import { useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowUpZA, Bold, BookText, BrickWall, ChartColumn, Columns3, CopyMinus, Eraser, Eye, EyeOff, Filter, Grid3x3, Italic,
  Merge, MessageSquare, MessageSquarePlus, PaintBucket, Printer, Redo2, Rows3, ScanSearch, Search, ShieldCheck, Sigma, Snowflake, Sparkles, SplitSquareHorizontal, Table2, Type, Underline, Undo2,
  WandSparkles, WrapText, ZoomIn, ZoomOut, ListChecks, Palette, ChevronDown, CalendarDays, Wrench, Mic, Lightbulb, ChartPie, ChartLine, ChartBar, ChartArea,
} from 'lucide-react';
import { Button, Dropdown, ListBox, Select, Separator, Tabs } from '@heroui/react';
import { useStore, useWbVersion, wb, activeSheet } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';
import { Tip } from './Tip';
import type { NumFmt } from '../core/types';
import { focusGrid } from '../grid/GridCanvas';
import { runQuickAction } from '../ai/quick';

function Group({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="bg-surface-secondary flex items-center gap-0.5 rounded-xl p-0.5">{children}</div>
      {label && <span className="text-muted text-[10px] leading-none">{label}</span>}
    </div>
  );
}

function Btn({ label, onPress, active, disabled, children, wide }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode; wide?: boolean }) {
  return (
    <Tip label={label}>
      <Button
        isIconOnly={!wide}
        size="sm"
        variant={active ? 'secondary' : 'ghost'}
        className={'relative h-8 rounded-lg ' + (wide ? 'gap-1.5 px-2.5 text-[13px] ' : 'size-8 min-w-8 ') + (active ? 'bg-surface text-accent shadow-sm' : 'text-foreground/80')}
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

function Menu({ label, icon, items, wide = true }: { label: string; icon: React.ReactNode; items: ({ id: string; label: string; icon?: React.ReactNode; run: () => void } | 'sep')[]; wide?: boolean }) {
  const runners = new Map(items.flatMap((i) => (i === 'sep' ? [] : [[i.id, i.run] as const])));
  return (
    <Dropdown onOpenChange={(o) => !o && focusGrid()}>
      <Button size="sm" variant="ghost" className={'h-8 gap-1.5 rounded-lg px-2.5 text-[13px] ' + (wide ? '' : 'min-w-8 px-1.5')} aria-label={label}>
        {icon}{wide && <span>{label}</span>}<ChevronDown size={12} className="text-muted" />
      </Button>
      <Dropdown.Popover className="min-w-56">
        <Dropdown.Menu onAction={(k) => runners.get(String(k))?.()}>
          {items.map((it, i) => it === 'sep' ? <Separator key={'s' + i} /> : (
            <Dropdown.Item key={it.id} id={it.id} textValue={it.label}>
              <span className="flex items-center gap-2.5">{it.icon}{it.label}</span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function Ribbon() {
  const t = useT();
  useWbVersion();
  const tab = useStore((s) => s.ribbonTab);
  const set = useStore((s) => s.set);
  useStore((s) => s.active);
  useStore((s) => s.anchor);
  const zoom = useStore((s) => s.zoom);
  const autoFit = useStore((s) => s.autoFit);
  const style = A.styleAtActive();
  const sh = activeSheet();
  const textColor = useRef<HTMLInputElement>(null);
  const fillColor = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  void force;
  const FORMATS: [NumFmt, string][] = [
    ['general', t('fmt.general')], ['number', '0.00'], ['integer', '0'], ['thousands', '1,234.00'], ['percent', '%'],
    ['currency_inr', '₹ INR'], ['accounting_inr', '₹ ' + t('fmt.accounting')], ['currency_usd', '$ USD'], ['currency_eur', '€ EUR'],
    ['date', t('fmt.date')], ['datetime', t('fmt.datetime')], ['time', t('fmt.time')], ['scientific', t('fmt.scientific')], ['text', t('fmt.text')],
  ];
  const dlg = (d: Parameters<typeof A.openDialog>[0]) => () => A.openDialog(d);

  return (
    <div className="bg-surface shrink-0 border-b">
      <Tabs selectedKey={tab} onSelectionChange={(k) => set({ ribbonTab: k as typeof tab })} className="px-3 pt-1">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Ribbon" className="h-8">
            {(['home', 'insert', 'data', 'view', 'ai'] as const).map((k) => (
              <Tabs.Tab key={k} id={k} className="h-7 px-3.5 text-[13px]">
                <span className={'flex items-center gap-1.5 ' + (k === 'ai' ? 'text-ai font-semibold' : '')}>{k === 'ai' && <Sparkles size={13} />}{t('rb.' + k)}</span>
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      <div className="flex h-[52px] items-start gap-2.5 overflow-x-auto px-3 pt-1.5 pb-1" role="toolbar" aria-label={t('rb.' + tab)}>
        {tab === 'home' && (
          <>
            <Group>
              <Btn label={t('tb.undo') + ' (Ctrl+Z)'} onPress={A.undo} disabled={!wb.undoStack.length}><Undo2 size={16} /></Btn>
              <Btn label={t('tb.redo') + ' (Ctrl+Y)'} onPress={A.redo} disabled={!wb.redoStack.length}><Redo2 size={16} /></Btn>
            </Group>
            <Select aria-label={t('tb.numfmt')} selectedKey={style.fmt ?? 'general'} onSelectionChange={(k) => { A.applyStyle({ fmt: k === 'general' ? undefined : (k as NumFmt) }); focusGrid(); }} className="w-40 shrink-0">
              <Select.Trigger className="h-8 min-h-8 rounded-lg text-[13px]"><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox>{FORMATS.map(([k, l]) => <ListBox.Item key={k} id={k} textValue={l}>{l}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
            </Select>
            <Group>
              <Btn label={t('tb.bold') + ' (Ctrl+B)'} active={!!style.b} onPress={() => A.toggleStyle('b')}><Bold size={16} /></Btn>
              <Btn label={t('tb.italic') + ' (Ctrl+I)'} active={!!style.i} onPress={() => A.toggleStyle('i')}><Italic size={16} /></Btn>
              <Btn label={t('tb.underline') + ' (Ctrl+U)'} active={!!style.u} onPress={() => A.toggleStyle('u')}><Underline size={16} /></Btn>
            </Group>
            <Group>
              <Btn label={t('tb.textColor')} onPress={() => textColor.current?.click()}>
                <Type size={16} /><i className="absolute bottom-1 h-[3px] w-4 rounded-full" style={{ background: style.color ?? 'currentColor' }} />
              </Btn>
              <input ref={textColor} type="color" className="sr-only" tabIndex={-1} value={style.color ?? '#000000'} onChange={(e) => A.applyStyle({ color: e.target.value })} />
              <Btn label={t('tb.fillColor')} onPress={() => fillColor.current?.click()}>
                <PaintBucket size={16} /><i className="absolute bottom-1 h-[3px] w-4 rounded-full" style={{ background: style.bg ?? 'transparent', outline: style.bg ? 'none' : '1px dashed var(--muted)' }} />
              </Btn>
              <input ref={fillColor} type="color" className="sr-only" tabIndex={-1} value={style.bg ?? '#ffffff'} onChange={(e) => A.applyStyle({ bg: e.target.value })} />
              <Btn label={t('tb.clearFill')} onPress={() => A.applyStyle({ bg: undefined, color: undefined })}><Eraser size={16} /></Btn>
            </Group>
            <Group>
              <Menu label={t('tb.borders')} wide={false} icon={<Grid3x3 size={16} />} items={([['all', t('bd.all')], ['outer', t('bd.outer')], ['inner', t('bd.inner')], ['top', t('bd.top')], ['bottom', t('bd.bottom')], ['left', t('bd.left')], ['right', t('bd.right')], ['none', t('bd.none')]] as const).map(([id, label]) => ({ id, label, run: () => A.setBorderPreset(id) }))} />
              <Btn label={t('tb.merge')} active={sh.merges.some((m) => { const R = A.selectionNorm(); return m.r1 === R.r1 && m.c1 === R.c1 && m.r2 === R.r2 && m.c2 === R.c2; })} onPress={A.mergeSelection}><Merge size={16} /></Btn>
              <Btn label={t('tb.wrap')} active={!!style.wrap} onPress={() => { A.toggleStyle('wrap'); setTimeout(A.autoFitRowsNow, 0); }}><WrapText size={16} /></Btn>
            </Group>
            <Group>
              <Btn label={t('tb.alignLeft')} active={style.align === 'left'} onPress={() => A.applyStyle({ align: style.align === 'left' ? undefined : 'left' })}><AlignLeft size={16} /></Btn>
              <Btn label={t('tb.alignCenter')} active={style.align === 'center'} onPress={() => A.applyStyle({ align: style.align === 'center' ? undefined : 'center' })}><AlignCenter size={16} /></Btn>
              <Btn label={t('tb.alignRight')} active={style.align === 'right'} onPress={() => A.applyStyle({ align: style.align === 'right' ? undefined : 'right' })}><AlignRight size={16} /></Btn>
            </Group>
            <Group>
              <Btn label={t('tb.autosum') + ' (Alt+=)'} onPress={A.autoSum}><Sigma size={16} /></Btn>
              <Btn label={t('tb.sortAsc')} onPress={() => A.sortSelection(true)}><ArrowDownAZ size={16} /></Btn>
              <Btn label={t('tb.sortDesc')} onPress={() => A.sortSelection(false)}><ArrowUpZA size={16} /></Btn>
              <Btn label={t('tb.filter') + ' (Ctrl+Shift+L)'} active={!!sh.filter} onPress={A.toggleFilter}><Filter size={16} /></Btn>
            </Group>
            <Group>
              <Btn label={t('tb.findReplace') + ' (Ctrl+F)'} onPress={() => set({ dialog: { kind: 'find' } })}><Search size={16} /></Btn>
            </Group>
          </>
        )}

        {tab === 'insert' && (
          <>
            <Group>
              <Menu label={t('ins.chart')} icon={<ChartColumn size={16} />} items={[
                { id: 'column', label: t('chart.column'), icon: <ChartColumn size={15} />, run: () => A.createChartFromSelection('column') },
                { id: 'bar', label: t('chart.bar'), icon: <ChartBar size={15} />, run: () => A.createChartFromSelection('bar') },
                { id: 'line', label: t('chart.line'), icon: <ChartLine size={15} />, run: () => A.createChartFromSelection('line') },
                { id: 'area', label: t('chart.area'), icon: <ChartArea size={15} />, run: () => A.createChartFromSelection('area') },
                { id: 'pie', label: t('chart.pie'), icon: <ChartPie size={15} />, run: () => A.createChartFromSelection('pie') },
                'sep',
                { id: 'more', label: t('ins.chartMore'), icon: <Wrench size={15} />, run: dlg({ kind: 'chart' }) },
              ]} />
              <Btn wide label={t('ins.pivot')} onPress={dlg({ kind: 'pivot' })}><Table2 size={16} />{t('ins.pivot')}</Btn>
            </Group>
            <Group>
              <Btn wide label={t('ins.comment')} onPress={() => { const R = A.selectionNorm(); A.openDialog({ kind: 'comment', r: R.r1, c: R.c1 }); }}><MessageSquarePlus size={16} />{t('ins.comment')}</Btn>
              <Btn wide label={t('ins.names')} onPress={dlg({ kind: 'names' })}><BookText size={16} />{t('ins.names')}</Btn>
            </Group>
            <Group>
              <Btn wide label={t('ins.date') + ' (Ctrl+;)'} onPress={() => A.insertToday(false)}><CalendarDays size={16} />{t('ins.date')}</Btn>
              <Btn label={t('menu.insertRows', { n: 1 })} onPress={A.insertRowAbove}><Rows3 size={16} /></Btn>
              <Btn label={t('menu.insertCols', { n: 1 })} onPress={A.insertColLeft}><Columns3 size={16} /></Btn>
            </Group>
          </>
        )}

        {tab === 'data' && (
          <>
            <Group>
              <Btn label={t('tb.sortAsc')} onPress={() => A.sortSelection(true)}><ArrowDownAZ size={16} /></Btn>
              <Btn label={t('tb.sortDesc')} onPress={() => A.sortSelection(false)}><ArrowUpZA size={16} /></Btn>
              <Btn wide label={t('tb.filter')} active={!!sh.filter} onPress={A.toggleFilter}><Filter size={16} />{t('tb.filter')}</Btn>
              {sh.filter && Object.keys(sh.filter.allowed).length > 0 && <Btn wide label={t('flt.clearAll')} onPress={() => wb.clearFilterCriteria(sh)}>{t('flt.clearAll')}</Btn>}
            </Group>
            <Group>
              <Btn wide label={t('cf.title')} onPress={dlg({ kind: 'cf' })}><Palette size={16} />{t('cf.short')}</Btn>
              <Btn wide label={t('dv.title')} onPress={dlg({ kind: 'dv' })}><ListChecks size={16} />{t('dv.short')}</Btn>
            </Group>
            <Group>
              <Btn wide label={t('dd.title')} onPress={dlg({ kind: 'dedupe' })}><CopyMinus size={16} />{t('dd.short')}</Btn>
              <Btn wide label={t('ttc.title')} onPress={dlg({ kind: 'textcols' })}><SplitSquareHorizontal size={16} />{t('ttc.short')}</Btn>
              <Btn wide label={t('menu.fillDown') + ' (Ctrl+D)'} onPress={A.fillDown}>{t('menu.fillDown')}</Btn>
            </Group>
          </>
        )}

        {tab === 'view' && (
          <>
            <Group>
              <Btn label={t('tb.freeze')} active={!!(sh.freezeRows || sh.freezeCols)} onPress={A.toggleFreeze}><Snowflake size={16} /></Btn>
              <Btn label={t('view.gridlines')} active={!sh.hideGrid} onPress={() => wb.setGridlines(sh, !!sh.hideGrid)}><BrickWall size={16} /></Btn>
            </Group>
            <Group>
              <Btn label={t('view.zoomOut')} onPress={() => set({ zoom: Math.max(0.5, +(zoom - 0.1).toFixed(2)) })}><ZoomOut size={16} /></Btn>
              <button type="button" className="text-muted hover:text-foreground w-11 text-xs tabular-nums" onClick={() => set({ zoom: 1 })} title="Ctrl+0">{Math.round(zoom * 100)}%</button>
              <Btn label={t('view.zoomIn')} onPress={() => set({ zoom: Math.min(2, +(zoom + 0.1).toFixed(2)) })}><ZoomIn size={16} /></Btn>
            </Group>
            <Group>
              <Btn wide label={t('view.autofitCols')} onPress={() => A.autoFitCols(null)}><Columns3 size={16} />{t('view.autofitCols')}</Btn>
              <Btn wide label={t('view.autofitRows')} onPress={A.autoFitRowsNow}><Rows3 size={16} />{t('view.autofitRows')}</Btn>
              <Btn wide label={t('view.autofitAuto')} active={autoFit} onPress={() => set({ autoFit: !autoFit })}><ScanSearch size={16} />{t('view.autofitAuto')}</Btn>
            </Group>
            <Group>
              <Btn label={t('menu.hideRows')} onPress={() => A.hideSelected('row', true)}><EyeOff size={16} /></Btn>
              <Btn label={t('menu.hideCols')} onPress={() => A.hideSelected('col', true)}><Columns3 size={16} /></Btn>
              <Btn label={t('menu.unhide')} onPress={() => { A.hideSelected('row', false); A.hideSelected('col', false); }}><Eye size={16} /></Btn>
            </Group>
            <Group>
              <Btn wide label={t('page.title')} onPress={dlg({ kind: 'page' })}><Printer size={16} />{t('view.print')}</Btn>
            </Group>
          </>
        )}

        {tab === 'ai' && (
          <>
            <Group>
              <Btn wide label={t('ai.formulaShort')} onPress={dlg({ kind: 'formula', mode: 'create' })}><WandSparkles size={16} className="text-ai" />{t('ai.formulaCreator')}</Btn>
              <Btn wide label={t('ai.speakShort')} onPress={dlg({ kind: 'formula', mode: 'create', autoVoice: true })}><Mic size={16} className="text-ai" />{t('ai.speakFormula')}</Btn>
            </Group>
            <Group>
              <Btn wide label={t('ai.explainShort')} onPress={dlg({ kind: 'formula', mode: 'explain' })}><MessageSquare size={16} />{t('ai.explain')}</Btn>
              <Btn wide label={t('ai.fixShort')} onPress={() => runQuickAction('fixErrors')}><ShieldCheck size={16} />{t('ai.fixErrors')}</Btn>
            </Group>
            <Group>
              <Btn wide label={t('ai.insightsShort')} onPress={() => runQuickAction('insights')}><Lightbulb size={16} />{t('ai.insights')}</Btn>
              <Btn wide label={t('ai.cleanShort')} onPress={() => runQuickAction('clean')}><Eraser size={16} />{t('ai.clean')}</Btn>
              <Btn wide label={t('ai.chartShort')} onPress={() => runQuickAction('chart')}><ChartColumn size={16} />{t('ai.chartSuggest')}</Btn>
              <Btn wide label={t('ai.dashboardShort')} onPress={() => runQuickAction('dashboard')}><Sparkles size={16} />{t('ai.dashboard')}</Btn>
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
