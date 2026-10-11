import type { Workbook } from '../core/workbook';
import { addr, colToName, keyOf, type Range } from '../core/address';
import { displayValue } from '../core/format';
import { FormulaError } from '../core/types';
import { profileRange } from '../core/tools';

// ---------- action schema ----------
export interface StylePatch {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  indent?: number;
  numberFormat?: string;
  wrap?: boolean;
}

type S = { sheet?: string };

export type Action =
  | ({ type: 'set_cells'; cells: { ref: string; value: string | number | boolean | null; style?: StylePatch }[] } & S)
  | ({ type: 'set_range'; range: string; values: (string | number | boolean | null)[][] } & S)
  | ({ type: 'fill_formula'; range: string; formula: string } & S)
  | ({ type: 'format'; range: string; style: StylePatch } & S)
  | ({ type: 'clear'; range: string; formatToo?: boolean } & S)
  | ({ type: 'insert_rows' | 'delete_rows' | 'insert_cols' | 'delete_cols'; at: number | string; count?: number } & S)
  | ({ type: 'sort'; range: string; by: string | number; order?: 'asc' | 'desc'; hasHeader?: boolean } & S)
  | { type: 'add_sheet'; name: string }
  | { type: 'rename_sheet'; sheet: string; name: string }
  | { type: 'delete_sheet'; sheet: string }
  | ({ type: 'set_col_width'; col: string; width: number } & S)
  | ({ type: 'set_row_height'; row: number; height: number } & S)
  | ({ type: 'freeze'; rows?: number; cols?: number } & S)
  | ({ type: 'autofit'; cols?: string; rows?: boolean } & S)
  | ({ type: 'merge'; range: string; unmerge?: boolean } & S)
  | ({ type: 'borders'; range: string; preset: 'all' | 'outer' | 'inner' | 'none' | 'top' | 'bottom' | 'left' | 'right' | 'horizontal' | 'vertical'; style?: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'; color?: string } & S)
  | ({ type: 'add_chart'; id?: string; chartType: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter'; range: string; title?: string; headerRow?: boolean; headerCol?: boolean; stacked?: boolean; legend?: boolean; at?: string; width?: number; height?: number } & S)
  | ({ type: 'delete_chart'; id: string } & S)
  | ({ type: 'conditional_format'; range: string; rule: 'cell' | 'text' | 'top' | 'bottom' | 'duplicates' | 'color_scale' | 'data_bar' | 'formula'; op?: '>' | '<' | '>=' | '<=' | '=' | '<>' | 'between' | 'notBetween'; value?: string | number; value2?: string | number; text?: string; rank?: number; formula?: string; background?: string; color?: string; bold?: boolean; colors?: string[] } & S)
  | ({ type: 'clear_conditional_format'; range?: string } & S)
  | ({ type: 'data_validation'; range: string; kind: 'list' | 'whole' | 'decimal' | 'textLength' | 'date'; items?: string[]; source?: string; op?: 'between' | 'notBetween' | '=' | '<>' | '>' | '<' | '>=' | '<='; min?: number; max?: number; message?: string } & S)
  | ({ type: 'clear_data_validation'; range?: string } & S)
  | ({ type: 'filter'; range?: string | null; column?: string; values?: string[] } & S)
  | { type: 'pivot'; sourceSheet?: string; source: string; rows: string; columns?: string; values: string; agg?: 'sum' | 'count' | 'avg' | 'min' | 'max'; targetSheet?: string; grandTotals?: boolean }
  | { type: 'find_replace'; find: string; replace: string; sheet?: string; allSheets?: boolean; matchCase?: boolean; wholeCell?: boolean }
  | ({ type: 'remove_duplicates'; range: string; columns?: string[]; hasHeader?: boolean } & S)
  | ({ type: 'text_to_columns'; range: string; delimiter: string } & S)
  | ({ type: 'add_comment'; ref: string; text: string | null } & S)
  | { type: 'define_name'; name: string; ref: string | null }
  | ({ type: 'hide'; rows?: string; cols?: string; hidden?: boolean } & S);

export const ACTION_TYPES = new Set([
  'set_cells', 'set_range', 'fill_formula', 'format', 'clear', 'insert_rows', 'delete_rows', 'insert_cols', 'delete_cols', 'sort', 'add_sheet', 'rename_sheet', 'delete_sheet',
  'set_col_width', 'set_row_height', 'freeze', 'autofit', 'merge', 'borders', 'add_chart', 'delete_chart', 'conditional_format', 'clear_conditional_format', 'data_validation',
  'clear_data_validation', 'filter', 'pivot', 'find_replace', 'remove_duplicates', 'text_to_columns', 'add_comment', 'define_name', 'hide',
]);

export type ToolCall =
  | { tool: 'read_range'; sheet?: string; range: string }
  | { tool: 'search'; query: string; sheet?: string }
  | { tool: 'profile'; sheet?: string; range?: string }
  | { tool: 'eval'; sheet?: string; cell?: string; formula: string };

export interface PlanTask {
  id: string;
  title: string;
  instruction: string;
  depends?: string[];
}
export interface Plan {
  goal: string;
  tasks: PlanTask[];
}

export interface AiReply {
  message: string;
  actions: Action[];
  tools: ToolCall[];
  plan: Plan | null;
}

export type Lang = 'en' | 'gu';

const LANG_RULE = (lang: 'auto' | Lang) =>
  lang === 'gu' ? 'Write in Gujarati (ગુજરાતી).' : lang === 'en' ? 'Write in English.' : 'Reply in the language the user used (English or Gujarati/ગુજરાતી); if they mix, prefer Gujarati.';

const ACTIONS_DOC = `## Actions (JSON objects inside the "actions" array)
Sheets are referenced by name ("sheet" omitted = active sheet). Cells use A1 notation (rows 1-based, exactly as shown in the grid). Ranges like "A1:D20".
Data & structure
- {"type":"set_cells","cells":[{"ref":"A1","value":"Name","style":{...}}]}  — value: text, number, boolean, null (clear) or a formula string starting with "="
- {"type":"set_range","range":"A1:C2","values":[["a","b","c"],[1,2,"=A2+B2"]]}  — 2D array whose size matches the range exactly (best for tables)
- {"type":"fill_formula","range":"D2:D20","formula":"=B2*C2"}  — formula for the TOP-LEFT cell, auto-adjusted down/across like Excel fill (use this instead of writing many formulas)
- {"type":"clear","range":"A5:C9","formatToo":false}
- {"type":"insert_rows"|"delete_rows"|"insert_cols"|"delete_cols","at":3,"count":1}  — rows: 1-based number; cols: letter ("C") or 1-based number; insert is BEFORE "at"
- {"type":"sort","range":"A1:D20","by":"B","order":"asc|desc","hasHeader":true}
- {"type":"remove_duplicates","range":"A1:D50","columns":["A","B"],"hasHeader":true}
- {"type":"text_to_columns","range":"A2:A50","delimiter":","}  (delimiter: "," ";" "|" "tab" "space" or any text)
- {"type":"find_replace","find":"old","replace":"new","allSheets":false,"matchCase":false,"wholeCell":false}
- {"type":"add_sheet","name":"Summary"} / {"type":"rename_sheet","sheet":"Old","name":"New"} / {"type":"delete_sheet","sheet":"Old"}
Look & layout
- {"type":"format","range":"A1:D1","style":{"bold":true,"italic":false,"underline":false,"color":"#RRGGBB","background":"#RRGGBB","align":"left|center|right","valign":"top|middle|bottom","indent":1,"wrap":true,"numberFormat":"general|number|integer|thousands|percent|currency_inr|currency_usd|currency_eur|accounting_inr|date|datetime|time|scientific|text"}}
- {"type":"borders","range":"A1:D10","preset":"all|outer|inner|none|top|bottom|left|right|horizontal|vertical","style":"thin|medium|thick|dashed|dotted|double","color":"#RRGGBB"}
- {"type":"merge","range":"A1:D1","unmerge":false}
- {"type":"autofit","cols":"A:F"|"all","rows":true}   — fit column widths (and wrapped-text row heights) to content. Always do this after you create or fill a table.
- {"type":"set_col_width","col":"A","width":160} / {"type":"set_row_height","row":1,"height":32} (pixels)
- {"type":"freeze","rows":1,"cols":0}
- {"type":"hide","rows":"5:9","cols":"C:D","hidden":true}
Excel features
- {"type":"add_chart","chartType":"column|bar|line|area|pie|doughnut|scatter","range":"A1:C8","title":"…","headerRow":true,"headerCol":true,"stacked":false,"legend":true,"at":"F2","width":480,"height":300}  — range includes the header row and the category column. Add charts on the sheet that holds (or summarises) the data.
- {"type":"delete_chart","id":"…"}
- {"type":"conditional_format","range":"C2:C50","rule":"cell|text|top|bottom|duplicates|color_scale|data_bar|formula","op":">","value":100,"value2":200,"text":"late","rank":10,"formula":"=$C2<0","background":"#fecaca","color":"#991b1b","bold":true,"colors":["#f8696b","#ffeb84","#63be7b"]}
- {"type":"clear_conditional_format","range":"C2:C50"}
- {"type":"data_validation","range":"B2:B50","kind":"list","items":["Open","Closed"]}  (or "source":"Lists!A1:A9"; kinds whole|decimal|textLength|date use "op","min","max"; optional "message")
- {"type":"filter","range":"A1:F100"}  turns on AutoFilter; with "column":"B","values":["North"] it keeps only those values; {"type":"filter","range":null} removes it
- {"type":"pivot","source":"A1:F200","rows":"Region","columns":"Product","values":"Revenue","agg":"sum|count|avg|min|max","targetSheet":"Pivot","grandTotals":true}  — creates a live pivot table sheet ("rows"/"columns"/"values" are header names of the source range)
- {"type":"add_comment","ref":"B2","text":"Check this"}  (text null deletes)
- {"type":"define_name","name":"Revenue","ref":"Sales!C2:C200"}`;

const FUNCTIONS = `Supported functions: SUM PRODUCT AVERAGE MIN MAX MEDIAN STDEV VAR COUNT COUNTA COUNTBLANK LARGE SMALL RANK PERCENTILE IF IFS SWITCH CHOOSE IFERROR IFNA AND OR NOT ABS SQRT INT TRUNC POWER MOD ROUND ROUNDUP ROUNDDOWN CEILING FLOOR EXP LN LOG10 FACT SUMSQ RAND RANDBETWEEN SUMPRODUCT LEN UPPER LOWER TRIM PROPER LEFT RIGHT MID CONCAT CONCATENATE TEXTJOIN SUBSTITUTE REPLACE FIND SEARCH REPT EXACT CLEAN CHAR CODE VALUE TEXT ISBLANK ISNUMBER ISTEXT ISERROR ISEVEN ISODD NA TODAY NOW DATE YEAR MONTH DAY EDATE EOMONTH WEEKDAY DATEDIF DAYS NETWORKDAYS SUMIF COUNTIF AVERAGEIF SUMIFS COUNTIFS AVERAGEIFS MAXIFS MINIFS VLOOKUP HLOOKUP XLOOKUP LOOKUP MATCH INDEX ROWS COLUMNS ROW COLUMN PMT FV PV NPV IRR. Named ranges work in formulas. No dynamic arrays (UNIQUE/FILTER/SORT/LET/LAMBDA), no macros, no INDIRECT/OFFSET.`;

const RULES = `## How to work
- Think before you act: understand the data (headers, types, units, languages), then plan the smallest correct set of edits. Verify every cell reference you write against the context — wrong references are the #1 failure.
- Prefer live formulas over typed results. Use absolute refs ($B$2) for fixed lookups/rates, relative refs for fills. Wrap lookups that may miss in IFERROR. Never produce a formula that depends on unsupported functions.
- When you create or restructure a table: bold header row with a light background, sensible number formats (currency_inr for rupees, percent, date), borders if it helps readability, then an "autofit" action, and freeze the header for long tables.
- Charts: pick the right type (trend→line, comparison→column/bar, share of whole→pie only for ≤6 slices, relationship→scatter), give it a clear title, and keep the data range tight.
- Keep edits minimal. Do not overwrite data the user did not ask you to change. Insert rows/columns instead of overwriting, and remember inserts shift references (the app updates formulas, but your later actions must use the NEW positions).
- Actions run in order; later actions see the result of earlier ones. If you add a sheet, reference it by name in later actions.
- Dates are Excel serial numbers formatted with numberFormat "date". Money is a plain number with a currency format.
- Never claim you did something that is not in the actions block. If the request is ambiguous, ask ONE short clarifying question and omit the block.
- The workbook context may be truncated for large sheets. Use the read tools below rather than guessing.
- The user may deny some actions through permissions — accept it without arguing.`;

const TOOLS_DOC = `## Reading more data (optional)
If you need cells you cannot see, reply with a short sentence and ONE fenced block named "tool" holding a JSON array of calls, and nothing else after it. The app runs them and sends the results back so you can continue:
\`\`\`tool
[{"tool":"read_range","sheet":"Sales","range":"A100:F160"},{"tool":"search","query":"Invoice 1042"},{"tool":"profile","sheet":"Sales","range":"A1:H500"},{"tool":"eval","formula":"=SUMIF(Sales!B:B,\\"North\\",Sales!E:E)"}]
\`\`\`
- read_range: raw values/formulas of a range (max ~400 cells). search: finds cells containing text (all sheets unless "sheet" given). profile: per-column stats (type, min/max/mean, distinct count, samples). eval: computes a formula and returns the result (use it to check numbers before you commit to them).`;

const PLAN_DOC = `## Big jobs → plan
If the request clearly needs 3 or more independent parts of substantial work (for example "build a complete financial model with 4 sheets", "create sales, HR and inventory dashboards"), do NOT write the actions yourself. Reply with one sentence and ONE fenced block named "plan":
\`\`\`plan
{"goal":"…","tasks":[{"id":"t1","title":"Short title","instruction":"Precise, self-contained instruction for a specialist worker (name the sheet(s), columns, formulas and formats it must produce).","depends":[]},{"id":"t2","title":"…","instruction":"…","depends":["t1"]}]}
\`\`\`
Rules: 2-6 tasks; each task owns its own sheet or area so tasks do not overwrite each other; use "depends" when a task reads cells another task creates (reference the exact sheet names/ranges the earlier task will produce, and tell both tasks the layout). Small or sequential requests must NOT use a plan.`;

export const SYSTEM_PROMPT = (lang: 'auto' | Lang, opts: { multi?: boolean; role?: 'main' | 'worker'; task?: PlanTask; goal?: string } = {}) => {
  const worker = opts.role === 'worker';
  return `You are the AI engine inside AiSheet, a native Windows spreadsheet (Excel-like). You read the open workbook and edit it by emitting actions. You are precise, careful and fast.

## Output format
Reply in Markdown, like a helpful senior analyst: short and clear. ${LANG_RULE(lang)}
- Say briefly what you will do or what you found. Use short lists or **bold** sparingly. No headings for small replies.
- To edit the workbook, END your reply with exactly one fenced block whose info string is "actions" containing a JSON array of actions:
\`\`\`actions
[ {"type":"…"}, … ]
\`\`\`
- Nothing after that block. For pure questions, omit it. Cell content (names, labels) stays in the user's data language; never translate existing data unless asked.

${ACTIONS_DOC}

${FUNCTIONS}

${RULES}

${TOOLS_DOC}
${worker ? `
## You are a worker agent
You handle ONLY this task of a larger plan. Goal of the whole job: ${opts.goal ?? ''}
Your task "${opts.task?.title ?? ''}": ${opts.task?.instruction ?? ''}
Do not do other tasks, do not emit a plan block, and do not touch cells outside your task's sheet/area. End with your actions block.` : opts.multi === false ? '' : `\n${PLAN_DOC}`}`;
};

// ---------- context ----------
export interface ContextOpts {
  maxCells?: number;
}

function cellText(wb: Workbook, s: ReturnType<Workbook['sheetById']> & object, r: number, c: number): string | null {
  const cell = s.cells.get(keyOf(r, c));
  if (!cell || cell.raw === '') return null;
  const raw = cell.raw;
  if (typeof raw === 'string' && raw.startsWith('=')) {
    const v = wb.value(s, r, c);
    return `${colToName(c)}${r + 1}=${raw} → ${v instanceof FormulaError ? v.code : displayValue(v, undefined)}`;
  }
  return `${colToName(c)}${r + 1}=${typeof raw === 'string' ? JSON.stringify(raw.length > 160 ? raw.slice(0, 160) + '…' : raw) : String(raw)}`;
}

export function buildContext(wb: Workbook, activeSheetId: string, selection: Range | null, opts: ContextOpts = {}): string {
  const lines: string[] = [];
  lines.push('## Workbook');
  for (const s of wb.sheets) {
    const b = wb.usedBounds(s);
    const extras: string[] = [];
    if (s.freezeRows || s.freezeCols) extras.push(`frozen ${s.freezeRows} row(s)/${s.freezeCols} col(s)`);
    if (s.filter) extras.push(`AutoFilter ${addr(s.filter.range.r1, s.filter.range.c1)}:${addr(s.filter.range.r2, s.filter.range.c2)}`);
    if (s.merges.length) extras.push(`${s.merges.length} merged block(s)`);
    if (s.cf.length) extras.push(`${s.cf.length} conditional format rule(s)`);
    if (s.validations.length) extras.push(`${s.validations.length} validation rule(s)`);
    if (s.hiddenRows.size || s.filterHidden.size) extras.push(`${s.hiddenRows.size + s.filterHidden.size} hidden row(s)`);
    lines.push(`- "${s.name}"${s.id === activeSheetId ? ' (active)' : ''}: ${b.r < 0 ? 'empty' : `used range A1:${addr(b.r, b.c)} (${b.r + 1} rows × ${b.c + 1} cols)`}${extras.length ? ' · ' + extras.join(', ') : ''}`);
    for (const ch of s.charts) lines.push(`  · chart id=${ch.id} ${ch.type} "${ch.title}" range ${ch.range}`);
  }
  if (wb.names.size) lines.push('Named ranges: ' + [...wb.names].map(([n, r]) => `${n}=${r}`).join(', '));
  const active = wb.sheetById(activeSheetId) ?? wb.sheets[0];
  if (selection) {
    const multi = selection.r1 !== selection.r2 || selection.c1 !== selection.c2;
    lines.push(`Selection on "${active.name}": ${addr(selection.r1, selection.c1)}${multi ? ':' + addr(Math.min(selection.r2, 1048575), selection.c2) : ''}`);
    if (multi && (selection.r2 - selection.r1 + 1) * Math.min(selection.c2 - selection.c1 + 1, 30) <= 60) {
      const vals: string[] = [];
      for (let r = selection.r1; r <= selection.r2; r++) for (let c = selection.c1; c <= Math.min(selection.c2, selection.c1 + 29); c++) { const t = cellText(wb, active, r, c); if (t) vals.push(t); }
      if (vals.length) lines.push('Selected cells: ' + vals.join(' | '));
    }
  }
  const total = opts.maxCells ?? 3200;
  let budget = total;
  const ordered = [...wb.sheets].sort((a, b) => (a.id === activeSheetId ? -1 : b.id === activeSheetId ? 1 : 0));
  for (const s of ordered) {
    const b = wb.usedBounds(s);
    if (b.r < 0) continue;
    const maxC = Math.min(b.c, 49);
    const cellsApprox = (b.r + 1) * (maxC + 1);
    const big = cellsApprox > budget;
    lines.push(`\n## Sheet "${s.name}" ${big ? '(large — showing header, first rows, last rows and column statistics; use the read tools for more)' : '(REF=value; formulas show =… → result)'}`);
    const rowsToShow: number[] = [];
    if (big) {
      const first = Math.max(8, Math.floor(budget / (maxC + 1) / 2));
      for (let r = 0; r <= Math.min(b.r, first); r++) rowsToShow.push(r);
      for (let r = Math.max(first + 1, b.r - 4); r <= b.r; r++) rowsToShow.push(r);
    } else for (let r = 0; r <= b.r; r++) rowsToShow.push(r);
    let prev = -1;
    for (const r of rowsToShow) {
      if (budget <= 0) break;
      if (prev >= 0 && r > prev + 1) lines.push(`… (rows ${prev + 2}-${r} omitted)`);
      const parts: string[] = [];
      for (let c = 0; c <= maxC; c++) {
        const t = cellText(wb, s, r, c);
        if (t) {
          parts.push(t);
          budget--;
        }
      }
      if (parts.length) lines.push(parts.join(' | '));
      prev = r;
    }
    if (big) {
      const prof = profileRange(wb, s, { r1: 0, c1: 0, r2: b.r, c2: maxC }, true);
      lines.push('Column statistics: ' + prof.map((p) => `${p.col} "${p.header}" ${p.type}, ${p.filled} filled, ${p.distinct} distinct${p.min !== undefined ? `, min ${p.min}, max ${p.max}, mean ${Math.round((p.mean ?? 0) * 100) / 100}` : ''}${p.errors ? `, ${p.errors} errors` : ''}`).join(' ; '));
    }
    if (b.c > maxC) lines.push(`(columns beyond ${colToName(maxC)} omitted)`);
    if (s.comments.size) lines.push('Comments: ' + [...s.comments].slice(0, 8).map(([k, t]) => `${addr(Math.floor(k / 65536), k % 65536)}: ${t.slice(0, 80)}`).join(' | '));
  }
  return lines.join('\n');
}

// ---------- parsing ----------
const FENCE_OPEN = /```(actions|json|tool|plan)/i;

/** Text to show while streaming: everything before the first structured block (hides a half-written fence too). */
export function visibleText(raw: string): string {
  const i = raw.search(FENCE_OPEN);
  let t = i >= 0 ? raw.slice(0, i) : raw;
  t = t.replace(/`{1,3}[a-z]{0,7}$/i, (m) => (['```actions', '```json', '```tool', '```plan'].some((o) => o.startsWith(m.toLowerCase())) ? '' : m));
  return t.trimEnd();
}

export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* bracket matching */
  }
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error('no json');
  const open = t[start];
  const close = open === '[' ? ']' : '}';
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
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error('unbalanced json');
}

