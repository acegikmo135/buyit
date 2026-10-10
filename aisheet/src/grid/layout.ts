export const HEADER_W = 52;
export const HEADER_H = 26;
export const DEF_COL_W = 104;
export const DEF_ROW_H = 24;

export interface Axis {
  /** cumulative offsets, length n+1 */
  off: Float64Array;
  n: number;
}

export function buildAxis(n: number, def: number, overrides: Map<number, number>): Axis {
  const off = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + (overrides.get(i) ?? def);
  return { off, n };
}

/** Index of the item containing offset `v` (clamped). */
export function indexAt(axis: Axis, v: number): number {
  let lo = 0;
  let hi = axis.n - 1;
  if (v <= 0) return 0;
  if (v >= axis.off[axis.n]) return axis.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (axis.off[mid] <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
