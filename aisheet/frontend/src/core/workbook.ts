import { keyOf, rowOfKey, colOfKey, normRange, type Range } from './address';
import { evaluateFormula, type EvalCtx } from './formula';
import { adjustFormula, renameSheetInFormula, shiftFormula } from './tokens';
import { FormulaError, type Cell, type CellStyle, type Scalar, type Sheet } from './types';
import { parseInput } from './format';

export type TxSource = 'user' | 'ai';

type Snap = { sheets: Sheet[] };
type Entry =
  | { kind: 'cell'; sheetId: string; key: number; before: Cell | undefined; after: Cell | undefined }
  | { kind: 'snap'; before: Snap; after: Snap };

export interface Tx {
  id: number;
  label: string;
  source: TxSource;
  ts: number;
  entries: Entry[];
}

export interface CellChange {
  sheetId: string;
  key: number;
  before: Cell | undefined;
  after: Cell | undefined;
}

let sheetCounter = 1;
const newSheetId = () => `s${Date.now().toString(36)}${(sheetCounter++).toString(36)}`;

export function makeSheet(name: string): Sheet {
  return { id: newSheetId(), name, cells: new Map(), colW: new Map(), rowH: new Map(), freezeRows: 0, freezeCols: 0 };
}

function cloneSheet(s: Sheet): Sheet {
  return { ...s, cells: new Map(s.cells), colW: new Map(s.colW), rowH: new Map(s.rowH) };
}

export class Workbook {
  sheets: Sheet[] = [makeSheet('Sheet1')];
  version = 0;
  undoStack: Tx[] = [];
  redoStack: Tx[] = [];
  private tx: Tx | null = null;
  private txCounter = 1;
  private listeners = new Set<() => void>();
  private cache = new Map<string, Scalar>();
  private evaluating = new Set<string>();
  private nameIdx = new Map<string, Sheet>();
  private bounds = new Map<string, { r: number; c: number }>();
  /** Called after every committed or undone transaction with its cell-level changes. */
  onTxApplied: ((tx: Tx, dir: 'do' | 'undo' | 'redo') => void) | null = null;

  constructor() {
    this.reindex();
  }

  // ---------- subscription ----------
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private touch() {
    this.version++;
    this.cache.clear();
    this.bounds.clear();
    this.reindex();
    for (const l of this.listeners) l();
  }
  private reindex() {
    this.nameIdx.clear();
    for (const s of this.sheets) this.nameIdx.set(s.name.toLowerCase(), s);
  }

  // ---------- lookup ----------
  sheetById(id: string): Sheet | undefined {
    return this.sheets.find((s) => s.id === id);
  }
  sheetByName(name: string): Sheet | undefined {
    return this.nameIdx.get(name.toLowerCase());
  }
  resolveSheet(ref: string | undefined, fallbackId: string): Sheet {
    return (ref ? this.sheetByName(ref) ?? this.sheetById(ref) : undefined) ?? this.sheetById(fallbackId) ?? this.sheets[0];
  }

  /** 0-based last used row/col (-1 when empty). */
  usedBounds(sheet: Sheet): { r: number; c: number } {
    let b = this.bounds.get(sheet.id);
    if (!b) {
      let r = -1;
      let c = -1;
      for (const [k, cell] of sheet.cells) {
        if (cell.raw === '' && !cell.style) continue;
        const kr = rowOfKey(k);
        const kc = colOfKey(k);
        if (kr > r) r = kr;
        if (kc > c) c = kc;
      }
      b = { r, c };
      this.bounds.set(sheet.id, b);
    }
    return b;
  }

  // ---------- evaluation ----------
  getCell(sheet: Sheet, r: number, c: number): Cell | undefined {
    return sheet.cells.get(keyOf(r, c));
  }

  value(sheet: Sheet, r: number, c: number): Scalar {
    const key = keyOf(r, c);
    const cell = sheet.cells.get(key);
    if (!cell) return null;
    const raw = cell.raw;
    if (typeof raw !== 'string' || !raw.startsWith('=') || cell.style?.fmt === 'text') return raw === '' ? null : raw;
    const ck = sheet.id + ':' + key;
    const hit = this.cache.get(ck);
    if (hit !== undefined) return hit;
    if (this.evaluating.has(ck)) return new FormulaError('#CIRC!');
    this.evaluating.add(ck);
    let v: Scalar;
    try {
      v = evaluateFormula(raw, this.ctxFor(sheet));
    } finally {
      this.evaluating.delete(ck);
    }
    this.cache.set(ck, v);
    return v;
  }

