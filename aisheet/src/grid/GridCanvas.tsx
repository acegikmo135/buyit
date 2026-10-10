import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, useWbVersion, wb, selectionRange } from '../store';
import { addr, colToName, keyOf, normRange, type Range } from '../core/address';
import { displayValue } from '../core/format';
import { FormulaError } from '../core/types';
import { buildAxis, indexAt, DEF_COL_W, DEF_ROW_H, HEADER_H, HEADER_W } from './layout';
import { fxFor, fxTick, subscribeFx, FADE_MS } from './fx';
import * as A from '../actions';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { useT } from '../i18n';

const FONT_FAMILY = '"Inter Variable", "Noto Sans Gujarati Variable", "Nirmala UI", "Shruti", "Segoe UI", system-ui, sans-serif';
const FONT_SIZE = 13;

interface Theme {
  bg: string; line: string; headBg: string; headText: string; headActive: string; text: string; accent: string; accentSoft: string; sel: string; ai: string; aiSoft: string; muted: string;
}

function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { bg: v('--grid-bg'), line: v('--grid-line'), headBg: v('--head-bg'), headText: v('--head-text'), headActive: v('--head-active'), text: v('--text'), accent: v('--accent'), accentSoft: v('--accent-soft'), sel: v('--sel'), ai: v('--ai'), aiSoft: v('--ai-soft'), muted: v('--muted') };
}

type Drag =
  | { kind: 'select' }
  | { kind: 'cols'; from: number }
  | { kind: 'rows'; from: number }
  | { kind: 'colResize'; col: number; startX: number; startW: number }
  | { kind: 'rowResize'; row: number; startY: number; startH: number }
  | { kind: 'fill'; src: Range };

let focusFn: (() => void) | null = null;
export const focusGrid = () => focusFn?.();

const measureCache = new Map<string, number>();

