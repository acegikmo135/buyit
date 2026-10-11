import { tokenize, type Tok, type RefPart } from './tokens';
import { FormulaError, type Scalar } from './types';
import { normalizeDigits, jsToExcelDate, excelDateToJS, formatNumber } from './format';
import { MAX_COLS, MAX_ROWS } from './address';

export interface EvalCtx {
  /** sheet that owns the formula being evaluated */
  sheet: string;
  getCell(sheet: string, r: number, c: number): Scalar;
  /** returns 2D array; whole-row/col ranges clipped to used area by implementation */
  getRange(sheet: string, r1: number, c1: number, r2: number, c2: number): Scalar[][];
  hasSheet(sheet: string): boolean;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; sheet?: string; a: RefPart; b?: RefPart }
  | { k: 'un'; op: string; x: Node }
  | { k: 'pct'; x: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'err'; e: FormulaError };

// ---------- parser (precedence climbing) ----------
const PREC: Record<string, number> = {
  '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 5,
};

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek() {
    return this.toks[this.i];
  }
  parse(): Node {
    const n = this.expr(0);
    if (this.i < this.toks.length) throw new FormulaError('#ERROR!');
    return n;
  }
  expr(minPrec: number): Node {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op' || !(t.v in PREC)) break;
      const p = PREC[t.v];
      if (p < minPrec) break;
      this.i++;
      const right = this.expr(t.v === '^' ? p : p + 1);
      left = { k: 'bin', op: t.v, l: left, r: right };
    }
    return left;
  }
  unary(): Node {
    const t = this.peek();
    if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.i++;
      const x = this.unary();
      return t.v === '-' ? { k: 'un', op: '-', x } : x;
    }
    return this.postfix();
  }
  postfix(): Node {
    let n = this.primary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && t.v === '%') {
        this.i++;
        n = { k: 'pct', x: n };
      } else break;
    }
    return n;
  }
  primary(): Node {
    const t = this.toks[this.i++];
    if (!t) throw new FormulaError('#ERROR!');
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return { k: 'str', v: t.v };
      case 'bool':
        return { k: 'bool', v: t.v };
      case 'ref':
        return { k: 'ref', sheet: t.sheet, a: t.a, b: t.b };
      case 'lp': {
        const e = this.expr(0);
        const c = this.toks[this.i++];
        if (!c || c.t !== 'rp') throw new FormulaError('#ERROR!');
        return e;
      }
      case 'name': {
        const nx = this.peek();
        if (nx && nx.t === 'lp') {
          this.i++;
          const args: Node[] = [];
          if (this.peek()?.t === 'rp') {
            this.i++;
            return { k: 'fn', name: t.v.toUpperCase(), args };
          }
          for (;;) {
            // allow empty arg: ,,
            const p = this.peek();
            if (p && (p.t === 'comma' || p.t === 'rp')) args.push({ k: 'str', v: '' });
            else args.push(this.expr(0));
            const sep = this.toks[this.i++];
            if (!sep) throw new FormulaError('#ERROR!');
            if (sep.t === 'rp') break;
            if (sep.t !== 'comma') throw new FormulaError('#ERROR!');
          }
          return { k: 'fn', name: t.v.toUpperCase(), args };
        }
        return { k: 'err', e: new FormulaError('#NAME?') };
      }
      default:
        throw new FormulaError('#ERROR!');
    }
  }
}

const parseCache = new Map<string, Node | FormulaError>();

function parseFormula(src: string): Node | FormulaError {
  let hit = parseCache.get(src);
  if (hit) return hit;
  const body = src.slice(1).trim();
  if (/^#(REF|DIV\/0|VALUE|NAME|N\/A|NUM|CIRC|ERROR)[!?]?$/i.test(body)) {
    hit = new FormulaError(body.toUpperCase() as never);
  } else {
    try {
      hit = new Parser(tokenize(src.slice(1))).parse();
    } catch (e) {
      hit = e instanceof FormulaError ? e : new FormulaError('#ERROR!');
    }
  }
  if (parseCache.size > 5000) parseCache.clear();
  parseCache.set(src, hit);
  return hit;
}

// ---------- coercion ----------
const E = (c: FormulaError['code']) => new FormulaError(c);

