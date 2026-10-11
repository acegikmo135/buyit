// Animated edit effects: when the AI (or undo/redo) changes cells, the canvas shows a typewriter
// reveal with a glowing "AI cursor" instead of an instant swap. The model is already updated; this
// only overrides what the canvas *displays* for a short while.

export interface FxEntry {
  start: number; // performance.now() when scheduled
  delay: number;
  prev: string;
  next: string;
  typeMs: number;
  kind: 'ai' | 'user';
}

export const FADE_MS = 1100;

const active = new Map<string, Map<number, FxEntry>>();
const listeners = new Set<() => void>();

export function subscribeFx(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface FxInput {
  key: number;
  prev: string;
  next: string;
}

export function playFx(sheetId: string, items: FxInput[], kind: 'ai' | 'user' = 'ai', totalBudgetMs = 1800) {
  if (!items.length) return;
  const now = performance.now();
  // row-major order so the AI cursor sweeps naturally
  const sorted = [...items].sort((a, b) => a.key - b.key).slice(0, 1500);
  const step = kind === 'user' ? 0 : Math.max(6, Math.min(70, totalBudgetMs / sorted.length));
  let m = active.get(sheetId);
  if (!m) active.set(sheetId, (m = new Map()));
  sorted.forEach((it, i) => {
    const len = [...it.next].length;
    m!.set(it.key, {
      start: now,
      delay: i * step,
      prev: it.prev,
      next: it.next,
      typeMs: kind === 'user' ? 1 : Math.min(520, Math.max(120, len * 22)),
      kind,
    });
  });
  for (const l of listeners) l();
}

export function fxFor(sheetId: string): Map<number, FxEntry> | undefined {
  return active.get(sheetId);
}

/** Drops finished effects; returns true while anything is still animating. */
export function fxTick(now: number): boolean {
  let any = false;
  for (const [sid, m] of active) {
    for (const [k, e] of m) {
      if (now - e.start - e.delay > e.typeMs + FADE_MS) m.delete(k);
      else any = true;
    }
    if (!m.size) active.delete(sid);
  }
  return any;
}

export function fxActive() {
  return active.size > 0;
}

export function clearFx() {
  active.clear();
}
