// Browser / OS speech recognition (Web Speech API). Free and streaming where the webview supports it.

interface SR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const Ctor = (): (new () => SR) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const systemSpeechAvailable = () => !!Ctor();

export interface SystemSession {
  stop(): Promise<string>;
  cancel(): void;
}

/** Starts recognition. Rejects early (via onFail) when the service is unreachable so the caller can fall back to Whisper. */
export function startSystemSpeech(lang: 'en' | 'gu', onPartial: (t: string) => void, onFail: (reason: string) => void): SystemSession {
  const rec = new (Ctor()!)();
  rec.lang = lang === 'gu' ? 'gu-IN' : 'en-IN';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let failed = false;
  let endResolve: ((t: string) => void) | null = null;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    onPartial((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    failed = true;
    onFail(e.error);
  };
  rec.onend = () => endResolve?.(failed ? '' : finalText.trim());
  rec.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        endResolve = resolve;
        rec.stop();
        setTimeout(() => resolve(finalText.trim()), 2500);
      }),
    cancel: () => rec.abort(),
  };
}