  private ctxFor(sheet: Sheet): EvalCtx {
    return {
      sheet: sheet.name,
      hasSheet: (n) => !!this.sheetByName(n),
      getCell: (n, r, c) => {
        const s = this.sheetByName(n);
        return s ? this.value(s, r, c) : new FormulaError('#REF!');
      },
      getRange: (n, r1, c1, r2, c2) => {
        const s = this.sheetByName(n);
        if (!s) return [[new FormulaError('#REF!')]];
        const ub = this.usedBounds(s);
        const rr2 = Math.min(r2, Math.max(ub.r, r1));
        const cc2 = Math.min(c2, Math.max(ub.c, c1));
        const out: Scalar[][] = [];
        for (let r = r1; r <= rr2; r++) {
          const row: Scalar[] = [];
          for (let c = c1; c <= cc2; c++) row.push(this.value(s, r, c));
          out.push(row);
        }
        return out;
      },
    };
  }

  // ---------- transactions ----------
  private depth = 0;

  /** Runs `fn` inside one undoable transaction. Nested calls join the outer transaction. */
  run<T>(label: string, source: TxSource, fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.tx = { id: this.txCounter++, label, source, ts: Date.now(), entries: [] };
    try {
      const out = fn();
      return out;
    } finally {
      this.depth--;
      const tx = this.tx;
      this.tx = null;
      if (tx && tx.entries.length) {
        this.undoStack.push(tx);
        if (this.undoStack.length > 500) this.undoStack.shift();
        this.redoStack = [];
        this.touch();
        this.onTxApplied?.(tx, 'do');
      }
    }
  }

  private record(e: Entry) {
    if (!this.tx) throw new Error('mutation outside of transaction');
    this.tx.entries.push(e);
  }

  private snap(): Snap {
    return { sheets: this.sheets.map(cloneSheet) };
  }
  private restore(s: Snap) {
    this.sheets = s.sheets.map(cloneSheet);
  }

  private applyEntries(tx: Tx, dir: 'undo' | 'redo') {
    const list = dir === 'undo' ? [...tx.entries].reverse() : tx.entries;
    for (const e of list) {
      if (e.kind === 'snap') this.restore(dir === 'undo' ? e.before : e.after);
      else {
        const sh = this.sheetById(e.sheetId);
        if (!sh) continue;
        const v = dir === 'undo' ? e.before : e.after;
        if (v) sh.cells.set(e.key, v);
        else sh.cells.delete(e.key);
      }
    }
  }

  undo(): Tx | null {
    const tx = this.undoStack.pop();
    if (!tx) return null;
    this.applyEntries(tx, 'undo');
    this.redoStack.push(tx);
    this.touch();
    this.onTxApplied?.(tx, 'undo');
    return tx;
  }
  redo(): Tx | null {
    const tx = this.redoStack.pop();
    if (!tx) return null;
    this.applyEntries(tx, 'redo');
    this.undoStack.push(tx);
    this.touch();
    this.onTxApplied?.(tx, 'redo');
    return tx;
  }
  /** Undo until the stack has `keep` entries. */
  revertTo(keep: number) {
    while (this.undoStack.length > keep) this.undo();
  }

  cellChangesOf(tx: Tx): CellChange[] {
    return tx.entries.filter((e): e is Extract<Entry, { kind: 'cell' }> => e.kind === 'cell');
  }
  hasStructuralChange(tx: Tx) {
    return tx.entries.some((e) => e.kind === 'snap');
  }

  // ---------- cell mutations ----------
  setCellRaw(sheet: Sheet, r: number, c: number, cell: Cell | undefined) {
    const key = keyOf(r, c);
    const before = sheet.cells.get(key);
    if (before === cell) return;
    if (cell && before && before.raw === cell.raw && JSON.stringify(before.style) === JSON.stringify(cell.style)) return;
    if (cell && cell.raw === '' && !cell.style) cell = undefined;
    if (!cell && !before) return;
    this.record({ kind: 'cell', sheetId: sheet.id, key, before, after: cell });
    if (cell) sheet.cells.set(key, cell);
    else sheet.cells.delete(key);
  }

