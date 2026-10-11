import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { Button, Chip, Input, ListBox, Modal, Select, Switch, Tabs } from '@heroui/react';
import { useStore, providerModel } from '../store';
import { PROVIDERS, chat, listModels, providerById, type ProviderId } from '../ai/providers';
import { setSecret, isNative, httpFetch } from '../platform';
import { loadKey } from '../ai/agent';
import { deepgramKey } from '../voice/dictation';
import { useT } from '../i18n';
import type { Category } from '../ai/executor';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-muted mt-0.5 text-xs leading-5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const Section = ({ children }: { children: React.ReactNode }) => <div className="divide-border divide-y">{children}</div>;
const Label = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 text-sm font-medium">{children}</div>;

function Pick<T extends string>({ value, onChange, options, label, width = 'w-48' }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string; width?: string }) {
  return (
    <Select aria-label={label} selectedKey={value} onSelectionChange={(k) => onChange(k as T)} className={width}>
      <Select.Trigger className="h-9 text-sm"><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([k, l]) => (
            <ListBox.Item key={k} id={k} textValue={l}>{l}<ListBox.ItemIndicator /></ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'err'; text?: string };

function StatusLine({ s }: { s: Status }) {
  if (s.kind === 'idle') return null;
  return (
    <span className={'flex items-center gap-1.5 text-xs ' + (s.kind === 'ok' ? 'text-success' : s.kind === 'err' ? 'text-danger' : 'text-muted')}>
      {s.kind === 'busy' && <Loader2 size={13} className="animate-spin" />}
      {s.text}
    </span>
  );
}

export function SettingsModal() {
  const t = useT();
  const s = useStore();
  const def = providerById(s.providerId);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[]>(def.models);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [dgKey, setDgKey] = useState('');
  const [dgShow, setDgShow] = useState(false);
  const [dgStatus, setDgStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    setModels(def.models);
    setStatus({ kind: 'idle' });
    loadKey(s.providerId).then((k) => alive && setKey(k));
    return () => {
      alive = false;
    };
  }, [s.providerId, def.models]);

  useEffect(() => {
    let alive = true;
    deepgramKey().then((k) => alive && setDgKey(k));
    return () => {
      alive = false;
    };
  }, []);

  const cfg = () => ({ id: s.providerId, model: providerModel(s.providerId), baseUrl: s.baseUrls[s.providerId], apiKey: key, strictPrivacy: s.strictPrivacy });
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
      const m = (e as Error).message;
      setStatus({ kind: 'err', text: m === 'PRIVACY_NO_ENDPOINT' ? t('err.privacy') : m });
    }
  };
  const fetchModels = () => run(async () => {
    const list = await listModels({ id: s.providerId, baseUrl: s.baseUrls[s.providerId], apiKey: key });
    setModels(list);
    return t('set.modelsLoaded', { n: list.length });
  });
  const test = () => run(async () => t('set.testOk') + ' ' + (await chat(cfg(), 'Reply with the single word: ok', [{ role: 'user', content: 'ping' }])).slice(0, 40));

  const saveDg = async () => {
    await setSecret('deepgram', dgKey.trim());
    s.set({ deepgramKey: dgKey.trim() });
    setDgStatus({ kind: 'busy', text: t('set.testing') });
    if (!dgKey.trim()) return setDgStatus({ kind: 'idle' });
    try {
      const res = await httpFetch('https://api.deepgram.com/v1/auth/token', { headers: { Authorization: `Token ${dgKey.trim()}` } });
      setDgStatus(res.ok ? { kind: 'ok', text: t('voice.keyOk') } : { kind: 'err', text: res.status === 401 || res.status === 403 ? t('voice.keyBad') : `HTTP ${res.status}` });
    } catch (e) {
      setDgStatus({ kind: 'err', text: (e as Error).message });
    }
  };

  const perms = s.permissions;
  const setPerm = (p: Partial<typeof perms>) => s.set({ permissions: { ...perms, ...p } });
  const cats: Category[] = ['write', 'format', 'structure', 'sheets', 'delete'];

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && s.set({ settingsOpen: false })}>
      <Modal.Container size="lg">
        <Modal.Dialog className="flex max-h-[88vh] flex-col sm:max-w-[760px]" aria-label={t('settings.title')}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="text-lg font-semibold tracking-tight">{t('settings.title')}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="min-h-0 overflow-y-auto p-1">
            <Tabs selectedKey={s.settingsTab} onSelectionChange={(k) => s.set({ settingsTab: k as typeof s.settingsTab })}>
              <Tabs.ListContainer>
                <Tabs.List aria-label="Settings sections">
                  {(['ai', 'voice', 'perm', 'general'] as const).map((k) => (
                    <Tabs.Tab key={k} id={k}>{t('settings.tab.' + k)}<Tabs.Indicator /></Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel id="ai" className="flex flex-col gap-5 pt-4">
                <div>
                  <Label>{t('set.provider')}</Label>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {PROVIDERS.map((p) => (
                      <Button key={p.id} size="sm" variant={p.id === s.providerId ? 'primary' : 'tertiary'} className="justify-start" onPress={() => s.set({ providerId: p.id as ProviderId })}>
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {def.editableUrl && (
                  <div>
                    <Label>{t('set.baseUrl')}</Label>
                    <Input fullWidth value={s.baseUrls[s.providerId] ?? def.baseUrl} onChange={(e) => s.set({ baseUrls: { ...s.baseUrls, [s.providerId]: e.target.value } })} spellCheck={false} />
                  </div>
                )}
                <div>
                  <Label>{t('set.apiKey')} {def.keyOptional && <span className="text-muted font-normal">({t('set.optional')})</span>}</Label>
                  <div className="flex gap-2">
                    <Input fullWidth type={showKey ? 'text' : 'password'} value={key} placeholder={def.keyHint} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" />
                    <Button isIconOnly variant="tertiary" onPress={() => setShowKey(!showKey)} aria-label="toggle">{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</Button>
                    <Button variant="tertiary" onPress={saveKey}>{saved ? <><Check size={15} />{t('set.saved')}</> : t('set.save')}</Button>
                  </div>
                  <p className="text-muted mt-1.5 text-xs">{isNative() ? t('set.keyHintNative') : t('set.keyHintWeb')}</p>
                </div>
                <div>
                  <Label>{t('set.model')}</Label>
                  <div className="flex gap-2">
                    <Input fullWidth list="model-list" value={providerModel(s.providerId)} onChange={(e) => s.set({ models: { ...s.models, [s.providerId]: e.target.value } })} spellCheck={false} />
                    <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
                    <Button variant="tertiary" onPress={fetchModels}><RefreshCw size={15} />{t('set.fetch')}</Button>
                  </div>
                </div>
                {s.providerId === 'openrouter' && (
                  <div className="bg-surface-secondary rounded-xl p-4">
                    <Row title={t('set.privacy')} hint={t('set.privacy.d')}>
                      <Switch aria-label={t('set.privacy')} isSelected={s.strictPrivacy} onChange={(v) => s.set({ strictPrivacy: v })}>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                      </Switch>
                    </Row>
                    <div className="text-success flex items-center gap-1.5 text-xs"><ShieldCheck size={14} />{s.strictPrivacy ? t('set.privacy.on') : t('set.privacy.off')}</div>
                  </div>
                )}
                <Row title={t('set.multiAgent')} hint={t('set.multiAgent.d')}>
                  <Switch aria-label={t('set.multiAgent')} isSelected={s.multiAgent} onChange={(v) => s.set({ multiAgent: v })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                </Row>
                <div className="flex items-center justify-end gap-3">
                  <div className="mr-auto"><StatusLine s={status} /></div>
                  <Button variant="primary" onPress={test} isDisabled={status.kind === 'busy'}><Zap size={15} />{t('set.test')}</Button>
                </div>
              </Tabs.Panel>

              <Tabs.Panel id="voice" className="flex flex-col gap-5 pt-4">
                <div className="bg-surface-secondary flex items-start gap-3 rounded-xl p-4 text-sm">
                  <Chip size="sm" color="accent" variant="soft">Deepgram Nova-3</Chip>
                  <p className="text-muted text-xs leading-5">{t('voice.about')}</p>
                </div>
                <div>
                  <Label>{t('voice.key')}</Label>
                  <div className="flex gap-2">
                    <Input fullWidth type={dgShow ? 'text' : 'password'} value={dgKey} placeholder="Deepgram API key" onChange={(e) => setDgKey(e.target.value)} spellCheck={false} autoComplete="off" />
                    <Button isIconOnly variant="tertiary" onPress={() => setDgShow(!dgShow)} aria-label="toggle">{dgShow ? <EyeOff size={16} /> : <Eye size={16} />}</Button>
                    <Button variant="tertiary" onPress={saveDg}>{t('set.saveTest')}</Button>
                  </div>
                  <div className="mt-1.5 min-h-4"><StatusLine s={dgStatus} /></div>
                </div>
                <Section>
                  <Row title={t('voice.lang')} hint={t('voice.lang.d')}>
                    <Pick label={t('voice.lang')} value={s.voice.lang} onChange={(l) => s.set({ voice: { ...s.voice, lang: l } })} options={[['en', 'English'], ['gu', 'ગુજરાતી (Gujarati)']]} />
                  </Row>
                  <Row title={t('voice.polish')} hint={t('voice.polish.d')}>
                    <Switch aria-label={t('voice.polish')} isSelected={s.voice.polish} onChange={(v) => s.set({ voice: { ...s.voice, polish: v } })}>
                      <Switch.Control><Switch.Thumb /></Switch.Control>
                    </Switch>
                  </Row>
                </Section>
              </Tabs.Panel>

              <Tabs.Panel id="perm" className="pt-2">
                <Section>
                  <Row title={t('perm.title')} hint={t('perm.desc.' + perms.mode)}>
                    <Pick label={t('perm.title')} value={perms.mode} onChange={(m) => setPerm({ mode: m })} options={[['ask', t('perm.ask')], ['auto', t('perm.auto')], ['readonly', t('perm.readonly')]]} />
                  </Row>
                  {cats.map((c) => (
                    <Row key={c} title={t('cat.' + c)} hint={t('cat.' + c + '.d')}>
                      <Switch aria-label={t('cat.' + c)} isSelected={perms.allow[c]} onChange={(v) => setPerm({ allow: { ...perms.allow, [c]: v } })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                    </Row>
                  ))}
                  <Row title={t('perm.selOnly')} hint={t('perm.selOnly.d')}>
                    <Switch aria-label={t('perm.selOnly')} isSelected={perms.selectionOnly} onChange={(v) => setPerm({ selectionOnly: v })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                  </Row>
                  <Row title={t('perm.confirmDestructive')} hint={t('perm.confirmDestructive.d')}>
                    <Switch aria-label={t('perm.confirmDestructive')} isSelected={perms.confirmDestructive} onChange={(v) => setPerm({ confirmDestructive: v })}><Switch.Control><Switch.Thumb /></Switch.Control></Switch>
                  </Row>
                </Section>
              </Tabs.Panel>

              <Tabs.Panel id="general" className="pt-2">
                <Section>
                  <Row title={t('gen.lang')}><Pick label={t('gen.lang')} value={s.lang} onChange={(l) => s.set({ lang: l })} options={[['en', 'English'], ['gu', 'ગુજરાતી']]} /></Row>
                  <Row title={t('gen.aiLang')}><Pick label={t('gen.aiLang')} value={s.aiLang} onChange={(l) => s.set({ aiLang: l })} options={[['auto', t('gen.auto')], ['en', 'English'], ['gu', 'ગુજરાતી']]} /></Row>
                  <Row title={t('gen.theme')}><Pick label={t('gen.theme')} value={s.theme} onChange={(l) => s.set({ theme: l })} options={[['system', t('gen.theme.system')], ['light', t('gen.theme.light')], ['dark', t('gen.theme.dark')]]} /></Row>
                </Section>
              </Tabs.Panel>
            </Tabs>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
