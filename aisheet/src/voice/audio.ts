// Microphone capture. Produces 16 kHz mono Float32 audio (what Whisper expects) and a live input level.

export interface Recorder {
  stop(): Promise<Float32Array>;
  cancel(): void;
}

export async function startRecording(onLevel: (v: number) => void): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const actx = new AudioContext();
  const src = actx.createMediaStreamSource(stream);
  const analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
    onLevel(Math.min(1, peak / 64));
    raf = requestAnimationFrame(tick);
  };
  tick();

  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);

  const cleanup = () => {
    cancelAnimationFrame(raf);
    onLevel(0);
    stream.getTracks().forEach((t) => t.stop());
    void actx.close();
  };

  return {
    cancel: () => {
      if (rec.state !== 'inactive') rec.stop();
      cleanup();
    },
    stop: () =>
      new Promise<Float32Array>((resolve, reject) => {
        rec.onstop = async () => {
          cleanup();
          try {
            resolve(await decodeTo16k(new Blob(chunks, { type: rec.mimeType })));
          } catch (e) {
            reject(e);
          }
        };
        rec.stop();
      }),
  };
}

async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const arr = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(arr);
  void ctx.close();
  const frames = Math.ceil(decoded.duration * 16000);
  const off = new OfflineAudioContext(1, Math.max(1, frames), 16000);
  const s = off.createBufferSource();
  s.buffer = decoded;
  s.connect(off.destination);
  s.start();
  const out = await off.startRendering();
  return out.getChannelData(0);
}