function toNum(v: Scalar): number | FormulaError {
  if (v instanceof FormulaError) return v;
  if (v === null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const t = normalizeDigits(String(v).trim());
  if (t !== '' && !isNaN(Number(t))) return Number(t);
  if (/^[-+]?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100;
  return E('#VALUE!');
}
function toStr(v: Scalar): string {
  if (v instanceof FormulaError) return v.code;
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatNumber(v, 'general');
  return v;
}
function toBool(v: Scalar): boolean | FormulaError {
  if (v instanceof FormulaError) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  const u = v.toUpperCase();
  if (u === 'TRUE') return true;
  if (u === 'FALSE') return false;
  return E('#VALUE!');
}

function compare(a: Scalar, b: Scalar): number {
  const rank = (x: Scalar) => (typeof x === 'number' || x === null ? 0 : typeof x === 'string' ? 1 : 2);
  if (a === null && typeof b === 'string') a = '';
  if (b === null && typeof a === 'string') b = '';
  if (a === null && typeof b === 'boolean') a = false;
  if (b === null && typeof a === 'boolean') b = false;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(a ?? 0);
  const y = Number(b ?? 0);
  return x < y ? -1 : x > y ? 1 : 0;
}

// ---------- evaluation ----------
type Val = Scalar | Scalar[][]; // arrays come from ranges

function flat(vals: Val[]): Scalar[] {
  const out: Scalar[] = [];
  for (const v of vals) {
    if (Array.isArray(v)) for (const row of v) for (const x of row) out.push(x);
    else out.push(v);
  }
  return out;
}

function scalar(v: Val): Scalar {
  if (Array.isArray(v)) return v[0]?.[0] ?? null;
  return v;
}

function evalNode(n: Node, ctx: EvalCtx): Val {
  switch (n.k) {
    case 'num':
    case 'str':
    case 'bool':
      return n.v;
    case 'err':
      return n.e;
    case 'ref': {
      const sheet = n.sheet ?? ctx.sheet;
      if (!ctx.hasSheet(sheet)) return E('#REF!');
      const a = n.a;
      if (!n.b) return ctx.getCell(sheet, a.row, a.col);
      const b = n.b;
      const r1 = Math.min(a.row < 0 ? 0 : a.row, b.row < 0 ? 0 : b.row);
      const r2 = a.row < 0 || b.row < 0 ? MAX_ROWS - 1 : Math.max(a.row, b.row);
      const c1 = Math.min(a.col < 0 ? 0 : a.col, b.col < 0 ? 0 : b.col);
      const c2 = a.col < 0 || b.col < 0 ? MAX_COLS - 1 : Math.max(a.col, b.col);
      return ctx.getRange(sheet, r1, c1, r2, c2);
    }
    case 'un': {
      const x = toNum(scalar(evalNode(n.x, ctx)));
      return x instanceof FormulaError ? x : -x;
    }
    case 'pct': {
      const x = toNum(scalar(evalNode(n.x, ctx)));
      return x instanceof FormulaError ? x : x / 100;
    }
    case 'bin': {
      const l = scalar(evalNode(n.l, ctx));
      const r = scalar(evalNode(n.r, ctx));
      if (l instanceof FormulaError) return l;
      if (r instanceof FormulaError) return r;
      switch (n.op) {
        case '&':
          return toStr(l) + toStr(r);
        case '=':
          return compare(l, r) === 0;
        case '<>':
          return compare(l, r) !== 0;
        case '<':
          return compare(l, r) < 0;
        case '>':
          return compare(l, r) > 0;
        case '<=':
          return compare(l, r) <= 0;
        case '>=':
          return compare(l, r) >= 0;
      }
      const a = toNum(l);
      const b = toNum(r);
      if (a instanceof FormulaError) return a;
      if (b instanceof FormulaError) return b;
      switch (n.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? E('#DIV/0!') : a / b;
        case '^': {
          const p = Math.pow(a, b);
          return isFinite(p) ? p : E('#NUM!');
        }
      }
      return E('#ERROR!');
    }
    case 'fn':
      return callFn(n, ctx);
  }
}

// ---------- functions ----------
type Lazy = (i: number) => Val;
type Fn = (args: Val[], ctx: EvalCtx) => Val;

function nums(vals: Val[], strict = false): number[] | FormulaError {
  const out: number[] = [];
  for (const v of vals) {
    if (Array.isArray(v)) {
      for (const row of v)
        for (const x of row) {
          if (x instanceof FormulaError) return x;
          if (typeof x === 'number') out.push(x);
        }
    } else {
      if (v instanceof FormulaError) return v;
      if (v === null) continue;
      if (typeof v === 'number') out.push(v);
      else if (typeof v === 'boolean') out.push(v ? 1 : 0);
      else {
        const n = toNum(v);
        if (n instanceof FormulaError) {
          if (strict) return n;
        } else out.push(n);
      }
    }
  }
  return out;
}

const firstErr = (vals: Scalar[]) => vals.find((v) => v instanceof FormulaError) as FormulaError | undefined;

function criteriaMatcher(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === 'string') {
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(crit);
    const op = m?.[1] ?? '=';
    const rhsText = m?.[2] ?? '';
    const rhsNum = rhsText.trim() !== '' && !isNaN(Number(normalizeDigits(rhsText))) ? Number(normalizeDigits(rhsText)) : null;
    return (v) => {
      if (v instanceof FormulaError) return false;
      if (rhsNum !== null) {
        if (typeof v !== 'number') {
          if (op === '<>') return true;
          return false;
        }
        return cmpOp(op, v, rhsNum);
      }
      const s = v === null ? '' : toStr(v).toLowerCase();
      const t = rhsText.toLowerCase();
      if (op === '=' || op === '<>') {
        let eq: boolean;
        if (t.includes('*') || t.includes('?')) {
          const re = new RegExp('^' + t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 's');
          eq = re.test(s);
        } else eq = s === t;
        return op === '=' ? eq : !eq;
      }
      return cmpOp(op, s < t ? -1 : s > t ? 1 : 0, 0);
    };
  }
  if (typeof crit === 'number') return (v) => typeof v === 'number' && v === crit;
  if (typeof crit === 'boolean') return (v) => v === crit;
  return (v) => v === null;
}
function cmpOp(op: string, a: number, b: number) {
  switch (op) {
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    case '<>': return a !== b;
    default: return a === b;
  }
}

function range2(v: Val): Scalar[][] {
  return Array.isArray(v) ? v : [[v]];
}

function roundTo(x: number, d: number, mode: 'r' | 'u' | 'd') {
  const f = Math.pow(10, d);
  const y = x * f;
  const fn = mode === 'r' ? (v: number) => Math.sign(v) * Math.round(Math.abs(v)) : mode === 'u' ? (v: number) => Math.sign(v) * Math.ceil(Math.abs(v)) : (v: number) => Math.sign(v) * Math.floor(Math.abs(v));
  return fn(+y.toPrecision(15)) / f;
}

function simpleText(name: string, f: (s: string) => string): [string, Fn] {
  return [name, (a) => { const v = scalar(a[0]); return v instanceof FormulaError ? v : f(toStr(v)); }];
}

function numFn(name: string, f: (x: number) => number | FormulaError): [string, Fn] {
  return [name, (a) => {
    const x = toNum(scalar(a[0]));
    if (x instanceof FormulaError) return x;
    const r = f(x);
    return typeof r === 'number' && !isFinite(r) ? E('#NUM!') : r;
  }];
}

const FUNCS: Record<string, Fn> = Object.fromEntries([
  ['SUM', (a) => { const n = nums(a); return n instanceof FormulaError ? n : n.reduce((s, x) => s + x, 0); }],
  ['PRODUCT', (a) => { const n = nums(a); return n instanceof FormulaError ? n : n.reduce((s, x) => s * x, 1); }],
  ['AVERAGE', (a) => { const n = nums(a); if (n instanceof FormulaError) return n; return n.length ? n.reduce((s, x) => s + x, 0) / n.length : E('#DIV/0!'); }],
  ['MIN', (a) => { const n = nums(a); return n instanceof FormulaError ? n : n.length ? Math.min(...n) : 0; }],
  ['MAX', (a) => { const n = nums(a); return n instanceof FormulaError ? n : n.length ? Math.max(...n) : 0; }],
  ['MEDIAN', (a) => { const n = nums(a); if (n instanceof FormulaError) return n; if (!n.length) return E('#NUM!'); n.sort((x, y) => x - y); const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; }],
  ['STDEV', (a) => { const n = nums(a); if (n instanceof FormulaError) return n; if (n.length < 2) return E('#DIV/0!'); const m = n.reduce((s, x) => s + x, 0) / n.length; return Math.sqrt(n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1)); }],
  ['COUNT', (a) => { let c = 0; for (const v of flat(a)) if (typeof v === 'number') c++; return c; }],
  ['COUNTA', (a) => flat(a).filter((v) => v !== null && v !== '').length],
  ['COUNTBLANK', (a) => flat(a).filter((v) => v === null || v === '').length],
  ['LARGE', (a) => { const n = nums([a[0]]); const k = toNum(scalar(a[1])); if (n instanceof FormulaError) return n; if (k instanceof FormulaError) return k; n.sort((x, y) => y - x); return n[k - 1] ?? E('#NUM!'); }],
  ['SMALL', (a) => { const n = nums([a[0]]); const k = toNum(scalar(a[1])); if (n instanceof FormulaError) return n; if (k instanceof FormulaError) return k; n.sort((x, y) => x - y); return n[k - 1] ?? E('#NUM!'); }],
  ['IF', (a) => { const c = toBool(scalar(a[0])); if (c instanceof FormulaError) return c; return c ? (a[1] ?? true) : a.length > 2 ? a[2] : false; }],
  ['IFERROR', (a) => { const v = scalar(a[0]); return v instanceof FormulaError ? (a[1] ?? '') : v; }],
  ['IFNA', (a) => { const v = scalar(a[0]); return v instanceof FormulaError && v.code === '#N/A' ? (a[1] ?? '') : v; }],
  ['AND', (a) => { for (const v of flat(a)) { if (v === null) continue; const b = toBool(v); if (b instanceof FormulaError) return b; if (!b) return false; } return true; }],
  ['OR', (a) => { for (const v of flat(a)) { if (v === null) continue; const b = toBool(v); if (b instanceof FormulaError) return b; if (b) return true; } return false; }],
  ['NOT', (a) => { const b = toBool(scalar(a[0])); return b instanceof FormulaError ? b : !b; }],
  ['TRUE', () => true],
  ['FALSE', () => false],
  numFn('ABS', Math.abs),
  numFn('SQRT', (x) => (x < 0 ? E('#NUM!') : Math.sqrt(x))),
  numFn('INT', Math.floor),
  numFn('EXP', Math.exp),
  numFn('LN', (x) => (x <= 0 ? E('#NUM!') : Math.log(x))),
  numFn('LOG10', (x) => (x <= 0 ? E('#NUM!') : Math.log10(x))),
  numFn('SIGN', Math.sign),
  numFn('SIN', Math.sin),
  numFn('COS', Math.cos),
  numFn('TAN', Math.tan),
  ['PI', () => Math.PI],
  ['POWER', (a) => { const x = toNum(scalar(a[0])), y = toNum(scalar(a[1])); if (x instanceof FormulaError) return x; if (y instanceof FormulaError) return y; const p = Math.pow(x, y); return isFinite(p) ? p : E('#NUM!'); }],
  ['MOD', (a) => { const x = toNum(scalar(a[0])), y = toNum(scalar(a[1])); if (x instanceof FormulaError) return x; if (y instanceof FormulaError) return y; return y === 0 ? E('#DIV/0!') : x - y * Math.floor(x / y); }],
  ['ROUND', (a) => { const x = toNum(scalar(a[0])), d = a[1] === undefined ? 0 : toNum(scalar(a[1])); if (x instanceof FormulaError) return x; if (d instanceof FormulaError) return d; return roundTo(x, d, 'r'); }],
  ['ROUNDUP', (a) => { const x = toNum(scalar(a[0])), d = a[1] === undefined ? 0 : toNum(scalar(a[1])); if (x instanceof FormulaError) return x; if (d instanceof FormulaError) return d; return roundTo(x, d, 'u'); }],
  ['ROUNDDOWN', (a) => { const x = toNum(scalar(a[0])), d = a[1] === undefined ? 0 : toNum(scalar(a[1])); if (x instanceof FormulaError) return x; if (d instanceof FormulaError) return d; return roundTo(x, d, 'd'); }],
  ['CEILING', (a) => { const x = toNum(scalar(a[0])), s = a[1] === undefined ? 1 : toNum(scalar(a[1])); if (x instanceof FormulaError) return x; if (s instanceof FormulaError) return s; return s === 0 ? 0 : Math.ceil(x / s) * s; }],
  ['FLOOR', (a) => { const x = toNum(scalar(a[0])), s = a[1] === undefined ? 1 : toNum(scalar(a[1])); if (x instanceof FormulaError) return x; if (s instanceof FormulaError) return s; return s === 0 ? 0 : Math.floor(x / s) * s; }],
  ['RAND', () => Math.random()],
  ['RANDBETWEEN', (a) => { const lo = toNum(scalar(a[0])), hi = toNum(scalar(a[1])); if (lo instanceof FormulaError) return lo; if (hi instanceof FormulaError) return hi; return lo + Math.floor(Math.random() * (hi - lo + 1)); }],
  ['SUMPRODUCT', (a) => { const arrs = a.map((x) => flat([x])); const n = arrs[0]?.length ?? 0; let s = 0; for (let i = 0; i < n; i++) { let p = 1; for (const ar of arrs) { const v = ar[i]; p *= typeof v === 'number' ? v : 0; } s += p; } return s; }],
  // text
  ['LEN', (a) => { const v = scalar(a[0]); return v instanceof FormulaError ? v : [...toStr(v)].length; }],
  simpleText('UPPER', (s) => s.toUpperCase()),
  simpleText('LOWER', (s) => s.toLowerCase()),
  simpleText('TRIM', (s) => s.trim().replace(/\s+/g, ' ')),
  simpleText('PROPER', (s) => s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())),
  ['LEFT', (a) => { const s = toStr(scalar(a[0])); const n = a[1] === undefined ? 1 : toNum(scalar(a[1])); if (n instanceof FormulaError) return n; return [...s].slice(0, n).join(''); }],
  ['RIGHT', (a) => { const s = [...toStr(scalar(a[0]))]; const n = a[1] === undefined ? 1 : toNum(scalar(a[1])); if (n instanceof FormulaError) return n; return n === 0 ? '' : s.slice(-n).join(''); }],
  ['MID', (a) => { const s = [...toStr(scalar(a[0]))]; const st = toNum(scalar(a[1])), n = toNum(scalar(a[2])); if (st instanceof FormulaError) return st; if (n instanceof FormulaError) return n; return s.slice(st - 1, st - 1 + n).join(''); }],
  ['CONCAT', (a) => flat(a).map(toStr).join('')],
  ['CONCATENATE', (a) => flat(a).map(toStr).join('')],
  ['TEXTJOIN', (a) => { const d = toStr(scalar(a[0])); const skip = toBool(scalar(a[1])) === true; const parts = flat(a.slice(2)).map(toStr); return (skip ? parts.filter((x) => x !== '') : parts).join(d); }],
  ['SUBSTITUTE', (a) => { const s = toStr(scalar(a[0])), f = toStr(scalar(a[1])), t = toStr(scalar(a[2])); return f ? s.split(f).join(t) : s; }],
  ['FIND', (a) => { const i = toStr(scalar(a[1])).indexOf(toStr(scalar(a[0])), a[2] === undefined ? 0 : (toNum(scalar(a[2])) as number) - 1); return i < 0 ? E('#VALUE!') : i + 1; }],
  ['SEARCH', (a) => { const i = toStr(scalar(a[1])).toLowerCase().indexOf(toStr(scalar(a[0])).toLowerCase(), a[2] === undefined ? 0 : (toNum(scalar(a[2])) as number) - 1); return i < 0 ? E('#VALUE!') : i + 1; }],
  ['REPT', (a) => { const n = toNum(scalar(a[1])); if (n instanceof FormulaError) return n; return toStr(scalar(a[0])).repeat(Math.max(0, n)); }],
  ['VALUE', (a) => { const v = scalar(a[0]); return typeof v === 'string' ? toNum(v) : v; }],
  ['TEXT', (a) => {
    const x = scalar(a[0]); const f = toStr(scalar(a[1]));
    const n = toNum(x);
    if (n instanceof FormulaError) return toStr(x);
    const dec = /\.(0+)/.exec(f)?.[1].length ?? 0;
    if (f.includes('%')) return (n * 100).toFixed(dec) + '%';
    if (/[dmy]/i.test(f)) { const d = excelDateToJS(n); const p = (v: number) => String(v).padStart(2, '0'); return f.replace(/yyyy/gi, String(d.getUTCFullYear())).replace(/yy/gi, String(d.getUTCFullYear()).slice(2)).replace(/dd/gi, p(d.getUTCDate())).replace(/mm/gi, p(d.getUTCMonth() + 1)); }
    const s = n.toFixed(dec);
    return f.includes(',') ? s.replace(/\B(?=(\d{3})+(?!\d|\.\d))/g, ',') : s;
  }],
  ['ISBLANK', (a) => scalar(a[0]) === null],
  ['ISNUMBER', (a) => typeof scalar(a[0]) === 'number'],
  ['ISTEXT', (a) => typeof scalar(a[0]) === 'string'],
  ['ISERROR', (a) => scalar(a[0]) instanceof FormulaError],
  // dates
  ['TODAY', () => Math.floor(jsToExcelDate(new Date()))],
  ['NOW', () => jsToExcelDate(new Date())],
  ['DATE', (a) => { const [y, m, d] = a.map((x) => toNum(scalar(x))); if (y instanceof FormulaError) return y; if (m instanceof FormulaError) return m; if (d instanceof FormulaError) return d; return Math.floor(jsToExcelDate(new Date(Date.UTC(y, m - 1, d)))); }],
  ['YEAR', (a) => { const n = toNum(scalar(a[0])); return n instanceof FormulaError ? n : excelDateToJS(n).getUTCFullYear(); }],
  ['MONTH', (a) => { const n = toNum(scalar(a[0])); return n instanceof FormulaError ? n : excelDateToJS(n).getUTCMonth() + 1; }],
  ['DAY', (a) => { const n = toNum(scalar(a[0])); return n instanceof FormulaError ? n : excelDateToJS(n).getUTCDate(); }],
  // conditional aggregates
  ['SUMIF', (a) => {
    const rng = range2(a[0]); const m = criteriaMatcher(scalar(a[1])); const sumR = a[2] !== undefined ? range2(a[2]) : rng;
    let s = 0;
    for (let r = 0; r < rng.length; r++) for (let c = 0; c < rng[r].length; c++) if (m(rng[r][c])) { const v = sumR[r]?.[c]; if (typeof v === 'number') s += v; }
    return s;
  }],
  ['COUNTIF', (a) => { const m = criteriaMatcher(scalar(a[1])); let n = 0; for (const row of range2(a[0])) for (const v of row) if (m(v)) n++; return n; }],
  ['AVERAGEIF', (a) => {
    const rng = range2(a[0]); const m = criteriaMatcher(scalar(a[1])); const avR = a[2] !== undefined ? range2(a[2]) : rng;
    let s = 0, n = 0;
    for (let r = 0; r < rng.length; r++) for (let c = 0; c < rng[r].length; c++) if (m(rng[r][c])) { const v = avR[r]?.[c]; if (typeof v === 'number') { s += v; n++; } }
    return n ? s / n : E('#DIV/0!');
  }],
  ['SUMIFS', (a) => {
    const sumR = range2(a[0]); const conds: [Scalar[][], (v: Scalar) => boolean][] = [];
    for (let i = 1; i + 1 < a.length; i += 2) conds.push([range2(a[i]), criteriaMatcher(scalar(a[i + 1]))]);
    let s = 0;
    for (let r = 0; r < sumR.length; r++) for (let c = 0; c < sumR[r].length; c++) if (conds.every(([rg, m]) => m(rg[r]?.[c] ?? null))) { const v = sumR[r][c]; if (typeof v === 'number') s += v; }
    return s;
  }],
  ['COUNTIFS', (a) => {
    const conds: [Scalar[][], (v: Scalar) => boolean][] = [];
    for (let i = 0; i + 1 < a.length; i += 2) conds.push([range2(a[i]), criteriaMatcher(scalar(a[i + 1]))]);
    const base = conds[0]?.[0] ?? []; let n = 0;
    for (let r = 0; r < base.length; r++) for (let c = 0; c < base[r].length; c++) if (conds.every(([rg, m]) => m(rg[r]?.[c] ?? null))) n++;
    return n;
  }],
  // lookup
  ['VLOOKUP', (a) => {
    const key = scalar(a[0]); const tbl = range2(a[1]); const col = toNum(scalar(a[2])); const approx = a[3] === undefined ? true : toBool(scalar(a[3]));
    if (col instanceof FormulaError) return col; if (approx instanceof FormulaError) return approx;
    if (col < 1 || col > (tbl[0]?.length ?? 0)) return E('#REF!');
    if (!approx) { for (const row of tbl) if (compare(row[0], key) === 0) return row[col - 1]; return E('#N/A'); }
    let best: Scalar[] | null = null; for (const row of tbl) { if (compare(row[0], key) <= 0) best = row; else break; }
    return best ? best[col - 1] : E('#N/A');
  }],
  ['HLOOKUP', (a) => {
    const key = scalar(a[0]); const tbl = range2(a[1]); const row = toNum(scalar(a[2])); const approx = a[3] === undefined ? true : toBool(scalar(a[3]));
    if (row instanceof FormulaError) return row; if (approx instanceof FormulaError) return approx;
    if (row < 1 || row > tbl.length) return E('#REF!');
    const head = tbl[0] ?? [];
    if (!approx) { for (let c = 0; c < head.length; c++) if (compare(head[c], key) === 0) return tbl[row - 1][c]; return E('#N/A'); }
    let bi = -1; for (let c = 0; c < head.length; c++) { if (compare(head[c], key) <= 0) bi = c; else break; }
    return bi >= 0 ? tbl[row - 1][bi] : E('#N/A');
  }],
  ['XLOOKUP', (a) => {
    const key = scalar(a[0]); const look = flat([a[1]]); const ret = range2(a[2]); const vertical = range2(a[1]).length > 1 || range2(a[1])[0].length === 1;
    for (let i = 0; i < look.length; i++) if (compare(look[i], key) === 0) return vertical ? (ret[i]?.[0] ?? null) : (ret[0]?.[i] ?? null);
    return a[3] !== undefined ? a[3] : E('#N/A');
  }],
  ['MATCH', (a) => {
    const key = scalar(a[0]); const arr = flat([a[1]]); const type = a[2] === undefined ? 1 : toNum(scalar(a[2]));
    if (type instanceof FormulaError) return type;
    if (type === 0) { for (let i = 0; i < arr.length; i++) if (compare(arr[i], key) === 0) return i + 1; return E('#N/A'); }
    let best = -1; for (let i = 0; i < arr.length; i++) { const c = compare(arr[i], key); if (type > 0 ? c <= 0 : c >= 0) best = i; else break; }
    return best < 0 ? E('#N/A') : best + 1;
  }],
  ['INDEX', (a) => {
    const t = range2(a[0]); const r = toNum(scalar(a[1])); const c = a[2] === undefined ? 1 : toNum(scalar(a[2]));
    if (r instanceof FormulaError) return r; if (c instanceof FormulaError) return c;
    if (t.length === 1 && a[2] === undefined) return t[0][r - 1] ?? E('#REF!');
    return t[r - 1]?.[c - 1] ?? E('#REF!');
  }],
  ['ROWS', (a) => range2(a[0]).length],
  ['COLUMNS', (a) => range2(a[0])[0]?.length ?? 0],
] as [string, Fn][]);

