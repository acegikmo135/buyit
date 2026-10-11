import type { Range } from './address';

export type Align = 'left' | 'center' | 'right';
export type NumFmt =
  | 'general'
  | 'number'
  | 'integer'
  | 'thousands'
  | 'percent'
  | 'currency_usd'
  | 'currency_inr'
  | 'currency_eur'
  | 'date'
  | 'datetime'
  | 'time'
  | 'scientific'
  | 'accounting_inr'
  | 'text';

export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';
export interface Border {
  s: BorderStyle;
  c?: string;
}
export interface Borders {
  t?: Border;
  r?: Border;
  b?: Border;
  l?: Border;
}

export interface CellStyle {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  color?: string;
  bg?: string;
  align?: Align;
  fmt?: NumFmt;
  wrap?: boolean;
  valign?: 'top' | 'middle' | 'bottom';
  indent?: number;
  bd?: Borders;
}

/** Immutable cell record. `raw` is what the user typed: a literal or a "=formula". */
export interface Cell {
  raw: string | number | boolean;
  style?: CellStyle;
}

export type CFKind = 'cell' | 'text' | 'colorScale' | 'dataBar' | 'top' | 'dupes' | 'formula';
export interface CFRule {
  id: string;
  range: Range;
  kind: CFKind;
  op?: '>' | '<' | '>=' | '<=' | '=' | '<>' | 'between' | 'notBetween';
  v1?: string | number;
  v2?: string | number;
  text?: string; // for kind 'text' (contains)
  rank?: number; // for 'top'
  bottom?: boolean;
  formula?: string; // for 'formula' (relative to range top-left)
  style?: { bg?: string; color?: string; b?: boolean };
  colors?: string[]; // colorScale: [low, high] or [low, mid, high]
  color?: string; // dataBar
}

export type DVKind = 'list' | 'whole' | 'decimal' | 'textLength' | 'date' | 'custom';
export interface DVRule {
  id: string;
  range: Range;
  kind: DVKind;
  items?: string[]; // list literal
  source?: string; // list from range, e.g. "Sheet2!A1:A10"
  op?: 'between' | 'notBetween' | '=' | '<>' | '>' | '<' | '>=' | '<=';
  v1?: string | number;
  v2?: string | number;
  formula?: string;
  message?: string;
}

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
export interface ChartDef {
  id: string;
  type: ChartType;
  title: string;
  /** data range (A1 notation, optionally "Sheet!A1:C9") */
  range: string;
  headerRow: boolean; // first row holds series names
  headerCol: boolean; // first column holds categories
  stacked?: boolean;
  legend: boolean;
  /** position in sheet pixels (relative to the first cell) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FilterState {
  range: Range;
  /** column index → allowed display values; absent = unfiltered */
  allowed: Record<number, string[]>;
}

export interface PageSetup {
  orientation: 'portrait' | 'landscape';
  fitWidth: boolean;
  gridlines: boolean;
  headers: boolean;
  repeatHeaderRow: boolean;
  paper: 'A4' | 'Letter' | 'A3';
}

export interface Sheet {
  id: string;
  name: string;
  cells: Map<number, Cell>;
  colW: Map<number, number>;
  rowH: Map<number, number>;
  freezeRows: number;
  freezeCols: number;
  merges: Range[];
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
  /** rows currently hidden by the filter (derived when the filter is applied) */
  filterHidden: Set<number>;
  filter: FilterState | null;
  cf: CFRule[];
  validations: DVRule[];
  comments: Map<number, string>;
  charts: ChartDef[];
  page: PageSetup;
  hideGrid?: boolean;
}

export type ErrCode = '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#N/A' | '#NUM!' | '#CIRC!' | '#ERROR!';

export class FormulaError {
  constructor(public code: ErrCode) {}
  toString() {
    return this.code;
  }
}

export type Scalar = number | string | boolean | null | FormulaError;

export interface SelectionState {
  anchor: { r: number; c: number };
  active: { r: number; c: number };
  range: Range;
}
