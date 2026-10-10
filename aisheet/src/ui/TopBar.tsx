import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, History, Moon, Settings, Sparkles, Sun, Languages } from 'lucide-react';
import { useStore } from '../store';
import * as A from '../actions';
import { useT } from '../i18n';
import { ContextMenu } from './ContextMenu';
import { focusGrid } from '../grid/GridCanvas';

export function TopBar() {
  const t = useT();
  const file = useStore((s) => s.file);
  const panel = useStore((s) => s.panel);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const set = useStore((s) => s.set);
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (useStore.getState().file.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <header className="topbar">
      <div className="brand"><FileSpreadsheet size={17} /><b>AiSheet</b></div>
      <button
        ref={btn}
        className="file-btn"
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos({ x: r.left, y: r.bottom + 4 });
          setMenu(true);
        }}
      >
        {t('file.menu')}
      </button>
      <div className="doc-name" title={file.path}>
        {file.name}
        {file.dirty && <span className="dirty" title={t('file.unsaved')}>●</span>}
      </div>
      <div className="spacer" />
      <button className="icon-btn" title={lang === 'en' ? 'ગુજરાતી' : 'English'} onClick={() => set({ lang: lang === 'en' ? 'gu' : 'en' })}>
        <Languages size={16} /><span className="lang-tag">{lang === 'en' ? 'EN' : 'ગુ'}</span>
      </button>
      <button className="icon-btn" title={t('gen.theme')} onClick={() => set({ theme: dark ? 'light' : 'dark' })}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      <button className={'icon-btn' + (panel === 'history' ? ' on' : '')} title={t('hist.title')} onClick={() => set({ panel: panel === 'history' ? null : 'history' })}><History size={16} /></button>
      <button className={'icon-btn ai' + (panel === 'ai' ? ' on' : '')} title={t('ai.title') + ' (Ctrl+K)'} onClick={() => set({ panel: panel === 'ai' ? null : 'ai' })}><Sparkles size={16} /></button>
      <button className="icon-btn" title={t('settings.title')} onClick={() => set({ settingsOpen: true })}><Settings size={16} /></button>
      {menu && (
        <ContextMenu
          x={pos.x}
          y={pos.y}
          onClose={() => { setMenu(false); focusGrid(); }}
          items={[
            { label: t('file.new'), hint: 'Ctrl+N', run: A.newWorkbook },
            { label: t('file.open'), hint: 'Ctrl+O', run: A.openFile },
            { sep: true },
            { label: t('file.save'), hint: 'Ctrl+S', run: () => void A.saveFile(false) },
            { label: t('file.saveAs'), hint: 'Ctrl+Shift+S', run: () => void A.saveFile(true) },
            { label: t('file.exportCsv'), run: () => void A.exportCsv() },
          ]}
        />
      )}
    </header>
  );
}
