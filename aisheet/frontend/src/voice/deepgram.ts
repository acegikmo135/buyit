// Deepgram live (WebSocket) speech-to-text, Nova-3. https://developers.deepgram.com/docs/live-streaming-audio

export type DgLang = 'en' | 'gu';

export interface DgHandlers {
  /** `finals` = committed text so far, `interim` = the in-progress phrase. */
  onText(finals: string, interim: string): void;
  onError(message: string): void;
}

export class DeepgramLive {
  private ws: WebSocket;
  private queue: ArrayBuffer[] = [];
  private open = false;
  private finals: string[] = [];
  private interim = '';
  private keepAlive = 0;
  private closed: Promise<void>;
  private resolveClosed!: () => void;
  private everOpened = false;
  private resolveFinalized!: () => void;
  private finalized = new Promise<void>((r) => (this.resolveFinalized = r));

  constructor(apiKey: string, lang: DgLang, private h: DgHandlers) {
    const q = new URLSearchParams({
      model: 'nova-3',
      language: lang,
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '600',
    });
    this.closed = new Promise((r) => (this.resolveClosed = r));
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${q}`, ['token', apiKey]);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.open = true;
      this.everOpened = true;
      for (const b of this.queue) this.ws.send(b);
      this.queue = [];
      this.keepAlive = window.setInterval(() => this.ws.readyState === 1 && this.ws.send(JSON.stringify({ type: 'KeepAlive' })), 7000);
    };
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'Results') {
          const t: string = m.channel?.alternatives?.[0]?.transcript ?? '';
          if (m.is_final) {
            if (t.trim()) this.finals.push(t.trim());
            this.interim = '';
          } else this.interim = t;
          this.h.onText(this.finals.join(' '), this.interim);
          if (m.from_finalize) this.resolveFinalized();
        } else if (m.type === 'Error' || m.err_code) {
          this.h.onError(m.description ?? m.err_msg ?? 'Deepgram error');
        }
      } catch {
        /* ignore non-JSON */
      }
    };
    this.ws.onerror = () => {
      /* details arrive via onclose */
    };
    this.ws.onclose = (e) => {
      window.clearInterval(this.keepAlive);
      this.open = false;
      if (!this.everOpened) this.h.onError('Could not connect to Deepgram. Check your API key and internet connection.');
      else if (e.code !== 1000 && e.code !== 1005 && !this.stopping) this.h.onError(`Connection closed (${e.code}${e.reason ? ': ' + e.reason : ''}).`);
      this.resolveClosed();
    };
  }

  private stopping = false;

  send(pcm: ArrayBuffer) {
    if (this.open && this.ws.readyState === 1) this.ws.send(pcm);
    else if (this.queue.length < 400) this.queue.push(pcm);
  }

  /** Flushes the last words, waits (briefly) for Deepgram's final results, then closes. */
  async finish(): Promise<string> {
    this.stopping = true;
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'Finalize' }));
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
    }
    await Promise.race([this.closed, this.finalized, new Promise((r) => setTimeout(r, 3500))]);
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    window.clearInterval(this.keepAlive);
    return [...this.finals, this.interim].filter(Boolean).join(' ').trim();
  }

  abort() {
    this.stopping = true;
    window.clearInterval(this.keepAlive);
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
