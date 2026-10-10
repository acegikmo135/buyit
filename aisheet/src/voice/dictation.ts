import { create } from 'zustand';
import { useStore, providerModel } from '../store';
import { loadKey } from '../ai/agent';
import { startRecording, type Recorder } from './audio';
import { preloadWhisper, transcribeWhisper } from './whisper';
import { startSystemSpeech, systemSpeechAvailable, type SystemSession } from './system';
import { localClean, polish } from './clean';
import { tr } from '../i18n';

export type Phase = 'idle' | 'recording' | 'transcribing' | 'loading';

interface VoiceState {
  phase: Phase;
  level: number;
  partial: string;
  progress: number | null;
  engine: 'system' | 'whisper' | null;
}

export const useVoice = create<VoiceState>(() => ({ phase: 'idle', level: 0, partial: '', progress: null, engine: null }));
const setV = (p: Partial<VoiceState>) => useVoice.setState(p);

let recorder: Recorder | null = null;
let sysSession: SystemSession | null = null;
let onText: ((t: string) => void) | null = null;
let systemBroken = false;
let whisperReady: string | null = null;
let cancelled = false;

const toast = (t: string) => useStore.getState().showToast(t);

function pickEngine(): 'system' | 'whisper' {
  const v = useStore.getState().voice;
  const lang = v.lang;
  if (v.engine === 'whisper') return 'whisper';
  if (v.engine === 'system') return systemSpeechAvailable() ? 'system' : 'whisper';
  // auto: system speech needs an explicit language; Whisper can auto-detect English/Gujarati/mixed
  return systemSpeechAvailable() && !systemBroken && lang !== 'auto' ? 'system' : 'whisper';
}

export async function startDictation(target: (text: string) => void) {
  if (useVoice.getState().phase !== 'idle') return;
  onText = target;
  cancelled = false;
  const v = useStore.getState().voice;
  const engine = pickEngine();
  try {
    if (engine === 'system') {
      setV({ phase: 'recording', engine, partial: '', level: 0 });
      sysSession = startSystemSpeech(
        v.lang === 'gu' ? 'gu' : 'en',
        (t) => setV({ partial: t }),
        (reason) => {
          // service unreachable in this webview -> fall back to on-device Whisper automatically
          systemBroken = true;
          sysSession?.cancel();
          sysSession = null;
          setV({ phase: 'idle', partial: '' });
          toast(tr('voice.fallback'));
          void startDictation(target);
          void reason;
        },
      );
    } else {
      setV({ phase: 'recording', engine, partial: '', level: 0 });
      recorder = await startRecording((level) => setV({ level }));
      // warm the model while the user speaks
      if (whisperReady !== v.model) {
        void preloadWhisper(v.model, (p) => setV({ progress: p })).then(() => (whisperReady = v.model)).catch(() => {});
      }
    }
  } catch (e) {
    setV({ phase: 'idle' });
    toast(tr('voice.micError') + ' ' + ((e as Error).message ?? ''));
  }
}

export async function stopDictation() {
  const st = useVoice.getState();
  if (st.phase !== 'recording') return;
  const settings = useStore.getState().voice;
  let raw = '';
  try {
    if (st.engine === 'system' && sysSession) {
      setV({ phase: 'transcribing' });
      raw = await sysSession.stop();
      sysSession = null;
    } else if (recorder) {
      setV({ phase: 'transcribing' });
      const audio = await recorder.stop();
      recorder = null;
      if (cancelled) return;
      let energy = 0;
      for (let i = 0; i < audio.length; i += 16) energy += audio[i] * audio[i];
      if (audio.length < 16000 * 0.4 || Math.sqrt(energy / (audio.length / 16)) < 0.004) raw = '';
      else {
        if (whisperReady !== settings.model) {
          setV({ phase: 'loading' });
          await preloadWhisper(settings.model, (p) => setV({ progress: p }));
          whisperReady = settings.model;
          setV({ phase: 'transcribing' });
        }
        raw = await transcribeWhisper(audio, settings.lang === 'en' ? 'english' : settings.lang === 'gu' ? 'gujarati' : null);
      }
    }
    if (cancelled) return;
    let text = localClean(raw);
    if (text && settings.polish) {
      const s = useStore.getState();
      const key = await loadKey(s.providerId);
      if (key || s.providerId === 'ollama') {
        try {
          text = await polish(text, { id: s.providerId, model: providerModel(s.providerId), baseUrl: s.baseUrls[s.providerId], apiKey: key });
        } catch {
          /* keep locally cleaned text */
        }
      }
    }
    if (text) onText?.(text);
    else toast(tr('voice.nothing'));
  } catch (e) {
    toast(tr('voice.error') + ' ' + (e as Error).message);
  } finally {
    setV({ phase: 'idle', level: 0, partial: '', progress: null });
  }
}

export function cancelDictation() {
  cancelled = true;
  recorder?.cancel();
  sysSession?.cancel();
  recorder = null;
  sysSession = null;
  setV({ phase: 'idle', level: 0, partial: '', progress: null });
}

export function toggleDictation(target: (text: string) => void) {
  const ph = useVoice.getState().phase;
  if (ph === 'idle') void startDictation(target);
  else if (ph === 'recording') void stopDictation();
}

/** Insert dictated text into whatever the user is working in: cell editor, formula bar, or the AI box. */
export function dictationToFocus(text: string) {
  const s = useStore.getState();
  if (s.editing) {
    const sep = s.editing.text && !/\s$/.test(s.editing.text) ? ' ' : '';
    s.set({ editing: { ...s.editing, text: s.editing.text + sep + text } });
    return;
  }
  const a = document.activeElement as HTMLElement | null;
  if (a && a.closest('.composer')) {
    s.set({ draft: (s.draft ? s.draft + ' ' : '') + text });
    return;
  }
  s.set({ panel: 'ai', draft: (s.draft ? s.draft + ' ' : '') + text });
}
