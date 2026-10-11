// App-level workflows that tie the store, the workbook and the platform together.
import { activeSheet, execContext, selectionRange, useStore, wb } from './store';
import { addr, colToName, keyOf, MAX_COLS, MAX_ROWS, normRange, type Range } from './core/address';
import { autoFitColumns, autoFitRows, currentRegion } from './core/tools';
import { measureText, wrapLines } from './grid/measure';
import type { ChartDef, ChartType } from './core/types';
import { displayValue, parseInput } from './core/format';
import type { Cell, CellStyle } from './core/types';
import { csvToSheet, sheetToCsv, workbookToXlsx, xlsxToWorkbook } from './core/io';
import { makeSheet } from './core/workbook';
import { openFileDialog, saveFileDialog, readPath, confirmDialog, type OpenedFile } from './platform';
import { clearFx, playFx } from './grid/fx';
import { tr } from './i18n';

const st = () => useStore.getState();

// ---------- selection ----------
export function ensureActiveSheet() {
  if (!wb.sheetById(st().activeSheetId)) st().set({ activeSheetId: wb.sheets[0].id });
}

/** Column where a run of Tab-entries started; Enter returns there (like Excel). */
let tabOrigin: number | null = null;
export const resetTabOrigin = () => {
  tabOrigin = null;
};

/** Top-left cell of the merged block containing (r,c), or (r,c) itself. */
export function resolveCell(r: number, c: number): { r: number; c: number } {
  const m = activeSheet().merges.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
  return m ? { r: m.r1, c: m.c1 } : { r, c };
}

export function moveSelection(dr: number, dc: number, extend: boolean) {
  tabOrigin = null;
  const { anchor, active } = st();
  const sh = activeSheet();
  let r = active.r;
  let c = active.c;
  if (!extend) {
    // leave a merged block in one step
    const m = sh.merges.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);
    if (m) {
      if (dr > 0) r = m.r2;
      else if (dr < 0) r = m.r1;
      if (dc > 0) c = m.c2;
      else if (dc < 0) c = m.c1;
    }
  }
  const hiddenR = (x: number) => wb.isRowHidden(sh, x);
  const hiddenC = (x: number) => sh.hiddenCols.has(x);
  let nr = r + dr;
  let nc = c + dc;
  while (dr !== 0 && nr >= 0 && nr < MAX_ROWS && hiddenR(nr)) nr += dr;
  while (dc !== 0 && nc >= 0 && nc < MAX_COLS && hiddenC(nc)) nc += dc;
  nr = Math.max(0, Math.min(MAX_ROWS - 1, nr));
  nc = Math.max(0, Math.min(MAX_COLS - 1, nc));
  if (hiddenR(nr)) nr = r;
  if (hiddenC(nc)) nc = c;
  if (!extend) {
    const t = sh.merges.find((x) => nr >= x.r1 && nr <= x.r2 && nc >= x.c1 && nc <= x.c2);
    if (t) {
      st().select({ r: t.r1, c: t.c1 }, { r: t.r2, c: t.c2 });
      return;
    }
  }
  st().select(extend ? anchor : { r: nr, c: nc }, { r: nr, c: nc });
}

export function pressEnter(up: boolean) {
  const o = tabOrigin;
  moveSelection(up ? -1 : 1, 0, false);
  if (o !== null) st().select({ r: st().active.r, c: o });
}
export function pressTab(back: boolean) {
  const o = tabOrigin ?? st().active.c;
  moveSelection(0, back ? -1 : 1, false);
  tabOrigin = o;
}

export function cellText(sheetId: string, r: number, c: number): string {
  const sh = wb.sheetById(sheetId);
  if (!sh) return '';
  return displayValue(wb.value(sh, r, c), sh.cells.get(keyOf(r, c))?.style);
}

export function rawText(r0: number, c0: number): string {
  const { r, c } = resolveCell(r0, c0);
  const cell = activeSheet().cells.get(keyOf(r, c));
  if (!cell) return '';
  const raw = cell.raw;
  if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
  if (typeof raw === 'string' && cell.style?.fmt !== 'text' && /^\s*[-+]?\d/.test(raw) && typeof parseInput(raw) === 'number') return "'" + raw;
  return String(raw);
}

