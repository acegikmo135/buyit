import type { CellStyle, NumFmt, Scalar } from './types';
import { FormulaError } from './types';

const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';

/** Converts Gujarati (and Devanagari / Arabic-Indic) digits to ASCII so numbers typed in Gujarati work. */
export function normalizeDigits(s: string): string {
  return s.replace(/[૦-૯०-९٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0ae6) return String(code - 0x0ae6);
    if (code >= 0x0966 && code <= 0x096f) return String(code - 0x0966);
    return String(code - 0x0660);
  });
}

export function toGujaratiDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => GU_DIGITS[+d]);
}

/** Parses typed input into a literal: number, boolean, or string. Formulas stay strings. */
export function parseInput(text: string): string | number | boolean {
  if (text.startsWith('=') || text.startsWith("'")) {
    return text.startsWith("'") ? text.slice(1) : text;
  }
  const t = normalizeDigits(text.trim());
  if (t === '') return '';
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return parseFloat(t);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  if (/^[-+]?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100;
  const up = t.toUpperCase();
  if (up === 'TRUE') return true;
  if (up === 'FALSE') return false;
  return text;
}

function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + ',' + last3;
}

function groupWestern(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fixed(n: number, dp: number, indian: boolean, group: boolean): string {
  const neg = n < 0;
  const s = Math.abs(n).toFixed(dp);
  const [i, f] = s.split('.');
  const gi = group ? (indian ? groupIndian(i) : groupWestern(i)) : i;
  return (neg ? '-' : '') + gi + (f ? '.' + f : '');
}

export function excelDateToJS(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}
export function jsToExcelDate(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

export function formatNumber(n: number, fmt: NumFmt | undefined): string {
  switch (fmt) {
    case 'number':
      return fixed(n, 2, false, false);
    case 'integer':
      return fixed(n, 0, false, false);
    case 'thousands':
      return fixed(n, 2, false, true);
    case 'percent':
      return fixed(n * 100, 2, false, false) + '%';
    case 'currency_usd':
      return (n < 0 ? '-' : '') + '$' + fixed(Math.abs(n), 2, false, true);
    case 'currency_eur':
      return (n < 0 ? '-' : '') + '€' + fixed(Math.abs(n), 2, false, true);
    case 'currency_inr':
      return (n < 0 ? '-' : '') + '₹' + fixed(Math.abs(n), 2, true, true);
    case 'datetime': {
      const d = excelDateToJS(n);
      const p2 = (v: number) => String(v).padStart(2, '0');
      return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
    }
    case 'time': {
      const d = excelDateToJS(n);
      const p2 = (v: number) => String(v).padStart(2, '0');
      return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
    }
    case 'scientific':
      return n.toExponential(2).toUpperCase().replace('E+', 'E+').replace(/E([+-])(\d)$/, 'E$10$2');
    case 'accounting_inr':
      return n < 0 ? `(₹${fixed(Math.abs(n), 2, true, true)})` : n === 0 ? '₹ -' : `₹${fixed(n, 2, true, true)} `;
    case 'date': {
      const d = excelDateToJS(n);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}/${d.getUTCFullYear()}`;
    }
    default: {
      if (!isFinite(n)) return String(n);
      if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
      const abs = Math.abs(n);
      if (abs >= 1e15 || (abs > 0 && abs < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, 'e');
      return String(parseFloat(n.toPrecision(12)));
    }
  }
}

export function displayValue(v: Scalar, style?: CellStyle): string {
  if (v === null || v === undefined) return '';
  if (v instanceof FormulaError) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return style?.fmt === 'text' ? String(v) : formatNumber(v, style?.fmt);
  return v;
}
