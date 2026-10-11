import { create } from 'zustand';
import { toast } from '@heroui/react';
import { useSyncExternalStore } from 'react';
import { Workbook } from './core/workbook';
import type { Cell, Sheet } from './core/types';
import { normRange, type Range } from './core/address';
import { DEFAULT_PERMISSIONS, type Denied, type ExecContext, type Permissions, type Preview } from './ai/executor';
import type { Action } from './ai/protocol';
import { PROVIDERS, type ProviderId } from './ai/providers';
import type { Lang } from './i18n';

export const wb = new Workbook();

export function useWbVersion(): number {
  return useSyncExternalStore(
    (cb) => wb.subscribe(cb),
    () => wb.version,
  );
}

export interface AgentTask {
  id: string;
  title: string;
  instruction: string;
  depends: string[];
  status: 'queued' | 'running' | 'done' | 'error' | 'skipped';
  text: string;
  steps: string[];
  actions: number;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}
export interface AgentRun {
  goal: string;
  tasks: AgentTask[];
  status: 'pending' | 'running' | 'merging' | 'done' | 'cancelled' | 'error';
  prompt: string;
}

export interface ChatMsg {
  id: number;
  role: 'user' | 'ai' | 'sys';
  text: string;
  streaming?: boolean;
  /** tool calls the assistant made while answering ("Read Sales!A100:F160") */
  steps?: string[];
  /** sub-agent plan attached to this message */
  agent?: AgentRun;
  proposalId?: number;
  result?: { applied: number; denied: number; errors: string[]; txId?: number };
  error?: boolean;
}

export interface Proposal {
  id: number;
  actions: Action[];
  ok: { index: number; action: Action }[];
  denied: Denied[];
  preview: Preview;
  ctx: ExecContext;
  selected: Set<number>;
  prompt: string;
  status: 'pending' | 'applied' | 'rejected';
}

export interface Editing {
  r: number;
  c: number;
  sheetId: string;
  text: string;
  from: 'cell' | 'bar';
}

export interface Clip {
  block: (Cell | undefined)[][];
  from: { r: number; c: number };
  tsv: string;
  cut: boolean;
  sheetId: string;
  range: Range;
}

export interface VoiceSettings {
  /** Deepgram Nova-3 language: English or Gujarati. */
  lang: 'en' | 'gu';
  /** Smart clean-up of the dictated text (fillers, punctuation, cell references). */
  polish: boolean;
}

export type DialogState =
  | { kind: 'find'; replace?: boolean }
  | { kind: 'chart'; id?: string }
  | { kind: 'cf' }
  | { kind: 'dv' }
  | { kind: 'pivot' }
  | { kind: 'page' }
  | { kind: 'comment'; r: number; c: number }
  | { kind: 'names' }
  | { kind: 'formula'; mode?: 'create' | 'explain' | 'fix'; seed?: string; autoVoice?: boolean }
  | { kind: 'textcols' }
  | { kind: 'dedupe' };

export type Theme = 'system' | 'light' | 'dark';
export type Panel = 'ai' | 'history' | null;

interface Persisted {
  theme: Theme;
  lang: Lang;
  aiLang: 'auto' | Lang;
  providerId: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  baseUrls: Partial<Record<ProviderId, string>>;
  permissions: Permissions;
  panel: Panel;
  voice: VoiceSettings;
  /** OpenRouter: only route to providers that neither store nor train on prompts. */
  strictPrivacy: boolean;
  /** allow the assistant to split big jobs across parallel sub-agents */
  multiAgent: boolean;
  /** assistant side-panel width in px, and whether it is collapsed to a rail */
  panelWidth: number;
  panelMin: boolean;
}

const SETTINGS_KEY = 'aisheet:settings:v1';

