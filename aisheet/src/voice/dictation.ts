import { create } from 'zustand';
import { useStore, providerModel } from '../store';
import { loadKey } from '../ai/agent';
import { startRecording, rms, type Recorder } from './audio';
import { transcribeNative, nativeAvailable } from './native';
import { transcribeCloud, cloudSupported } from './cloud';
import { startSystemSpeech, systemSpeechAvailable, type SystemSession } from './system';
import { useModels } from './models';
import { localClean, polish } from './clean';
import { tr } from '../i18n';

export type Phase = 'idle' | 'recording' | 'finalizing';
export type EngineKind = 'native' | 'cloud' | 'browser';

interface VoiceState {
  phase: Phase;
  engine: EngineKind | null;
  live: string; // live transcript while speaking
  seconds: number;
  status: string; // short status line ("Loading model…", "Polishing…")
}

export const useVoice = create<VoiceState>(() => ({ phase: 'idle', engine: null, live: '', seconds: 0, status: '' }));
const setV = (p: Partial<VoiceState>) => useVoice.setState(p);

let recorder: Recorder | null = null;
let sys: SystemSession | null = null;
let onText: ((t: string) => void) | null = null;
let timer = 0;
let liveTimer = 0;
let inflight = false;
let session = 0;

const log = (t: string, level: 'info' | 'error' | 'ok' = 'info') => useModels.getState().log(t, level);
const toast = (t: string) => useStore.getState().showToast(t);

function pickEngine(): EngineKind {
  const v = useStore.getState().voice;
  if (v.engine !== 'auto') return v.engine;
  if (nativeAvailable()) return 'native';
  return systemSpeechAvailable() ? 'browser' : 'cloud';
}

function stopTimers() {
  clearInterval(timer);
  clearInterval(liveTimer);
  timer = 0;
  liveTimer = 0;
}

export async function startDictation(target: (text: string) => void) {
  if (useVoice.getState().phase !== 'idle') return;
  const s = useStore.getState();
  const engine = pickEngine();
  const my = ++session;
  onText = target;

  if (engine === 'native') {
    await useModels.getState().init();
    await useModels.getState().refresh();
    const m = useModels.getState().models.find((x) => x.id === s.voice.model);
    if (!m?.installed) {
      toast(tr('voice.needModel'));
      s.set({ settingsOpen: true, settingsTab: 'voice' });
      return;
    }
  } else if (engine === 'cloud' && !cloudSupported(s.providerId)) {
    toast(tr('voice.cloudUnsupported'));
    s.set({ settingsOpen: true, settingsTab: 'voice' });
    return;
  }

  try {
    setV({ phase: 'recording', engine, live: '', seconds: 0, status: '' });
    if (engine === 'browser') {
      sys = startSystemSpeech(
        s.voice.lang === 'gu' ? 'gu' : 'en',
        (t) => setV({ live: t }),
        (reason) => {
          toast(tr('voice.browserFail') + ' ' + reason);
          cancelDictation();
        },
      );
      // the browser engine has no PCM; still show the waveform by capturing separately
      recorder = await startRecording().catch(() => null);
    } else {
      recorder = await startRecording();
    }
    if (my !== session) return;
    log(`recording started (${engine}, lang ${s.voice.lang})`);
    const t0 = performance.now();
    timer = window.setInterval(() => setV({ seconds: (performance.now() - t0) / 1000 }), 250);

    if (engine === 'native') {
      // live transcript: re-transcribe the latest window every ~1.4 s while the user speaks
      liveTimer = window.setInterval(async () => {
        if (inflight || !recorder || recorder.seconds() < 1.2) return;
        inflight = true;
        const mine = my;
        try {
          const win = recorder.snapshot(18);
          if (rms(win) < 0.004) return;
          const text = await transcribeNative(win, useStore.getState().voice.model, useStore.getState().voice.lang, true);
          if (mine === session && useVoice.getState().phase === 'recording') setV({ live: text });
        } catch (e) {
          log('live transcript: ' + String(e), 'error');
        } finally {
          inflight = false;
        }
      }, 1400);
    }
  } catch (e) {
    stopTimers();
    setV({ phase: 'idle', engine: null });
    toast(tr('voice.micError') + ' ' + ((e as Error).message ?? ''));
    log('microphone error: ' + String(e), 'error');
  }
}

export async function stopDictation() {
  const st = useVoice.getState();
  if (st.phase !== 'recording') return;
  const my = session;
  const settings = useStore.getState().voice;
  stopTimers();
  setV({ phase: 'finalizing', status: tr('voice.transcribing') });
  let raw = '';
  try {
    if (st.engine === 'browser') {
      raw = (await sys?.stop()) ?? '';
      sys = null;
      recorder?.cancel();
      recorder = null;
    } else {
      const audio = recorder!.stop();
      recorder = null;
      // wait for any in-flight live pass so the engine isn't hit twice at once
      for (let i = 0; i < 100 && inflight; i++) await new Promise((r) => setTimeout(r, 50));
      if (my !== session) return;
      if (audio.length < 16000 * 0.4 || rms(audio) < 0.004) raw = '';
      else if (st.engine === 'native') raw = await transcribeNative(audio, settings.model, settings.lang, false);
      else {
        const s = useStore.getState();
        raw = await transcribeCloud(audio, { id: s.providerId, apiKey: await loadKey(s.providerId), baseUrl: s.baseUrls[s.providerId] }, settings.lang);
      }
    }
    if (my !== session) return;
    let text = localClean(raw);
    if (text && settings.polish) {
      const s = useStore.getState();
      const key = await loadKey(s.providerId);
      if (key || s.providerId === 'ollama') {
        setV({ status: tr('voice.polishing') });
        try {
          text = await polish(text, { id: s.providerId, model: providerModel(s.providerId), baseUrl: s.baseUrls[s.providerId], apiKey: key });
        } catch (e) {
          log('smart clean-up skipped: ' + String(e), 'error');
        }
      }
    }
    if (my !== session) return;
    if (text) {
      onText?.(text);
      log(`inserted ${text.length} characters`, 'ok');
    } else toast(tr('voice.nothing'));
  } catch (e) {
    toast(tr('voice.error') + ' ' + String((e as Error).message ?? e));
    log('dictation failed: ' + String(e), 'error');
  } finally {
    if (my === session) setV({ phase: 'idle', engine: null, live: '', seconds: 0, status: '' });
  }
}

export function cancelDictation() {
  session++;
  stopTimers();
  recorder?.cancel();
  sys?.cancel();
  recorder = null;
  sys = null;
  inflight = false;
  setV({ phase: 'idle', engine: null, live: '', seconds: 0, status: '' });
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
  s.set({ panel: 'ai', draft: (s.draft ? s.draft + ' ' : '') + text });
}