// ---------- auto-fit ----------
const autoCols = new Map<string, Set<number>>();
export function markManualWidth(sheetId: string, c: number) {
  autoCols.get(sheetId)?.delete(c);
}

/** Auto-fits columns. With `grow`, only widens columns the user has not sized by hand. */
export function autoFitCols(cols: number[] | null, grow = false) {
  const sh = activeSheet();
  const managed = autoCols.get(sh.id) ?? new Set<number>();
  autoCols.set(sh.id, managed);
  const target = (cols ?? Array.from({ length: wb.usedBounds(sh).c + 1 }, (_, i) => i)).filter((c) => !grow || !sh.colW.has(c) || managed.has(c));
  if (!target.length) return;
  autoFitColumns(wb, sh, target, measureText, 'user', { onlyGrow: grow, silent: grow });
  target.forEach((c) => managed.add(c));
}

export function autoFitRowsNow() {
  const sh = activeSheet();
  autoFitRows(wb, sh, null, measureText, (t, w) => wrapLines(t, w, (x) => measureText(x)));
}

export function autoFitSelection() {
  const R = selectionRange();
  const sh = activeSheet();
  const ub = wb.usedBounds(sh);
  const cols = Array.from({ length: Math.min(R.c2, Math.max(ub.c, R.c1)) - R.c1 + 1 }, (_, i) => R.c1 + i);
  autoFitColumns(wb, sh, cols, measureText, 'user');
  const m = autoCols.get(sh.id) ?? new Set<number>();
  autoCols.set(sh.id, m);
  cols.forEach((c) => m.add(c));
}

// ---------- editing ----------
export function startEdit(from: 'cell' | 'bar', initial?: string) {
  const active = resolveCell(st().active.r, st().active.c);
  const sh = activeSheet();
  st().set({ editing: { r: active.r, c: active.c, sheetId: sh.id, text: initial ?? rawText(active.r, active.c), from } });
}

export function commitEdit(move: 'down' | 'right' | 'left' | 'up' | 'none' = 'down') {
  const e = st().editing;
  if (!e) return;
  const sh = wb.sheetById(e.sheetId);
  st().set({ editing: null });
  const before = st().editing;
  void before;
  if (sh) {
    const prev = rawText(e.r, e.c);
    if (e.text !== prev) {
      const err = wb.validate(sh, e.r, e.c, e.text);
      if (err) {
        st().set({ editing: e });
        st().showToast(err);
        return;
      }
      wb.setInput(sh, e.r, e.c, e.text, `Edit ${addr(e.r, e.c)}`);
      if (st().autoFit) autoFitCols([e.c], true);
    }
  }
  const origin = tabOrigin ?? e.c;
  if (move === 'down' || move === 'up') {
    const returnTo = tabOrigin;
    moveSelection(move === 'down' ? 1 : -1, 0, false);
    if (returnTo !== null) {
      const a = st().active;
      st().select({ r: a.r, c: returnTo });
    }
  } else if (move === 'right' || move === 'left') {
    moveSelection(0, move === 'right' ? 1 : -1, false);
    tabOrigin = origin;
  }
}

export function cancelEdit() {
  st().set({ editing: null });
}

// ---------- clipboard ----------
function tsvOf(range: Range): string {
  const sh = activeSheet();
  const rows: string[] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    const cols: string[] = [];
    for (let c = range.c1; c <= range.c2; c++) {
      const s = displayValue(wb.value(sh, r, c), sh.cells.get(keyOf(r, c))?.style);
      cols.push(/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    }
    rows.push(cols.join('\t'));
  }
  return rows.join('\n');
}

export function copySelection(cut: boolean, e?: ClipboardEvent) {
  const R = clampSel();
  const sh = activeSheet();
  const tsv = tsvOf(R);
  st().set({ clip: { block: wb.readBlock(sh, R), from: { r: R.r1, c: R.c1 }, tsv, cut, sheetId: sh.id, range: R } });
  if (e?.clipboardData) {
    e.clipboardData.setData('text/plain', tsv);
    e.preventDefault();
  } else navigator.clipboard?.writeText(tsv).catch(() => {});
}

