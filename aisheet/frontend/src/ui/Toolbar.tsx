import { useRef } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, PaintBucket, Redo2, Snowflake, Type, Underline, Undo2, WrapText, ArrowDownAZ, ArrowUpZA, Eraser } from 'lucide-react';
import { Button, ListBox, Select } from '@heroui/react';
import { useStore, useWbVersion, wb } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';
import { Tip } from './Tip';
import type { NumFmt } from '../core/types';
import { focusGrid } from '../grid/GridCanvas';

function Group({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface-secondary flex items-center gap-0.5 rounded-xl p-0.5">{children}</div>;
}

function Btn({ label, onPress, active, disabled, children }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tip label={label}>
      <Button
        isIconOnly
        size="sm"
        variant={active ? 'secondary' : 'ghost'}
        className={'relative size-8 min-w-8 rounded-lg ' + (active ? 'bg-surface shadow-sm text-accent' : 'text-foreground/80')}
        aria-label={label}
        aria-pressed={active}
        isDisabled={disabled}
        onPress={() => {
          onPress();
          focusGrid();
        }}
      >
        {children}
      </Button>
    </Tip>
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
    <div className="bg-surface flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b px-3" role="toolbar" aria-label="Formatting">
      <Group>
        <Btn label={t('tb.undo') + ' (Ctrl+Z)'} onPress={A.undo} disabled={!wb.undoStack.length}><Undo2 size={16} /></Btn>
        <Btn label={t('tb.redo') + ' (Ctrl+Y)'} onPress={A.redo} disabled={!wb.redoStack.length}><Redo2 size={16} /></Btn>
      </Group>

      <Select
        aria-label={t('tb.numfmt')}
        selectedKey={style.fmt ?? 'general'}
        onSelectionChange={(k) => {
          A.applyStyle({ fmt: k === 'general' ? undefined : (k as NumFmt) });
          focusGrid();
        }}
        className="w-36 shrink-0"
      >
        <Select.Trigger className="h-8 min-h-8 rounded-lg text-[13px]">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {FORMATS.map(([k, l]) => (
              <ListBox.Item key={k} id={k} textValue={l}>{l}<ListBox.ItemIndicator /></ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Group>
        <Btn label={t('tb.bold') + ' (Ctrl+B)'} active={!!style.b} onPress={() => A.toggleStyle('b')}><Bold size={16} /></Btn>
        <Btn label={t('tb.italic') + ' (Ctrl+I)'} active={!!style.i} onPress={() => A.toggleStyle('i')}><Italic size={16} /></Btn>
        <Btn label={t('tb.underline') + ' (Ctrl+U)'} active={!!style.u} onPress={() => A.toggleStyle('u')}><Underline size={16} /></Btn>
      </Group>

      <Group>
        <Btn label={t('tb.textColor')} onPress={() => textColor.current?.click()}>
          <Type size={16} />
          <i className="absolute bottom-1 h-[3px] w-4 rounded-full" style={{ background: style.color ?? 'currentColor' }} />
        </Btn>
        <input ref={textColor} type="color" className="sr-only" tabIndex={-1} value={style.color ?? '#000000'} onChange={(e) => A.applyStyle({ color: e.target.value })} />
        <Btn label={t('tb.fillColor')} onPress={() => fillColor.current?.click()}>
          <PaintBucket size={16} />
          <i className="absolute bottom-1 h-[3px] w-4 rounded-full" style={{ background: style.bg ?? 'transparent', outline: style.bg ? 'none' : '1px dashed var(--muted)' }} />
        </Btn>
        <input ref={fillColor} type="color" className="sr-only" tabIndex={-1} value={style.bg ?? '#ffffff'} onChange={(e) => A.applyStyle({ bg: e.target.value })} />
        <Btn label={t('tb.clearFill')} onPress={() => A.applyStyle({ bg: undefined, color: undefined })}><Eraser size={16} /></Btn>
      </Group>

      <Group>
        <Btn label={t('tb.alignLeft')} active={style.align === 'left'} onPress={() => A.applyStyle({ align: style.align === 'left' ? undefined : 'left' })}><AlignLeft size={16} /></Btn>
        <Btn label={t('tb.alignCenter')} active={style.align === 'center'} onPress={() => A.applyStyle({ align: style.align === 'center' ? undefined : 'center' })}><AlignCenter size={16} /></Btn>
        <Btn label={t('tb.alignRight')} active={style.align === 'right'} onPress={() => A.applyStyle({ align: style.align === 'right' ? undefined : 'right' })}><AlignRight size={16} /></Btn>
        <Btn label={t('tb.wrap')} active={!!style.wrap} onPress={() => A.toggleStyle('wrap')}><WrapText size={16} /></Btn>
      </Group>

      <Group>
        <Btn label={t('tb.sortAsc')} onPress={() => A.sortSelection(true)}><ArrowDownAZ size={16} /></Btn>
        <Btn label={t('tb.sortDesc')} onPress={() => A.sortSelection(false)}><ArrowUpZA size={16} /></Btn>
        <Btn label={t('tb.freeze')} onPress={A.toggleFreeze}><Snowflake size={16} /></Btn>
      </Group>
    </div>
  );
}
