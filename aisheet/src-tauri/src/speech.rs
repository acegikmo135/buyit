//! On-device speech-to-text (whisper.cpp) + a resumable model downloader.
//! Pure logic: no Tauri types in here so it can be unit-tested on its own.

use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct ModelDef {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub size_mb: u32,
    pub note: &'static str,
}

/// Quantized GGML models (q5_1): ~3x smaller than fp16 with almost no accuracy loss.
pub const MODELS: &[ModelDef] = &[
    ModelDef { id: "tiny", label: "Tiny", file: "ggml-tiny-q5_1.bin", size_mb: 31, note: "fastest, rough accuracy" },
    ModelDef { id: "base", label: "Base", file: "ggml-base-q5_1.bin", size_mb: 57, note: "fast, good English" },
    ModelDef { id: "small", label: "Small", file: "ggml-small-q5_1.bin", size_mb: 181, note: "recommended for Gujarati" },
    ModelDef { id: "medium", label: "Medium", file: "ggml-medium-q5_0.bin", size_mb: 515, note: "best accuracy, slower, more RAM" },
];

/// Download sources, tried in order. The mirror is used automatically when the first host is slow or blocked.
pub const HOSTS: &[&str] = &[
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main",
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main",
];

pub fn find(id: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|m| m.id == id)
}

pub fn model_path(dir: &Path, m: &ModelDef) -> PathBuf {
    dir.join(m.file)
}

pub fn part_path(dir: &Path, m: &ModelDef) -> PathBuf {
    dir.join(format!("{}.part", m.file))
}

#[derive(Clone, serde::Serialize)]
pub struct Progress {
    pub id: String,
    pub downloaded: u64,
    pub total: u64,
    pub bps: u64,
    pub status: &'static str, // "downloading" | "done" | "error" | "cancelled"
}