function callFn(n: Extract<Node, { k: 'fn' }>, ctx: EvalCtx): Val {
  const f = FUNCS[n.name];
  if (!f) return E('#NAME?');
  // IF / IFERROR / IFNA evaluate lazily to avoid error propagation from the unused branch.
  if (n.name === 'IF') {
    const c = toBool(scalar(evalNode(n.args[0], ctx)));
    if (c instanceof FormulaError) return c;
    if (c) return n.args[1] ? evalNode(n.args[1], ctx) : true;
    return n.args[2] ? evalNode(n.args[2], ctx) : false;
  }
  if (n.name === 'IFERROR' || n.name === 'IFNA') {
    const v = scalar(evalNode(n.args[0], ctx));
    const isErr = v instanceof FormulaError && (n.name === 'IFERROR' || v.code === '#N/A');
    return isErr ? (n.args[1] ? evalNode(n.args[1], ctx) : '') : v;
  }
  const args = n.args.map((x) => evalNode(x, ctx));
  // propagate first error for scalar-only functions is handled per-function.
  return f(args, ctx);
}

export function evaluateFormula(src: string, ctx: EvalCtx): Scalar {
  const ast = parseFormula(src);
  if (ast instanceof FormulaError) return ast;
  try {
    const v = evalNode(ast, ctx);
    const s = scalar(v);
    return s === undefined ? null : s;
  } catch (e) {
    return e instanceof FormulaError ? e : E('#ERROR!');
  }
}

export const FUNCTION_NAMES = Object.keys(FUNCS).sort();
void firstErr;
