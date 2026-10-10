import type { Workbook } from '../core/workbook';
import { addr, colToName, type Range } from '../core/address';
import { displayValue } from '../core/format';
import { keyOf } from '../core/address';
import { FormulaError } from '../core/types';

// ---------- action schema ----------
export interface StylePatch {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  numberFormat?: string;
  wrap?: boolean;
}

export type Action =
  | { type: 'set_cells'; sheet?: string; cells: { ref: string; value: string | number | boolean | null; style?: StylePatch }[] }
  | { type: 'set_range'; sheet?: string; range: string; values: (string | number | boolean | null)[][] }
  | { type: 'fill_formula'; sheet?: string; range: string; formula: string }
  | { type: 'format'; sheet?: string; range: string; style: StylePatch }
  | { type: 'clear'; sheet?: string; range: string; formatToo?: boolean }
  | { type: 'insert_rows' | 'delete_rows' | 'insert_cols' | 'delete_cols'; sheet?: string; at: number | string; count?: number }
  | { type: 'sort'; sheet?: string; range: string; by: string | number; order?: 'asc' | 'desc'; hasHeader?: boolean }
  | { type: 'add_sheet'; name: string }
  | { type: 'rename_sheet'; sheet: string; name: string }
  | { type: 'delete_sheet'; sheet: string }
  | { type: 'set_col_width'; sheet?: string; col: string; width: number }
  | { type: 'freeze'; sheet?: string; rows?: number; cols?: number };

export interface AiReply {
  message: string;
  actions: Action[];
}

export type Lang = 'en' | 'gu';

export const SYSTEM_PROMPT = (lang: 'auto' | Lang) => `You are the AI engine inside AiSheet, a desktop spreadsheet app (Excel-like). The user chats with you and you can read and edit the open workbook.

## Output format (STRICT)
Reply with ONE JSON object and nothing else (no markdown fences):
{"message": "<short human reply>", "actions": [ ...zero or more actions... ]}
- "message": concise, friendly, plain text. Explain what you did or answer the question. ${
  lang === 'gu'
    ? 'Write the message in Gujarati (ગુજરાતી).'
    : lang === 'en'
      ? 'Write the message in English.'
      : 'Write the message in the same language the user used (English or Gujarati/ગુજરાતી). If they mix, prefer Gujarati.'
}
- Cell content (names, labels) must stay in the user's data language; never translate existing data unless asked.
- For pure questions give "actions": [].

## Coordinates
Sheets are referenced by name (omit "sheet" to use the active sheet). Cells use A1 notation; rows are 1-based as shown in the grid.

## Actions
- {"type":"set_cells","sheet?":"","cells":[{"ref":"A1","value":"Name","style?":{...}}]}  — value may be text, number, boolean, null (clear) or a formula string starting with "=".
- {"type":"set_range","sheet?":"","range":"A1:C2","values":[["a","b","c"],[1,2,"=A2+B2"]]}  — 2D array whose size matches the range exactly (prefer this for tables).
- {"type":"fill_formula","sheet?":"","range":"D2:D20","formula":"=B2*C2"}  — write the formula for the TOP-LEFT cell; it is auto-adjusted down/across (relative refs shift like Excel fill). Prefer this over writing many formulas.
- {"type":"format","sheet?":"","range":"A1:D1","style":{"bold":true,"italic":false,"underline":false,"color":"#RRGGBB","background":"#RRGGBB","align":"left|center|right","numberFormat":"general|number|integer|thousands|percent|currency_usd|currency_inr|currency_eur|date|text","wrap":true}}
- {"type":"clear","sheet?":"","range":"A5:C9","formatToo?":false}
- {"type":"insert_rows"|"delete_rows"|"insert_cols"|"delete_cols","sheet?":"","at":3,"count?":1}  — rows: 1-based row number; cols: column letter (e.g. "C") or 1-based number. Insert happens BEFORE "at".
- {"type":"sort","sheet?":"","range":"A1:D20","by":"B","order":"asc|desc","hasHeader":true}
- {"type":"add_sheet","name":"Summary"} / {"type":"rename_sheet","sheet":"Old","name":"New"} / {"type":"delete_sheet","sheet":"Old"}
- {"type":"set_col_width","sheet?":"","col":"A","width":160}   (pixels)
- {"type":"freeze","sheet?":"","rows":1,"cols":0}

## Rules
- Use real spreadsheet formulas (SUM, AVERAGE, IF, SUMIF, COUNTIF, VLOOKUP, XLOOKUP, INDEX, MATCH, TEXT, ROUND, CONCAT, etc.) instead of computed constants whenever the result should stay live.
- Supported functions: SUM PRODUCT AVERAGE MIN MAX MEDIAN STDEV COUNT COUNTA COUNTBLANK LARGE SMALL IF IFERROR IFNA AND OR NOT ABS SQRT INT POWER MOD ROUND ROUNDUP ROUNDDOWN CEILING FLOOR EXP LN LOG10 RAND RANDBETWEEN SUMPRODUCT LEN UPPER LOWER TRIM PROPER LEFT RIGHT MID CONCAT CONCATENATE TEXTJOIN SUBSTITUTE FIND SEARCH REPT VALUE TEXT ISBLANK ISNUMBER ISTEXT ISERROR TODAY NOW DATE YEAR MONTH DAY SUMIF COUNTIF AVERAGEIF SUMIFS COUNTIFS VLOOKUP HLOOKUP XLOOKUP MATCH INDEX ROWS COLUMNS. No dynamic arrays, no named ranges, no macros.
- Make minimal, targeted edits. Do not overwrite data the user did not ask you to change. Do not touch cells outside the request.
- Put headers in a bold first row when you create a new table; set sensible number formats (currency_inr for rupees, percent, date).
- Dates are numbers (Excel serials) formatted with numberFormat "date".
- Never claim you did something that is not in "actions". If a request is ambiguous, ask a short clarifying question with "actions": [].
- If the workbook context is truncated, only edit what you can see or what the user described.
- The user may deny some actions (permissions) — then you will be told; do not argue.`;

