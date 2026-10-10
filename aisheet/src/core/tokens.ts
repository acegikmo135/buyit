// Formula tokenizer + reference rewriting (for fill/copy/insert/delete).
import { colToName, nameToCol, MAX_COLS, MAX_ROWS } from './address';

export type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; sheet?: string; a: RefPart; b?: RefPart }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' };

/** One side of a reference. col/row are -1 when absent (whole row / whole column refs). */
export interface RefPart {
  col: number;
  row: number;
  absC: boolean;
  absR: boolean;
}

const REF_PART = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/;
const COL_ONLY = /^(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(])/;
const ROW_ONLY = /^(\$?)(\d{1,7})(?![A-Za-z0-9_.(])/;

function readPart(s: string, i: number): { p: RefPart; len: number } | null {
  const rest = s.slice(i);
  let m = REF_PART.exec(rest);
  if (m) {
    const col = nameToCol(m[2]);
    const row = parseInt(m[4], 10) - 1;
    if (col >= MAX_COLS || row >= MAX_ROWS || row < 0) return null;
    return { p: { col, row, absC: !!m[1], absR: !!m[3] }, len: m[0].length };
  }
  return null;
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let v = '';
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += src[j++];
      }
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      // Could be a row-only ref like 2:5 -- handled in ref branch below when followed by ':'
      const rm = /^(\d{1,7}):(\d{1,7})(?![A-Za-z0-9_.(])/.exec(src.slice(i));
      if (rm) {
        out.push({
          t: 'ref',
          a: { col: -1, row: parseInt(rm[1], 10) - 1, absC: false, absR: false },
          b: { col: -1, row: parseInt(rm[2], 10) - 1, absC: false, absR: false },
        });
        i += rm[0].length;
        continue;
      }
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (m) {
        out.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '(') {
      out.push({ t: 'lp' });
      i++;
      continue;
    }
    if (ch === ')') {
      out.push({ t: 'rp' });
      i++;
      continue;
    }
    if (ch === ',' || ch === ';') {
      out.push({ t: 'comma' });
      i++;
      continue;
    }
    if (ch === '<' || ch === '>' || ch === '=') {
      const two = src.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        out.push({ t: 'op', v: two });
        i += 2;
      } else {
        out.push({ t: 'op', v: ch });
        i++;
      }
      continue;
    }
    if ('+-*/^&%'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    // sheet-qualified ref: 'My Sheet'!A1 or Sheet1!A1
    let sheet: string | undefined;
    let j = i;
    if (ch === "'") {
      let k = i + 1;
      let nm = '';
      while (k < n) {
        if (src[k] === "'") {
          if (src[k + 1] === "'") {
            nm += "'";
            k += 2;
            continue;
          }
          break;
        }
        nm += src[k++];
      }
      if (src[k + 1] === '!') {
        sheet = nm;
        j = k + 2;
      }
    } else {
      const m = /^([\p{L}_][\p{L}\p{N}_.]*)!/u.exec(src.slice(i));
      if (m) {
        sheet = m[1];
        j = i + m[0].length;
      }
    }
    // reference?
    const first = readPart(src, j);
    if (first) {
      let b: RefPart | undefined;
      let len = first.len;
      if (src[j + len] === ':') {
        const second = readPart(src, j + len + 1);
        if (second) {
          b = second.p;
          len += 1 + second.len;
        }
      }
      const after = src[j + len];
      if (!(after && /[\p{L}\p{N}_(]/u.test(after))) {
        out.push({ t: 'ref', sheet, a: first.p, b });
        i = j + len;
        continue;
      }
    }
    // column-only A:A
    const cm = COL_ONLY.exec(src.slice(j));
    if (cm && src[j + cm[0].length] === ':') {
      const cm2 = COL_ONLY.exec(src.slice(j + cm[0].length + 1));
      if (cm2) {
        out.push({
          t: 'ref',
          sheet,
          a: { col: nameToCol(cm[2]), row: -1, absC: !!cm[1], absR: false },
          b: { col: nameToCol(cm2[2]), row: -1, absC: !!cm2[1], absR: false },
        });
        i = j + cm[0].length + 1 + cm2[0].length;
        continue;
      }
    }
    // identifier (function name / TRUE / FALSE / named)
    const im = /^[\p{L}_][\p{L}\p{N}_.]*/u.exec(src.slice(i));
    if (im) {
      const up = im[0].toUpperCase();
      if (up === 'TRUE') out.push({ t: 'bool', v: true });
      else if (up === 'FALSE') out.push({ t: 'bool', v: false });
      else out.push({ t: 'name', v: im[0] });
      i += im[0].length;
      continue;
    }
    // unknown char — emit as name so evaluation yields #NAME?
    out.push({ t: 'name', v: ch });
    i++;
  }
  return out;
}

function partToString(p: RefPart): string {
  const c = p.col >= 0 ? (p.absC ? '$' : '') + colToName(p.col) : '';
  const r = p.row >= 0 ? (p.absR ? '$' : '') + (p.row + 1) : '';
  return c + r;
}

function sheetPrefix(s?: string): string {
  if (!s) return '';
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s) ? `${s}!` : `'${s.replace(/'/g, "''")}'!`;
}

