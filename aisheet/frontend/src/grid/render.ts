import type { Range } from '../core/address';
import { colToName, keyOf } from '../core/address';
import { displayValue } from '../core/format';
import { FormulaError, type Border, type Borders, type CellStyle, type Sheet } from '../core/types';
import type { Workbook } from '../core/workbook';
import { cfFor } from './cf';
import { indexAt, HEADER_H, HEADER_W, type Axis } from './layout';
import type { FxEntry } from './fx';
import { FADE_MS } from './fx';
import { FONT_FAMILY, FONT_SIZE, wrapLines } from './measure';

export interface Theme {
  bg: string; line: string; headBg: string; headText: string; headActive: string; text: string; accent: string;
  accentSoft: string; sel: string; ai: string; aiSoft: string; muted: string;
}

export function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { bg: v('--grid-bg'), line: v('--grid-line'), headBg: v('--head-bg'), headText: v('--head-text'), headActive: v('--head-active'), text: v('--text'), accent: v('--accent'), accentSoft: v('--accent-soft'), sel: v('--sel'), ai: v('--ai'), aiSoft: v('--ai-soft'), muted: v('--muted') };
}

export interface PreviewCell { key: number; text: string; was: string }

export interface RenderParams {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  th: Theme;
  wb: Workbook;
  sh: Sheet;
  rows: Axis;
  cols: Axis;
  nRows: number;
  nCols: number;
  sl: number;
  st: number;
  now: number;
  fx?: Map<number, FxEntry>;
  prevMap?: Map<number, PreviewCell>;
  anchor: { r: number; c: number };
  active: { r: number; c: number };
  clipRange?: Range | null;
  fillTarget?: Range | null;
  measure: (text: string, font: string) => number;
  hoverFilterCol?: number | null;
  searchHits?: Set<number>;
  currentHit?: number | null;
}

export const filterBtnRect = (x: number, y: number, w: number, h: number) => ({ x: x + w - 19, y: y + (h - 16) / 2, w: 16, h: 16 });
export const dvBtnRect = filterBtnRect;

/** Picks a readable text color for an arbitrary cell background (matters in dark mode). */
export function contrastText(bg: string, fallback: string): string {
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{6})$/i.exec(bg);
  if (hex) {
    const n = parseInt(hex[1], 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    if (m) rgb = [+m[1], +m[2], +m[3]];
  }
  if (!rgb) return fallback;
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return lum > 0.58 ? '#18181b' : '#f4f4f5';
}

const baseFont = (st?: { b?: boolean; i?: boolean }) => `${st?.i ? 'italic ' : ''}${st?.b ? 600 : 400} ${FONT_SIZE}px ${FONT_FAMILY}`;

function strokeBorder(ctx: CanvasRenderingContext2D, side: 't' | 'r' | 'b' | 'l', b: Border, x: number, y: number, w: number, h: number, fallback: string) {
  ctx.save();
  ctx.strokeStyle = b.c || fallback;
  const lw = b.s === 'thick' ? 3 : b.s === 'medium' ? 2 : 1;
  ctx.lineWidth = lw;
  if (b.s === 'dashed') ctx.setLineDash([5, 3]);
  else if (b.s === 'dotted') ctx.setLineDash([1.5, 2]);
  const draw = (off: number) => {
    ctx.beginPath();
    if (side === 't') { ctx.moveTo(x, y + off); ctx.lineTo(x + w, y + off); }
    else if (side === 'b') { ctx.moveTo(x, y + h + off); ctx.lineTo(x + w, y + h + off); }
    else if (side === 'l') { ctx.moveTo(x + off, y); ctx.lineTo(x + off, y + h); }
    else { ctx.moveTo(x + w + off, y); ctx.lineTo(x + w + off, y + h); }
    ctx.stroke();
  };
  const adj = (side === 'b' || side === 'r' ? -1 : 1) * 0.5 * (lw % 2 ? 1 : 0);
  if (b.s === 'double') { draw(-1.5 * (side === 'b' || side === 'r' ? 1 : -1) * -1 + adj); draw(1.5 * (side === 'b' || side === 'r' ? 1 : -1) * -1 + adj); }
  else draw(adj + (side === 'b' || side === 'r' ? 0 : 0));
  ctx.restore();
}