function clampSel(): Range {
  const R = selectionRange();
  const ub = wb.usedBounds(activeSheet());
  return { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, Math.max(ub.r, R.r1)), c2: Math.min(R.c2, Math.max(ub.c, R.c1)) };
}

function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === '\t') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export function pasteText(text: string, valuesOnly = false) {
  const { active, clip } = st();
  const sh = activeSheet();
  const R = selectionRange();
  const r0 = R.r1;
  const c0 = R.c1;
  void active;
  if (clip && clip.tsv === text.replace(/\r\n/g, '\n').replace(/\n$/, '')) {
    wb.run(clip.cut ? 'Move' : 'Paste', 'user', () => {
      wb.pasteBlock(sh, r0, c0, clip.block, clip.from, { values: valuesOnly });
      if (clip.cut) {
        const src = wb.sheetById(clip.sheetId);
        if (src) {
          const h = clip.block.length;
          const w = clip.block[0]?.length ?? 0;
          // clear source cells not overwritten by the destination
          const dst: Range = { r1: r0, c1: c0, r2: r0 + h - 1, c2: c0 + w - 1 };
          for (let r = clip.range.r1; r <= clip.range.r2; r++)
            for (let c = clip.range.c1; c <= clip.range.c2; c++) {
              if (src.id === sh.id && r >= dst.r1 && r <= dst.r2 && c >= dst.c1 && c <= dst.c2) continue;
              wb.setCellRaw(src, r, c, undefined);
            }
        }
      }
    });
    if (clip.cut) st().set({ clip: null });
    const h = clip.block.length;
    const w = clip.block[0]?.length ?? 0;
    st().select({ r: r0, c: c0 }, { r: r0 + h - 1, c: c0 + w - 1 });
    if (st().autoFit) autoFitCols(Array.from({ length: w }, (_, i) => c0 + i), true);
    return;
  }
  const rows = parseTsv(text);
  if (!rows.length) return;
  wb.run('Paste', 'user', () => {
    rows.forEach((row, i) =>
      row.forEach((v, j) => {
        const prev = sh.cells.get(keyOf(r0 + i, c0 + j));
        const raw = parseInput(v);
        wb.setCellRaw(sh, r0 + i, c0 + j, raw === '' ? (prev?.style ? { raw: '', style: prev.style } : undefined) : { raw, style: prev?.style });
      }),
    );
  });
  const pw = Math.max(...rows.map((r) => r.length));
  st().select({ r: r0, c: c0 }, { r: r0 + rows.length - 1, c: c0 + pw - 1 });
  if (st().autoFit) autoFitCols(Array.from({ length: pw }, (_, i) => c0 + i), true);
}

export function clearSelection() {
  wb.clearRange(activeSheet(), selectionRange(), { contents: true });
}

export function fillDown() {
  const R = selectionRange();
  if (R.r2 === R.r1) return;
  wb.fillRange(activeSheet(), { ...R, r2: R.r1 }, R);
}
export function fillRight() {
  const R = selectionRange();
  if (R.c2 === R.c1) return;
  wb.fillRange(activeSheet(), { ...R, c2: R.c1 }, R);
}

// ---------- formatting ----------
export function styleAtActive(): CellStyle {
  const { active } = st();
  return activeSheet().cells.get(keyOf(active.r, active.c))?.style ?? {};
}

export function applyStyle(patch: Partial<CellStyle>) {
  wb.applyStyle(activeSheet(), selectionRange(), patch);
}

export function toggleStyle(key: 'b' | 'i' | 'u' | 'wrap') {
  const cur = styleAtActive()[key];
  applyStyle({ [key]: !cur });
}

