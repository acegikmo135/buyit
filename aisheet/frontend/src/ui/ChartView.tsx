import { useMemo, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@heroui/react';
import { useStore, wb, useWbVersion } from '../store';
import type { ChartDef, Sheet } from '../core/types';
import { chartData, niceTicks, CHART_COLORS } from '../core/chartdata';
import { formatNumber } from '../core/format';

const fmt = (n: number) => (Math.abs(n) >= 1e7 ? formatNumber(n / 1e7, 'general') + 'Cr' : Math.abs(n) >= 1e5 ? formatNumber(n / 1e5, 'general') + 'L' : Math.abs(n) >= 1000 ? formatNumber(n / 1000, 'general') + 'k' : formatNumber(n, 'general'));

export function ChartSvg({ def, sheet, w, h }: { def: ChartDef; sheet: Sheet; w: number; h: number }) {
  const ver = useWbVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => chartData(wb, sheet, def), [ver, sheet.id, def]);
  if (!data || !data.series.length || !data.categories.length) return <div className="text-muted flex h-full items-center justify-center text-sm">No data in range</div>;
  const title = def.title ? 28 : 8;
  const legendOn = def.legend && (data.series.length > 1 || def.type === 'pie' || def.type === 'doughnut');
  const legendH = legendOn ? 26 : 6;
  const L = def.type === 'bar' ? 70 : 46;
  const B = def.type === 'bar' ? 22 : 30;
  const px = { l: L, r: 14, t: title + 4, b: legendH + B };
  const cw = Math.max(10, w - px.l - px.r);
  const ch = Math.max(10, h - px.t - px.b);
  const col = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
  const text = 'var(--muted)';
  const grid = 'var(--border)';

  const legend = legendOn && (
    <g transform={`translate(${w / 2},${h - 12})`}>
      {(def.type === 'pie' || def.type === 'doughnut' ? data.categories : data.series.map((s) => s.name)).slice(0, 8).map((n, i, arr) => {
        const wEach = Math.min(110, (w - 20) / arr.length);
        const x = (i - arr.length / 2) * wEach;
        return (
          <g key={i} transform={`translate(${x},0)`}>
            <rect width="9" height="9" y="-8" rx="2" fill={col(i)} />
            <text x="13" fontSize="10.5" fill={text}>{n.length > 12 ? n.slice(0, 11) + '…' : n}</text>
          </g>
        );
      })}
    </g>
  );

  const heading = def.title && <text x={w / 2} y={19} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--foreground)">{def.title}</text>;

  if (def.type === 'pie' || def.type === 'doughnut') {
    const vals = data.series[0].values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const rad = Math.min(cw, ch) / 2;
    const cx = w / 2;
    const cy = px.t + ch / 2;
    let a0 = -Math.PI / 2;
    return (
      <svg width={w} height={h}>
        {heading}
        {vals.map((v, i) => {
          const a1 = a0 + (v / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const p = (a: number, r: number) => `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
          const inner = def.type === 'doughnut' ? rad * 0.58 : 0;
          const d = vals.length === 1 ? '' : `M${p(a0, rad)} A${rad},${rad} 0 ${large} 1 ${p(a1, rad)} ${inner ? `L${p(a1, inner)} A${inner},${inner} 0 ${large} 0 ${p(a0, inner)}` : `L${cx},${cy}`} Z`;
          const mid = (a0 + a1) / 2;
          const node = (
            <g key={i}>
              {vals.length === 1 ? <circle cx={cx} cy={cy} r={rad} fill={col(i)} /> : <path d={d} fill={col(i)} stroke="var(--surface)" strokeWidth="1.5"><title>{`${data.categories[i]}: ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`}</title></path>}
              {v / total > 0.05 && <text x={cx + Math.cos(mid) * rad * (inner ? 0.79 : 0.65)} y={cy + Math.sin(mid) * rad * (inner ? 0.79 : 0.65)} textAnchor="middle" dominantBaseline="middle" fontSize="10.5" fontWeight="600" fill="#fff">{((v / total) * 100).toFixed(0)}%</text>}
            </g>
          );
          a0 = a1;
          return node;
        })}
        {legend}
      </svg>
    );
  }

  const stacked = !!def.stacked && (def.type === 'column' || def.type === 'bar' || def.type === 'area');
  const all = data.series.flatMap((s) => s.values);
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (stacked) {
    const sums = data.categories.map((_, i) => data.series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
    hi = Math.max(...sums, 0);
    lo = Math.min(0, ...all);
  }
  if (def.type === 'scatter') {
    const xs = data.xs ?? data.categories.map((_, i) => i + 1);
    const xt = niceTicks(Math.min(...xs), Math.max(...xs));
    const yt = niceTicks(Math.min(0, ...all), Math.max(...all));
    const X = (v: number) => px.l + ((v - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * cw;
    const Y = (v: number) => px.t + ch - ((v - yt[0]) / (yt[yt.length - 1] - yt[0] || 1)) * ch;
    return (
      <svg width={w} height={h}>
        {heading}
        {yt.map((t) => <g key={t}><line x1={px.l} x2={px.l + cw} y1={Y(t)} y2={Y(t)} stroke={grid} /><text x={px.l - 6} y={Y(t) + 3} textAnchor="end" fontSize="10" fill={text}>{fmt(t)}</text></g>)}
        {xt.map((t) => <text key={t} x={X(t)} y={px.t + ch + 14} textAnchor="middle" fontSize="10" fill={text}>{fmt(t)}</text>)}
        {data.series.map((s, i) => s.values.map((v, j) => <circle key={`${i}-${j}`} cx={X(xs[j])} cy={Y(v)} r="4" fill={col(i)} fillOpacity=".75"><title>{`${s.name}: (${fmt(xs[j])}, ${fmt(v)})`}</title></circle>))}
        {legend}
      </svg>
    );
  }
  const ticks = niceTicks(lo, hi);
  const tmin = ticks[0];
  const tmax = ticks[ticks.length - 1];
  const horizontal = def.type === 'bar';
  const V = (v: number) => (horizontal ? px.l + ((v - tmin) / (tmax - tmin || 1)) * cw : px.t + ch - ((v - tmin) / (tmax - tmin || 1)) * ch);
  const n = data.categories.length;
  const band = (horizontal ? ch : cw) / n;
  const C = (i: number) => (horizontal ? px.t : px.l) + band * i;
  const ns = data.series.length;
  const gap = Math.min(0.28, 0.5 / Math.max(ns, 1));
  const barW = stacked ? band * (1 - 0.3) : (band * (1 - 0.3)) / ns;
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor((horizontal ? ch / 16 : cw / 54))));
  void gap;

  return (
    <svg width={w} height={h}>
      {heading}
      {ticks.map((t) => (
        <g key={t}>
          {horizontal ? <line x1={V(t)} x2={V(t)} y1={px.t} y2={px.t + ch} stroke={grid} /> : <line x1={px.l} x2={px.l + cw} y1={V(t)} y2={V(t)} stroke={grid} />}
          {horizontal ? <text x={V(t)} y={px.t + ch + 14} textAnchor="middle" fontSize="10" fill={text}>{fmt(t)}</text> : <text x={px.l - 6} y={V(t) + 3} textAnchor="end" fontSize="10" fill={text}>{fmt(t)}</text>}
        </g>
      ))}
      {data.categories.map((cat, i) =>
        i % labelEvery ? null : horizontal ? (
          <text key={i} x={px.l - 6} y={C(i) + band / 2 + 3} textAnchor="end" fontSize="10" fill={text}>{cat.length > 10 ? cat.slice(0, 9) + '…' : cat}</text>
        ) : (
          <text key={i} x={C(i) + band / 2} y={px.t + ch + 14} textAnchor="middle" fontSize="10" fill={text}>{cat.length > 9 ? cat.slice(0, 8) + '…' : cat}</text>
        ),
      )}
      {(def.type === 'column' || def.type === 'bar') &&
        data.series.map((s, si) =>
          s.values.map((v, i) => {
            let start = 0;
            if (stacked) for (let k = 0; k < si; k++) start += Math.max(0, data.series[k].values[i]);
            const a = V(stacked ? start : 0);
            const b = V(stacked ? start + v : v);
            const off = stacked ? band * 0.15 : band * 0.15 + si * barW;
            return horizontal ? (
              <rect key={`${si}-${i}`} x={Math.min(a, b)} y={C(i) + off} width={Math.abs(b - a)} height={barW} fill={col(si)} rx="2"><title>{`${data.categories[i]} · ${s.name}: ${fmt(v)}`}</title></rect>
            ) : (
              <rect key={`${si}-${i}`} x={C(i) + off} y={Math.min(a, b)} width={barW} height={Math.abs(b - a)} fill={col(si)} rx="2"><title>{`${data.categories[i]} · ${s.name}: ${fmt(v)}`}</title></rect>
            );
          }),
        )}
      {(def.type === 'line' || def.type === 'area') &&
        data.series.map((s, si) => {
          const pts = s.values.map((v, i) => {
            let base = 0;
            if (stacked) for (let k = 0; k < si; k++) base += data.series[k].values[i];
            return [C(i) + band / 2, V(base + v)] as const;
          });
          const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
          return (
            <g key={si}>
              {def.type === 'area' && <path d={`${line} L${pts[pts.length - 1][0]},${V(0)} L${pts[0][0]},${V(0)} Z`} fill={col(si)} fillOpacity=".22" />}
              <path d={line} fill="none" stroke={col(si)} strokeWidth="2.2" strokeLinejoin="round" />
              {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.2" fill="var(--surface)" stroke={col(si)} strokeWidth="1.8"><title>{`${data.categories[i]} · ${s.name}: ${fmt(s.values[i])}`}</title></circle>)}
            </g>
          );
        })}
      {legend}
    </svg>
  );
}

/** Draggable / resizable chart that floats over the grid and scrolls with it. */
export function ChartView({ def, sheet, zoom }: { def: ChartDef; sheet: Sheet; zoom: number }) {
  const selected = useStore((s) => s.selectedChart === def.id);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<{ kind: 'move' | 'size'; sx: number; sy: number; o: ChartDef } | null>(null);
  const box = live ?? def;

  const onDown = (kind: 'move' | 'size') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    useStore.getState().set({ selectedChart: def.id });
    drag.current = { kind, sx: e.clientX, sy: e.clientY, o: def };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / zoom;
    const dy = (e.clientY - d.sy) / zoom;
    setLive(d.kind === 'move' ? { x: Math.max(0, d.o.x + dx), y: Math.max(0, d.o.y + dy), w: d.o.w, h: d.o.h } : { x: d.o.x, y: d.o.y, w: Math.max(220, d.o.w + dx), h: Math.max(150, d.o.h + dy) });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && live) wb.addChart(sheet, { ...def, ...live });
    setLive(null);
  };

  return (
    <div
      className={'bg-surface absolute rounded-xl border shadow-md transition-shadow ' + (selected ? 'ring-accent ring-2' : 'hover:shadow-lg')}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 2 }}
      onPointerDown={(e) => { e.stopPropagation(); useStore.getState().set({ selectedChart: def.id }); }}
      onDoubleClick={() => useStore.getState().set({ dialog: { kind: 'chart', id: def.id } })}
    >
      <div className="absolute inset-x-0 top-0 h-7 cursor-move rounded-t-xl" onPointerDown={onDown('move')} onPointerMove={onMove} onPointerUp={onUp} />
      <ChartSvg def={def} sheet={sheet} w={box.w} h={box.h} />
      {selected && (
        <div className="bg-overlay absolute -top-9 right-0 flex gap-0.5 rounded-lg border p-0.5 shadow-md">
          <Button isIconOnly size="sm" variant="ghost" aria-label="Edit chart" onPress={() => useStore.getState().set({ dialog: { kind: 'chart', id: def.id } })}><Pencil size={14} /></Button>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Delete chart" onPress={() => { wb.removeChart(sheet, def.id); useStore.getState().set({ selectedChart: null }); }}><Trash2 size={14} /></Button>
        </div>
      )}
      <div className="absolute right-0 bottom-0 size-4 cursor-nwse-resize" onPointerDown={onDown('size')} onPointerMove={onMove} onPointerUp={onUp}>
        <svg viewBox="0 0 16 16" className="text-muted size-4"><path d="M14 6v8H6M14 10v4h-4" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
      </div>
    </div>
  );
}