// ---------- context ----------
const MAX_CELLS = 2500;

export function buildContext(wb: Workbook, activeSheetId: string, selection: Range | null): string {
  const lines: string[] = [];
  lines.push('## Workbook');
  for (const s of wb.sheets) {
    const b = wb.usedBounds(s);
    lines.push(`- "${s.name}"${s.id === activeSheetId ? ' (active)' : ''}: ${b.r < 0 ? 'empty' : `used range A1:${addr(b.r, b.c)}`}`);
  }
  if (selection) lines.push(`Selection on active sheet: ${addr(selection.r1, selection.c1)}${selection.r1 !== selection.r2 || selection.c1 !== selection.c2 ? ':' + addr(selection.r2, selection.c2) : ''}`);
  let budget = MAX_CELLS;
  const ordered = [...wb.sheets].sort((a, b) => (a.id === activeSheetId ? -1 : b.id === activeSheetId ? 1 : 0));
  for (const s of ordered) {
    const b = wb.usedBounds(s);
    if (b.r < 0) continue;
    lines.push(`\n## Sheet "${s.name}" contents (format: REF=value  | formulas shown as =… with computed result after →)`);
    const maxC = Math.min(b.c, 59);
    for (let r = 0; r <= b.r; r++) {
      if (budget <= 0) {
        lines.push(`… (truncated at row ${r}; sheet continues to row ${b.r + 1})`);
        break;
      }
      const parts: string[] = [];
      for (let c = 0; c <= maxC; c++) {
        const cell = s.cells.get(keyOf(r, c));
        if (!cell || cell.raw === '') continue;
        budget--;
        const raw = cell.raw;
        if (typeof raw === 'string' && raw.startsWith('=')) {
          const v = wb.value(s, r, c);
          const shown = v instanceof FormulaError ? v.code : displayValue(v, undefined);
          parts.push(`${colToName(c)}${r + 1}=${raw} → ${shown}`);
        } else parts.push(`${colToName(c)}${r + 1}=${typeof raw === 'string' ? JSON.stringify(raw.length > 200 ? raw.slice(0, 200) + '…' : raw) : String(raw)}`);
      }
      if (parts.length) lines.push(parts.join(' | '));
    }
    if (b.c > maxC) lines.push(`(columns beyond ${colToName(maxC)} omitted)`);
  }
  return lines.join('\n');
}

// ---------- parsing ----------
function stripFences(t: string) {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  return m ? m[1] : t;
}

function extractJson(text: string): unknown {
  const t = stripFences(text).trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to brace matching */
  }
  const start = t.indexOf('{');
  if (start < 0) throw new Error('no json');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced json');
}

const ACTION_TYPES = new Set(['set_cells', 'set_range', 'fill_formula', 'format', 'clear', 'insert_rows', 'delete_rows', 'insert_cols', 'delete_cols', 'sort', 'add_sheet', 'rename_sheet', 'delete_sheet', 'set_col_width', 'freeze']);

export function parseReply(text: string): AiReply {
  try {
    const j = extractJson(text) as { message?: unknown; actions?: unknown };
    const actions = Array.isArray(j.actions) ? (j.actions.filter((a) => a && typeof a === 'object' && ACTION_TYPES.has((a as { type: string }).type)) as Action[]) : [];
    return { message: typeof j.message === 'string' ? j.message : '', actions };
  } catch {
    return { message: text.trim(), actions: [] };
  }
}
