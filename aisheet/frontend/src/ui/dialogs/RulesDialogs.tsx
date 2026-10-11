import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Chip, Input } from '@heroui/react';
import { useStore, wb, activeSheet, selectionRange } from '../../store';
import { rangeToString, parseRange } from '../../core/address';
import type { CFRule, DVRule } from '../../core/types';
import { Field, Footer, ModalShell, Pick } from '../forms';
import { useT } from '../../i18n';

const PRESETS: Record<string, { bg: string; color: string }> = {
  red: { bg: '#fecaca', color: '#991b1b' },
  yellow: { bg: '#fef08a', color: '#854d0e' },
  green: { bg: '#bbf7d0', color: '#166534' },
  blue: { bg: '#bfdbfe', color: '#1e40af' },
  orange: { bg: '#fed7aa', color: '#9a3412' },
};

const rid = () => 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1000);

export function CFDialog() {
  const t = useT();
  const sheet = activeSheet();
  const close = () => useStore.getState().set({ dialog: null });
  const [range, setRange] = useState(rangeToString(selectionRange()));
  const [kind, setKind] = useState<'cell' | 'text' | 'top' | 'dupes' | 'colorScale' | 'dataBar' | 'formula'>('cell');
  const [op, setOp] = useState<NonNullable<CFRule['op']>>('>');
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [text, setText] = useState('');
  const [rank, setRank] = useState('10');
  const [bottom, setBottom] = useState(false);
  const [formula, setFormula] = useState('');
  const [preset, setPreset] = useState('red');
  const rules = sheet.cf;

  const describe = (r: CFRule) => {
    const k = r.kind;
    const base = k === 'cell' ? `${t('cf.cell')} ${r.op} ${r.v1}${r.op === 'between' || r.op === 'notBetween' ? ' – ' + r.v2 : ''}` : k === 'text' ? `${t('cf.text')} “${r.text}”` : k === 'top' ? `${r.bottom ? t('cf.bottom') : t('cf.top')} ${r.rank}` : k === 'dupes' ? t('cf.dupes') : k === 'colorScale' ? t('cf.scale') : k === 'dataBar' ? t('cf.bar') : `ƒ ${r.formula}`;
    return `${rangeToString(r.range)} · ${base}`;
  };

  const add = () => {
    const R = parseRange(range);
    if (!R) return useStore.getState().showToast(t('common.badRange'));
    const style = PRESETS[preset];
    const rule: CFRule = { id: rid(), range: R, kind, style: { bg: style.bg, color: style.color } };
    if (kind === 'cell') Object.assign(rule, { op, v1: isNaN(Number(v1)) ? v1 : Number(v1), v2: isNaN(Number(v2)) ? v2 : Number(v2) });
    if (kind === 'text') rule.text = text;
    if (kind === 'top') Object.assign(rule, { rank: Number(rank) || 10, bottom });
    if (kind === 'formula') rule.formula = formula;
    if (kind === 'colorScale') { rule.colors = ['#f8696b', '#ffeb84', '#63be7b']; delete rule.style; }
    if (kind === 'dataBar') { rule.color = '#6d8ff0'; delete rule.style; }
    wb.addCF(sheet, rule);
  };

  return (
    <ModalShell title={t('cf.title')} onClose={close} footer={<Footer onClose={close} onOk={add} okLabel={t('cf.add')} cancelLabel={t('common.close')} />}>
      <Field label={t('common.range')}><Input fullWidth value={range} onChange={(e) => setRange(e.target.value)} spellCheck={false} /></Field>
      <Field label={t('cf.rule')}>
        <Pick label={t('cf.rule')} value={kind} onChange={setKind} options={[['cell', t('cf.cell')], ['text', t('cf.text')], ['top', t('cf.topN')], ['dupes', t('cf.dupes')], ['colorScale', t('cf.scale')], ['dataBar', t('cf.bar')], ['formula', t('cf.formula')]]} />
      </Field>
      {kind === 'cell' && (
        <div className="grid grid-cols-[150px_1fr_1fr] gap-2">
          <Pick label="op" value={op} onChange={setOp} options={[['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤'], ['=', '='], ['<>', '≠'], ['between', t('cf.between')], ['notBetween', t('cf.notBetween')]]} />
          <Input aria-label="value" placeholder={t('cf.value')} value={v1} onChange={(e) => setV1(e.target.value)} />
          {(op === 'between' || op === 'notBetween') && <Input aria-label="value 2" placeholder={t('cf.value2')} value={v2} onChange={(e) => setV2(e.target.value)} />}
        </div>
      )}
      {kind === 'text' && <Input aria-label="text" placeholder={t('cf.contains')} value={text} onChange={(e) => setText(e.target.value)} />}
      {kind === 'top' && (
        <div className="flex gap-2">
          <Pick label="top/bottom" value={bottom ? 'b' : 't'} onChange={(v) => setBottom(v === 'b')} options={[['t', t('cf.top')], ['b', t('cf.bottom')]]} width="w-40" />
          <Input aria-label="N" value={rank} onChange={(e) => setRank(e.target.value)} className="w-24" />
        </div>
      )}
      {kind === 'formula' && <Field label={t('cf.formula')} hint={t('cf.formula.d')}><Input fullWidth value={formula} placeholder="=$C2>100" onChange={(e) => setFormula(e.target.value)} spellCheck={false} /></Field>}
      {['cell', 'text', 'top', 'dupes', 'formula'].includes(kind) && (
        <Field label={t('cf.format')}>
          <div className="flex gap-2">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} type="button" onClick={() => setPreset(k)} className={'flex h-9 w-16 items-center justify-center rounded-lg border text-xs font-semibold ' + (preset === k ? 'ring-accent ring-2' : '')} style={{ background: p.bg, color: p.color }}>Aa</button>
            ))}
          </div>
        </Field>
      )}
      <Field label={t('cf.existing')}>
        <div className="flex flex-col gap-1.5">
          {!rules.length && <div className="text-muted text-sm">{t('cf.none')}</div>}
          {rules.map((r) => (
            <div key={r.id} className="bg-surface-secondary flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]">
              {r.style?.bg && <span className="size-3.5 rounded" style={{ background: r.style.bg }} />}
              <span className="flex-1 truncate">{describe(r)}</span>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Delete" onPress={() => wb.removeCF(sheet, r.id)}><Trash2 size={14} /></Button>
            </div>
          ))}
          {rules.length > 1 && <Button size="sm" variant="ghost" className="self-start" onPress={() => wb.removeCF(sheet, 'all')}>{t('cf.clearAll')}</Button>}
        </div>
      </Field>
    </ModalShell>
  );
}