export function GridCanvas() {
  const t = useT();
  const ver = useWbVersion();
  const activeSheetId = useStore((s) => s.activeSheetId);
  const anchor = useStore((s) => s.anchor);
  const active = useStore((s) => s.active);
  const editing = useStore((s) => s.editing);
  const clip = useStore((s) => s.clip);
  const proposal = useStore((s) => s.proposal);
  const themePref = useStore((s) => s.theme);

  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [grow, setGrow] = useState({ r: 0, c: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<string>('default');
  const fillTarget = useRef<Range | null>(null);
  const themeRef = useRef<Theme | null>(null);
  const rafRef = useRef(0);
  const composing = useRef(false);

  const sheet = wb.sheetById(activeSheetId) ?? wb.sheets[0];

  // ---------- axes ----------
  const dims = useMemo(() => {
    const ub = wb.usedBounds(sheet);
    const nRows = Math.max(100, ub.r + 40, grow.r, active.r + 30);
    const nCols = Math.max(26, ub.c + 8, grow.c, active.c + 8);
    return {
      nRows,
      nCols,
      rows: buildAxis(nRows, DEF_ROW_H, sheet.rowH),
      cols: buildAxis(nCols, DEF_COL_W, sheet.colW),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ver, sheet.id, grow.r, grow.c, active.r, active.c]);

  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  // ---------- drawing ----------
  const draw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const scroller = scrollerRef.current;
    if (!canvas || !scroller) return;
    const dpr = window.devicePixelRatio || 1;
    const W = scroller.clientWidth;
    const H = scroller.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const th = (themeRef.current ??= readTheme(wrapRef.current!));
    const s = useStore.getState();
    const sh = wb.sheetById(s.activeSheetId) ?? wb.sheets[0];
    const { rows, cols, nRows, nCols } = dimsRef.current;
    const sl = scroller.scrollLeft;
    const st = scroller.scrollTop;
    const now = performance.now();
    const fx = fxFor(sh.id);
    const prevMap = s.proposal?.preview.bySheet.get(sh.id);

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
    const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
    const scrollCols = range(Math.max(firstC, FC), lastC);
    const scrollRows = range(Math.max(firstR, FR), lastR);
    const frozenCols = range(0, FC - 1);
    const frozenRows = range(0, FR - 1);

    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, W, H);

    const baseFont = (st?: { b?: boolean; i?: boolean }) => `${st?.i ? 'italic ' : ''}${st?.b ? 600 : 400} ${FONT_SIZE}px ${FONT_FAMILY}`;
    const measure = (text: string, font: string) => {
      const k = font + '|' + text;
      let w = measureCache.get(k);
      if (w === undefined) {
        ctx.font = font;
        w = ctx.measureText(text).width;
        if (measureCache.size > 20000) measureCache.clear();
        measureCache.set(k, w);
      }
      return w;
    };

    let aiCursor: { x: number; y: number; w: number; h: number } | null = null;

    const drawRegion = (rs: number[], cs: number[], x0: number, y0: number, x1: number, y1: number) => {
      if (!rs.length || !cs.length) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      // backgrounds
      for (const r of rs) {
        const y = sy(r);
        const h = rh(r);
        for (const c of cs) {
          const cell = sh.cells.get(keyOf(r, c));
          const bg = cell?.style?.bg;
          if (bg) {
            ctx.fillStyle = bg;
            ctx.fillRect(sx(c), y, cw(c), h);
          }
        }
      }
      // gridlines
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
      // text
      ctx.textBaseline = 'middle';
      for (const r of rs) {
        const y = sy(r);
        const h = rh(r);
        if (y + h < y0 || y > y1) continue;
        for (const c of cs) {
          const x = sx(c);
          const w = cw(c);
          if (x + w < x0 || x > x1) continue;
          const key = keyOf(r, c);
          const cell = sh.cells.get(key);
          const style = cell?.style;
          const pv = prevMap?.get(key);
          const e = fx?.get(key);
          let text = '';
          let v: ReturnType<typeof wb.value> = null;
          if (cell) {
            v = wb.value(sh, r, c);
            text = displayValue(v, style);
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
              ctx.globalAlpha = 1;
              ctx.strokeStyle = th.ai;
              ctx.globalAlpha = Math.min(1, glow * 1.2);
              ctx.lineWidth = typing ? 2 : 1.5;
              ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
              ctx.globalAlpha = 1;
              ctx.lineWidth = 1;
            }
            if (typing) aiCursor = { x, y, w, h };
          }
          let color = style?.color || (style?.bg ? contrastText(style.bg, th.text) : th.text);
          let font = baseFont(style);
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
            font = baseFont({ ...style, i: true });
            v = pv.text;
          }
          if (!text) continue;
          const isNum = typeof v === 'number';
          const isErr = v instanceof FormulaError;
          let align = style?.align ?? (isNum ? 'right' : isErr || typeof v === 'boolean' ? 'center' : 'left');
          if (isErr) color = '#ef4444';
          ctx.font = font;
          ctx.fillStyle = color;
          const pad = 6;
          let tw = measure(text, font);
          if (isNum && !e && !pv && tw > w - pad * 2) {
            text = '#'.repeat(Math.max(1, Math.floor((w - pad * 2) / 8)));
            tw = measure(text, font);
            align = 'center';
          }
          let availL = x;
          let availR = x + w;
          if (align === 'left' && tw > w - pad * 2 && !style?.wrap) {
            // overflow into empty neighbours
            let cc = c + 1;
            while (cc < nCols && availR - x < tw + pad * 2 + 4 && !sh.cells.has(keyOf(r, cc)) && cc - c < 30) {
              availR += cw(cc);
              cc++;
            }
          } else if (align === 'right' && tw > w - pad * 2 && !style?.wrap) {
            let cc = c - 1;
            while (cc >= 0 && x + w - availL < tw + pad * 2 + 4 && !sh.cells.has(keyOf(r, cc)) && c - cc < 30) {
              availL -= cw(cc);
              cc--;
            }
          }
          const needClip = tw > availR - availL - pad * 2 || !!style?.wrap;
          if (needClip) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(availL + 1, y, availR - availL - 2, h);
            ctx.clip();
          }
          if (style?.wrap) {
            const lines = wrapLines(text, w - pad * 2, (s2) => measure(s2, font));
            const lh = FONT_SIZE + 5;
            const startY = y + Math.max(3, (h - lines.length * lh) / 2) + lh / 2;
            lines.forEach((ln, i) => {
              const lw = measure(ln, font);
              const tx = align === 'right' ? x + w - pad - lw : align === 'center' ? x + (w - lw) / 2 : x + pad;
              ctx.fillText(ln, tx, startY + i * lh);
            });
          } else {
            const tx = align === 'right' ? availR - pad - tw : align === 'center' ? x + (w - tw) / 2 : availL + pad;
            const ty = y + h / 2 + 0.5;
            ctx.fillText(text, tx, ty);
            if (style?.u) {
              ctx.fillRect(tx, ty + FONT_SIZE / 2 + 1, tw, 1);
            }
            if (typing) {
              ctx.fillStyle = th.ai;
              ctx.fillRect(tx + tw + 1, y + 5, 1.5, h - 10);
            }
          }
          if (needClip) ctx.restore();
        }
      }
      ctx.restore();
    };

    const gx0 = HEADER_W;
    const gy0 = HEADER_H;
    drawRegion(scrollRows, scrollCols, gx0 + frozenW, gy0 + frozenH, W, H);
    drawRegion(frozenRows, scrollCols, gx0 + frozenW, gy0, W, gy0 + frozenH);
    drawRegion(scrollRows, frozenCols, gx0, gy0 + frozenH, gx0 + frozenW, H);
    drawRegion(frozenRows, frozenCols, gx0, gy0, gx0 + frozenW, gy0 + frozenH);

    // freeze separators
    ctx.strokeStyle = th.muted;
    ctx.lineWidth = 1;
    if (FC) {
      ctx.beginPath();
      ctx.moveTo(gx0 + frozenW + 0.5, gy0);
      ctx.lineTo(gx0 + frozenW + 0.5, H);
      ctx.stroke();
    }
    if (FR) {
      ctx.beginPath();
      ctx.moveTo(gx0, gy0 + frozenH + 0.5);
      ctx.lineTo(W, gy0 + frozenH + 0.5);
      ctx.stroke();
    }

    // selection
    const selFull = normRange({ r1: s.anchor.r, c1: s.anchor.c, r2: s.active.r, c2: s.active.c });
    const sel = { r1: Math.min(selFull.r1, nRows - 1), c1: Math.min(selFull.c1, nCols - 1), r2: Math.min(selFull.r2, nRows - 1), c2: Math.min(selFull.c2, nCols - 1) };
    const clipArea = new Path2D();
    clipArea.rect(gx0, gy0, W - gx0, H - gy0);
    ctx.save();
    ctx.clip(clipArea);
    if (s.clip && s.clip.sheetId === sh.id) {
      const cr = s.clip.range;
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
    if (multi) {
      ctx.fillStyle = th.sel;
      ctx.fillRect(rx, ry, rw, rhh);
    }
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(rx + 1, ry + 1, rw - 2, rhh - 2);
    if (multi) {
      const ax = sx(s.active.c);
      const ay = sy(s.active.r);
      ctx.lineWidth = 1;
      ctx.fillStyle = th.bg;
      ctx.globalAlpha = 0.0;
      ctx.globalAlpha = 1;
      ctx.strokeRect(ax + 1.5, ay + 1.5, cw(s.active.c) - 3, rh(s.active.r) - 3);
    }
    // fill handle
    ctx.fillStyle = th.accent;
    ctx.fillRect(rx + rw - 4, ry + rhh - 4, 7, 7);
    ctx.strokeStyle = th.bg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx + rw - 4, ry + rhh - 4, 7, 7);
    if (fillTarget.current) {
      const f = fillTarget.current;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 1.5;
      const fx0 = sx(f.c1);
      const fy0 = sy(f.r1);
      ctx.strokeRect(fx0 + 0.5, fy0 + 0.5, sx(f.c2) + cw(f.c2) - fx0 - 1, sy(f.r2) + rh(f.r2) - fy0 - 1);
      ctx.setLineDash([]);
    }
    // AI cursor tag
    if (aiCursor) {
      const ac: { x: number; y: number; w: number; h: number } = aiCursor;
      ctx.font = `600 10px ${FONT_FAMILY}`;
      const label = 'AI';
      const lw = 22;
      ctx.fillStyle = th.ai;
      const ty = ac.y - 15 < gy0 ? ac.y + ac.h + 1 : ac.y - 15;
      ctx.beginPath();
      ctx.roundRect(ac.x, ty, lw, 14, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, ac.x + 5, ty + 7.5);
    }
    ctx.restore();

    // headers
    ctx.fillStyle = th.headBg;
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillRect(0, 0, HEADER_W, H);
    ctx.font = `500 11.5px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const hdrCols = [...frozenCols, ...scrollCols];
    const hdrRows = [...frozenRows, ...scrollRows];
    const drawColHeads = (list: number[], clipX0: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX0, 0, W - clipX0, HEADER_H);
      ctx.clip();
      for (const c of list) {
        const x = sx(c);
        const w = cw(c);
        const on = c >= sel.c1 && c <= sel.c2;
        if (on) {
          ctx.fillStyle = th.headActive;
          ctx.fillRect(x, 0, w, HEADER_H);
        }
        ctx.fillStyle = on ? th.accent : th.headText;
        ctx.fillText(colToName(c), x + w / 2, HEADER_H / 2 + 0.5);
        ctx.fillStyle = th.line;
        ctx.fillRect(Math.round(x + w) - 1, 0, 1, HEADER_H);
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
        if (on) {
          ctx.fillStyle = th.headActive;
          ctx.fillRect(0, y, HEADER_W, h);
        }
        ctx.fillStyle = on ? th.accent : th.headText;
        ctx.fillText(String(r + 1), HEADER_W / 2, y + h / 2 + 0.5);
        ctx.fillStyle = th.line;
        ctx.fillRect(0, Math.round(y + h) - 1, HEADER_W, 1);
      }
      ctx.restore();
    };
    drawRowHeads(scrollRows, gy0 + frozenH);
    drawRowHeads(frozenRows, gy0);
    void hdrCols;
    void hdrRows;
    ctx.textAlign = 'start';
    ctx.fillStyle = th.line;
    ctx.fillRect(0, HEADER_H - 1, W, 1);
    ctx.fillRect(HEADER_W - 1, 0, 1, H);
    ctx.fillStyle = th.headBg;
    ctx.fillRect(0, 0, HEADER_W - 1, HEADER_H - 1);

    const animating = fxTick(now) || !!s.clip;
    if (animating) rafRef.current = requestAnimationFrame(draw);
  }, []);

  const requestDraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // redraw triggers
  useEffect(() => {
    requestDraw();
  }, [ver, activeSheetId, anchor, active, editing, clip, proposal, size, dims, requestDraw]);
  useEffect(() => {
    const off = subscribeFx(requestDraw);
    return () => {
      off();
    };
  }, [requestDraw]);

  useEffect(() => {
    themeRef.current = null;
    const id = setTimeout(requestDraw, 30);
    return () => clearTimeout(id);
  }, [themePref, requestDraw]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => {
      themeRef.current = null;
      requestDraw();
    };
    mq.addEventListener('change', h);
    document.fonts?.ready.then(() => {
      measureCache.clear();
      requestDraw();
    });
    document.fonts?.addEventListener?.('loadingdone', h);
    return () => mq.removeEventListener('change', h);
  }, [requestDraw]);

  // resize
  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---------- geometry helpers for interaction ----------
  const geom = () => {
    const sc = scrollerRef.current as HTMLDivElement; // null only during the very first render
    const { rows, cols, nRows, nCols } = dimsRef.current;
    const FR = Math.min(sheet.freezeRows, nRows);
    const FC = Math.min(sheet.freezeCols, nCols);
    return { sc, rows, cols, nRows, nCols, FR, FC, sl: sc?.scrollLeft ?? 0, st: sc?.scrollTop ?? 0 };
  };

  const colAtX = (x: number) => {
    const g = geom();
    const cx = x - HEADER_W;
    const content = cx < g.cols.off[g.FC] ? cx : cx + g.sl;
    return indexAt(g.cols, content);
  };
  const rowAtY = (y: number) => {
    const g = geom();
    const cy = y - HEADER_H;
    const content = cy < g.rows.off[g.FR] ? cy : cy + g.st;
    return indexAt(g.rows, content);
  };
  const cellScreenRect = (r: number, c: number) => {
    const g = geom();
    const x = HEADER_W + g.cols.off[c] - (c < g.FC ? 0 : g.sl);
    const y = HEADER_H + g.rows.off[r] - (r < g.FR ? 0 : g.st);
    return { x, y, w: g.cols.off[c + 1] - g.cols.off[c], h: g.rows.off[r + 1] - g.rows.off[r] };
  };

  // scroll active cell into view
  useEffect(() => {
    const g = geom();
    const { sc } = g;
    if (!sc) return;
    const x = g.cols.off[active.c];
    const x2 = g.cols.off[active.c + 1];
    const y = g.rows.off[active.r];
    const y2 = g.rows.off[active.r + 1];
    const fw = g.cols.off[g.FC];
    const fh = g.rows.off[g.FR];
    const vw = sc.clientWidth - HEADER_W;
    const vh = sc.clientHeight - HEADER_H;
    if (active.c >= g.FC) {
      if (x - fw < sc.scrollLeft) sc.scrollLeft = x - fw;
      else if (x2 > sc.scrollLeft + vw) sc.scrollLeft = x2 - vw;
    }
    if (active.r >= g.FR) {
      if (y - fh < sc.scrollTop) sc.scrollTop = y - fh;
      else if (y2 > sc.scrollTop + vh) sc.scrollTop = y2 - vh;
    }
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.r, active.c, sheet.id]);

  const onScroll = () => {
    const sc = scrollerRef.current!;
    const g = dimsRef.current;
    if (sc.scrollTop + sc.clientHeight > g.rows.off[g.nRows] + HEADER_H - 200) setGrow((p) => ({ ...p, r: g.nRows + 100 }));
    if (sc.scrollLeft + sc.clientWidth > g.cols.off[g.nCols] + HEADER_W - 200) setGrow((p) => ({ ...p, c: g.nCols + 10 }));
    requestDraw();
  };

  // ---------- pointer interaction ----------
  const hit = (x: number, y: number) => {
    const g = geom();
    if (x < HEADER_W && y < HEADER_H) return { type: 'corner' as const };
    if (y < HEADER_H) {
      const c = colAtX(x);
      const rect = cellScreenRect(0, c);
      if (Math.abs(x - (rect.x + rect.w)) < 4) return { type: 'colEdge' as const, c };
      if (c > 0 && Math.abs(x - rect.x) < 4 && c - 1 >= 0) return { type: 'colEdge' as const, c: c - 1 };
      return { type: 'colHeader' as const, c };
    }
    if (x < HEADER_W) {
      const r = rowAtY(y);
      const rect = cellScreenRect(r, 0);
      if (Math.abs(y - (rect.y + rect.h)) < 3) return { type: 'rowEdge' as const, r };
      return { type: 'rowHeader' as const, r };
    }
    // fill handle
    const R = selectionRange();
    const br = cellScreenRect(R.r2, R.c2);
    if (Math.abs(x - (br.x + br.w)) < 6 && Math.abs(y - (br.y + br.h)) < 6) return { type: 'handle' as const };
    void g;
    return { type: 'cell' as const, r: rowAtY(y), c: colAtX(x) };
  };

  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = scrollerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      const { x, y } = localXY(e);
      const h = hit(x, y);
      if (h.type === 'cell') {
        const R = selectionRange();
        if (!(h.r >= R.r1 && h.r <= R.r2 && h.c >= R.c1 && h.c <= R.c2)) useStore.getState().select({ r: h.r, c: h.c });
      }
      return;
    }
    if (e.button !== 0) return;
    const sc = scrollerRef.current!;
    // ignore clicks on scrollbars
    if (e.clientX > sc.getBoundingClientRect().left + sc.clientWidth || e.clientY > sc.getBoundingClientRect().top + sc.clientHeight) return;
    const { x, y } = localXY(e);
    const h = hit(x, y);
    const s = useStore.getState();
    // formula reference insertion
    if (s.editing && h.type === 'cell') {
      const txt = s.editing.text;
      if (txt.startsWith('=') && /[=+\-*/^&(,<>;:]$/.test(txt)) {
        s.set({ editing: { ...s.editing, text: txt + addr(h.r, h.c) } });
        e.preventDefault();
        return;
      }
    }
    if (s.editing) A.commitEdit('none');
    A.resetTabOrigin();
    sc.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (h.type === 'cell') {
      if (e.shiftKey) s.select(s.anchor, { r: h.r, c: h.c });
      else s.select({ r: h.r, c: h.c });
      dragRef.current = { kind: 'select' };
    } else if (h.type === 'colHeader') {
      const nr = 1048575;
      if (e.shiftKey) s.select({ r: 0, c: s.anchor.c }, { r: nr, c: h.c });
      else s.select({ r: 0, c: h.c }, { r: nr, c: h.c });
      dragRef.current = { kind: 'cols', from: e.shiftKey ? s.anchor.c : h.c };
    } else if (h.type === 'rowHeader') {
      const nc = 16383;
      if (e.shiftKey) s.select({ r: s.anchor.r, c: 0 }, { r: h.r, c: nc });
      else s.select({ r: h.r, c: 0 }, { r: h.r, c: nc });
      dragRef.current = { kind: 'rows', from: e.shiftKey ? s.anchor.r : h.r };
    } else if (h.type === 'corner') {
      s.select({ r: 0, c: 0 }, { r: 1048575, c: 16383 });
    } else if (h.type === 'colEdge') {
      const g = geom();
      dragRef.current = { kind: 'colResize', col: h.c, startX: x, startW: g.cols.off[h.c + 1] - g.cols.off[h.c] };
    } else if (h.type === 'rowEdge') {
      const g = geom();
      dragRef.current = { kind: 'rowResize', row: h.r, startY: y, startH: g.rows.off[h.r + 1] - g.rows.off[h.r] };
    } else if (h.type === 'handle') {
      dragRef.current = { kind: 'fill', src: selectionRange() };
    }
    A.ensureActiveSheet();
    focusGrid();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = localXY(e);
    const d = dragRef.current;
    const s = useStore.getState();
    if (!d) {
      const h = hit(x, y);
      const cur = h.type === 'colEdge' ? 'col-resize' : h.type === 'rowEdge' ? 'row-resize' : h.type === 'handle' ? 'crosshair' : h.type === 'cell' ? 'cell' : 'default';
      if (cur !== hoverRef.current) {
        hoverRef.current = cur;
        scrollerRef.current!.style.cursor = cur;
      }
      return;
    }
    if (d.kind === 'select') {
      const g = geom();
      const cx = Math.max(HEADER_W + 1, Math.min(x, g.sc.clientWidth - 1));
      const cy = Math.max(HEADER_H + 1, Math.min(y, g.sc.clientHeight - 1));
      const r = rowAtY(cy);
      const c = colAtX(cx);
      if (r !== s.active.r || c !== s.active.c) s.select(s.anchor, { r, c });
      // edge autoscroll
      const sc = g.sc;
      if (x > sc.clientWidth - 20) sc.scrollLeft += 20;
      else if (x < HEADER_W + 20) sc.scrollLeft -= 20;
      if (y > sc.clientHeight - 20) sc.scrollTop += 20;
      else if (y < HEADER_H + 20) sc.scrollTop -= 20;
    } else if (d.kind === 'cols') {
      const c = colAtX(Math.max(HEADER_W + 1, x));
      s.select({ r: 0, c: d.from }, { r: 1048575, c });
    } else if (d.kind === 'rows') {
      const r = rowAtY(Math.max(HEADER_H + 1, y));
      s.select({ r: d.from, c: 0 }, { r, c: 16383 });
    } else if (d.kind === 'colResize') {
      const nw = Math.max(24, d.startW + (x - d.startX));
      sheet.colW.set(d.col, nw); // live feedback; committed (with undo) on release
      setGrow((p) => ({ ...p }));
      requestDraw();
    } else if (d.kind === 'rowResize') {
      const nh = Math.max(14, d.startH + (y - d.startY));
      sheet.rowH.set(d.row, nh);
      setGrow((p) => ({ ...p }));
      requestDraw();
    } else if (d.kind === 'fill') {
      const r = rowAtY(Math.max(HEADER_H + 1, y));
      const c = colAtX(Math.max(HEADER_W + 1, x));
      const S = d.src;
      let T: Range = S;
      const dv = r > S.r2 ? r - S.r2 : r < S.r1 ? r - S.r1 : 0;
      const dh = c > S.c2 ? c - S.c2 : c < S.c1 ? c - S.c1 : 0;
      if (Math.abs(dv) >= Math.abs(dh) && dv !== 0) T = dv > 0 ? { ...S, r2: S.r2 + dv } : { ...S, r1: S.r1 + dv };
      else if (dh !== 0) T = dh > 0 ? { ...S, c2: S.c2 + dh } : { ...S, c1: S.c1 + dh };
      fillTarget.current = T;
      requestDraw();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      scrollerRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d) return;
    if (d.kind === 'colResize') {
      const w = sheet.colW.get(d.col) ?? d.startW;
      sheet.colW.set(d.col, d.startW); // restore, then commit through the model for undo
      if (w !== d.startW) wb.setColWidth(sheet, d.col, w);
      else if (d.startW === DEF_COL_W) sheet.colW.delete(d.col);
    } else if (d.kind === 'rowResize') {
      const h = sheet.rowH.get(d.row) ?? d.startH;
      sheet.rowH.set(d.row, d.startH);
      if (h !== d.startH) wb.setRowHeight(sheet, d.row, h);
      else if (d.startH === DEF_ROW_H) sheet.rowH.delete(d.row);
    } else if (d.kind === 'fill') {
      const T = fillTarget.current;
      fillTarget.current = null;
      if (T) {
        wb.fillRange(wb.sheetById(sheet.id)!, d.src, T);
        useStore.getState().select({ r: T.r1, c: T.c1 }, { r: T.r2, c: T.c2 });
      }
      requestDraw();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = localXY(e);
    const h = hit(x, y);
    if (h.type === 'cell') {
      A.startEdit('cell');
    } else if (h.type === 'colEdge') {
      autoFit(h.c);
    }
  };

  const autoFit = (c: number) => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let max = 40;
    let n = 0;
    for (const [k, cell] of sheet.cells) {
      if (k % 65536 !== c) continue;
      if (++n > 1000) break;
      const r = Math.floor(k / 65536);
      const text = displayValue(wb.value(sheet, r, c), cell.style);
      ctx.font = `${cell.style?.i ? 'italic ' : ''}${cell.style?.b ? 600 : 400} ${FONT_SIZE}px ${FONT_FAMILY}`;
      max = Math.max(max, ctx.measureText(text).width + 18);
    }
    wb.setColWidth(sheet, c, Math.min(500, max));
  };

  // ---------- keyboard ----------
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const s = useStore.getState();
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (composing.current || e.nativeEvent.isComposing) return;
    if (s.editing) {
      if (key === 'Enter' && !e.altKey) {
        e.preventDefault();
        A.commitEdit(e.shiftKey ? 'up' : 'down');
      } else if (key === 'Enter' && e.altKey) {
        e.preventDefault();
        const ta = e.currentTarget;
        const { selectionStart: a, selectionEnd: b } = ta;
        s.set({ editing: { ...s.editing, text: s.editing.text.slice(0, a) + '\n' + s.editing.text.slice(b) } });
        requestAnimationFrame(() => ta.setSelectionRange(a + 1, a + 1));
      } else if (key === 'Tab') {
        e.preventDefault();
        A.commitEdit(e.shiftKey ? 'left' : 'right');
      } else if (key === 'Escape') {
        e.preventDefault();
        A.cancelEdit();
      }
      return;
    }
    const extend = e.shiftKey;
    const jump = (dr: number, dc: number) => {
      if (ctrl) {
        const ub = wb.usedBounds(sheet);
        const a = s.active;
        const filled = (r: number, c: number) => sheet.cells.has(keyOf(r, c)) && sheet.cells.get(keyOf(r, c))!.raw !== '';
        let r = a.r;
        let c = a.c;
        const maxR = Math.max(ub.r, 0);
        const maxC = Math.max(ub.c, 0);
        const step = () => {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr > Math.max(maxR, 1048575) || nc > 16383) return false;
          r = nr;
          c = nc;
          return true;
        };
        const startFilled = filled(r, c);
        const nextFilled = (() => {
          const nr = r + dr;
          const nc = c + dc;
          return filled(nr, nc);
        })();
        if (startFilled && nextFilled) {
          while (step() && filled(r + dr, c + dc)) {
            /* walk to end of block */
          }
        } else {
          while (step() && !filled(r, c) && r <= maxR + 1 && c <= maxC + 1) {
            /* walk to next filled */
          }
          if (!filled(r, c)) {
            r = dr > 0 ? Math.max(maxR, a.r) : dr < 0 ? 0 : a.r;
            c = dc > 0 ? Math.max(maxC, a.c) : dc < 0 ? 0 : a.c;
          }
        }
        s.select(extend ? s.anchor : { r, c }, { r, c });
      } else A.moveSelection(dr, dc, extend);
    };
    switch (key) {
      case 'ArrowUp': e.preventDefault(); return jump(-1, 0);
      case 'ArrowDown': e.preventDefault(); return jump(1, 0);
      case 'ArrowLeft': e.preventDefault(); return jump(0, -1);
      case 'ArrowRight': e.preventDefault(); return jump(0, 1);
      case 'PageDown': e.preventDefault(); return A.moveSelection(20, 0, extend);
      case 'PageUp': e.preventDefault(); return A.moveSelection(-20, 0, extend);
      case 'Home':
        e.preventDefault();
        return s.select(ctrl ? { r: 0, c: 0 } : extend ? s.anchor : { r: s.active.r, c: 0 }, ctrl ? { r: 0, c: 0 } : { r: s.active.r, c: 0 });
      case 'Tab': e.preventDefault(); return A.pressTab(e.shiftKey);
      case 'Enter': e.preventDefault(); return A.pressEnter(e.shiftKey);
      case 'F2': e.preventDefault(); return A.startEdit('cell');
      case 'Delete':
      case 'Backspace': e.preventDefault(); return A.clearSelection();
      case 'Escape': if (s.clip) s.set({ clip: null }); return;
    }
    if (ctrl) {
      const k = key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); return A.undo(); }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); return A.redo(); }
      if (k === 'b') { e.preventDefault(); return A.toggleStyle('b'); }
      if (k === 'i') { e.preventDefault(); return A.toggleStyle('i'); }
      if (k === 'u') { e.preventDefault(); return A.toggleStyle('u'); }
      if (k === 'd') { e.preventDefault(); return A.fillDown(); }
      if (k === 'r') { e.preventDefault(); return A.fillRight(); }
      if (k === 'a') { e.preventDefault(); return s.select({ r: 0, c: 0 }, { r: 1048575, c: 16383 }); }
      if (k === 's') { e.preventDefault(); void A.saveFile(e.shiftKey); return; }
      if (k === 'o') { e.preventDefault(); void A.openFile(); return; }
      if (k === 'n') { e.preventDefault(); A.newWorkbook(); return; }
      if (k === 'c' || k === 'x' || k === 'v') return; // handled by clipboard events
      if (k === 'k' || k === 'j') { e.preventDefault(); s.set({ panel: 'ai' }); return; }
      return;
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const s = useStore.getState();
    if (s.editing) s.set({ editing: { ...s.editing, text: e.target.value } });
    else if (e.target.value) A.startEdit('cell', e.target.value);
  };

  // keep editor focused
  useEffect(() => {
    focusFn = () => taRef.current?.focus({ preventScroll: true });
    focusFn();
    return () => {
      focusFn = null;
    };
  }, []);
  useEffect(() => {
    if (editing?.from === 'cell') {
      const ta = taRef.current;
      if (ta && document.activeElement !== ta) ta.focus({ preventScroll: true });
    }
  }, [editing]);

  // editor placement
  let edStyle: React.CSSProperties = { left: 0, top: 0, width: 1, height: 1, opacity: 0 };
  if (editing && editing.sheetId === sheet.id && editing.from === 'cell') {
    const rc = cellScreenRect(editing.r, editing.c);
    const lines = editing.text.split('\n');
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), '');
    const tw = Math.min(520, Math.max(rc.w, longest.length * 8 + 28));
    edStyle = {
      left: rc.x,
      top: rc.y,
      width: tw,
      height: Math.max(rc.h, lines.length * 18 + 8),
      opacity: 1,
      font: `${FONT_SIZE}px ${FONT_FAMILY}`,
    };
  } else {
    const rc = cellScreenRect(active.r, active.c);
    edStyle = { left: Math.max(0, rc.x), top: Math.max(0, rc.y), width: 1, height: 1, opacity: 0 };
  }

  const menuItems = (): MenuItem[] => {
    const R = selectionRange();
    const rows = R.r2 - R.r1 + 1;
    const cols = R.c2 - R.c1 + 1;
    const whole = R.c1 === 0 && R.c2 === 16383;
    const wholeCol = R.r1 === 0 && R.r2 === 1048575;
    return [
      { label: t('menu.cut'), hint: 'Ctrl+X', run: () => A.copySelection(true) },
      { label: t('menu.copy'), hint: 'Ctrl+C', run: () => A.copySelection(false) },
      { label: t('menu.paste'), hint: 'Ctrl+V', run: async () => { try { const tx = await navigator.clipboard.readText(); A.pasteText(tx); } catch { useStore.getState().showToast(t('menu.pasteHint')); } } },
      { sep: true },
      { label: whole || !wholeCol ? t('menu.insertRows', { n: rows }) : t('menu.insertCols', { n: cols }), run: whole || !wholeCol ? A.insertRowAbove : A.insertColLeft },
      { label: t('menu.insertCols', { n: cols }), run: A.insertColLeft, hidden: wholeCol },
      { label: t('menu.deleteRows', { n: rows }), run: A.deleteSelectedRows, hidden: wholeCol },
      { label: t('menu.deleteCols', { n: cols }), run: A.deleteSelectedCols },
      { sep: true },
      { label: t('menu.clear'), hint: 'Del', run: A.clearSelection },
      { sep: true },
      { label: t('menu.askAi'), run: () => useStore.getState().set({ panel: 'ai' }), accent: true },
    ];
  };

  return (
    <div className="grid-wrap" ref={wrapRef}>
      <div
        className="grid-scroller"
        ref={scrollerRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          const { x, y } = localXY(e);
          setMenu({ x: x + 8, y: y + 8 });
        }}
      >
        <div className="grid-sticky">
          <canvas ref={canvasRef} className="grid-canvas" />
          <textarea
            ref={taRef}
            className={'grid-editor' + (editing?.from === 'cell' ? ' on' : '')}
            style={edStyle}
            value={editing ? editing.text : ''}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onCopy={(e) => { if (!editing) A.copySelection(false, e.nativeEvent); }}
            onCut={(e) => { if (!editing) A.copySelection(true, e.nativeEvent); }}
            onPaste={(e) => {
              if (editing) return;
              e.preventDefault();
              A.pasteText(e.clipboardData.getData('text/plain'));
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="cell input"
          />
        </div>
        <div style={{ width: HEADER_W + dims.cols.off[dims.nCols], height: HEADER_H + dims.rows.off[dims.nRows] }} />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => { setMenu(null); focusGrid(); }} />}
    </div>
  );
}

/** Picks a readable text color for an arbitrary cell background (matters in dark mode). */
function contrastText(bg: string, fallback: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(bg);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.58 ? '#18181b' : '#f4f4f5';
}

function wrapLines(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (measure(line + word) > maxW && line) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line += word;
    }
    out.push(line);
  }
  return out;
}