/// Resumable download with stall detection and mirror fallback.
pub async fn download(
    dir: PathBuf,
    m: &'static ModelDef,
    cancel: Arc<AtomicBool>,
    on_progress: impl Fn(Progress) + Send + Sync,
    log: impl Fn(String) + Send + Sync,
) -> Result<(), String> {
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let part = part_path(&dir, m);
    let fin = model_path(&dir, m);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .user_agent("AiSheet/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let mut last_err = String::from("no host tried");

    // AISHEET_MODEL_HOST lets users (or tests) point at their own mirror; it is tried first.
    let mut hosts: Vec<String> = HOSTS.iter().map(|h| h.to_string()).collect();
    if let Ok(h) = std::env::var("AISHEET_MODEL_HOST") {
        hosts.insert(0, h.trim_end_matches('/').to_string());
    }
    for host in &hosts {
        let url = format!("{}/{}", host, m.file);
        let have = tokio::fs::metadata(&part).await.map(|x| x.len()).unwrap_or(0);
        log(format!("GET {} (resume from {} bytes)", url, have));
        let mut req = client.get(&url);
        if have > 0 {
            req = req.header("Range", format!("bytes={}-", have));
        }
        let resp = match tokio::time::timeout(Duration::from_secs(20), req.send()).await {
            Err(_) => {
                last_err = "timed out waiting for the server".into();
                log(format!("  ✗ {} — trying next source", last_err));
                continue;
            }
            Ok(Err(e)) => {
                last_err = e.to_string();
                log(format!("  ✗ connection failed: {} — trying next source", last_err));
                continue;
            }
            Ok(Ok(r)) => r,
        };
        let status = resp.status();
        log(format!("  HTTP {}", status));
        if status.as_u16() == 416 && have > 1_000_000 {
            // already fully downloaded
            tokio::fs::rename(&part, &fin).await.map_err(|e| e.to_string())?;
            on_progress(Progress { id: m.id.into(), downloaded: have, total: have, bps: 0, status: "done" });
            return Ok(());
        }
        if !status.is_success() {
            last_err = format!("HTTP {}", status);
            continue;
        }
        let resumed = status.as_u16() == 206;
        let base = if resumed { have } else { 0 };
        let total = resp.content_length().map(|l| l + base).unwrap_or(0);
        log(format!("  size {} MB{}", total / 1_048_576, if resumed { " (resumed)" } else { "" }));

        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(resumed)
            .truncate(!resumed)
            .open(&part)
            .await
            .map_err(|e| e.to_string())?;
        let mut stream = resp.bytes_stream();
        let mut done = base;
        let mut window_start = Instant::now();
        let mut window_bytes = 0u64;
        let mut bps = 0u64;
        let mut ok = true;
        loop {
            if cancel.load(Ordering::Relaxed) {
                log("cancelled by user (partial file kept, you can resume)".into());
                on_progress(Progress { id: m.id.into(), downloaded: done, total, bps: 0, status: "cancelled" });
                return Err("cancelled".into());
            }
            match tokio::time::timeout(Duration::from_secs(25), stream.next()).await {
                Err(_) => {
                    last_err = "download stalled (no data for 25s)".into();
                    log(format!("  ✗ {} — switching source", last_err));
                    ok = false;
                    break;
                }
                Ok(None) => break,
                Ok(Some(Err(e))) => {
                    last_err = e.to_string();
                    log(format!("  ✗ stream error: {} — switching source", last_err));
                    ok = false;
                    break;
                }
                Ok(Some(Ok(chunk))) => {
                    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                    done += chunk.len() as u64;
                    window_bytes += chunk.len() as u64;
                    let el = window_start.elapsed();
                    if el >= Duration::from_millis(400) {
                        bps = (window_bytes as f64 / el.as_secs_f64()) as u64;
                        window_start = Instant::now();
                        window_bytes = 0;
                        on_progress(Progress { id: m.id.into(), downloaded: done, total, bps, status: "downloading" });
                    }
                }
            }
        }
        file.flush().await.ok();
        drop(file);
        if ok {
            if total > 0 && done < total {
                last_err = format!("incomplete: {} of {} bytes", done, total);
                log(format!("  ✗ {}", last_err));
                continue;
            }
            tokio::fs::rename(&part, &fin).await.map_err(|e| e.to_string())?;
            log(format!("✓ saved {}", fin.display()));
            on_progress(Progress { id: m.id.into(), downloaded: done, total: done, bps, status: "done" });
            return Ok(());
        }
    }
    on_progress(Progress { id: m.id.into(), downloaded: 0, total: 0, bps: 0, status: "error" });
    Err(format!("all download sources failed: {}", last_err))
}

// ---------- inference ----------

pub struct Loaded {
    pub id: String,
    pub ctx: WhisperContext,
}

pub fn load(path: &Path, id: &str) -> Result<Loaded, String> {
    let mut p = WhisperContextParameters::default();
    p.use_gpu(false);
    let ctx = WhisperContext::new_with_params(path.to_str().ok_or("bad path")?, p).map_err(|e| format!("could not load model: {e}"))?;
    Ok(Loaded { id: id.into(), ctx })
}

fn threads() -> i32 {
    std::thread::available_parallelism().map(|n| n.get() as i32).unwrap_or(4).clamp(2, 6)
}

/// `lang`: "en", "gu" or "auto". `partial` trades accuracy for speed (used for the live transcript).
pub fn transcribe(l: &Loaded, pcm: &[f32], lang: &str, partial: bool) -> Result<String, String> {
    let mut state = l.ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(lang));
    params.set_translate(false);
    params.set_n_threads(threads());
    params.set_no_context(true);
    params.set_single_segment(partial);
    params.set_no_timestamps(true);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    state.full(params, pcm).map_err(|e| format!("transcription failed: {e}"))?;
    let mut out = String::new();
    for seg in state.as_iter() {
        let t = seg.to_str_lossy().map_err(|e| e.to_string())?;
        out.push_str(&t);
    }
    Ok(clean_output(&out))
}

/// Strips whisper's non-speech markers such as "[BLANK_AUDIO]" or "(music)".
pub fn clean_output(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for ch in s.chars() {
        match ch {
            '[' | '(' | '♪' => depth += 1,
            ']' | ')' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_markers() {
        assert_eq!(clean_output(" [BLANK_AUDIO] hello (music) world "), "hello world");
    }
}
