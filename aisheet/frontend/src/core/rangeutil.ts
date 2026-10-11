import type { Range } from './address';

/** Moves/stretches a range when rows or columns are inserted (count>0) or deleted (count<0). Returns null when it vanishes. */
export function shiftRangeAxis(r: Range, axis: 'row' | 'col', at: number, count: number): Range | null {
  const lo = axis === 'row' ? r.r1 : r.c1;
  const hi = axis === 'row' ? r.r2 : r.c2;
  let nlo = lo;
  let nhi = hi;
  if (count > 0) {
    if (lo >= at) nlo += count;
    if (hi >= at) nhi += count;
  } else {
    const n = -count;
    const end = at + n - 1;
    if (lo > end) nlo = lo - n;
    else if (lo >= at) nlo = at;
    if (hi > end) nhi = hi - n;
    else if (hi >= at) nhi = at - 1;
    if (nhi < nlo) return null;
  }
  return axis === 'row' ? { ...r, r1: nlo, r2: nhi } : { ...r, c1: nlo, c2: nhi };
}

export const sameRange = (a: Range, b: Range) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
export const rangesOverlap = (a: Range, b: Range) => !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2);
export const containsCell = (a: Range, r: number, c: number) => r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2;
