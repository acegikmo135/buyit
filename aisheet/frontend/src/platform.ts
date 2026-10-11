// Bridge to the native Windows shell (Wails/Go). Falls back to plain-browser behaviour for dev and tests.

type Bound = Record<string, (...a: unknown[]) => Promise<unknown>>;
interface WailsRuntime {
  EventsOn(name: string, cb: (...d: unknown[]) => void): () => void;
}
declare global {
  interface Window {
    go?: { main?: { App?: Bound } };
    runtime?: WailsRuntime;
  }
}

const app = (): Bound | undefined => window.go?.main?.App;
export const isNative = () => !!app();

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  return (await app()![name](...args)) as T;
}

export function onNative(event: string, cb: (...d: unknown[]) => void): () => void {
  return window.runtime?.EventsOn(event, cb) ?? (() => {});
}

// ---------- base64 helpers ----------
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

// ---------- HTTP (no CORS + streaming inside the native shell) ----------
let reqSeq = 0;

export async function httpFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isNative()) return fetch(url, init);
  const id = `r${Date.now().toString(36)}${reqSeq++}`;
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => (headers[k] = v));
  const body = typeof init.body === 'string' ? init.body : '';

  return new Promise<Response>((resolve, reject) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let started = false;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => (controller = c),
      cancel: () => void call('HttpAbort', id),
    });
    const off = onNative('http:' + id, (m) => {
      const e = m as { t: string; status?: number; headers?: Record<string, string>; d?: string; m?: string };
      if (e.t === 'start') {
        started = true;
        const nullBody = [101, 204, 205, 304].includes(e.status!);
        resolve(new Response(nullBody ? null : stream, { status: e.status, headers: e.headers }));
      } else if (e.t === 'chunk') controller.enqueue(b64ToBytes(e.d!));
      else if (e.t === 'end') {
        off();
        controller.close();
      } else if (e.t === 'error') {
        off();
        if (!started) reject(new Error(e.m));
        else controller.error(new Error(e.m));
      }
    });
    init.signal?.addEventListener('abort', () => {
      void call('HttpAbort', id);
      off();
      if (!started) reject(new DOMException('Aborted', 'AbortError'));
      else controller.error(new DOMException('Aborted', 'AbortError'));
    });
    void call('HttpStream', { id, method: init.method ?? 'GET', url, headers, body });
  });
}

// ---------- secrets ----------
export async function setSecret(name: string, value: string): Promise<void> {
  if (isNative()) return call('SecretSet', name, value);
  try {
    if (value) localStorage.setItem('secret:' + name, value);
    else localStorage.removeItem('secret:' + name);
  } catch {
    /* ignore */
  }
}

export async function getSecret(name: string): Promise<string> {
  if (isNative()) return call<string>('SecretGet', name);
  try {
    return localStorage.getItem('secret:' + name) ?? '';
  } catch {
    return '';
  }
}

// ---------- files ----------
export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  path?: string;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export async function readPath(path: string): Promise<OpenedFile> {
  const b64 = await call<string>('ReadFile', path);
  return { name: baseName(path), bytes: b64ToBytes(b64), path };
}

export async function getLaunchFile(): Promise<string> {
  return isNative() ? call<string>('GetLaunchFile') : '';
}

export async function openFileDialog(): Promise<OpenedFile | null> {
  if (isNative()) {
    const path = await call<string>('PickOpen');
    return path ? readPath(path) : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xlsm,.csv,.tsv';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function saveFileDialog(suggested: string, bytes: Uint8Array, existingPath?: string): Promise<{ name: string; path?: string } | null> {
  if (isNative()) {
    const path = existingPath ?? (await call<string>('PickSave', suggested));
    if (!path) return null;
    await call('WriteFile', path, bytesToB64(bytes));
    return { name: baseName(path), path };
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  a.download = suggested;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { name: suggested };
}

export async function confirmDialog(message: string): Promise<boolean> {
  return isNative() ? call<boolean>('Confirm', message) : window.confirm(message);
}

export function setWindowTitle(title: string) {
  document.title = title;
  if (isNative()) void call('SetTitle', title);
}

export function setDirty(d: boolean) {
  if (isNative()) void call('SetDirty', d);
}
