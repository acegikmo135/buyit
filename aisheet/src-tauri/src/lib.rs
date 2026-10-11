mod speech;

use keyring::Entry;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

const SERVICE: &str = "AiSheet";

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

/// Stores an API key in the OS credential store (never on disk in plain text).
#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    entry(&name)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- speech-to-text ----------

/// Loaded model is dropped after this much idle time so the app doesn't hold hundreds of MB for nothing.
const IDLE_UNLOAD: Duration = Duration::from_secs(40);

#[derive(Default)]
struct Speech {
    engine: Mutex<Option<speech::Loaded>>,
    last_used: Mutex<Option<Instant>>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(serde::Serialize)]
struct ModelStatus {
    id: &'static str,
    label: &'static str,
    note: &'static str,
    size_mb: u32,
    installed: bool,
    partial_bytes: u64,
    loaded: bool,
}

fn models_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("models")).map_err(|e| e.to_string())
}

fn log(app: &AppHandle, line: impl Into<String>) {
    let _ = app.emit("speech:log", line.into());
}

#[tauri::command]
fn speech_models(app: AppHandle, state: State<'_, Arc<Speech>>) -> Result<Vec<ModelStatus>, String> {
    let dir = models_dir(&app)?;
    let loaded = state.engine.lock().unwrap().as_ref().map(|l| l.id.clone());
    Ok(speech::MODELS
        .iter()
        .map(|m| ModelStatus {
            id: m.id,
            label: m.label,
            note: m.note,
            size_mb: m.size_mb,
            installed: speech::model_path(&dir, m).exists(),
            partial_bytes: std::fs::metadata(speech::part_path(&dir, m)).map(|x| x.len()).unwrap_or(0),
            loaded: loaded.as_deref() == Some(m.id),
        })
        .collect())
}

#[tauri::command]
fn speech_dir(app: AppHandle) -> Result<String, String> {
    Ok(models_dir(&app)?.display().to_string())
}

#[tauri::command]
async fn speech_download(app: AppHandle, state: State<'_, Arc<Speech>>, id: String) -> Result<(), String> {
    let m = speech::find(&id).ok_or("unknown model")?;
    let dir = models_dir(&app)?;
    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().unwrap().insert(id.clone(), cancel.clone());
    log(&app, format!("▶ downloading {} ({} MB)", m.label, m.size_mb));
    let a1 = app.clone();
    let a2 = app.clone();
    let r = speech::download(
        dir,
        m,
        cancel,
        move |p| {
            let _ = a1.emit("speech:progress", p);
        },
        move |l| log(&a2, l),
    )
    .await;
    state.cancels.lock().unwrap().remove(&id);
    if let Err(e) = &r {
        log(&app, format!("✗ {}", e));
    }
    r
}

#[tauri::command]
fn speech_cancel(state: State<'_, Arc<Speech>>, id: String) {
    if let Some(c) = state.cancels.lock().unwrap().get(&id) {
        c.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[tauri::command]
fn speech_delete(app: AppHandle, state: State<'_, Arc<Speech>>, id: String) -> Result<(), String> {
    let m = speech::find(&id).ok_or("unknown model")?;
    let dir = models_dir(&app)?;
    let mut eng = state.engine.lock().unwrap();
    if eng.as_ref().map(|l| l.id == id).unwrap_or(false) {
        *eng = None;
    }
    let _ = std::fs::remove_file(speech::model_path(&dir, m));
    let _ = std::fs::remove_file(speech::part_path(&dir, m));
    log(&app, format!("deleted {}", m.label));
    Ok(())
}

#[tauri::command]
fn speech_unload(app: AppHandle, state: State<'_, Arc<Speech>>) {
    if state.engine.lock().unwrap().take().is_some() {
        log(&app, "model unloaded (RAM freed)");
    }
}

/// Body = raw little-endian f32 PCM at 16 kHz mono. Headers: x-model, x-lang, x-partial.
#[tauri::command]
async fn speech_transcribe(app: AppHandle, state: State<'_, Arc<Speech>>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw audio body".into()) };
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let (model_id, lang, partial) = (h("x-model"), h("x-lang"), h("x-partial") == "1");
    let pcm: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let m = speech::find(&model_id).ok_or("unknown model")?;
    let path = speech::model_path(&models_dir(&app)?, m);
    if !path.exists() {
        return Err("model-not-installed".into());
    }
    let st = state.inner().clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut eng = st.engine.lock().unwrap();
        if eng.as_ref().map(|l| l.id != model_id).unwrap_or(true) {
            let t = Instant::now();
            *eng = None; // free the old model before loading the new one
            *eng = Some(speech::load(&path, &model_id)?);
            log(&app2, format!("model {} loaded in {} ms", model_id, t.elapsed().as_millis()));
        }
        let t = Instant::now();
        let out = speech::transcribe(eng.as_ref().unwrap(), &pcm, if lang.is_empty() { "auto" } else { &lang }, partial)?;
        if !partial {
            log(&app2, format!("transcribed {:.1}s of audio in {} ms", pcm.len() as f32 / 16000.0, t.elapsed().as_millis()));
        }
        *st.last_used.lock().unwrap() = Some(Instant::now());
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .manage(Arc::new(Speech::default()))
        .setup(|app| {
            // idle watchdog: unload the model after a period of no dictation
            let handle = app.handle().clone();
            let speech: Arc<Speech> = app.state::<Arc<Speech>>().inner().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(10));
                let idle = speech.last_used.lock().unwrap().map(|t| t.elapsed() > IDLE_UNLOAD).unwrap_or(false);
                if idle {
                    if let Ok(mut e) = speech.engine.try_lock() {
                        if e.take().is_some() {
                            *speech.last_used.lock().unwrap() = None;
                            log(&handle, "idle — model unloaded to free RAM");
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secret_set,
            secret_get,
            secret_delete,
            speech_models,
            speech_dir,
            speech_download,
            speech_cancel,
            speech_delete,
            speech_unload,
            speech_transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running AiSheet");
}