function loadPersisted(): Persisted {
  const def: Persisted = {
    theme: 'system',
    lang: (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('gu') ? 'gu' : 'en') as Lang,
    aiLang: 'auto',
    providerId: 'openai',
    models: {},
    baseUrls: {},
    permissions: DEFAULT_PERMISSIONS,
    panel: 'ai',
    voice: { lang: 'en', polish: true },
    strictPrivacy: true,
    multiAgent: true,
    panelWidth: 400,
    panelMin: false,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Persisted>;
      return { ...def, ...j, voice: { ...def.voice, lang: j.voice?.lang === 'gu' ? 'gu' : 'en', polish: j.voice?.polish ?? true }, permissions: { ...DEFAULT_PERMISSIONS, ...j.permissions, allow: { ...DEFAULT_PERMISSIONS.allow, ...j.permissions?.allow } } };
    }
  } catch {
    /* ignore */
  }
  return def;
}

export interface AppState extends Persisted {
  activeSheetId: string;
  anchor: { r: number; c: number };
  active: { r: number; c: number };
  editing: Editing | null;
  clip: Clip | null;
  file: { name: string; path?: string; dirty: boolean };
  settingsOpen: boolean;
  settingsTab: 'ai' | 'perm' | 'voice' | 'general';
  keys: Partial<Record<ProviderId, string>>;
  deepgramKey?: string;
  msgs: ChatMsg[];
  busy: boolean;
  proposal: Proposal | null;
  draft: string;
  zoom: number;
  ribbonTab: 'home' | 'insert' | 'data' | 'view' | 'ai';
  dialog: DialogState | null;
  selectedChart: string | null;
  /** auto-fit columns after AI edits / paste / file open */
  autoFit: boolean;
  find: { query: string; keys: number[]; idx: number; sheetId: string } | null;

  set: (p: Partial<AppState>) => void;
  select: (anchor: { r: number; c: number }, active?: { r: number; c: number }) => void;
  persist: () => void;
  showToast: (text: string) => void;
}

const persisted = loadPersisted();

export const useStore = create<AppState>((set, get) => ({
  ...persisted,
  activeSheetId: wb.sheets[0].id,
  anchor: { r: 0, c: 0 },
  active: { r: 0, c: 0 },
  editing: null,
  clip: null,
  file: { name: 'Untitled', dirty: false },
  settingsOpen: false,
  settingsTab: 'ai',
  keys: {},
  msgs: [],
  busy: false,
  proposal: null,
  draft: '',
  zoom: 1,
  ribbonTab: 'home',
  dialog: null,
  selectedChart: null,
  autoFit: true,
  find: null,

  set: (p) => {
    set(p);
    if ('theme' in p || 'lang' in p || 'aiLang' in p || 'providerId' in p || 'models' in p || 'baseUrls' in p || 'permissions' in p || 'panel' in p || 'voice' in p || 'strictPrivacy' in p || 'multiAgent' in p || 'panelWidth' in p || 'panelMin' in p) get().persist();
  },
  select: (anchor, active) => set({ anchor, active: active ?? anchor }),
  persist: () => {
    const s = get();
    const p: Persisted = { theme: s.theme, lang: s.lang, aiLang: s.aiLang, providerId: s.providerId, models: s.models, baseUrls: s.baseUrls, permissions: s.permissions, panel: s.panel, voice: s.voice, strictPrivacy: s.strictPrivacy, multiAgent: s.multiAgent, panelWidth: s.panelWidth, panelMin: s.panelMin };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  },
  showToast: (text) => {
    toast(text, { timeout: 3500 });
  },
}));

// ---------- derived helpers ----------
export function activeSheet(): Sheet {
  return wb.sheetById(useStore.getState().activeSheetId) ?? wb.sheets[0];
}

export function selectionRange(): Range {
  const { anchor, active } = useStore.getState();
  return normRange({ r1: anchor.r, c1: anchor.c, r2: active.r, c2: active.c });
}

export function execContext(): ExecContext {
  const s = useStore.getState();
  const R = normRange({ r1: s.anchor.r, c1: s.anchor.c, r2: s.active.r, c2: s.active.c });
  return { activeSheetId: activeSheet().id, selection: R };
}

export function providerModel(id: ProviderId): string {
  const s = useStore.getState();
  return s.models[id] ?? PROVIDERS.find((p) => p.id === id)?.defaultModel ?? '';
}

// handle for automated UI tests
if (typeof window !== 'undefined') (window as unknown as { __aisheet: unknown }).__aisheet = { wb, useStore };
