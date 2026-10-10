import { Loader2, Mic, Square } from 'lucide-react';
import { useVoice, toggleDictation, cancelDictation } from '../voice/dictation';
import { useStore } from '../store';
import { useT } from '../i18n';

/** Mic button + live status strip. `onText` receives the cleaned transcript. */
export function MicButton({ onText }: { onText: (t: string) => void }) {
  const t = useT();
  const { phase, level } = useVoice();
  const busy = phase === 'transcribing' || phase === 'loading';
  return (
    <button
      className={'mic' + (phase === 'recording' ? ' rec' : '')}
      title={(phase === 'recording' ? t('voice.stop') : t('voice.start')) + ' (Ctrl+Shift+Space)'}
      aria-label={t('voice.start')}
      disabled={busy}
      onClick={() => toggleDictation(onText)}
      style={phase === 'recording' ? ({ ['--lvl' as string]: level } as React.CSSProperties) : undefined}
    >
      {busy ? <Loader2 size={16} className="spin" /> : phase === 'recording' ? <Square size={13} fill="currentColor" /> : <Mic size={16} />}
    </button>
  );
}

export function VoiceStrip() {
  const t = useT();
  const { phase, partial, progress, engine } = useVoice();
  const voice = useStore((s) => s.voice);
  if (phase === 'idle') return null;
  return (
    <div className={'voice-strip ' + phase}>
      <span className="pulse" />
      <span className="voice-text">
        {phase === 'recording' && (partial || t('voice.listening', { lang: voice.lang === 'gu' ? 'ગુજરાતી' : voice.lang === 'en' ? 'English' : 'English · ગુજરાતી' }))}
        {phase === 'loading' && `${t('voice.loadingModel')} ${progress != null ? Math.round(progress * 100) + '%' : ''}`}
        {phase === 'transcribing' && t('voice.transcribing')}
      </span>
      {phase === 'recording' && <span className="eng">{engine === 'whisper' ? 'Whisper' : 'System'}</span>}
      <button className="mini" onClick={cancelDictation}>{t('voice.cancel')}</button>
    </div>
  );
}
