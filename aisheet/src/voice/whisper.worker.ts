/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
// WASM runtime is shipped inside the app (public/ort) — nothing is fetched from a CDN.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = new URL('/ort/', self.location.origin).href;

type Msg =
  | { type: 'load'; model: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: 'english' | 'gujarati' | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let loaded = '';

async function ensure(model: string) {
  if (asr && loaded === model) return;
  const hasGpu = 'gpu' in navigator;
  const progress_callback = (p: { status: string; progress?: number; file?: string }) => postMessage({ type: 'progress', ...p });
  try {
    asr = await pipeline('automatic-speech-recognition', model, { device: hasGpu ? 'webgpu' : 'wasm', dtype: hasGpu ? 'fp32' : 'q8', progress_callback } as never);
  } catch {
    asr = await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback } as never);
  }
  loaded = model;
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      await ensure(m.model);
      postMessage({ type: 'ready' });
    } else {
      await ensure(loaded || 'Xenova/whisper-small');
      const opts: Record<string, unknown> = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
      if (m.language) opts.language = m.language;
      const out = await asr(m.audio, opts);
      postMessage({ type: 'result', id: m.id, text: (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) as string });
    }
  } catch (err) {
    postMessage({ type: 'error', id: (m as { id?: number }).id, message: (err as Error).message });
  }
};
