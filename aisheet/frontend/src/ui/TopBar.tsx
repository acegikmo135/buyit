import { ChevronDown, History, Languages, Moon, Settings, Sparkles, Sun } from 'lucide-react';
import { Button, Dropdown, Kbd, Separator } from '@heroui/react';
import { useStore } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';
import { Logo } from './Logo';
import { Tip } from './Tip';
import { focusGrid } from '../grid/GridCanvas';
import { isDark } from './theme';

export function TopBar() {
  const t = useT();
  const file = useStore((s) => s.file);
  const panel = useStore((s) => s.panel);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const set = useStore((s) => s.set);
  const dark = theme === 'dark' || (theme === 'system' && isDark());

  const act: Record<string, () => void> = {
    new: () => void A.newWorkbook(),
    open: () => void A.openFile(),
    save: () => void A.saveFile(false),
    saveAs: () => void A.saveFile(true),
    csv: () => void A.exportCsv(),
  };

  return (
    <header className="bg-surface flex h-12 shrink-0 items-center gap-1 border-b px-3">
      <div className="mr-1 flex items-center gap-2 pr-1">
        <Logo size={24} />
        <span className="text-[15px] font-semibold tracking-tight">AiSheet</span>
      </div>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Dropdown onOpenChange={(o) => !o && focusGrid()}>
        <Button size="sm" variant="ghost" className="gap-1 px-2.5">
          {t('file.menu')} <ChevronDown size={13} className="text-muted" />
        </Button>
        <Dropdown.Popover className="min-w-60">
          <Dropdown.Menu onAction={(k) => act[String(k)]?.()}>
            <Dropdown.Item id="new" textValue={t('file.new')}><Row l={t('file.new')} k="Ctrl+N" /></Dropdown.Item>
            <Dropdown.Item id="open" textValue={t('file.open')}><Row l={t('file.open')} k="Ctrl+O" /></Dropdown.Item>
            <Dropdown.Item id="save" textValue={t('file.save')}><Row l={t('file.save')} k="Ctrl+S" /></Dropdown.Item>
            <Dropdown.Item id="saveAs" textValue={t('file.saveAs')}><Row l={t('file.saveAs')} k="Ctrl+Shift+S" /></Dropdown.Item>
            <Dropdown.Item id="csv" textValue={t('file.exportCsv')}><Row l={t('file.exportCsv')} /></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <div className="text-muted mx-auto flex max-w-[40%] items-center gap-2 truncate text-sm" title={file.path}>
        <span className="text-foreground truncate font-medium">{file.name}</span>
        {file.dirty && <span className="bg-accent size-1.5 shrink-0 rounded-full" title={t('file.unsaved')} />}
      </div>

      <Tip label={lang === 'en' ? 'ગુજરાતી' : 'English'}>
        <Button size="sm" variant="ghost" className="gap-1.5 px-2.5" onPress={() => set({ lang: lang === 'en' ? 'gu' : 'en' })}>
          <Languages size={16} /> <span className="w-5 text-xs font-semibold">{lang === 'en' ? 'EN' : 'ગુ'}</span>
        </Button>
      </Tip>
      <Tip label={t('gen.theme')}>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('gen.theme')} onPress={() => set({ theme: dark ? 'light' : 'dark' })}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </Tip>
      <Tip label={t('hist.title')}>
        <Button isIconOnly size="sm" variant={panel === 'history' ? 'secondary' : 'ghost'} aria-label={t('hist.title')} onPress={() => set({ panel: panel === 'history' ? null : 'history' })}>
          <History size={16} />
        </Button>
      </Tip>
      <Tip label={t('ai.title') + ' (Ctrl+K)'}>
        <Button size="sm" variant={panel === 'ai' ? 'primary' : 'secondary'} className="gap-1.5 px-3" aria-label={t('ai.title')} onPress={() => set({ panel: panel === 'ai' ? null : 'ai' })}>
          <Sparkles size={15} /> <span className="hidden md:inline">{t('ai.short')}</span>
        </Button>
      </Tip>
      <Tip label={t('settings.title')}>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('settings.title')} onPress={() => set({ settingsOpen: true })}>
          <Settings size={16} />
        </Button>
      </Tip>
    </header>
  );
}

function Row({ l, k }: { l: string; k?: string }) {
  return (
    <span className="flex w-full items-center justify-between gap-8">
      <span>{l}</span>
      {k && <Kbd className="text-[11px]">{k}</Kbd>}
    </span>
  );
}
