import { useRef } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Italic, PaintBucket, Redo2, Snowflake, Type, Underline, Undo2, WrapText, ArrowDownAZ, ArrowUpZA } from 'lucide-react';
import { useStore, useWbVersion, wb } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';
import type { NumFmt } from '../core/types';
import { focusGrid } from '../grid/GridCanvas';

function Btn({ title, onClick, active, disabled, children }: { title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={'tb-btn' + (active ? ' on' : '')}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        focusGrid();
      }}
    >
      {children}
    </button>
  );
}

export function Toolbar() {
  const t = useT();
  useWbVersion();
  useStore((s) => s.active);
  useStore((s) => s.anchor);
  const style = A.styleAtActive();
  const textColor = useRef<HTMLInputElement>(null);
  const fillColor = useRef<HTMLInputElement>(null);
  const FORMATS: [NumFmt, string][] = [
    ['general', t('fmt.general')],
    ['number', '0.00'],
    ['integer', '0'],
    ['thousands', '1,234.00'],
    ['percent', '%'],
    ['currency_inr', '₹ INR'],
    ['currency_usd', '$ USD'],
    ['currency_eur', '€ EUR'],
    ['date', t('fmt.date')],
    ['text', t('fmt.text')],
  ];
  return (
    <div className="toolbar" role="toolbar">
      <Btn title={t('tb.undo') + ' (Ctrl+Z)'} onClick={A.undo} disabled={!wb.undoStack.length}><Undo2 size={16} /></Btn>
      <Btn title={t('tb.redo') + ' (Ctrl+Y)'} onClick={A.redo} disabled={!wb.redoStack.length}><Redo2 size={16} /></Btn>
      <span className="tb-sep" />
      <label className="tb-select" title={t('tb.numfmt')}>
        <select
          value={style.fmt ?? 'general'}
          onChange={(e) => {
            A.applyStyle({ fmt: e.target.value === 'general' ? undefined : (e.target.value as NumFmt) });
            focusGrid();
          }}
        >
          {FORMATS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <ChevronDown size={12} />
      </label>
      <span className="tb-sep" />
      <Btn title={t('tb.bold') + ' (Ctrl+B)'} active={!!style.b} onClick={() => A.toggleStyle('b')}><Bold size={16} /></Btn>
      <Btn title={t('tb.italic') + ' (Ctrl+I)'} active={!!style.i} onClick={() => A.toggleStyle('i')}><Italic size={16} /></Btn>
      <Btn title={t('tb.underline') + ' (Ctrl+U)'} active={!!style.u} onClick={() => A.toggleStyle('u')}><Underline size={16} /></Btn>
      <span className="tb-sep" />
      <Btn title={t('tb.textColor')} onClick={() => textColor.current?.click()}>
        <Type size={16} />
        <i className="swatch" style={{ background: style.color ?? 'var(--text)' }} />
      </Btn>
      <input ref={textColor} type="color" className="hidden-input" value={style.color ?? '#000000'} onChange={(e) => A.applyStyle({ color: e.target.value })} />
      <Btn title={t('tb.fillColor')} onClick={() => fillColor.current?.click()}>
        <PaintBucket size={16} />
        <i className="swatch" style={{ background: style.bg ?? 'transparent', outline: style.bg ? 'none' : '1px dashed var(--muted)' }} />
      </Btn>
      <input ref={fillColor} type="color" className="hidden-input" value={style.bg ?? '#ffffff'} onChange={(e) => A.applyStyle({ bg: e.target.value })} />
      <Btn title={t('tb.clearFill')} onClick={() => A.applyStyle({ bg: undefined, color: undefined })}><span className="tb-x">×</span></Btn>
      <span className="tb-sep" />
      <Btn title={t('tb.alignLeft')} active={style.align === 'left'} onClick={() => A.applyStyle({ align: style.align === 'left' ? undefined : 'left' })}><AlignLeft size={16} /></Btn>
      <Btn title={t('tb.alignCenter')} active={style.align === 'center'} onClick={() => A.applyStyle({ align: style.align === 'center' ? undefined : 'center' })}><AlignCenter size={16} /></Btn>
      <Btn title={t('tb.alignRight')} active={style.align === 'right'} onClick={() => A.applyStyle({ align: style.align === 'right' ? undefined : 'right' })}><AlignRight size={16} /></Btn>
      <Btn title={t('tb.wrap')} active={!!style.wrap} onClick={() => A.toggleStyle('wrap')}><WrapText size={16} /></Btn>
      <span className="tb-sep" />
      <Btn title={t('tb.sortAsc')} onClick={() => A.sortSelection(true)}><ArrowDownAZ size={16} /></Btn>
      <Btn title={t('tb.sortDesc')} onClick={() => A.sortSelection(false)}><ArrowUpZA size={16} /></Btn>
      <Btn title={t('tb.freeze')} onClick={A.toggleFreeze}><Snowflake size={16} /></Btn>
    </div>
  );
}