const onlyActions = (v: unknown): Action[] => (Array.isArray(v) ? v : []).filter((a) => a && typeof a === 'object' && ACTION_TYPES.has((a as { type: string }).type)) as Action[];
const TOOL_NAMES = new Set(['read_range', 'search', 'profile', 'eval']);
const onlyTools = (v: unknown): ToolCall[] => (Array.isArray(v) ? v : []).filter((a) => a && typeof a === 'object' && TOOL_NAMES.has((a as { tool: string }).tool)).slice(0, 6) as ToolCall[];

function block(raw: string, kind: string): string | null {
  const re = new RegExp('```' + kind + '\\s*\\n?([\\s\\S]*?)(?:```|$)', 'i');
  const m = re.exec(raw);
  return m ? m[1] : null;
}

export function parseReply(raw: string): AiReply {
  const message = visibleText(raw);
  const out: AiReply = { message, actions: [], tools: [], plan: null };
  const a = block(raw, 'actions') ?? block(raw, 'json');
  if (a) {
    try {
      const j = extractJson(a);
      out.actions = onlyActions(Array.isArray(j) ? j : (j as { actions?: unknown }).actions);
    } catch {
      /* ignore */
    }
  }
  const t = block(raw, 'tool');
  if (t) {
    try {
      out.tools = onlyTools(extractJson(t));
    } catch {
      /* ignore */
    }
  }
  const p = block(raw, 'plan');
  if (p) {
    try {
      const j = extractJson(p) as Plan;
      if (j && Array.isArray(j.tasks) && j.tasks.length >= 2) {
        const ids = new Set<string>();
        const tasks = j.tasks.slice(0, 6).map((x, i) => ({ id: String(x.id ?? `t${i + 1}`), title: String(x.title ?? `Task ${i + 1}`), instruction: String(x.instruction ?? ''), depends: Array.isArray(x.depends) ? x.depends.map(String) : [] }));
        tasks.forEach((x) => ids.add(x.id));
        tasks.forEach((x) => (x.depends = x.depends.filter((d) => ids.has(d) && d !== x.id)));
        out.plan = { goal: String(j.goal ?? ''), tasks };
      }
    } catch {
      /* ignore */
    }
  }
  // legacy / non-compliant models: a bare JSON object {"message","actions"}
  if (!a && !t && !p && /^\s*[{`]/.test(raw)) {
    try {
      const j = extractJson(raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '')) as { message?: unknown; actions?: unknown };
      if (j && typeof j === 'object' && !Array.isArray(j)) return { message: typeof j.message === 'string' ? j.message : '', actions: onlyActions(j.actions), tools: [], plan: null };
    } catch {
      /* plain text */
    }
  }
  if (!a && !t && !p) out.message = raw.trim();
  return out;
}