export function DVDialog() {
  const t = useT();
  const sheet = activeSheet();
  const close = () => useStore.getState().set({ dialog: null });
  const [range, setRange] = useState(rangeToString(selectionRange()));
  const [kind, setKind] = useState<DVRule['kind']>('list');
  const [list, setList] = useState('Yes, No');
  const [op, setOp] = useState<NonNullable<DVRule['op']>>('between');
  const [v1, setV1] = useState('0');
  const [v2, setV2] = useState('100');
  const [msg, setMsg] = useState('');
  const add = () => {
    const R = parseRange(range);
    if (!R) return useStore.getState().showToast(t('common.badRange'));
    const rule: DVRule = { id: rid(), range: R, kind, message: msg || undefined };
    if (kind === 'list') {
      if (/^(?:'?[^'!]+'?!)?\$?[A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?$/i.test(list.trim())) rule.source = list.trim();
      else rule.items = list.split(',').map((x) => x.trim()).filter(Boolean);
    } else Object.assign(rule, { op, v1: Number(v1), v2: Number(v2) });
    wb.addDV(sheet, rule);
  };
  return (
    <ModalShell title={t('dv.title')} onClose={close} footer={<Footer onClose={close} onOk={add} okLabel={t('dv.add')} cancelLabel={t('common.close')} />}>
      <Field label={t('common.range')}><Input fullWidth value={range} onChange={(e) => setRange(e.target.value)} spellCheck={false} /></Field>
      <Field label={t('dv.allow')}>
        <Pick label="kind" value={kind} onChange={setKind} options={[['list', t('dv.list')], ['whole', t('dv.whole')], ['decimal', t('dv.decimal')], ['textLength', t('dv.textLength')], ['date', t('dv.date')]]} />
      </Field>
      {kind === 'list' ? (
        <Field label={t('dv.items')} hint={t('dv.items.d')}><Input fullWidth value={list} onChange={(e) => setList(e.target.value)} spellCheck={false} /></Field>
      ) : (
        <div className="grid grid-cols-[150px_1fr_1fr] gap-2">
          <Pick label="op" value={op} onChange={setOp} options={[['between', t('cf.between')], ['notBetween', t('cf.notBetween')], ['=', '='], ['<>', '≠'], ['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤']]} />
          <Input aria-label="v1" value={v1} onChange={(e) => setV1(e.target.value)} />
          {(op === 'between' || op === 'notBetween') && <Input aria-label="v2" value={v2} onChange={(e) => setV2(e.target.value)} />}
        </div>
      )}
      <Field label={t('dv.message')}><Input fullWidth value={msg} placeholder={t('dv.message.ph')} onChange={(e) => setMsg(e.target.value)} /></Field>
      <Field label={t('dv.existing')}>
        <div className="flex flex-col gap-1.5">
          {!sheet.validations.length && <div className="text-muted text-sm">{t('dv.none')}</div>}
          {sheet.validations.map((r) => (
            <div key={r.id} className="bg-surface-secondary flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]">
              <Chip size="sm" variant="soft">{r.kind}</Chip>
              <span className="flex-1 truncate">{rangeToString(r.range)} · {r.kind === 'list' ? (r.items ?? [r.source]).join(', ') : `${r.op} ${r.v1}${r.v2 !== undefined && (r.op === 'between' || r.op === 'notBetween') ? '–' + r.v2 : ''}`}</span>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Delete" onPress={() => wb.removeDV(sheet, r.id)}><Trash2 size={14} /></Button>
            </div>
          ))}
        </div>
      </Field>
    </ModalShell>
  );
}