// ---------- structure ----------
export function insertRowAbove() {
  const R = selectionRange();
  wb.insertRows(activeSheet(), R.r1, R.r2 - R.r1 + 1);
}
export function deleteSelectedRows() {
  const R = selectionRange();
  wb.deleteRows(activeSheet(), R.r1, R.r2 - R.r1 + 1);
}
export function insertColLeft() {
  const R = selectionRange();
  wb.insertCols(activeSheet(), R.c1, R.c2 - R.c1 + 1);
}
export function deleteSelectedCols() {
  const R = selectionRange();
  wb.deleteCols(activeSheet(), R.c1, R.c2 - R.c1 + 1);
}
export function sortSelection(asc: boolean) {
  const sh = activeSheet();
  let R = selectionRange();
  const ub = wb.usedBounds(sh);
  if (R.r1 === R.r2 && R.c1 === R.c2) R = { r1: 0, c1: 0, r2: ub.r, c2: ub.c }; // sort whole table around active cell
  const byCol = st().active.c;
  // header detection: first row all text while the next row has a number
  let hasHeader = false;
  const first = wb.value(sh, R.r1, byCol);
  const second = wb.value(sh, R.r1 + 1, byCol);
  if (typeof first === 'string' && typeof second === 'number') hasHeader = true;
  else if (R.r1 === 0) hasHeader = typeof first === 'string' && R.r2 > R.r1;
  wb.sortRange(sh, normRange(R), byCol, asc, hasHeader);
}
export function toggleFreeze() {
  const sh = activeSheet();
  const { active } = st();
  if (sh.freezeRows || sh.freezeCols) wb.setFreeze(sh, 0, 0);
  else wb.setFreeze(sh, active.r > 0 ? active.r : 1, active.c > 0 ? active.c : 0);
}

// ---------- sheets ----------
export function addSheet() {
  const s = wb.addSheet();
  st().set({ activeSheetId: s.id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 } });
}
export function switchSheet(id: string) {
  cancelEdit();
  st().set({ activeSheetId: id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 } });
}

// ---------- undo / redo ----------
export function undo() {
  cancelEdit();
  wb.undo();
  ensureActiveSheet();
}
export function redo() {
  cancelEdit();
  wb.redo();
  ensureActiveSheet();
}

// ---------- files ----------
function baseName(n: string) {
  return n.replace(/\.[^.]+$/, '');
}

export function newWorkbook() {
  clearFx();
  wb.loadSheets([makeSheet('Sheet1')]);
  st().set({ activeSheetId: wb.sheets[0].id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 }, file: { name: 'Untitled', dirty: false }, msgs: [], proposal: null, editing: null, clip: null });
}

async function loadOpened(f: OpenedFile) {
  const lower = f.name.toLowerCase();
  clearFx();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const loaded = await xlsxToWorkbook(f.bytes);
    wb.loadSheets(loaded.sheets, loaded.names);
  }
  else {
    const text = new TextDecoder('utf-8').decode(f.bytes);
    wb.loadSheets([csvToSheet(text, baseName(f.name))]);
  }
  const keepPath = lower.endsWith('.xlsx');
  wb.sheets.forEach((sh) => {
    if (!sh.colW.size) autoFitColumns(wb, sh, null, measureText, 'user', { silent: true, maxW: 320 });
  });
  st().set({ activeSheetId: wb.sheets[0].id, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 }, file: { name: f.name, path: keepPath ? f.path : undefined, dirty: false }, msgs: [], proposal: null, editing: null, clip: null });
}

async function guardedOpen(get: () => Promise<OpenedFile | null>) {
  try {
    if (st().file.dirty && !(await confirmDialog(tr('file.discardConfirm')))) return;
    const f = await get();
    if (f) await loadOpened(f);
  } catch (e) {
    st().showToast(tr('file.openFailed') + ' ' + (e as Error).message);
  }
}

export const openFile = () => guardedOpen(openFileDialog);
/** Opens a path handed over by the shell (double-click / Open with / drag-and-drop). */
export const openPath = (path: string) => guardedOpen(() => readPath(path));

export async function saveFile(saveAs = false) {
  const { file } = st();
  try {
    const name = baseName(file.name) + '.xlsx';
    const bytes = await workbookToXlsx(wb.sheets, wb.names, (s, r, c) => {
      const v = wb.value(s, r, c);
      return v === null ? null : typeof v === 'object' ? String((v as { code: string }).code) : v;
    });
    const res = await saveFileDialog(name, bytes, saveAs || !file.path || !file.name.toLowerCase().endsWith('.xlsx') ? undefined : file.path);
    if (res) st().set({ file: { name: res.name, path: res.path, dirty: false } });
    return !!res;
  } catch (e) {
    st().showToast('Save failed: ' + (e as Error).message);
    return false;
  }
}

