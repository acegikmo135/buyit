import { useState } from 'react';
import { Printer, Trash2 } from 'lucide-react';
import { Button, Checkbox, Chip, Input, Switch, TextArea } from '@heroui/react';
import { useStore, wb, activeSheet, selectionRange } from '../../store';
import { addr, colToName, keyOf, rangeToString } from '../../core/address';
import { removeDuplicates, textToColumns } from '../../core/tools';
import { printSheet } from '../../core/print';
import { displayValue } from '../../core/format';
import { Field, Footer, ModalShell, Pick, Row } from '../forms';
import { useT } from '../../i18n';
import type { PageSetup } from '../../core/types';

const close = () => useStore.getState().set({ dialog: null });

export function CommentDialog({ r, c }: { r: number; c: number }) {
  const t = useT();
  const sh = activeSheet();
  const [text, setText] = useState(sh.comments.get(keyOf(r, c)) ?? '');
  return (
    <ModalShell title={`${t('comment.title')} · ${addr(r, c)}`} onClose={close} footer={<Footer onClose={close} okLabel={t('common.save')} cancelLabel={t('common.cancel')} onOk={() => { wb.setComment(sh, r, c, text.trim() || null); close(); }} extra={sh.comments.has(keyOf(r, c)) && <Button variant="danger-soft" onPress={() => { wb.setComment(sh, r, c, null); close(); }}><Trash2 size={14} />{t('common.delete')}</Button>} />}>
      <TextArea aria-label={t('comment.title')} rows={5} value={text} autoFocus placeholder={t('comment.ph')} onChange={(e) => setText(e.target.value)} className="w-full select-text" />
    </ModalShell>
  );
}

