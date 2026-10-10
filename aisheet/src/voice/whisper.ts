// Main-thread client for the on-device Whisper worker (free, offline after the one-time model download).

export type WhisperModel = 'Xenova/whisper-base' | 'Xenova/whisper-small';

let worker: Worker | null = null;
let seq = 1;
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
let progressCb: ((p: number | null, label: string) => void) | null = null;
let readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  const files = new Map<string, { loaded: number; total: number }>();
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'progress') {
      if (m.status === 'progress' && typeof m.progress === 'number' && m.file) {
        files.set(m.file, { loaded: m.loaded ?? 0, total: m.total ?? 0 });
        let l = 0;
        let t = 0;
        for (const f of files.values()) {
          l += f.loaded;
          t += f.total;
        }
        progressCb?.(t ? l / t : null, 'download');
      } else if (m.status === 'ready') progressCb?.(1, 'ready');
    } else if (m.type === 'ready') {
      readyWaiters.forEach((w) => w.resolve());
      readyWaiters = [];
    } else if (m.type === 'result') {
      pending.get(m.id)?.resolve(m.text);
      pending.delete(m.id);
    } else if (m.type === 'error') {
      const err = new Error(m.message);
      if (m.id !== undefined && pending.has(m.id)) {
        pending.get(m.id)!.reject(err);
        pending.delete(m.id);
      } else {
        readyWaiters.forEach((w) => w.reject(err));
        readyWaiters = [];
      }
    }
  };
  return worker;
}

export function preloadWhisper(model: WhisperModel, onProgress: (p: number | null, label: string) => void): Promise<void> {
  progressCb = onProgress;
  return new Promise((resolve, reject) => {
    readyWaiters.push({ resolve, reject });
    getWorker().postMessage({ type: 'load', model });
  });
}

export function transcribeWhisper(audio: Float32Array, language: 'english' | 'gujarati' | null): Promise<string> {
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'transcribe', id, audio, language });
  });
}