export async function exportCsv() {
  const sh = activeSheet();
  const ub = wb.usedBounds(sh);
  const text = sheetToCsv(sh, (r, c) => displayValue(wb.value(sh, r, c), undefined), ub.r, ub.c);
  await saveFileDialog(baseName(st().file.name) + '.csv', new TextEncoder().encode(text));
}

// ---------- fx hookup ----------
export function installFx() {
  wb.onTxApplied = (tx, dir) => {
    if (tx.label === 'preview') return;
    if (tx.source === 'user' && dir === 'do') return;
    const sheetId = st().activeSheetId;
    const changes = wb.cellChangesOf(tx).filter((c) => c.sheetId === sheetId);
    if (!changes.length) return;
    const sh = wb.sheetById(sheetId);
    if (!sh) return;
    const items = changes.map((ch) => {
      const r = Math.floor(ch.key / 65536);
      const c = ch.key % 65536;
      const prevCell = dir === 'undo' ? ch.after : ch.before;
      const prev = prevCell && !(typeof prevCell.raw === 'string' && prevCell.raw.startsWith('=')) ? displayValue(prevCell.raw, prevCell.style) : '';
      return { key: ch.key, prev, next: displayValue(wb.value(sh, r, c), sh.cells.get(ch.key)?.style) };
    });
    playFx(sheetId, items, tx.source === 'ai' ? 'ai' : 'user');
  };
  wb.subscribe(() => {
    const s = st();
    if (!s.file.dirty) s.set({ file: { ...s.file, dirty: true } });
  });
}

export { execContext };


// ---------- Excel-style commands ----------
export function mergeSelection() {
  const R = selectionRange();
  const sh = activeSheet();
  const merged = sh.merges.some((m) => m.r1 === R.r1 && m.c1 === R.c1 && m.r2 === R.r2 && m.c2 === R.c2);
  if (merged) wb.unmergeCells(sh, R);
  else {
    wb.mergeCells(sh, R);
    wb.applyStyle(wb.sheetById(sh.id)!, { r1: R.r1, c1: R.c1, r2: R.r1, c2: R.c1 }, { align: 'center' }, 'Merge & center');
  }
}

export function setBorderPreset(preset: Parameters<typeof wb.setBorders>[2], style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' = 'thin') {
  wb.setBorders(activeSheet(), selectionRange(), preset, { s: style });
}

export function toggleFilter() {
  const sh = activeSheet();
  if (sh.filter) return void wb.setFilter(sh, null);
  const { active } = st();
  const R = selectionRange();
  const single = R.r1 === R.r2 && R.c1 === R.c2;
  wb.setFilter(sh, single ? currentRegion(wb, sh, active.r, active.c) : R);
}

export function hideSelected(axis: 'row' | 'col', hide: boolean) {
  const R = selectionRange();
  const sh = activeSheet();
  const ub = wb.usedBounds(sh);
  if (axis === 'row') wb.setHidden(sh, 'row', R.r1 - (hide ? 0 : 1), Math.min(R.r2, Math.max(ub.r + 50, R.r1)) + (hide ? 0 : 1), hide);
  else wb.setHidden(sh, 'col', R.c1 - (hide ? 0 : 1), Math.min(R.c2, Math.max(ub.c + 10, R.c1)) + (hide ? 0 : 1), hide);
}

/** Ctrl+A: the table around the active cell first, the whole sheet on a second press. */
export function selectCurrentRegionOrAll() {
  const { active, anchor } = st();
  const R = currentRegion(wb, activeSheet(), active.r, active.c);
  const cur = selectionRange();
  const already = cur.r1 === R.r1 && cur.c1 === R.c1 && cur.r2 === R.r2 && cur.c2 === R.c2;
  void anchor;
  if (already || (R.r1 === R.r2 && R.c1 === R.c2)) st().select({ r: 0, c: 0 }, { r: 1048575, c: 16383 });
  else st().select({ r: R.r1, c: R.c1 }, { r: R.r2, c: R.c2 });
}

