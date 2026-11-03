import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, type DataSource, type DataSourceType, type TestResult } from '../api'
import { Spinner } from './AuthShell'
import { t } from '../i18n'

type Field = { key: string; label: string; placeholder?: string; hint?: string; kind?: 'text' | 'number' | 'secret-file' | 'select'; options?: [string, string][]; required?: boolean }

const TYPES: { type: DataSourceType; label: string; desc: string; icon: ReactNode }[] = [
  { type: 'elasticsearch', label: 'Elasticsearch', desc: t('Index, data stream, alias'), icon: <path d="M4 7h16M4 12h10M4 17h13" /> },
  { type: 'prometheus', label: 'Prometheus / Thanos', desc: t('PromQL metrik sorguları'), icon: <path d="M3 17l5-6 4 3 5-7 4 5" /> },
  { type: 'postgresql', label: 'PostgreSQL', desc: t('Tablo ve görünümler'), icon: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></> },
  { type: 'mssql', label: 'Microsoft SQL Server', desc: t('Tablo ve görünümler'), icon: <><rect x="4" y="3" width="16" height="7" rx="1.5" /><rect x="4" y="14" width="16" height="7" rx="1.5" /><path d="M8 6.5h.01M8 17.5h.01" /></> },
]

const CRED: Field = { key: 'cred_file', label: t('Kimlik dosyası'), kind: 'secret-file', required: true, hint: t('1. satır kullanıcı adı, 2. satır şifre. Yalnız SELECT / okuma yetkili bir kullanıcı kullanın.') }
const CA: Field = { key: 'ca_file', label: t('CA sertifikası'), kind: 'secret-file', hint: t('Kurum içi CA veya kendinden imzalı sertifika için (PEM). Boşsa sistem güven deposu.') }
const TZ: Field = { key: 'timezone', label: t('Kolon saat dilimi'), placeholder: 'UTC', hint: t('Saat dilimi bilgisi olmayan tarih kolonları bu saat diliminde kabul edilir (ör. Europe/Berlin).') }
const TIMEOUT: Field = { key: 'timeout', label: t('Sorgu zaman aşımı (sn)'), kind: 'number', placeholder: '120' }

const FIELDS: Record<DataSourceType, { main: Field[]; advanced: Field[] }> = {
  elasticsearch: {
    main: [{ key: 'url', label: t('Adres'), placeholder: 'https://elasticsearch.example.com:9200', required: true }, CRED, CA],
    advanced: [{ key: 'timeout', label: t('Zaman aşımı (sn)'), kind: 'number', placeholder: '60' }],
  },
  prometheus: {
    main: [{ key: 'url', label: t('Adres'), placeholder: 'https://thanos-query.example.com', required: true, hint: t('Prometheus veya Thanos Query adresi.') }, CA],
    advanced: [TIMEOUT],
  },
  postgresql: {
    main: [
      { key: 'host', label: t('Sunucu'), placeholder: 'db.example.com', required: true },
      { key: 'port', label: 'Port', kind: 'number', placeholder: '5432' },
      { key: 'database', label: t('Veritabanı'), required: true },
      CRED,
      { key: 'sslmode', label: 'TLS', kind: 'select', options: [['verify-full', t('Doğrulamalı (verify-full) · önerilen')], ['verify-ca', t('Yalnız CA doğrulama (verify-ca)')], ['require', t('Şifreli, doğrulamasız (require)')], ['prefer', t('Mümkünse şifreli (prefer)')], ['disable', t('Şifresiz (disable)')]] },
      CA,
    ],
    advanced: [TZ, TIMEOUT],
  },
  mssql: {
    main: [
      { key: 'host', label: t('Sunucu'), placeholder: 'sql.example.com', required: true },
      { key: 'port', label: 'Port', kind: 'number', placeholder: '1433' },
      { key: 'database', label: t('Veritabanı'), required: true },
      CRED,
      { key: 'encrypt', label: 'TLS', kind: 'select', options: [['true', t('Şifreli (önerilen)')], ['false', t('Şifresiz')]] },
      { ...CA, hint: t('Sunucu sertifikası (PEM) ile sabitleme. Boşsa sistem güven deposu.') },
      { key: 'trust_server_certificate', label: t('Sertifika doğrulama'), kind: 'select', options: [['false', t('Doğrula (önerilen)')], ['true', t('Doğrulama (yalnız test ortamı)')]] },
    ],
    advanced: [TZ, TIMEOUT],
  },
}

