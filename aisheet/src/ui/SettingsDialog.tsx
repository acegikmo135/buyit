import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, RefreshCw, X, Zap } from 'lucide-react';
import { useStore, providerModel } from '../store';
import { PROVIDERS, chat, listModels, providerById, type ProviderId } from '../ai/providers';
import { setSecret } from '../platform';
import { loadKey } from '../ai/agent';
import { useT } from '../i18n';
import { isTauri } from '../platform';
import type { Category } from '../ai/executor';

export function SettingsDialog() {
  const t = useT();
  const s = useStore();
  const [tab, setTab] = useState<'ai' | 'perm' | 'voice' | 'general'>('ai');
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
    setSaved(false);
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

  const fetchModels = async () => {
    setStatus({ kind: 'busy' });
    try {
      await saveKey();
      const list = await listModels({ id: s.providerId, baseUrl: s.baseUrls[s.providerId], apiKey: key });
      setModels(list);
      setStatus({ kind: 'ok', text: t('set.modelsLoaded', { n: list.length }) });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    }
  };

  const test = async () => {
    setStatus({ kind: 'busy' });
    try {
      await saveKey();
      const r = await chat(cfg(), 'Reply with JSON {"message":"ok","actions":[]}', [{ role: 'user', content: 'ping' }]);
      setStatus({ kind: 'ok', text: t('set.testOk') + ' ' + r.slice(0, 60) });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    }
  };

  const perms = s.permissions;
  const setPerm = (p: Partial<typeof perms>) => s.set({ permissions: { ...perms, ...p } });
  const cats: Category[] = ['write', 'format', 'structure', 'sheets', 'delete'];

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && s.set({ settingsOpen: false })}>
      <div className="modal" role="dialog" aria-label={t('settings.title')}>
        <header className="modal-head">
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={() => s.set({ settingsOpen: false })} aria-label="close"><X size={16} /></button>
        </header>
        <nav className="tabs-nav">
          {(['ai', 'perm', 'voice', 'general'] as const).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t('settings.tab.' + k)}</button>
          ))}
        </nav>

        {tab === 'ai' && (
          <div className="modal-body">
            <div className="field">
              <label>{t('set.provider')}</label>
              <div className="provider-grid">
                {PROVIDERS.map((p) => (
                  <button key={p.id} className={'prov' + (p.id === s.providerId ? ' on' : '')} onClick={() => s.set({ providerId: p.id as ProviderId })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {def.editableUrl && (
              <div className="field">
                <label>{t('set.baseUrl')}</label>
                <input value={s.baseUrls[s.providerId] ?? def.baseUrl} onChange={(e) => s.set({ baseUrls: { ...s.baseUrls, [s.providerId]: e.target.value } })} spellCheck={false} />
              </div>
            )}
            <div className="field">
              <label>{t('set.apiKey')} {def.keyOptional && <em>({t('set.optional')})</em>}</label>
              <div className="row">
                <input type={show ? 'text' : 'password'} value={key} placeholder={def.keyHint} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" />
                <button className="icon-btn" onClick={() => setShow(!show)} aria-label="toggle">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                <button className="btn" onClick={saveKey}>{saved ? <><Check size={14} /> {t('set.saved')}</> : t('set.save')}</button>
              </div>
              <p className="hint">{isTauri() ? t('set.keyHintNative') : t('set.keyHintWeb')}</p>
            </div>
            <div className="field">
              <label>{t('set.model')}</label>
              <div className="row">
                <input list="model-list" value={providerModel(s.providerId)} onChange={(e) => s.set({ models: { ...s.models, [s.providerId]: e.target.value } })} spellCheck={false} />
                <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
                <button className="btn" onClick={fetchModels} title={t('set.fetchModels')}><RefreshCw size={14} /> {t('set.fetch')}</button>
              </div>
            </div>
            <div className="row end">
              {status.kind !== 'idle' && (
                <span className={'status ' + status.kind}>
                  {status.kind === 'busy' && <Loader2 size={14} className="spin" />}
                  {status.text}
                </span>
              )}
              <button className="btn primary" onClick={test} disabled={status.kind === 'busy'}><Zap size={14} /> {t('set.test')}</button>
            </div>
          </div>
        )}

        {tab === 'perm' && (
          <div className="modal-body">
            <div className="field">
              <label>{t('perm.title')}</label>
              <div className="seg">
                {(['ask', 'auto', 'readonly'] as const).map((m) => (
                  <button key={m} className={perms.mode === m ? 'on' : ''} onClick={() => setPerm({ mode: m })}>{t('perm.' + m)}</button>
                ))}
              </div>
              <p className="hint">{t('perm.desc.' + perms.mode)}</p>
            </div>
            <div className="field">
              <label>{t('perm.allowed')}</label>
              {cats.map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={perms.allow[c]} onChange={(e) => setPerm({ allow: { ...perms.allow, [c]: e.target.checked } })} />
                  <span><b>{t('cat.' + c)}</b> <em>{t('cat.' + c + '.d')}</em></span>
                </label>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={perms.selectionOnly} onChange={(e) => setPerm({ selectionOnly: e.target.checked })} />
              <span><b>{t('perm.selOnly')}</b> <em>{t('perm.selOnly.d')}</em></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={perms.confirmDestructive} onChange={(e) => setPerm({ confirmDestructive: e.target.checked })} />
              <span><b>{t('perm.confirmDestructive')}</b> <em>{t('perm.confirmDestructive.d')}</em></span>
            </label>
          </div>
        )}

        {tab === 'voice' && (
          <div className="modal-body">
            <div className="field">
              <label>{t('voice.lang')}</label>
              <div className="seg">
                {(['auto', 'en', 'gu'] as const).map((l) => (
                  <button key={l} className={s.voice.lang === l ? 'on' : ''} onClick={() => s.set({ voice: { ...s.voice, lang: l } })}>
                    {l === 'auto' ? t('voice.auto') : l === 'en' ? 'English' : 'ગુજરાતી'}
                  </button>
                ))}
              </div>
              <p className="hint">{t('voice.lang.d')}</p>
            </div>
            <div className="field">
              <label>{t('voice.engine')}</label>
              <div className="seg">
                {(['auto', 'system', 'whisper'] as const).map((l) => (
                  <button key={l} className={s.voice.engine === l ? 'on' : ''} onClick={() => s.set({ voice: { ...s.voice, engine: l } })}>
                    {t('voice.engine.' + l)}
                  </button>
                ))}
              </div>
              <p className="hint">{t('voice.engine.d')}</p>
            </div>
            <div className="field">
              <label>{t('voice.model')}</label>
              <div className="seg">
                <button className={s.voice.model === 'Xenova/whisper-base' ? 'on' : ''} onClick={() => s.set({ voice: { ...s.voice, model: 'Xenova/whisper-base' } })}>{t('voice.model.base')}</button>
                <button className={s.voice.model === 'Xenova/whisper-small' ? 'on' : ''} onClick={() => s.set({ voice: { ...s.voice, model: 'Xenova/whisper-small' } })}>{t('voice.model.small')}</button>
              </div>
              <p className="hint">{t('voice.model.d')}</p>
            </div>
            <label className="check">
              <input type="checkbox" checked={s.voice.polish} onChange={(e) => s.set({ voice: { ...s.voice, polish: e.target.checked } })} />
              <span><b>{t('voice.polish')}</b> <em>{t('voice.polish.d')}</em></span>
            </label>
          </div>
        )}

        {tab === 'general' && (
          <div className="modal-body">
            <div className="field">
              <label>{t('gen.lang')}</label>
              <div className="seg">
                <button className={s.lang === 'en' ? 'on' : ''} onClick={() => s.set({ lang: 'en' })}>English</button>
                <button className={s.lang === 'gu' ? 'on' : ''} onClick={() => s.set({ lang: 'gu' })}>ગુજરાતી</button>
              </div>
            </div>
            <div className="field">
              <label>{t('gen.aiLang')}</label>
              <div className="seg">
                <button className={s.aiLang === 'auto' ? 'on' : ''} onClick={() => s.set({ aiLang: 'auto' })}>{t('gen.auto')}</button>
                <button className={s.aiLang === 'en' ? 'on' : ''} onClick={() => s.set({ aiLang: 'en' })}>English</button>
                <button className={s.aiLang === 'gu' ? 'on' : ''} onClick={() => s.set({ aiLang: 'gu' })}>ગુજરાતી</button>
              </div>
            </div>
            <div className="field">
              <label>{t('gen.theme')}</label>
              <div className="seg">
                {(['system', 'light', 'dark'] as const).map((th) => (
                  <button key={th} className={s.theme === th ? 'on' : ''} onClick={() => s.set({ theme: th })}>{t('gen.theme.' + th)}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
