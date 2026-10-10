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
  | 'text';

export interface CellStyle {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  color?: string;
  bg?: string;
  align?: Align;
  fmt?: NumFmt;
  wrap?: boolean;
}

/** Immutable cell record. `raw` is what the user typed: a literal or a "=formula". */
export interface Cell {
  raw: string | number | boolean;
  style?: CellStyle;
}

export interface Sheet {
  id: string;
  name: string;
  cells: Map<number, Cell>;
  colW: Map<number, number>;
  rowH: Map<number, number>;
  freezeRows: number;
  freezeCols: number;
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