export default function DataSourceForm({ initial, onClose, onSaved }: { initial: DataSource | null; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<DataSourceType>(initial?.type ?? 'postgresql')
  const [name, setName] = useState(initial?.name ?? '')
  const [cfg, setCfg] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial?.config ?? {}).map(([k, v]) => [k, String(v)])))
  const [files, setFiles] = useState<string[]>([])
  const [test, setTest] = useState<TestResult | 'loading' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showAdv, setShowAdv] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => { api.secretFiles().then(setFiles).catch(() => {}) }, [])
  useEffect(() => {
    first.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { main, advanced } = FIELDS[type]
  const body = () => {
    const keys = new Set([...main, ...advanced].map(f => f.key))
    return { name: name.trim(), type, config: Object.fromEntries(Object.entries(cfg).filter(([k, v]) => keys.has(k) && v !== '')) }
  }
  const missing = [...main.filter(f => f.required && !cfg[f.key]?.trim()).map(f => f.label), ...(name.trim() ? [] : [t('Ad')])]
  const set = (k: string, v: string) => { setCfg(c => ({ ...c, [k]: v })); setTest(null) }

  const runTest = () => {
    setTest('loading')
    api.testDatasourceConfig(body()).then(setTest).catch(e => setTest({ ok: false, error: e.message }))
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (missing.length) return
    setBusy(true)
    setError('')
    const p = initial ? api.updateDatasource(initial.id, body()) : api.createDatasource(body())
    p.then(() => onSaved()).catch(err => { setError(err.message); setBusy(false) })
  }
  const remove = () => {
    if (!initial || !window.confirm(t('"{name}" veri kaynağı silinsin mi?', { name: initial.name }))) return
    api.deleteDatasource(initial.id).then(() => onSaved()).catch(err => setError(err.message))
  }

  const renderField = (f: Field) => {
    const v = cfg[f.key] ?? ''
    const id = `ds-${f.key}`
    let input: ReactNode
    if (f.kind === 'select') {
      input = <select id={id} value={v || f.options![0][0]} onChange={e => set(f.key, e.target.value)}>
        {f.options!.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    } else if (f.kind === 'secret-file') {
      input = <>
        <input id={id} list={`${id}-list`} value={v} placeholder={files.length ? t('dosya seçin veya yazın') : t('ör. pg-cred')} required={f.required}
               onChange={e => set(f.key, e.target.value)} className="mono" autoComplete="off" />
        <datalist id={`${id}-list`}>{files.map(n => <option key={n} value={n} />)}</datalist>
      </>
    } else {
      input = <input id={id} type={f.kind === 'number' ? 'number' : 'text'} inputMode={f.kind === 'number' ? 'numeric' : undefined} value={v}
                     placeholder={f.placeholder} required={f.required} onChange={e => set(f.key, e.target.value)} autoComplete="off" />
    }
    return (
      <div key={f.key} className={`field ds-f-${f.key}`}>
        <label htmlFor={id}>{f.label}{f.required && <span className="req" aria-hidden="true"> *</span>}</label>
        {input}
        {f.hint && <span className="hint">{f.hint}</span>}
      </div>
    )
  }

  return (
    <>
      <div className="peek-backdrop" onClick={onClose} />
      <aside className="peek ds-form" role="dialog" aria-modal="true" aria-labelledby="ds-form-title">
        <form onSubmit={save} className="ds-form-inner" noValidate>
          <div className="peek-head">
            <div style={{ flex: 1 }}>
              <span className="hint">{initial ? t('Veri kaynağını düzenle') : t('Yeni veri kaynağı')}</span>
              <h2 id="ds-form-title" className="peek-title">{name || (initial ? initial.name : t('Bağlantı bilgileri'))}</h2>
            </div>
            <button type="button" className="icon-btn close" onClick={onClose} aria-label={t('Kapat')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          <div className="peek-body">
            {error && <div className="banner err" role="alert">{error}</div>}

            <fieldset className="ds-types" disabled={!!initial}>
              <legend className="ds-legend">{t('Tip')}{initial && <span className="hint"> · {t('kayıtlı kaynağın tipi değiştirilemez')}</span>}</legend>
              {TYPES.map(ty => (
                <label key={ty.type} className={`ds-type${type === ty.type ? ' on' : ''}`}>
                  <input type="radio" name="ds-type" value={ty.type} checked={type === ty.type} onChange={() => { setType(ty.type); setTest(null) }} className="sr-only" />
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ty.icon}</svg>
                  <span><b>{ty.label}</b><small>{ty.desc}</small></span>
                </label>
              ))}
            </fieldset>

            <div className="ds-fields">
              <div className="field ds-f-name">
                <label htmlFor="ds-name">{t('Ad')}<span className="req" aria-hidden="true"> *</span></label>
                <input id="ds-name" ref={first} value={name} onChange={e => setName(e.target.value)} placeholder={t('ör. Satış veritabanı (salt okuma)')} required />
                <span className="hint">{t('Raporlarda ve bootstrap dosyasında kaynak bu adla anılır.')}</span>
              </div>
              {main.map(renderField)}
            </div>

            <button type="button" className="linkish ds-adv-toggle" aria-expanded={showAdv} onClick={() => setShowAdv(v => !v)}>
              {showAdv ? t('Gelişmiş ayarları gizle') : t('Gelişmiş ayarlar')}
            </button>
            {showAdv && <div className="ds-fields">{advanced.map(renderField)}</div>}

            <div className="ds-note">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /></svg>
              <span>{t('Şifreler veritabanına yazılmaz. Kimlik ve CA dosyaları sunucudaki gizli dizinden (RM_SECRETS_DIR) okunur. Kubernetes\'te bu dizin uygulamanın Secret\'ıdır: dosyayı Secret\'a anahtar olarak ekleyip pod\'u yeniden başlatın.')}</span>
            </div>

            {test && (
              <div className={`banner ${test === 'loading' ? '' : test.ok ? 'ok' : 'err'}`} role="status">
                {test === 'loading' ? <><Spinner />{t('Bağlantı deneniyor…')}</>
                  : test.ok ? <span><b>{t('Bağlantı başarılı')}</b> · {test.version} · {t('kullanıcı {user}', { user: test.user ?? '' })} · {test.ms} ms</span>
                  : <span><b>{t('Bağlanılamadı:')}</b> {test.error}</span>}
              </div>
            )}
          </div>

          <div className="ds-form-foot">
            {initial && (
              <button type="button" className="btn sm danger-ghost" onClick={remove} disabled={initial.template_count > 0}
                      title={initial.template_count ? t('{n} rapor bu kaynağı kullanıyor', { n: initial.template_count }) : undefined}>{t('Sil')}</button>
            )}
            <span className="push" />
            {missing.length > 0 && <span className="hint">{t('Eksik: {list}', { list: missing.join(', ') })}</span>}
            <button type="button" className="btn" onClick={runTest} disabled={missing.length > 0 || test === 'loading'}>{t('Bağlantıyı test et')}</button>
            <button className="btn primary" disabled={busy || missing.length > 0} aria-busy={busy}>{busy && <Spinner />}{initial ? t('Kaydet') : t('Ekle')}</button>
          </div>
        </form>
      </aside>
    </>
  )
}
