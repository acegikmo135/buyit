// Bridge to the Rust speech module (whisper.cpp + model downloader). Only available in the desktop app.
import { isTauri } from '../platform';

export interface ModelStatus {
  id: string;
  label: string;
  note: string;
  size_mb: number;
  installed: boolean;
  partial_bytes: number;
  loaded: boolean;
}

export interface DownloadProgress {
  id: string;
  downloaded: number;
  total: number;
  bps: number;
  status: 'downloading' | 'done' | 'error' | 'cancelled';
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const nativeAvailable = () => isTauri();
export const listModels = () => invoke<ModelStatus[]>('speech_models');
export const modelsDir = () => invoke<string>('speech_dir');
export const downloadModel = (id: string) => invoke<void>('speech_download', { id });
export const cancelDownload = (id: string) => invoke<void>('speech_cancel', { id });
export const deleteModel = (id: string) => invoke<void>('speech_delete', { id });
export const unloadModel = () => invoke<void>('speech_unload');

/** Sends raw f32 PCM (16 kHz mono) to Rust as a binary body — no JSON/base64 overhead. */
export async function transcribeNative(pcm: Float32Array, model: string, lang: 'en' | 'gu' | 'auto', partial: boolean): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const body = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return invoke<string>('speech_transcribe', body, { headers: { 'x-model': model, 'x-lang': lang, 'x-partial': partial ? '1' : '0' } });
}

export async function onNativeEvents(onProgress: (p: DownloadProgress) => void, onLog: (l: string) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  const a = await listen<DownloadProgress>('speech:progress', (e) => onProgress(e.payload));
  const b = await listen<string>('speech:log', (e) => onLog(e.payload));
  return () => {
    a();
    b();
  };
}
