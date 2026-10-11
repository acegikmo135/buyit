import { useMemo, useState } from 'react';
import { BarChart3, ChartArea, ChartBar, ChartLine, ChartPie, ChartScatter, Trash2 } from 'lucide-react';
import { Button, Input, Switch } from '@heroui/react';
import { useStore, wb, activeSheet, selectionRange } from '../../store';
import { addr } from '../../core/address';
import type { ChartDef, ChartType } from '../../core/types';
import { currentRegion } from '../../core/tools';
import { ChartSvg } from '../ChartView';
import { Field, Footer, ModalShell } from '../forms';
import { useT } from '../../i18n';

const TYPES: { id: ChartType; icon: React.ReactNode; key: string }[] = [
  { id: 'column', icon: <BarChart3 size={18} />, key: 'chart.column' },
  { id: 'bar', icon: <ChartBar size={18} />, key: 'chart.bar' },
  { id: 'line', icon: <ChartLine size={18} />, key: 'chart.line' },
  { id: 'area', icon: <ChartArea size={18} />, key: 'chart.area' },
  { id: 'pie', icon: <ChartPie size={18} />, key: 'chart.pie' },
  { id: 'doughnut', icon: <ChartPie size={18} />, key: 'chart.doughnut' },
  { id: 'scatter', icon: <ChartScatter size={18} />, key: 'chart.scatter' },
];

export function ChartDialog({ id }: { id?: string }) {
  const t = useT();
  const sheet = activeSheet();
  const existing = id ? sheet.charts.find((c) => c.id === id) : undefined;
  const initialRange = useMemo(() => {
    if (existing) return existing.range;
    const { active } = useStore.getState();
    let R = selectionRange();
    if (R.r1 === R.r2 && R.c1 === R.c2) R = currentRegion(wb, sheet, active.r, active.c);
    return `${addr(R.r1, R.c1)}:${addr(R.r2, R.c2)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [def, setDef] = useState<ChartDef>(
    existing ?? { id: 'ch' + Date.now().toString(36), type: 'column', title: '', range: initialRange, headerRow: true, headerCol: true, legend: true, x: 24, y: 24, w: 480, h: 300 },
  );
  const set = (p: Partial<ChartDef>) => setDef((d) => ({ ...d, ...p }));
  const close = () => useStore.getState().set({ dialog: null });
  const save = () => {
    if (!existing) {
      // place to the right of the data
      let left = 0;
      const m = /([A-Z]+)\d+:?([A-Z]+)?/i.exec(def.range.replace(/^.*!/, ''));
      const lastCol = m ? (m[2] ?? m[1]).toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) : 4;
      for (let c = 0; c <= lastCol; c++) left += sheet.colW.get(c) ?? 104;
      def.x = left + 20;
    }
    wb.addChart(sheet, def);
    useStore.getState().set({ selectedChart: def.id });
    close();
  };

  return (
    <ModalShell
      title={existing ? t('chart.edit') : t('chart.new')}
      onClose={close}
      width="sm:max-w-[760px]"
      footer={<Footer onClose={close} onOk={save} okLabel={existing ? t('common.save') : t('chart.create')} cancelLabel={t('common.cancel')} extra={existing && <Button variant="danger-soft" onPress={() => { wb.removeChart(sheet, existing.id); close(); }}><Trash2 size={14} />{t('chart.delete')}</Button>} />}
    >
      <div className="grid gap-5 md:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          <Field label={t('chart.type')}>
            <div className="grid grid-cols-4 gap-1.5">
              {TYPES.map((x) => (
                <Button key={x.id} size="sm" variant={def.type === x.id ? 'primary' : 'tertiary'} className="h-14 flex-col gap-0.5 text-[11px]" onPress={() => set({ type: x.id })}>
                  {x.icon}{t(x.key)}
                </Button>
              ))}
            </div>
          </Field>
          <Field label={t('chart.range')} hint={t('chart.range.d')}>
            <Input fullWidth value={def.range} onChange={(e) => set({ range: e.target.value })} spellCheck={false} />
          </Field>
          <Field label={t('chart.title')}>
            <Input fullWidth value={def.title} placeholder={t('chart.title.ph')} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <div className="flex flex-col gap-2.5">
            {([['chart.headerRow', 'headerRow'], ['chart.headerCol', 'headerCol'], ['chart.legend', 'legend'], ['chart.stacked', 'stacked']] as const).map(([k, f]) => (
              <div key={f} className="flex items-center justify-between text-sm">
                {t(k)}
                <Switch aria-label={t(k)} isSelected={!!def[f]} onChange={(v) => set({ [f]: v } as Partial<ChartDef>)}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface-secondary flex items-center justify-center rounded-xl border p-2">
          <div className="bg-surface rounded-lg border">
            <ChartSvg def={def} sheet={sheet} w={280} h={220} />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