function drawBorders(ctx: CanvasRenderingContext2D, bd: Borders, x: number, y: number, w: number, h: number, fallback: string) {
  if (bd.t) strokeBorder(ctx, 't', bd.t, x, y, w, h, fallback);
  if (bd.b) strokeBorder(ctx, 'b', bd.b, x, y, w, h, fallback);
  if (bd.l) strokeBorder(ctx, 'l', bd.l, x, y, w, h, fallback);
  if (bd.r) strokeBorder(ctx, 'r', bd.r, x, y, w, h, fallback);
}

export function renderGrid(p: RenderParams): { animating: boolean } {
  const { ctx, W, H, th, wb, sh, rows, cols, nRows, nCols, sl, st, now, fx, prevMap, measure } = p;
  const FR = Math.min(sh.freezeRows, nRows);
  const FC = Math.min(sh.freezeCols, nCols);
  const frozenW = cols.off[FC];
  const frozenH = rows.off[FR];
  const sx = (c: number) => HEADER_W + cols.off[c] - (c < FC ? 0 : sl);
  const sy = (r: number) => HEADER_H + rows.off[r] - (r < FR ? 0 : st);
  const cw = (c: number) => cols.off[c + 1] - cols.off[c];
  const rh = (r: number) => rows.off[r + 1] - rows.off[r];

  const firstC = indexAt(cols, sl + frozenW);
  const lastC = indexAt(cols, sl + W - HEADER_W);
  const firstR = indexAt(rows, st + frozenH);
  const lastR = indexAt(rows, st + H - HEADER_H);
  const range = (a: number, b: number, size: (i: number) => number) => {
    const out: number[] = [];
    for (let i = a; i <= b; i++) if (size(i) > 0) out.push(i);
    return out;
  };
  const scrollCols = range(Math.max(firstC, FC), lastC, cw);
  const scrollRows = range(Math.max(firstR, FR), lastR, rh);
  const frozenCols = range(0, FC - 1, cw);
  const frozenRows = range(0, FR - 1, rh);

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  const merges = sh.merges;
  const covered = (r: number, c: number) => {
    for (const m of merges) if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return true;
    return false;
  };

  let aiCursor: { x: number; y: number; w: number; h: number } | null = null;
  const filter = sh.filter;

  /** Draws one logical cell (possibly a merged block) at the given rect. */
  const drawCell = (r: number, c: number, x: number, y: number, w: number, h: number, isMerge: boolean, x0: number, x1: number, rs?: number[], cs?: number[]) => {
    const key = keyOf(r, c);
    const cell = sh.cells.get(key);
    const style: CellStyle | undefined = cell?.style;
    const pv = prevMap?.get(key);
    const e = fx?.get(key);
    let text = '';
    let v: ReturnType<typeof wb.value> = null;
    if (cell) {
      v = wb.value(sh, r, c);
      text = displayValue(v, style);
    }
    const cf = cell ? cfFor(wb, sh, r, c, v) : sh.cf.length ? cfFor(wb, sh, r, c, null) : null;
    const bg = cf?.bg ?? style?.bg;
    if (isMerge || cf?.bg) {
      ctx.fillStyle = bg ?? th.bg;
      ctx.fillRect(x, y, w, h);
    }
    if (cf?.bar) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = cf.bar.color;
      ctx.fillRect(x + 2, y + 3, Math.max(1, (w - 4) * cf.bar.pct), h - 6);
      ctx.globalAlpha = 1;
    }
    if (p.searchHits?.has(key)) {
      ctx.fillStyle = p.currentHit === key ? 'rgba(250,204,21,0.55)' : 'rgba(250,204,21,0.28)';
      ctx.fillRect(x, y, w, h);
    }
    let glow = 0;
    let typing = false;
    if (e) {
      const tt = now - e.start - e.delay;
      if (tt < 0) text = e.prev;
      else if (e.kind === 'ai' && tt < e.typeMs) {
        const chars = [...e.next];
        text = chars.slice(0, Math.max(0, Math.ceil((tt / e.typeMs) * chars.length))).join('');
        glow = 1;
        typing = true;
      } else {
        text = e.next;
        glow = Math.max(0, 1 - (tt - (e.kind === 'ai' ? e.typeMs : 0)) / FADE_MS);
      }
      if (glow > 0) {
        ctx.fillStyle = th.ai;
        ctx.globalAlpha = glow * (typing ? 0.28 : 0.22);
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = th.ai;
        ctx.globalAlpha = Math.min(1, glow * 1.2);
        ctx.lineWidth = typing ? 2 : 1.5;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
      }
      if (typing) aiCursor = { x, y, w, h };
    }
    let color = cf?.color || style?.color || (bg ? contrastText(bg, th.text) : th.text);
    const effStyle: CellStyle | undefined = cf?.b ? { ...style, b: true } : style;
    let font = baseFont(effStyle);
    if (pv) {
      ctx.fillStyle = th.aiSoft;
      ctx.fillRect(x, y, w, h);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = th.ai;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.restore();
      text = pv.text;
      color = th.ai;
      font = baseFont({ ...effStyle, i: true });
      v = pv.text;
    }
    if (text) {
      const isNum = typeof v === 'number';
      const isErr = v instanceof FormulaError;
      let align = style?.align ?? (isNum ? 'right' : isErr || typeof v === 'boolean' ? 'center' : 'left');
      if (isErr) color = '#ef4444';
      ctx.font = font;
      ctx.fillStyle = color;
      const pad = 6 + (style?.indent ?? 0) * 8;
      const rightReserve = (filter && r === filter.range.r1 && c >= filter.range.c1 && c <= filter.range.c2) ? 20 : 0;
      let tw = measure(text, font);
      if (isNum && !e && !pv && tw > w - pad * 2) {
        text = '#'.repeat(Math.max(1, Math.floor((w - pad * 2) / 8)));
        tw = measure(text, font);
        align = 'center';
      }
      let availL = x;
      let availR = x + w - rightReserve;
      if (!isMerge && align === 'left' && tw > w - pad * 2 - rightReserve && !style?.wrap) {
        let cc = c + 1;
        while (cc < nCols && availR - x < tw + pad * 2 + 4 && !sh.cells.has(keyOf(r, cc)) && cc - c < 30 && !covered(r, cc)) {
          availR += cw(cc);
          cc++;
        }
      } else if (!isMerge && align === 'right' && tw > w - pad * 2 && !style?.wrap) {
        let cc = c - 1;
        while (cc >= 0 && x + w - availL < tw + pad * 2 + 4 && !sh.cells.has(keyOf(r, cc)) && c - cc < 30 && !covered(r, cc)) {
          availL -= cw(cc);
          cc--;
        }
      }
      void rs;
      void cs;
      const needClip = tw > availR - availL - pad * 2 || !!style?.wrap || isMerge;
      if (needClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(availL, x0) + 1, y, Math.min(availR, x1) - Math.max(availL, x0) - 2, h);
        ctx.clip();
      }
      const valign = style?.valign ?? 'middle';
      if (style?.wrap) {
        const lines = wrapLines(text, w - pad * 2, (s2) => measure(s2, font));
        const lh = FONT_SIZE + 5;
        const startY = valign === 'top' ? y + 4 + lh / 2 : valign === 'bottom' ? y + h - 4 - lines.length * lh + lh / 2 : y + Math.max(3, (h - lines.length * lh) / 2) + lh / 2;
        lines.forEach((ln, i) => {
          const lw = measure(ln, font);
          const tx = align === 'right' ? x + w - pad - lw : align === 'center' ? x + (w - lw) / 2 : x + pad;
          ctx.fillText(ln, tx, startY + i * lh);
        });
      } else {
        const tx = align === 'right' ? availR - pad - tw : align === 'center' ? x + (w - tw) / 2 : availL + pad;
        const ty = (valign === 'top' ? y + 4 + FONT_SIZE / 2 : valign === 'bottom' ? y + h - 4 - FONT_SIZE / 2 : y + h / 2) + 0.5;
        ctx.fillText(text, tx, ty);
        if (style?.u) ctx.fillRect(tx, ty + FONT_SIZE / 2 + 1, tw, 1);
        if (typing) {
          ctx.fillStyle = th.ai;
          ctx.fillRect(tx + tw + 1, y + 5, 1.5, h - 10);
        }
      }
      if (needClip) ctx.restore();
    }
    if (style?.bd) drawBorders(ctx, style.bd, x, y, w, h, th.text);
    // comment marker
    if (sh.comments.has(key)) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(x + w - 7, y + 0.5);
      ctx.lineTo(x + w - 0.5, y + 0.5);
      ctx.lineTo(x + w - 0.5, y + 7);
      ctx.closePath();
      ctx.fill();
    }
    // filter dropdown button
    if (filter && r === filter.range.r1 && c >= filter.range.c1 && c <= filter.range.c2) {
      const b = filterBtnRect(x, y, w, h);
      const on = !!filter.allowed[c];
      ctx.fillStyle = on ? th.accent : th.headBg;
      ctx.strokeStyle = on ? th.accent : th.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = on ? '#fff' : th.headText;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (on) {
        ctx.moveTo(b.x + 4, b.y + 4.5);
        ctx.lineTo(b.x + b.w - 4, b.y + 4.5);
        ctx.lineTo(b.x + b.w / 2 + 1.2, b.y + 9.5);
        ctx.lineTo(b.x + b.w / 2 + 1.2, b.y + b.h - 3.5);
        ctx.lineTo(b.x + b.w / 2 - 1.2, b.y + b.h - 5);
        ctx.lineTo(b.x + b.w / 2 - 1.2, b.y + 9.5);
        ctx.closePath();
      } else {
        ctx.moveTo(b.x + 4, b.y + 6);
        ctx.lineTo(b.x + b.w / 2, b.y + 10.5);
        ctx.lineTo(b.x + b.w - 4, b.y + 6);
      }
      ctx.stroke();
    }
  };

  const drawRegion = (rs: number[], cs: number[], x0: number, y0: number, x1: number, y1: number) => {
    if (!rs.length || !cs.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    // gridlines
    if (!sh.hideGrid) {
      ctx.strokeStyle = th.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const r of rs) {
        const y = Math.round(sy(r) + rh(r)) - 0.5;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      for (const c of cs) {
        const x = Math.round(sx(c) + cw(c)) - 0.5;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      ctx.stroke();
    }
    // plain cells
    ctx.textBaseline = 'middle';
    for (const r of rs) {
      const y = sy(r);
      const h = rh(r);
      if (y + h < y0 || y > y1) continue;
      for (const c of cs) {
        const x = sx(c);
        const w = cw(c);
        if (x + w < x0 || x > x1) continue;
        if (merges.length && covered(r, c)) continue;
        drawCell(r, c, x, y, w, h, false, x0, x1);
      }
    }
    // merged cells
    const rset = new Set(rs);
    const cset = new Set(cs);
    for (const m of merges) {
      let vis = false;
      for (let r = m.r1; r <= m.r2 && !vis; r++) if (rset.has(r)) for (let c = m.c1; c <= m.c2; c++) if (cset.has(c)) { vis = true; break; }
      if (!vis) continue;
      const x = sx(m.c1);
      const y = sy(m.r1);
      const w = sx(m.c2) + cw(m.c2) - x;
      const h = sy(m.r2) + rh(m.r2) - y;
      drawCell(m.r1, m.c1, x, y, w, h, true, x0, x1);
    }
    ctx.restore();
  };

  const gx0 = HEADER_W;
  const gy0 = HEADER_H;
  drawRegion(scrollRows, scrollCols, gx0 + frozenW, gy0 + frozenH, W, H);
  drawRegion(frozenRows, scrollCols, gx0 + frozenW, gy0, W, gy0 + frozenH);
  drawRegion(scrollRows, frozenCols, gx0, gy0 + frozenH, gx0 + frozenW, H);
  drawRegion(frozenRows, frozenCols, gx0, gy0, gx0 + frozenW, gy0 + frozenH);

  ctx.strokeStyle = th.muted;
  ctx.lineWidth = 1;
  if (FC) { ctx.beginPath(); ctx.moveTo(gx0 + frozenW + 0.5, gy0); ctx.lineTo(gx0 + frozenW + 0.5, H); ctx.stroke(); }
  if (FR) { ctx.beginPath(); ctx.moveTo(gx0, gy0 + frozenH + 0.5); ctx.lineTo(W, gy0 + frozenH + 0.5); ctx.stroke(); }

  // ---------- selection ----------
  const selFull = { r1: Math.min(p.anchor.r, p.active.r), c1: Math.min(p.anchor.c, p.active.c), r2: Math.max(p.anchor.r, p.active.r), c2: Math.max(p.anchor.c, p.active.c) };
  const sel = { r1: Math.min(selFull.r1, nRows - 1), c1: Math.min(selFull.c1, nCols - 1), r2: Math.min(selFull.r2, nRows - 1), c2: Math.min(selFull.c2, nCols - 1) };
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx0, gy0, W - gx0, H - gy0);
  ctx.clip();
  if (p.clipRange) {
    const cr = p.clipRange;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -(now / 60) % 9;
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(cr.c1) + 0.5, sy(cr.r1) + 0.5, sx(cr.c2) + cw(cr.c2) - sx(cr.c1) - 1, sy(cr.r2) + rh(cr.r2) - sy(cr.r1) - 1);
    ctx.restore();
  }
  const rx = sx(sel.c1);
  const ry = sy(sel.r1);
  const rw = sx(sel.c2) + cw(sel.c2) - rx;
  const rhh = sy(sel.r2) + rh(sel.r2) - ry;
  const multi = sel.r1 !== sel.r2 || sel.c1 !== sel.c2;
  const single = !multi || (merges.some((m) => m.r1 === sel.r1 && m.c1 === sel.c1 && m.r2 === sel.r2 && m.c2 === sel.c2));
  if (multi && !single) {
    ctx.fillStyle = th.sel;
    ctx.fillRect(rx, ry, rw, rhh);
  }
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(rx + 1, ry + 1, rw - 2, rhh - 2);
  if (multi && !single) {
    ctx.lineWidth = 1;
    ctx.strokeRect(sx(p.active.c) + 1.5, sy(p.active.r) + 1.5, cw(p.active.c) - 3, rh(p.active.r) - 3);
  }
  ctx.fillStyle = th.accent;
  ctx.fillRect(rx + rw - 4, ry + rhh - 4, 7, 7);
  ctx.strokeStyle = th.bg;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rx + rw - 4, ry + rhh - 4, 7, 7);
  if (p.fillTarget) {
    const f = p.fillTarget;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.5;
    const fx0 = sx(f.c1);
    const fy0 = sy(f.r1);
    ctx.strokeRect(fx0 + 0.5, fy0 + 0.5, sx(f.c2) + cw(f.c2) - fx0 - 1, sy(f.r2) + rh(f.r2) - fy0 - 1);
    ctx.setLineDash([]);
  }
  // data-validation dropdown arrow on the active cell
  if (!multi || single) {
    const dv = sh.validations.find((v) => v.kind === 'list' && p.active.r >= v.range.r1 && p.active.r <= v.range.r2 && p.active.c >= v.range.c1 && p.active.c <= v.range.c2);
    if (dv) {
      const x = sx(p.active.c);
      const y = sy(p.active.r);
      const b = dvBtnRect(x, y, cw(p.active.c), rh(p.active.r));
      ctx.fillStyle = th.headBg;
      ctx.strokeStyle = th.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = th.headText;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(b.x + 4, b.y + 6);
      ctx.lineTo(b.x + b.w / 2, b.y + 10.5);
      ctx.lineTo(b.x + b.w - 4, b.y + 6);
      ctx.stroke();
    }
  }
  if (aiCursor) {
    const ac: { x: number; y: number; w: number; h: number } = aiCursor;
    ctx.font = `600 10px ${FONT_FAMILY}`;
    ctx.fillStyle = th.ai;
    const ty = ac.y - 15 < gy0 ? ac.y + ac.h + 1 : ac.y - 15;
    ctx.beginPath();
    ctx.roundRect(ac.x, ty, 22, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI', ac.x + 5, ty + 7.5);
  }
  ctx.restore();

  // ---------- headers ----------
  ctx.fillStyle = th.headBg;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillRect(0, 0, HEADER_W, H);
  ctx.font = `500 11.5px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const drawColHeads = (list: number[], clipX0: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipX0, 0, W - clipX0, HEADER_H);
    ctx.clip();
    for (const c of list) {
      const x = sx(c);
      const w = cw(c);
      const on = c >= sel.c1 && c <= sel.c2;
      if (on) { ctx.fillStyle = th.headActive; ctx.fillRect(x, 0, w, HEADER_H); }
      ctx.fillStyle = on ? th.accent : th.headText;
      ctx.fillText(colToName(c), x + w / 2, HEADER_H / 2 + 0.5);
      ctx.fillStyle = th.line;
      ctx.fillRect(Math.round(x + w) - 1, 0, 1, HEADER_H);
      if (sh.hiddenCols.has(c + 1)) { ctx.fillStyle = th.accent; ctx.fillRect(Math.round(x + w) - 2, 4, 3, HEADER_H - 8); }
    }
    ctx.restore();
  };
  drawColHeads(scrollCols, gx0 + frozenW);
  drawColHeads(frozenCols, gx0);
  const drawRowHeads = (list: number[], clipY0: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipY0, HEADER_W, H - clipY0);
    ctx.clip();
    for (const r of list) {
      const y = sy(r);
      const h = rh(r);
      const on = r >= sel.r1 && r <= sel.r2;
      if (on) { ctx.fillStyle = th.headActive; ctx.fillRect(0, y, HEADER_W, h); }
      ctx.fillStyle = on ? th.accent : th.headText;
      ctx.fillText(String(r + 1), HEADER_W / 2, y + h / 2 + 0.5);
      ctx.fillStyle = th.line;
      ctx.fillRect(0, Math.round(y + h) - 1, HEADER_W, 1);
      if (sh.filterHidden.has(r + 1) || sh.hiddenRows.has(r + 1)) { ctx.fillStyle = th.accent; ctx.fillRect(4, Math.round(y + h) - 2, HEADER_W - 8, 3); }
    }
    ctx.restore();
  };
  drawRowHeads(scrollRows, gy0 + frozenH);
  drawRowHeads(frozenRows, gy0);
  ctx.textAlign = 'start';
  ctx.fillStyle = th.line;
  ctx.fillRect(0, HEADER_H - 1, W, 1);
  ctx.fillRect(HEADER_W - 1, 0, 1, H);
  ctx.fillStyle = th.headBg;
  ctx.fillRect(0, 0, HEADER_W - 1, HEADER_H - 1);

  return { animating: !!p.clipRange || !!fx };
}
