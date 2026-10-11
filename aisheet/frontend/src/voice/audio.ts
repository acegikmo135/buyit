// Microphone → 16 kHz mono 16-bit PCM chunks (what Deepgram "linear16" expects) + live level history for the waveform.

export const WAVE_BARS = 48;
/** Newest sample last. Mutated in place; the waveform canvas reads it every frame (no React renders). */
export const waveLevels = new Float32Array(WAVE_BARS);

export interface Mic {
  stop(): void;
}

export async function startMic(onChunk: (pcm: ArrayBuffer) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const actx = new AudioContext({ sampleRate: 16000 });
  if (actx.state === 'suspended') await actx.resume();
  const src = actx.createMediaStreamSource(stream);
  const proc = actx.createScriptProcessor(2048, 1, 1);
  const mute = actx.createGain();
  mute.gain.value = 0; // keep the node graph running without playing the mic back
  src.connect(proc);
  proc.connect(mute);
  mute.connect(actx.destination);

  waveLevels.fill(0);
  let smooth = 0;
  let lastPush = 0;
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(d.length);
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.max(-1, Math.min(1, d[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      sum += v * v;
    }
    onChunk(pcm.buffer);
    const lvl = Math.min(1, Math.pow(Math.sqrt(sum / d.length) * 9, 0.7));
    smooth = lvl > smooth ? lvl : smooth * 0.8 + lvl * 0.2;
    const now = performance.now();
    if (now - lastPush > 40) {
      lastPush = now;
      waveLevels.copyWithin(0, 1);
      waveLevels[WAVE_BARS - 1] = smooth;
    }
  };

  return {
    stop() {
      proc.onaudioprocess = null;
      try {
        proc.disconnect();
        src.disconnect();
      } catch {
        /* already disconnected */
      }
      stream.getTracks().forEach((t) => t.stop());
      void actx.close();
      waveLevels.fill(0);
    },
  };
}
