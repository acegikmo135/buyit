import { useEffect } from 'react';
import { Toast } from '@heroui/react';
import { useStore } from './store';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { FormulaBar } from './ui/FormulaBar';
import { GridCanvas } from './grid/GridCanvas';
import { SheetTabs } from './ui/SheetTabs';
import { ChatPanel } from './ui/ChatPanel';
import { HistoryPanel } from './ui/HistoryPanel';
import { SettingsModal } from './ui/SettingsModal';
import { useApplyTheme } from './ui/theme';
import { installFx, openPath } from './actions';
import { getLaunchFile, onNative, setWindowTitle, setDirty } from './platform';
import { startDictation, stopDictation, cancelDictation, useVoice, type DictationTarget } from './voice/dictation';
import { composerTarget } from './ui/Composer';

let installed = false;

const cellTarget: DictationTarget = {
  read: () => useStore.getState().editing?.text ?? '',
  write: (t) => {
    const s = useStore.getState();
    if (s.editing) s.set({ editing: { ...s.editing, text: t } });
  },
};

export default function App() {
  const panel = useStore((s) => s.panel);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const lang = useStore((s) => s.lang);
  const file = useStore((s) => s.file);
  useApplyTheme();

  useEffect(() => {
    if (installed) return;
    installed = true;
    installFx();
    // file opened from Explorer ("Open with" / double-click), drag-and-drop, or a second launch
    void getLaunchFile().then((p) => p && void openPath(p));
    onNative('open-file', (p) => void openPath(String(p)));
    onNative('toast', (m) => useStore.getState().showToast(String(m)));
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        const s = useStore.getState();
        const ph = useVoice.getState().phase;
        const target = s.editing ? cellTarget : composerTarget;
        if (!s.editing && s.panel !== 'ai') s.set({ panel: 'ai' });
        if (ph === 'idle') void startDictation(target);
        else if (ph === 'listening') void stopDictation(target);
      } else if (e.key === 'Escape' && useVoice.getState().phase !== 'idle') cancelDictation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'gu' ? 'gu' : 'en';
  }, [lang]);

  useEffect(() => {
    setWindowTitle(`${file.dirty ? '• ' : ''}${file.name} — AiSheet`);
    setDirty(file.dirty);
  }, [file]);

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <TopBar />
      <Toolbar />
      <FormulaBar />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <GridCanvas />
        </main>
        {panel === 'ai' && <ChatPanel />}
        {panel === 'history' && <HistoryPanel />}
      </div>
      <SheetTabs />
      {settingsOpen && <SettingsModal />}
      <Toast.Provider placement="bottom end" />
    </div>
  );
}
