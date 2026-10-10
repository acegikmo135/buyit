import { useEffect } from 'react';
import { useStore } from './store';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { FormulaBar } from './ui/FormulaBar';
import { GridCanvas } from './grid/GridCanvas';
import { SheetTabs } from './ui/SheetTabs';
import { AiPanel } from './ui/AiPanel';
import { HistoryPanel } from './ui/HistoryPanel';
import { SettingsDialog } from './ui/SettingsDialog';
import { installFx } from './actions';
import { setWindowTitle } from './platform';
import { toggleDictation, dictationToFocus, cancelDictation, useVoice } from './voice/dictation';

let installed = false;

export default function App() {
  const panel = useStore((s) => s.panel);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const theme = useStore((s) => s.theme);
  const lang = useStore((s) => s.lang);
  const toast = useStore((s) => s.toast);
  const file = useStore((s) => s.file);

  useEffect(() => {
    if (!installed) {
      installed = true;
      installFx();
    }
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        toggleDictation(dictationToFocus);
      } else if (e.key === 'Escape' && useVoice.getState().phase !== 'idle') cancelDictation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === 'gu' ? 'gu' : 'en';
  }, [lang]);

  useEffect(() => {
    void setWindowTitle(`${file.dirty ? '• ' : ''}${file.name} — AiSheet`);
  }, [file]);

  return (
    <div className="app">
      <TopBar />
      <Toolbar />
      <FormulaBar />
      <div className="main">
        <div className="grid-area">
          <GridCanvas />
        </div>
        {panel === 'ai' && <AiPanel />}
        {panel === 'history' && <HistoryPanel />}
      </div>
      <SheetTabs />
      {settingsOpen && <SettingsDialog />}
      {toast && <div className="toast" role="status">{toast.text}</div>}
    </div>
  );
}