export function selectCurrentRegion() {
  const { active } = st();
  const R = currentRegion(wb, activeSheet(), active.r, active.c);
  st().select({ r: R.r1, c: R.c1 }, { r: R.r2, c: R.c2 });
}

/** Alt+= : writes =SUM(...) for the numbers above (or to the left of) the active cell, or below/right of a selection. */
export function autoSum() {
  const sh = activeSheet();
  const R = selectionRange();
  const multi = R.r1 !== R.r2 || R.c1 !== R.c2;
  wb.run('AutoSum', 'user', () => {
    if (multi) {
      // sum each column of the selection into the row below
      for (let c = R.c1; c <= R.c2; c++) wb.setInput(sh, R.r2 + 1, c, `=SUM(${addr(R.r1, c)}:${addr(R.r2, c)})`);
      return;
    }
    const { r, c } = R.r1 === R.r2 ? { r: R.r1, c: R.c1 } : { r: R.r1, c: R.c1 };
    let top = r - 1;
    while (top >= 0 && typeof wb.value(sh, top, c) === 'number') top--;
    if (top < r - 1) wb.setInput(sh, r, c, `=SUM(${addr(top + 1, c)}:${addr(r - 1, c)})`);
    else {
      let left = c - 1;
      while (left >= 0 && typeof wb.value(sh, r, left) === 'number') left--;
      wb.setInput(sh, r, c, `=SUM(${addr(r, left + 1)}:${addr(r, c - 1)})`);
    }
  });
}

export function insertToday(time = false) {
  const { active } = st();
  const d = new Date();
  const serial = d.getTime() / 86400000 + 25569 - d.getTimezoneOffset() / 1440;
  const sh = activeSheet();
  const prev = sh.cells.get(keyOf(active.r, active.c));
  wb.setCellRaw(sh, active.r, active.c, { raw: time ? serial : Math.floor(serial), style: { ...prev?.style, fmt: time ? 'time' : 'date' } });
}

/** Builds a chart from the selection (or the table around the active cell). */
export function createChartFromSelection(type: ChartType = 'column'): ChartDef | null {
  const sh = activeSheet();
  const { active } = st();
  let R = selectionRange();
  if (R.r1 === R.r2 && R.c1 === R.c2) R = currentRegion(wb, sh, active.r, active.c);
  const ub = wb.usedBounds(sh);
  R = { r1: R.r1, c1: R.c1, r2: Math.min(R.r2, ub.r), c2: Math.min(R.c2, ub.c) };
  if (R.r2 <= R.r1 && R.c2 <= R.c1) return null;
  const isText = (r: number, c: number) => typeof wb.value(sh, r, c) === 'string';
  const isNum = (r: number, c: number) => typeof wb.value(sh, r, c) === 'number';
  const headerRow = Array.from({ length: R.c2 - R.c1 + 1 }, (_, i) => R.c1 + i).some((c) => isText(R.r1, c)) && R.r2 > R.r1 && isNum(R.r1 + 1, R.c2);
  const headerCol = R.c2 > R.c1 && isText(R.r1 + (headerRow ? 1 : 0), R.c1);
  const ref = `${addr(R.r1, R.c1)}:${addr(R.r2, R.c2)}`;
  const x = 24 + (ub.c + 2) * 104 > 900 ? 24 : 0;
  void x;
  let left = 0;
  for (let c = 0; c <= R.c2 + 1; c++) left += sh.colW.get(c) ?? 104;
  const chart: ChartDef = {
    id: 'ch' + Date.now().toString(36), type, title: '', range: ref, headerRow, headerCol, legend: true,
    x: left + 20, y: Math.max(0, (R.r1) * 24), w: 480, h: 300,
  };
  wb.addChart(sh, chart);
  st().set({ selectedChart: chart.id });
  return chart;
}

export function openDialog(d: import('./store').DialogState) {
  st().set({ dialog: d });
}

export function colLabel(c: number) {
  return colToName(c);
}

export const selectionNorm = () => selectionRange();
