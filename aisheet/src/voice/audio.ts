// Microphone capture straight to 16 kHz mono Float32 (what whisper.cpp wants) + a live level history for the waveform.

export const WAVE_BARS = 56;
/** Newest sample last. Mutated in place by the recorder; the canvas reads it every frame (no React renders). */
export const waveLevels = new Float32Array(WAVE_BARS);

export interface Recorder {
  /** Audio so far; `maxSeconds` limits to the most recent window (used for the live transcript). */
  snapshot(maxSeconds?: number): Float32Array;
  seconds(): number;
  stop(): Float32Array;
  cancel(): void;
}

const MAX_SECONDS = 600;

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const actx = new AudioContext({ sampleRate: 16000 });
  const src = actx.createMediaStreamSource(stream);
  const proc = actx.createScriptProcessor(2048, 1, 1);
  const mute = actx.createGain();
  mute.gain.value = 0; // keep the graph alive without echoing the mic to the speakers
  src.connect(proc);
  proc.connect(mute);
  mute.connect(actx.destination);

  const chunks: Float32Array[] = [];
  let total = 0;
  let smooth = 0;
  waveLevels.fill(0);
  let lastPush = 0;

  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    if (total < MAX_SECONDS * 16000) {
      chunks.push(new Float32Array(d));
      total += d.length;
    }
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / d.length);
    const lvl = Math.min(1, Math.pow(rms * 9, 0.7));
    smooth = lvl > smooth ? lvl : smooth * 0.82 + lvl * 0.18;
    const now = performance.now();
    if (now - lastPush > 45) {
      lastPush = now;
      waveLevels.copyWithin(0, 1);
      waveLevels[WAVE_BARS - 1] = smooth;
    }
  };

  const concat = (maxSamples?: number) => {
    let start = 0;
    if (maxSamples && total > maxSamples) start = total - maxSamples;
    const out = new Float32Array(total - start);
    let pos = 0;
    let off = 0;
    for (const c of chunks) {
      if (off + c.length > start) {
        const s = Math.max(0, start - off);
        out.set(c.subarray(s), pos);
        pos += c.length - s;
      }
      off += c.length;
    }
    return out;
  };

  const close = () => {
    proc.onaudioprocess = null;
    try {
      proc.disconnect();
      src.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    void actx.close();
    waveLevels.fill(0);
  };

  return {
    snapshot: (s) => concat(s ? s * 16000 : undefined),
    seconds: () => total / 16000,
    stop: () => {
      const out = concat();
      close();
      chunks.length = 0;
      return out;
    },
    cancel: () => {
      close();
      chunks.length = 0;
    },
  };
}

export function rms(a: Float32Array): number {
  let e = 0;
  for (let i = 0; i < a.length; i += 8) e += a[i] * a[i];
  return Math.sqrt(e / Math.max(1, a.length / 8));
}

/** 16-bit PCM WAV, used for cloud transcription uploads. */
export function toWav(pcm: Float32Array, rate = 16000): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}