export function NamesDialog() {
  const t = useT();
  const [name, setName] = useState('');
  const [ref, setRef] = useState(`${activeSheet().name}!${rangeToString(selectionRange())}`);
  const names = [...wb.names];
  const valid = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name);
  return (
    <ModalShell title={t('names.title')} onClose={close} footer={<Footer onClose={close} okLabel={t('names.add')} okDisabled={!valid} cancelLabel={t('common.close')} onOk={() => { wb.defineName(name, ref); setName(''); }} />}>
      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
        <Field label={t('names.name')}><Input fullWidth value={name} placeholder="Sales" onChange={(e) => setName(e.target.value)} spellCheck={false} /></Field>
        <Field label={t('names.refers')}><Input fullWidth value={ref} onChange={(e) => setRef(e.target.value)} spellCheck={false} /></Field>
      </div>
      <p className="text-muted text-xs">{t('names.hint')}</p>
      <div className="flex flex-col gap-1.5">
        {!names.length && <div className="text-muted text-sm">{t('names.none')}</div>}
        {names.map(([n, r]) => (
          <div key={n} className="bg-surface-secondary flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]">
            <Chip size="sm" variant="soft">{n}</Chip>
            <span className="flex-1 truncate font-mono text-xs">{r}</span>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Delete" onPress={() => wb.defineName(n, null)}><Trash2 size={14} /></Button>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

export function TextColsDialog() {
  const t = useT();
  const [delim, setDelim] = useState(',');
  const [custom, setCustom] = useState('');
  return (
    <ModalShell title={t('ttc.title')} onClose={close} footer={<Footer onClose={close} okLabel={t('ttc.split')} cancelLabel={t('common.cancel')} onOk={() => { textToColumns(wb, activeSheet(), selectionRange(), delim === 'custom' ? custom : delim); close(); }} />}>
      <Field label={t('ttc.delim')} hint={t('ttc.hint')}>
        <Pick label="delimiter" value={delim} onChange={setDelim} options={[[',', t('ttc.comma')], ['tab', t('ttc.tab')], ['space', t('ttc.space')], [';', t('ttc.semi')], ['|', '|'], ['custom', t('ttc.custom')]]} />
      </Field>
      {delim === 'custom' && <Input aria-label="custom" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="-" />}
    </ModalShell>
  );
}

export function DedupeDialog() {
  const t = useT();
  const sh = activeSheet();
  const R = selectionRange();
  const ub = wb.usedBounds(sh);
  const range = R.r1 === R.r2 && R.c1 === R.c2 ? { r1: 0, c1: 0, r2: ub.r, c2: ub.c } : { ...R, r2: Math.min(R.r2, ub.r), c2: Math.min(R.c2, ub.c) };
  const cols = Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => range.c1 + i);
  const [chosen, setChosen] = useState<Set<number>>(new Set(cols));
  const [header, setHeader] = useState(true);
  return (
    <ModalShell title={t('dd.title')} onClose={close} footer={<Footer onClose={close} okLabel={t('dd.remove')} okDisabled={!chosen.size} cancelLabel={t('common.cancel')} onOk={() => { const n = removeDuplicates(wb, sh, range, [...chosen], header); useStore.getState().showToast(t('dd.removed', { n })); close(); }} />}>
      <div className="flex items-center justify-between text-sm">{t('dd.header')}<Switch aria-label={t('dd.header')} isSelected={header} onChange={setHeader}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></div>
      <Field label={t('dd.columns')} hint={rangeToString(range)}>
        <div className="grid grid-cols-2 gap-2">
          {cols.slice(0, 60).map((c) => (
            <Checkbox key={c} className="flex flex-row items-center gap-2" isSelected={chosen.has(c)} onChange={(on) => setChosen((p) => { const n = new Set(p); on ? n.add(c) : n.delete(c); return n; })}>
              <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
              <Checkbox.Content><span className="text-[13px]">{header ? displayValue(wb.value(sh, range.r1, c), undefined) || colToName(c) : colToName(c)}</span></Checkbox.Content>
            </Checkbox>
          ))}
        </div>
      </Field>
    </ModalShell>
  );
}

export function PageDialog() {
  const t = useT();
  const sh = activeSheet();
  const [p, setP] = useState<PageSetup>(sh.page);
  const set = (x: Partial<PageSetup>) => setP((o) => ({ ...o, ...x }));
  const apply = () => wb.setPage(sh, p);
  return (
    <ModalShell title={t('page.title')} onClose={close} footer={<Footer onClose={close} okLabel={t('page.print')} cancelLabel={t('common.cancel')} onOk={() => { apply(); close(); printSheet(wb, wb.sheetById(sh.id)!); }} extra={<Button variant="tertiary" onPress={() => { apply(); close(); }}>{t('common.save')}</Button>} />}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('page.orientation')}><Pick label="orientation" value={p.orientation} onChange={(v) => set({ orientation: v })} options={[['portrait', t('page.portrait')], ['landscape', t('page.landscape')]]} /></Field>
        <Field label={t('page.paper')}><Pick label="paper" value={p.paper} onChange={(v) => set({ paper: v })} options={[['A4', 'A4'], ['Letter', 'Letter'], ['A3', 'A3']]} /></Field>
      </div>
      <div className="divide-border divide-y">
        <Row title={t('page.fit')}><Switch aria-label={t('page.fit')} isSelected={p.fitWidth} onChange={(v) => set({ fitWidth: v })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
        <Row title={t('page.gridlines')}><Switch aria-label={t('page.gridlines')} isSelected={p.gridlines} onChange={(v) => set({ gridlines: v })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
        <Row title={t('page.headers')}><Switch aria-label={t('page.headers')} isSelected={p.headers} onChange={(v) => set({ headers: v })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
        <Row title={t('page.repeat')}><Switch aria-label={t('page.repeat')} isSelected={p.repeatHeaderRow} onChange={(v) => set({ repeatHeaderRow: v })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch></Row>
      </div>
      <p className="text-muted flex items-center gap-1.5 text-xs"><Printer size={13} />{t('page.hint')}</p>
    </ModalShell>
  );
}
