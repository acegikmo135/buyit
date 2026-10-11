import { useEffect } from 'react';
import { useStore } from '../store';

/** Resolves "system" to light/dark and applies it the way HeroUI expects (class + data-theme). */
export function useApplyTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      const root = document.documentElement;
      root.classList.toggle('dark', dark);
      root.classList.toggle('light', !dark);
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      window.dispatchEvent(new Event('aisheet-theme'));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export const isDark = () => document.documentElement.classList.contains('dark');
