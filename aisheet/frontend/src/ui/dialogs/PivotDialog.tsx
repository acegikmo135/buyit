import { useMemo, useState } from 'react';
import { Input, Switch } from '@heroui/react';
import { useStore, wb, activeSheet, selectionRange } from '../../store';
import { addr, colToName, parseRange, rangeToString } from '../../core/address';
import { buildPivot, currentRegion, type PivotAgg } from '../../core/tools';
import { displayValue } from '../../core/format';
import { Field, Footer, ModalShell, Pick } from '../forms';
import { useT } from '../../i18n';

export function PivotDialog() {
  const t = useT();
  const sheet = activeSheet();
  const close = () => useStore.getState().set({ dialog: null });
  const [range, setRange] = useState(() => {
    const { active } = useStore.getState();
    let R = selectionRange();
    if (R.r1 === R.r2 && R.c1 === R.c2) R = currentRegion(wb, sheet, active.r, active.c);
    return rangeToString(R);
  });
  const R = useMemo(() => parseRange(range), [range]);
  const headers = useMemo(() => {
    if (!R) return [];
    return Array.from({ length: Math.min(R.c2 - R.c1 + 1, 60) }, (_, i) => {
      const c = R.c1 + i;
      return [String(c), displayValue(wb.value(sheet, R.r1, c), undefined) || colToName(c)] as [string, string];
    });
  }, [R, sheet]);
  const firstText = headers[0]?.[0] ?? '0';
  const lastNum = headers[headers.length - 1]?.[0] ?? '0';
  const [rowF, setRowF] = useState<string>(firstText);
  const [colF, setColF] = useState<string>('none');
  const [valF, setValF] = useState<string>(lastNum);
  const [agg, setAgg] = useState<PivotAgg>('sum');
  const [grand, setGrand] = useState(true);
  const [target, setTarget] = useState('Pivot');

  const create = () => {
    if (!R || R.r2 <= R.r1) return useStore.getState().showToast(t('common.badRange'));
    const res = buildPivot(wb, { sourceSheet: sheet.name, source: R, rowField: Number(rowF), colField: colF === 'none' ? undefined : Number(colF), valueField: Number(valF), agg, target: target.trim() || 'Pivot', grandTotals: grand });
    useStore.getState().set({ activeSheetId: res.sheetId, anchor: { r: 0, c: 0 }, active: { r: 0, c: 0 }, dialog: null });
  };

  return (
    <ModalShell title={t('pivot.title')} onClose={close} footer={<Footer onClose={close} onOk={create} okLabel={t('pivot.create')} cancelLabel={t('common.cancel')} />}>
      <Field label={t('pivot.source')} hint={t('pivot.source.d')}>
        <Input fullWidth value={range} onChange={(e) => setRange(e.target.value)} spellCheck={false} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('pivot.rows')}><Pick label="rows" value={rowF} onChange={setRowF} options={headers} /></Field>
        <Field label={t('pivot.cols')}><Pick label="cols" value={colF} onChange={setColF} options={[['none', t('pivot.none')], ...headers]} /></Field>
        <Field label={t('pivot.values')}><Pick label="values" value={valF} onChange={setValF} options={headers} /></Field>
        <Field label={t('pivot.agg')}><Pick label="agg" value={agg} onChange={setAgg} options={[['sum', t('pivot.sum')], ['count', t('pivot.count')], ['avg', t('pivot.avg')], ['min', t('pivot.min')], ['max', t('pivot.max')]]} /></Field>
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <Field label={t('pivot.target')}><Input fullWidth value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <div className="flex items-center justify-between pb-2 text-sm">
          {t('pivot.grand')}
          <Switch aria-label={t('pivot.grand')} isSelected={grand} onChange={setGrand}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
        </div>
      </div>
      <p className="text-muted text-xs">{t('pivot.live')} · {addr(0, 0)}</p>
    </ModalShell>
  );
}
