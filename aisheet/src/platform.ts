// Thin abstraction over Tauri (native Windows app) vs plain browser (dev / tests).

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** fetch that bypasses CORS inside Tauri (Rust-side HTTP). */
export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
    return tfetch(url, init);
  }
  return fetch(url, init);
}

// ---------- secrets (API keys) ----------
// Native: Windows Credential Manager through the Rust `keyring` crate. Browser dev: localStorage only.

export async function setSecret(name: string, value: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    if (value) await invoke('secret_set', { name, value });
    else await invoke('secret_delete', { name });
    return;
  }
  try {
    if (value) localStorage.setItem('secret:' + name, value);
    else localStorage.removeItem('secret:' + name);
  } catch {
    /* ignore */
  }
}

export async function getSecret(name: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return ((await invoke('secret_get', { name })) as string | null) ?? '';
  }
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

const FILE_FILTERS = [
  { name: 'Spreadsheets', extensions: ['xlsx', 'csv', 'tsv'] },
];

export async function openFileDialog(): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: FILE_FILTERS });
    if (!path || typeof path !== 'string') return null;
    const bytes = await readFile(path);
    return { name: path.split(/[\\/]/).pop() ?? path, bytes, path };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.csv,.tsv';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function saveFileDialog(suggested: string, bytes: Uint8Array, existingPath?: string): Promise<{ name: string; path?: string } | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const ext = suggested.split('.').pop()?.toLowerCase() ?? 'xlsx';
    const path =
      existingPath ??
      (await save({ defaultPath: suggested, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }));
    if (!path) return null;
    await writeFile(path, bytes);
    return { name: path.split(/[\\/]/).pop() ?? path, path };
  }
  const blob = new Blob([bytes as BlobPart]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggested;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { name: suggested };
}

export async function setWindowTitle(title: string) {
  document.title = title;
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setTitle(title);
    } catch {
      /* ignore */
    }
  }
}

export async function confirmDialog(message: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      return await ask(message, { title: 'AiSheet', kind: 'warning' });
    } catch {
      return true;
    }
  }
  return window.confirm(message);
}
