import { create } from 'zustand';
import { useStore, providerModel } from '../store';
import { loadKey } from '../ai/agent';
import { getSecret } from '../platform';
import { startMic, type Mic } from './audio';
import { DeepgramLive } from './deepgram';
import { localClean, polish } from './clean';
import { tr } from '../i18n';

export type Phase = 'idle' | 'connecting' | 'listening' | 'finishing';

interface VoiceState {
  phase: Phase;
  seconds: number;
}
export const useVoice = create<VoiceState>(() => ({ phase: 'idle', seconds: 0 }));
const setV = (p: Partial<VoiceState>) => useVoice.setState(p);

export interface DictationTarget {
  read(): string;
  write(text: string): void;
}

let mic: Mic | null = null;
let dg: DeepgramLive | null = null;
let timer = 0;
let session = 0;
let startBase = '';

export async function deepgramKey(): Promise<string> {
  const cached = useStore.getState().deepgramKey;
  if (cached !== undefined) return cached;
  const k = await getSecret('deepgram');
  useStore.getState().set({ deepgramKey: k });
  return k;
}

const joinText = (base: string, add: string) => (!add ? base : base && !/\s$/.test(base) ? base + ' ' + add : base + add);

export async function startDictation(target: DictationTarget) {
  if (useVoice.getState().phase !== 'idle') return;
  const s = useStore.getState();
  const key = await deepgramKey();
  if (!key) {
    s.showToast(tr('voice.needKey'));
    s.set({ settingsOpen: true, settingsTab: 'voice' });
    return;
  }
  const my = ++session;
  const base = (startBase = target.read());
  setV({ phase: 'connecting', seconds: 0 });
  try {
    dg = new DeepgramLive(key, s.voice.lang, {
      onText: (finals, interim) => {
        if (my !== session) return;
        target.write(joinText(base, [finals, interim].filter(Boolean).join(' ')));
      },
      onError: (m) => {
        if (my !== session) return;
        useStore.getState().showToast(m);
        cancelDictation();
      },
    });
    mic = await startMic((pcm) => dg?.send(pcm));
    if (my !== session) {
      mic.stop();
      return;
    }
    const t0 = performance.now();
    timer = window.setInterval(() => setV({ seconds: (performance.now() - t0) / 1000 }), 250);
    setV({ phase: 'listening' });
  } catch (e) {
    cancelDictation();
    s.showToast(tr('voice.micError') + ' ' + ((e as Error).message ?? ''));
  }
}

export async function stopDictation(target: DictationTarget) {
  if (useVoice.getState().phase !== 'listening') return;
  const my = session;
  mic?.stop();
  mic = null;
  window.clearInterval(timer);
  setV({ phase: 'finishing' });
  try {
    const raw = (await dg?.finish()) ?? '';
    if (my !== session) return;
    let text = localClean(raw);
    const s = useStore.getState();
    if (text && s.voice.polish && s.providerId !== 'ollama') {
      const key = await loadKey(s.providerId);
      if (key) {
        try {
          text = await polish(text, { id: s.providerId, model: providerModel(s.providerId), baseUrl: s.baseUrls[s.providerId], apiKey: key, strictPrivacy: s.strictPrivacy });
        } catch {
          /* keep locally cleaned text */
        }
      }
    }
    if (my !== session) return;
    target.write(joinText(startBase, text));
  } finally {
    if (my === session) {
      dg = null;
      setV({ phase: 'idle', seconds: 0 });
    }
  }
}

export function cancelDictation() {
  session++;
  window.clearInterval(timer);
  mic?.stop();
  dg?.abort();
  mic = null;
  dg = null;
  setV({ phase: 'idle', seconds: 0 });
}
