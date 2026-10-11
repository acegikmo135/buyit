import { useEffect, useRef } from 'react';
import { waveLevels, WAVE_BARS } from '../voice/audio';

/** Live microphone waveform. Draws on a canvas every frame; costs no React renders. */
export function WaveBars({ width = 132, height = 28, active }: { width?: number; height?: number; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    let raf = 0;
    let t = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const color = getComputedStyle(c).getPropertyValue('--accent').trim() || '#6366f1';
      const gap = width / WAVE_BARS;
      t += 0.07;
      for (let i = 0; i < WAVE_BARS; i++) {
        const lvl = active ? waveLevels[i] : 0.06 + 0.04 * Math.sin(t + i * 0.5);
        const h = Math.max(3, lvl * (height - 2));
        ctx.globalAlpha = 0.3 + 0.7 * (i / WAVE_BARS);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(i * gap + gap * 0.2, (height - h) / 2, gap * 0.6, h, gap * 0.3);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, width, height]);
  return <canvas ref={ref} style={{ width, height }} aria-hidden />;
}
