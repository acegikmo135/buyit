// Quick AI actions: one-click prompts routed through the normal assistant pipeline.
import { useStore } from '../store';
import { sendPrompt } from './agent';

const PROMPTS: Record<string, string> = {
  fixErrors: 'Scan every sheet for formula errors (#REF!, #NAME?, #DIV/0!, #VALUE!, #N/A, #CIRC!) and wrong or inconsistent formulas. Explain each problem briefly and fix them.',
  insights: 'Analyze the data in this workbook. Give me the 4-6 most important insights (totals, trends, outliers, top/bottom performers) with the actual numbers. Do not change the sheet unless I ask.',
  clean: 'Clean the data on the active sheet: trim stray spaces, make text casing consistent, remove exact duplicate rows, fix obvious typos in categories, and make number/date formats consistent. Show what you changed.',
  chart: 'Look at my data and create the 1-3 most useful charts for it (pick sensible chart types, titles and ranges).',
  dashboard: 'Build a "Dashboard" sheet for this workbook: key totals as live formulas at the top, a few summary tables (by category/period/person as appropriate) using formulas that read from the data sheets, and 2-3 charts. Make it neat and well formatted.',
};

export function runQuickAction(id: keyof typeof PROMPTS | string) {
  const s = useStore.getState();
  s.set({ panel: 'ai' });
  void sendPrompt(PROMPTS[id] ?? id);
}