  setInput(sheet: Sheet, r: number, c: number, text: string, label = 'Edit cell', source: TxSource = 'user') {
    this.run(label, source, () => {
      const prev = sheet.cells.get(keyOf(r, c));
      const raw = parseInput(text);
      this.setCellRaw(sheet, r, c, raw === '' && !prev?.style ? undefined : { raw, style: prev?.style });
    });
  }

  setValue(sheet: Sheet, r: number, c: number, raw: string | number | boolean | null) {
    const prev = sheet.cells.get(keyOf(r, c));
    if (raw === null || raw === '') this.setCellRaw(sheet, r, c, prev?.style ? { raw: '', style: prev.style } : undefined);
    else this.setCellRaw(sheet, r, c, { raw, style: prev?.style });
  }

  applyStyle(sheet: Sheet, rng: Range, patch: Partial<CellStyle>, label = 'Format', source: TxSource = 'user') {
    const R = normRange(rng);
    this.run(label, source, () => {
      const ub = this.usedBounds(sheet);
      // Cap formatting of whole-row/column selections to a sane area to avoid millions of cells.
      const r2 = Math.min(R.r2, Math.max(ub.r + 200, R.r1 + 2000));
      const c2 = Math.min(R.c2, Math.max(ub.c + 5, R.c1 + 60));
      for (let r = R.r1; r <= r2; r++)
        for (let c = R.c1; c <= c2; c++) {
          const prev = sheet.cells.get(keyOf(r, c));
          const style: CellStyle = { ...prev?.style };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === false || v === '' || (k === 'align' && v === 'left' && false)) delete (style as Record<string, unknown>)[k];
            else (style as Record<string, unknown>)[k] = v;
          }
          const hasStyle = Object.keys(style).length > 0;
          this.setCellRaw(sheet, r, c, { raw: prev?.raw ?? '', style: hasStyle ? style : undefined });
        }
    });
  }

  clearRange(sheet: Sheet, rng: Range, opts: { contents?: boolean; styles?: boolean } = { contents: true }, label = 'Clear', source: TxSource = 'user') {
    const R = normRange(rng);
    this.run(label, source, () => {
      const keys: number[] = [];
      for (const k of sheet.cells.keys()) {
        const r = rowOfKey(k);
        const c = colOfKey(k);
        if (r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2) keys.push(k);
      }
      for (const k of keys) {
        const prev = sheet.cells.get(k)!;
        const r = rowOfKey(k);
        const c = colOfKey(k);
        const raw = opts.contents ? '' : prev.raw;
        const style = opts.styles ? undefined : prev.style;
        this.setCellRaw(sheet, r, c, raw === '' && !style ? undefined : { raw, style });
      }
    });
  }

  /** Pastes a block of cells (raw/style) at (r,c). Formulas are shifted relative to `from`. */
  pasteBlock(sheet: Sheet, r: number, c: number, block: (Cell | undefined)[][], from: { r: number; c: number } | null, opts: { values?: boolean } = {}, label = 'Paste', source: TxSource = 'user') {
    this.run(label, source, () => {
      for (let i = 0; i < block.length; i++)
        for (let j = 0; j < block[i].length; j++) {
          const src = block[i][j];
          const tr = r + i;
          const tc = c + j;
          if (tr < 0 || tc < 0) continue;
          if (!src) {
            if (!opts.values) this.setCellRaw(sheet, tr, tc, undefined);
            continue;
          }
          let raw = src.raw;
          if (typeof raw === 'string' && raw.startsWith('=') && from) raw = shiftFormula(raw, tr - (from.r + i), tc - (from.c + j));
          if (opts.values) {
            const prev = sheet.cells.get(keyOf(tr, tc));
            this.setCellRaw(sheet, tr, tc, { raw, style: prev?.style });
          } else this.setCellRaw(sheet, tr, tc, { raw, style: src.style });
        }
    });
  }

  /** Fills `target` by repeating the source range (formulas shifted). */
  fillRange(sheet: Sheet, src: Range, target: Range, label = 'Fill', source: TxSource = 'user') {
    const S = normRange(src);
    const T = normRange(target);
    const sh = S.r2 - S.r1 + 1;
    const sw = S.c2 - S.c1 + 1;
    this.run(label, source, () => {
      // detect simple numeric series for single-column/row source of >=2 numbers
      for (let r = T.r1; r <= T.r2; r++)
        for (let c = T.c1; c <= T.c2; c++) {
          if (r >= S.r1 && r <= S.r2 && c >= S.c1 && c <= S.c2) continue;
          const dr = ((r - S.r1) % sh + sh) % sh;
          const dc = ((c - S.c1) % sw + sw) % sw;
          const sr = S.r1 + dr;
          const sc = S.c1 + dc;
          const cell = sheet.cells.get(keyOf(sr, sc));
          if (!cell) {
            this.setCellRaw(sheet, r, c, undefined);
            continue;
          }
          let raw = cell.raw;
          if (typeof raw === 'string' && raw.startsWith('=')) raw = shiftFormula(raw, r - sr, c - sc);
          else if (typeof raw === 'number' && sh >= 2 && sw === 1 && T.c1 === S.c1) {
            // linear series down a column
            const a = sheet.cells.get(keyOf(S.r1, S.c1))?.raw;
            const b = sheet.cells.get(keyOf(S.r1 + 1, S.c1))?.raw;
            if (typeof a === 'number' && typeof b === 'number') raw = a + (b - a) * (r - S.r1);
          }
          this.setCellRaw(sheet, r, c, { raw, style: cell.style });
        }
    });
  }

  // ---------- structural operations (snapshot-based) ----------
  private structural(label: string, source: TxSource, fn: () => void) {
    this.run(label, source, () => {
      const before = this.snap();
      fn();
      this.record({ kind: 'snap', before, after: this.snap() });
    });
  }

  private rewriteAllFormulas(f: (formula: string, sheet: Sheet) => string) {
    for (const s of this.sheets)
      for (const [k, cell] of s.cells) {
        if (typeof cell.raw === 'string' && cell.raw.startsWith('=')) {
          const nf = f(cell.raw, s);
          if (nf !== cell.raw) s.cells.set(k, { ...cell, raw: nf });
        }
      }
  }

  insertRows(sheet: Sheet, at: number, count = 1, source: TxSource = 'user') {
    this.shiftAxis(sheet, 'row', at, count, source);
  }
  deleteRows(sheet: Sheet, at: number, count = 1, source: TxSource = 'user') {
    this.shiftAxis(sheet, 'row', at, -count, source);
  }
  insertCols(sheet: Sheet, at: number, count = 1, source: TxSource = 'user') {
    this.shiftAxis(sheet, 'col', at, count, source);
  }
  deleteCols(sheet: Sheet, at: number, count = 1, source: TxSource = 'user') {
    this.shiftAxis(sheet, 'col', at, -count, source);
  }

  private shiftAxis(sheet: Sheet, axis: 'row' | 'col', at: number, count: number, source: TxSource) {
    const label = `${count > 0 ? 'Insert' : 'Delete'} ${Math.abs(count)} ${axis === 'row' ? 'row' : 'column'}${Math.abs(count) > 1 ? 's' : ''}`;
    this.structural(label, source, () => {
      const n = Math.abs(count);
      const end = at + n - 1;
      const next = new Map<number, Cell>();
      for (const [k, cell] of sheet.cells) {
        let r = rowOfKey(k);
        let c = colOfKey(k);
        const v = axis === 'row' ? r : c;
        let nv = v;
        if (count > 0) {
          if (v >= at) nv = v + count;
        } else {
          if (v >= at && v <= end) continue;
          if (v > end) nv = v - n;
        }
        if (axis === 'row') r = nv;
        else c = nv;
        next.set(keyOf(r, c), cell);
      }
      sheet.cells = next;
      const dim = axis === 'row' ? sheet.rowH : sheet.colW;
      const nd = new Map<number, number>();
      for (const [k, w] of dim) {
        if (count > 0) nd.set(k >= at ? k + count : k, w);
        else if (k < at) nd.set(k, w);
        else if (k > end) nd.set(k - n, w);
      }
      if (axis === 'row') sheet.rowH = nd;
      else sheet.colW = nd;
      this.rewriteAllFormulas((f, owner) => adjustFormula(f, owner.name, { sheetName: sheet.name, axis, at, count }));
    });
  }

  sortRange(sheet: Sheet, rng: Range, byCol: number, asc: boolean, hasHeader: boolean, source: TxSource = 'user') {
    const R = normRange(rng);
    const top = R.r1 + (hasHeader ? 1 : 0);
    if (top >= R.r2) return;
    this.run('Sort', source, () => {
      const rows: { r: number; cells: (Cell | undefined)[]; v: Scalar }[] = [];
      for (let r = top; r <= R.r2; r++) {
        const cells: (Cell | undefined)[] = [];
        for (let c = R.c1; c <= R.c2; c++) cells.push(sheet.cells.get(keyOf(r, c)));
        rows.push({ r, cells, v: this.value(sheet, r, byCol) });
      }
      const coll = new Intl.Collator(['gu', 'en'], { numeric: true, sensitivity: 'base' });
      const rank = (v: Scalar) => (v === null || v === '' ? 3 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
      const sorted = [...rows].sort((a, b) => {
        const ra = rank(a.v);
        const rb = rank(b.v);
        if (ra === 3 || rb === 3) return ra - rb; // blanks always last
        let d: number;
        if (ra !== rb) d = ra - rb;
        else if (typeof a.v === 'number' && typeof b.v === 'number') d = a.v - b.v;
        else d = coll.compare(String(a.v), String(b.v));
        return asc ? d : -d;
      });
      sorted.forEach((row, i) => {
        const tr = top + i;
        row.cells.forEach((cell, j) => {
          let out = cell;
          if (cell && typeof cell.raw === 'string' && cell.raw.startsWith('=') && tr !== row.r) out = { ...cell, raw: shiftFormula(cell.raw, tr - row.r, 0) };
          this.setCellRaw(sheet, tr, R.c1 + j, out);
        });
      });
    });
  }

  // ---------- sheets ----------
  addSheet(name?: string, source: TxSource = 'user'): Sheet {
    let sh!: Sheet;
    this.structural('Add sheet', source, () => {
      let n = this.sheets.length + 1;
      let nm = name ?? `Sheet${n}`;
      while (this.sheetByName(nm)) nm = name ? `${name} ${n++}` : `Sheet${n++}`;
      sh = makeSheet(nm);
      this.sheets.push(sh);
      this.reindex();
    });
    return this.sheetByName(sh.name) ?? sh;
  }
  renameSheet(sheet: Sheet, name: string, source: TxSource = 'user') {
    const nm = name.trim();
    if (!nm || (this.sheetByName(nm) && this.sheetByName(nm) !== sheet)) return false;
    const old = sheet.name;
    this.structural('Rename sheet', source, () => {
      this.rewriteAllFormulas((f) => renameSheetInFormula(f, old, nm));
      const s = this.sheetById(sheet.id)!;
      s.name = nm;
      this.reindex();
    });
    return true;
  }
  deleteSheet(sheet: Sheet, source: TxSource = 'user') {
    if (this.sheets.length <= 1) return false;
    this.structural('Delete sheet', source, () => {
      this.sheets = this.sheets.filter((s) => s.id !== sheet.id);
      this.reindex();
    });
    return true;
  }
  setColWidth(sheet: Sheet, c: number, w: number | null, source: TxSource = 'user') {
    this.structural('Resize column', source, () => {
      const s = this.sheetById(sheet.id)!;
      if (w === null) s.colW.delete(c);
      else s.colW.set(c, Math.max(24, Math.round(w)));
    });
  }
  setRowHeight(sheet: Sheet, r: number, h: number | null, source: TxSource = 'user') {
    this.structural('Resize row', source, () => {
      const s = this.sheetById(sheet.id)!;
      if (h === null) s.rowH.delete(r);
      else s.rowH.set(r, Math.max(14, Math.round(h)));
    });
  }
  setFreeze(sheet: Sheet, rows: number, cols: number, source: TxSource = 'user') {
    this.structural('Freeze panes', source, () => {
      const s = this.sheetById(sheet.id)!;
      s.freezeRows = rows;
      s.freezeCols = cols;
    });
  }

  // ---------- bulk load / clone ----------
  loadSheets(sheets: Sheet[]) {
    this.sheets = sheets.length ? sheets : [makeSheet('Sheet1')];
    this.undoStack = [];
    this.redoStack = [];
    this.touch();
  }

  clone(): Workbook {
    const w = new Workbook();
    w.sheets = this.sheets.map(cloneSheet);
    w.reindex();
    return w;
  }

  /** Reads a rectangular block of raw cells. */
  readBlock(sheet: Sheet, rng: Range): (Cell | undefined)[][] {
    const R = normRange(rng);
    const out: (Cell | undefined)[][] = [];
    for (let r = R.r1; r <= R.r2; r++) {
      const row: (Cell | undefined)[] = [];
      for (let c = R.c1; c <= R.c2; c++) row.push(sheet.cells.get(keyOf(r, c)));
      out.push(row);
    }
    return out;
  }
}