export function stringify(toks: Tok[]): string {
  let out = '';
  for (const t of toks) {
    switch (t.t) {
      case 'num':
        out += String(t.v);
        break;
      case 'str':
        out += `"${t.v.replace(/"/g, '""')}"`;
        break;
      case 'bool':
        out += t.v ? 'TRUE' : 'FALSE';
        break;
      case 'ref':
        out += sheetPrefix(t.sheet) + partToString(t.a) + (t.b ? ':' + partToString(t.b) : '');
        break;
      case 'name':
        out += t.v;
        break;
      case 'op':
        out += t.v;
        break;
      case 'lp':
        out += '(';
        break;
      case 'rp':
        out += ')';
        break;
      case 'comma':
        out += ',';
        break;
    }
  }
  return out;
}

/** Shift relative references (copy / fill semantics). Off-sheet results become #REF!. */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!formula.startsWith('=')) return formula;
  const toks = tokenize(formula.slice(1));
  let bad = false;
  const shift = (p: RefPart): RefPart => {
    const q = { ...p };
    if (q.col >= 0 && !q.absC) q.col += dc;
    if (q.row >= 0 && !q.absR) q.row += dr;
    if (q.col < 0 && p.col >= 0) bad = true;
    if (q.row < 0 && p.row >= 0) bad = true;
    if (q.col >= MAX_COLS || q.row >= MAX_ROWS) bad = true;
    return q;
  };
  for (const t of toks) {
    if (t.t === 'ref') {
      t.a = shift(t.a);
      if (t.b) t.b = shift(t.b);
    }
  }
  if (bad) return '=#REF!';
  return '=' + stringify(toks);
}

export interface StructChange {
  sheetName: string; // sheet whose structure changes
  axis: 'row' | 'col';
  at: number; // index where insertion/deletion starts
  count: number; // positive = insert, negative = delete (abs = number removed)
}

/**
 * Rewrites references after rows/cols are inserted or deleted on `change.sheetName`.
 * `formulaSheet` is the sheet that owns the formula (to resolve unqualified refs).
 */
export function adjustFormula(formula: string, formulaSheet: string, change: StructChange): string {
  if (!formula.startsWith('=')) return formula;
  const toks = tokenize(formula.slice(1));
  const target = change.sheetName.toLowerCase();
  const axisKey = change.axis === 'row' ? 'row' : 'col';
  let dead = false;
  for (const t of toks) {
    if (t.t !== 'ref') continue;
    const sh = (t.sheet ?? formulaSheet).toLowerCase();
    if (sh !== target) continue;
    const a = t.a;
    const b = t.b;
    if (a[axisKey] < 0) continue; // whole-column / whole-row on the other axis
    if (change.count > 0) {
      if (a[axisKey] >= change.at) a[axisKey] += change.count;
      if (b && b[axisKey] >= change.at) b[axisKey] += change.count;
    } else {
      const n = -change.count;
      const end = change.at + n - 1;
      const adj = (v: number, isEnd: boolean): number | null => {
        if (v < change.at) return v;
        if (v > end) return v - n;
        return null; // inside deleted block
      };
      if (!b) {
        const na = adj(a[axisKey], false);
        if (na === null) dead = true;
        else a[axisKey] = na;
      } else {
        const lo = Math.min(a[axisKey], b[axisKey]);
        const hi = Math.max(a[axisKey], b[axisKey]);
        // shrink range
        let nlo = lo;
        let nhi = hi;
        if (lo > end) nlo = lo - n;
        else if (lo >= change.at) nlo = change.at;
        if (hi > end) nhi = hi - n;
        else if (hi >= change.at) nhi = change.at - 1;
        if (nhi < nlo) dead = true;
        else if (a[axisKey] <= b[axisKey]) {
          a[axisKey] = nlo;
          b[axisKey] = nhi;
        } else {
          b[axisKey] = nlo;
          a[axisKey] = nhi;
        }
      }
    }
  }
  if (dead) return '=#REF!';
  return '=' + stringify(toks);
}

/** Rewrites sheet-name references when a sheet is renamed. */
export function renameSheetInFormula(formula: string, from: string, to: string): string {
  if (!formula.startsWith('=')) return formula;
  const toks = tokenize(formula.slice(1));
  let changed = false;
  for (const t of toks) {
    if (t.t === 'ref' && t.sheet && t.sheet.toLowerCase() === from.toLowerCase()) {
      t.sheet = to;
      changed = true;
    }
  }
  return changed ? '=' + stringify(toks) : formula;
}
