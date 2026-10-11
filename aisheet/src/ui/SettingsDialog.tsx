import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, RefreshCw, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useStore, providerModel } from '../store';
import { PROVIDERS, chat, listModels, providerById, type ProviderId } from '../ai/providers';
import { setSecret, isTauri } from '../platform';
import { loadKey } from '../ai/agent';
import { useT } from '../i18n';
import { cloudSupported } from '../voice/cloud';
import { ModelManager } from './ModelManager';
import type { Category } from '../ai/executor';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="bg-muted inline-flex rounded-lg p-[3px]">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={cn('rounded-md px-3 py-1 text-sm transition', value === k ? 'bg-background text-foreground font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog() {
  const t = useT();
  const s = useStore();
  const def = providerById(s.providerId);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>(def.models);
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; text?: string }>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    setModels(def.models);
    setStatus({ kind: 'idle' });
    loadKey(s.providerId).then((k) => alive && setKey(k));
    return () => {
      alive = false;
    };
  }, [s.providerId, def.models]);

  const cfg = () => ({ id: s.providerId, model: providerModel(s.providerId), baseUrl: s.baseUrls[s.providerId], apiKey: key });
  const saveKey = async () => {
    await setSecret('key:' + s.providerId, key);
    s.set({ keys: { ...s.keys, [s.providerId]: key } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  const run = async (fn: () => Promise<string>) => {
    setStatus({ kind: 'busy' });
    try {
      await saveKey();
      setStatus({ kind: 'ok', text: await fn() });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    }
  };
  const fetchModels = () =>
    run(async () => {
      const list = await listModels({ id: s.providerId, baseUrl: s.baseUrls[s.providerId], apiKey: key });
      setModels(list);
      return t('set.modelsLoaded', { n: list.length });
    });
  const test = () => run(async () => t('set.testOk') + ' ' + (await chat(cfg(), 'Reply with JSON {"message":"ok","actions":[]}', [{ role: 'user', content: 'ping' }])).slice(0, 60));

  const perms = s.permissions;
  const setPerm = (p: Partial<typeof perms>) => s.set({ permissions: { ...perms, ...p } });
  const cats: Category[] = ['write', 'format', 'structure', 'sheets', 'delete'];
  const setVoice = (p: Partial<typeof s.voice>) => s.set({ voice: { ...s.voice, ...p } });

  return (
    <Dialog open onOpenChange={(o) => !o && s.set({ settingsOpen: false })}>
      <DialogContent className="flex h-[min(720px,90vh)] flex-col gap-3 p-0 sm:max-w-3xl" aria-describedby={undefined}>
        <div className="px-6 pt-5">
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('settings.title')}</DialogDescription>
        </div>
        <Tabs value={s.settingsTab} onValueChange={(v) => s.set({ settingsTab: v as typeof s.settingsTab })} className="min-h-0 flex-1 gap-0">
          <div className="px-6">
            <TabsList>
              {(['ai', 'perm', 'voice', 'general'] as const).map((k) => (
                <TabsTrigger key={k} value={k}>{t('settings.tab.' + k)}</TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <TabsContent value="ai" className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label>{t('set.provider')}</Label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {PROVIDERS.map((p) => (
                    <Button key={p.id} variant={p.id === s.providerId ? 'default' : 'outline'} size="sm" className="justify-start" onClick={() => s.set({ providerId: p.id as ProviderId })}>
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              {def.editableUrl && (
                <div className="flex flex-col gap-2">
                  <Label>{t('set.baseUrl')}</Label>
                  <Input value={s.baseUrls[s.providerId] ?? def.baseUrl} onChange={(e) => s.set({ baseUrls: { ...s.baseUrls, [s.providerId]: e.target.value } })} spellCheck={false} />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label>{t('set.apiKey')} {def.keyOptional && <span className="text-muted-foreground font-normal">({t('set.optional')})</span>}</Label>
                <div className="flex gap-2">
                  <Input type={show ? 'text' : 'password'} value={key} placeholder={def.keyHint} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" />
                  <Button variant="outline" size="icon" onClick={() => setShow(!show)} aria-label="toggle">{show ? <EyeOff /> : <Eye />}</Button>
                  <Button variant="outline" onClick={saveKey}>{saved ? <><Check />{t('set.saved')}</> : t('set.save')}</Button>
                </div>
                <p className="text-muted-foreground text-xs">{isTauri() ? t('set.keyHintNative') : t('set.keyHintWeb')}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('set.model')}</Label>
                <div className="flex gap-2">
                  <Input list="model-list" value={providerModel(s.providerId)} onChange={(e) => s.set({ models: { ...s.models, [s.providerId]: e.target.value } })} spellCheck={false} />
                  <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
                  <Button variant="outline" onClick={fetchModels}><RefreshCw />{t('set.fetch')}</Button>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                {status.kind !== 'idle' && (
                  <span className={cn('mr-auto flex items-center gap-1.5 text-xs', status.kind === 'ok' && 'text-emerald-600', status.kind === 'err' && 'text-destructive')}>
                    {status.kind === 'busy' && <Loader2 className="size-3.5 animate-spin" />}
                    {status.text}
                  </span>
                )}
                <Button onClick={test} disabled={status.kind === 'busy'}><Zap />{t('set.test')}</Button>
              </div>
            </TabsContent>

            <TabsContent value="perm" className="flex flex-col">
              <Row title={t('perm.title')} hint={t('perm.desc.' + perms.mode)}>
                <Seg value={perms.mode} onChange={(m) => setPerm({ mode: m })} options={[['ask', t('perm.ask')], ['auto', t('perm.auto')], ['readonly', t('perm.readonly')]]} />
              </Row>
              <div className="text-muted-foreground mt-3 text-xs font-medium tracking-wide uppercase">{t('perm.allowed')}</div>
              {cats.map((c) => (
                <Row key={c} title={t('cat.' + c)} hint={t('cat.' + c + '.d')}>
                  <Switch checked={perms.allow[c]} onCheckedChange={(v) => setPerm({ allow: { ...perms.allow, [c]: v } })} />
                </Row>
              ))}
              <Row title={t('perm.selOnly')} hint={t('perm.selOnly.d')}><Switch checked={perms.selectionOnly} onCheckedChange={(v) => setPerm({ selectionOnly: v })} /></Row>
              <Row title={t('perm.confirmDestructive')} hint={t('perm.confirmDestructive.d')}><Switch checked={perms.confirmDestructive} onCheckedChange={(v) => setPerm({ confirmDestructive: v })} /></Row>
            </TabsContent>

            <TabsContent value="voice" className="flex flex-col gap-4">
              <div className="flex flex-col">
                <Row title={t('voice.lang')} hint={t('voice.lang.d')}>
                  <Seg value={s.voice.lang} onChange={(l) => setVoice({ lang: l })} options={[['auto', t('voice.auto')], ['en', 'English'], ['gu', 'ગુજરાતી']]} />
                </Row>
                <Row title={t('voice.engine')} hint={t('voice.engine.d')}>
                  <Select value={s.voice.engine} onValueChange={(v) => setVoice({ engine: v as typeof s.voice.engine })}>
                    <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t('voice.engine.auto')}</SelectItem>
                      <SelectItem value="native">{t('voice.engine.native')}</SelectItem>
                      <SelectItem value="cloud" disabled={!cloudSupported(s.providerId)}>{t('voice.engine.cloud')}</SelectItem>
                      {!isTauri() && <SelectItem value="browser">{t('voice.engine.browser')}</SelectItem>}
                    </SelectContent>
                  </Select>
                </Row>
                <Row title={t('voice.polish')} hint={t('voice.polish.d')}><Switch checked={s.voice.polish} onCheckedChange={(v) => setVoice({ polish: v })} /></Row>
              </div>
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{t('voice.models')}</div>
              <ModelManager />
            </TabsContent>

            <TabsContent value="general" className="flex flex-col">
              <Row title={t('gen.lang')}><Seg value={s.lang} onChange={(l) => s.set({ lang: l })} options={[['en', 'English'], ['gu', 'ગુજરાતી']]} /></Row>
              <Row title={t('gen.aiLang')}><Seg value={s.aiLang} onChange={(l) => s.set({ aiLang: l })} options={[['auto', t('gen.auto')], ['en', 'English'], ['gu', 'ગુજરાતી']]} /></Row>
              <Row title={t('gen.theme')}><Seg value={s.theme} onChange={(l) => s.set({ theme: l })} options={[['system', t('gen.theme.system')], ['light', t('gen.theme.light')], ['dark', t('gen.theme.dark')]]} /></Row>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
