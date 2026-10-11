import { en, type Key } from './en';
import { gu } from './gu';
import { useStore } from '../store';

export type Lang = 'en' | 'gu';
const dicts: Record<Lang, Record<string, string>> = { en, gu };

function fmt(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : s;
}

/** Non-hook translate (uses the current UI language). */
export function tr(key: string, vars?: Record<string, string | number>): string {
  const lang = useStore.getState().lang;
  return fmt(dicts[lang][key] ?? en[key as Key] ?? key, vars);
}

export function useT() {
  const lang = useStore((s) => s.lang);
  return (key: string, vars?: Record<string, string | number>) => fmt(dicts[lang][key] ?? en[key as Key] ?? key, vars);
}
