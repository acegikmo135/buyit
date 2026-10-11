import { create } from 'zustand';
import * as N from './native';

export interface LogLine {
  t: number;
  text: string;
  level: 'info' | 'error' | 'ok';
}

interface ModelsState {
  models: N.ModelStatus[];
  progress: Record<string, N.DownloadProgress | undefined>;
  logs: LogLine[];
  dir: string;
  ready: boolean;
  log: (text: string, level?: LogLine['level']) => void;
  clearLogs: () => void;
  refresh: () => Promise<void>;
  init: () => Promise<void>;
  download: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

let inited = false;

export const useModels = create<ModelsState>((set, get) => ({
  models: [],
  progress: {},
  logs: [],
  dir: '',
  ready: false,
  log: (text, level = 'info') => set((s) => ({ logs: [...s.logs.slice(-299), { t: Date.now(), text, level }] })),
  clearLogs: () => set({ logs: [] }),
  refresh: async () => {
    if (!N.nativeAvailable()) return;
    try {
      set({ models: await N.listModels() });
    } catch (e) {
      get().log(String(e), 'error');
    }
  },
  init: async () => {
    if (inited || !N.nativeAvailable()) return;
    inited = true;
    try {
      set({ dir: await N.modelsDir() });
      await N.onNativeEvents(
        (p) => {
          set((s) => ({ progress: { ...s.progress, [p.id]: p } }));
          if (p.status !== 'downloading') void get().refresh();
        },
        (l) => get().log(l, l.startsWith('✗') || l.includes('✗') ? 'error' : l.startsWith('✓') ? 'ok' : 'info'),
      );
      await get().refresh();
      set({ ready: true });
      get().log('speech module ready');
    } catch (e) {
      get().log('init failed: ' + String(e), 'error');
    }
  },
  download: async (id) => {
    set((s) => ({ progress: { ...s.progress, [id]: { id, downloaded: 0, total: 0, bps: 0, status: 'downloading' } } }));
    try {
      await N.downloadModel(id);
    } catch (e) {
      if (String(e) !== 'cancelled') get().log(String(e), 'error');
    }
    await get().refresh();
  },
  cancel: async (id) => {
    await N.cancelDownload(id);
  },
  remove: async (id) => {
    await N.deleteModel(id);
    set((s) => ({ progress: { ...s.progress, [id]: undefined } }));
    await get().refresh();
  },
}));
