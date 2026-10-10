// Cell addressing helpers. Rows and columns are 0-based internally.

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;

export function colToName(c: number): string {
  let s = '';
  c += 1;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

export function nameToCol(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface CellPos {
  r: number;
  c: number;
}

export interface Range {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export const keyOf = (r: number, c: number) => r * 65536 + c;
export const rowOfKey = (k: number) => Math.floor(k / 65536);
export const colOfKey = (k: number) => k % 65536;

export function addr(r: number, c: number): string {
  return colToName(c) + (r + 1);
}

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;

export function parseAddr(s: string): CellPos | null {
  const m = CELL_RE.exec(s.trim());
  if (!m) return null;
  const c = nameToCol(m[1]);
  const r = parseInt(m[2], 10) - 1;
  if (r < 0 || r >= MAX_ROWS || c < 0 || c >= MAX_COLS) return null;
  return { r, c };
}

export function normRange(a: Range): Range {
  return {
    r1: Math.min(a.r1, a.r2),
    c1: Math.min(a.c1, a.c2),
    r2: Math.max(a.r1, a.r2),
    c2: Math.max(a.c1, a.c2),
  };
}

/** Parses "A1", "A1:B3", "A:A", "2:5". Whole-column / whole-row ranges use used-range bounds supplied by caller. */
export function parseRange(s: string, maxR = MAX_ROWS - 1, maxC = MAX_COLS - 1): Range | null {
  const t = s.trim().replace(/\$/g, '');
  const parts = t.split(':');
  if (parts.length === 1) {
    const p = parseAddr(parts[0]);
    return p ? { r1: p.r, c1: p.c, r2: p.r, c2: p.c } : null;
  }
  if (parts.length !== 2) return null;
  const a = parseAddr(parts[0]);
  const b = parseAddr(parts[1]);
  if (a && b) return normRange({ r1: a.r, c1: a.c, r2: b.r, c2: b.c });
  if (/^[A-Za-z]{1,3}$/.test(parts[0]) && /^[A-Za-z]{1,3}$/.test(parts[1])) {
    return normRange({ r1: 0, c1: nameToCol(parts[0]), r2: maxR, c2: nameToCol(parts[1]) });
  }
  if (/^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return normRange({ r1: parseInt(parts[0], 10) - 1, c1: 0, r2: parseInt(parts[1], 10) - 1, c2: maxC });
  }
  return null;
}

export function rangeToString(r: Range): string {
  if (r.r1 === r.r2 && r.c1 === r.c2) return addr(r.r1, r.c1);
  return `${addr(r.r1, r.c1)}:${addr(r.r2, r.c2)}`;
}

export const rangeRows = (r: Range) => r.r2 - r.r1 + 1;
export const rangeCols = (r: Range) => r.c2 - r.c1 + 1;
export const inRange = (r: Range, row: number, col: number) =>
  row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;
