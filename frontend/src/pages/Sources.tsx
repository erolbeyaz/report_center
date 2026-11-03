import { useEffect, useState } from 'react'
import { api, can, type DataSource, type Dataset, type TestResult } from '../api'
import DataSourceForm from '../components/DataSourceForm'
import { IconEdit, IconPlus } from '../components/Icons'
import { t } from '../i18n'

const TYPE_LABEL: Record<string, string> = { elasticsearch: 'Elasticsearch', prometheus: 'Prometheus / Thanos', postgresql: 'PostgreSQL', mssql: 'Microsoft SQL Server' }
const address = (d: DataSource) => d.config.url ?? `${d.config.host}${d.config.port ? `:${d.config.port}` : ''} / ${d.config.database}`
const tls = (d: DataSource) => {
  if (d.type === 'postgresql') return d.config.sslmode === 'disable' ? t('Şifresiz') : `${d.config.sslmode ?? 'verify-full'}${d.config.ca_file ? ` · ${t('kurum CA')}` : ''}`
  if (d.type === 'mssql') return d.config.encrypt === 'false' ? t('Şifresiz') : d.config.trust_server_certificate === 'true' ? t('Şifreli, sertifika doğrulanmıyor') : `${t('Şifreli')}${d.config.ca_file ? ` · ${t('sertifika sabitlenmiş')}` : ''}`
  return d.config.ca_file ? t('Kurum CA ile doğrulanıyor') : t('Sistem sertifikaları')
}

export default function Sources() {
  const [items, setItems] = useState<DataSource[]>([])
  const [tests, setTests] = useState<Record<number, TestResult | 'loading'>>({})
  const [sel, setSel] = useState<DataSource | null>(null)
  const [datasets, setDatasets] = useState<Dataset[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState<DataSource | 'new' | null>(null)

  const test = (d: DataSource) => {
    setTests(ts => ({ ...ts, [d.id]: 'loading' }))
    api.testDatasource(d.id).then(r => setTests(ts => ({ ...ts, [d.id]: r }))).catch(e => setTests(ts => ({ ...ts, [d.id]: { ok: false, error: e.message } })))
  }
  const reload = () => api.datasources()
    .then(r => { setItems(r); setSel(s => r.find(x => x.id === s?.id) ?? r[0] ?? null); r.forEach(test) })
    .catch(e => setError(e.message))
  useEffect(() => { reload() }, [])
  useEffect(() => {
    if (!sel) return
    setDatasets(null)
    api.datasets(sel.id).then(setDatasets).catch(e => setError(e.message))
  }, [sel])

  const shown = (datasets ?? []).filter(d => d.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Veri kaynakları')}</h1>
          <div className="lead">{t('Raporların okuduğu sistemler. Her kaynak salt okuma yetkili bir kullanıcıyla bağlanmalı.')}</div>
        </div>
        {can('admin') && <button className="btn primary" onClick={() => setForm('new')}><IconPlus size={16} />{t('Yeni veri kaynağı')}</button>}
      </div>
      {error && <div className="banner err" role="alert">{error}</div>}

      <div className="ds-grid">
        {items.map(d => {
          const res = tests[d.id]
          return (
            <article key={d.id} className="card ds-card" style={sel?.id === d.id ? { borderColor: '#9DB7D0' } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div><strong style={{ fontSize: 15 }}>{d.name}</strong><div className="hint">{TYPE_LABEL[d.type] ?? d.type} · {t('{n} rapor', { n: d.template_count })}</div></div>
                {res === 'loading' ? <span className="status unknown">{t('Test ediliyor')}</span>
                  : res?.ok ? <span className="status ok">{t('Bağlı')}</span>
                  : res ? <span className="status bad">{t('Hata')}</span> : <span className="status unknown">{t('Bilinmiyor')}</span>}
              </div>
              <dl>
                <dt>{t('Adres')}</dt><dd className="mono" style={{ fontSize: 12 }}>{address(d)}</dd>
                <dt>{t('Kullanıcı')}</dt><dd className="mono" style={{ fontSize: 12 }}>{res && res !== 'loading' && res.user ? res.user : '–'}</dd>
                <dt>{t('Kimlik')}</dt><dd>{d.credential === 'dosyadan' ? t('Dosyadan okunuyor (veritabanında tutulmuyor)') : d.type === 'prometheus' ? t('Gerekmiyor') : d.credential}</dd>
                <dt>TLS</dt><dd>{tls(d)}</dd>
                {res && res !== 'loading' && res.ok && <><dt>{t('Sürüm')}</dt><dd>{res.version} · {res.cluster} · {res.ms} ms</dd></>}
                {res && res !== 'loading' && !res.ok && <><dt>{t('Hata')}</dt><dd style={{ color: 'var(--danger)' }}>{res.error}</dd></>}
              </dl>
              <div className="actions">
                <button className="btn sm" onClick={() => test(d)}>{t('Bağlantıyı test et')}</button>
                <button className="btn sm" onClick={() => setSel(d)} aria-pressed={sel?.id === d.id}>{t('Veri setleri')}</button>
                {can('admin') && <button className="btn sm" onClick={() => setForm(d)}><IconEdit size={14} />{t('Düzenle')}</button>}
              </div>
            </article>
          )
        })}
        <article className="card ds-card placeholder"><strong>QRadar · Guardium</strong><span>{t('Sonraki fazda eklenecek.')}</span></article>
      </div>

      {sel && (
        <section className="card" aria-label={t('Veri setleri')}>
          <div className="card-head">
            <h2>{sel.name} · {t('veri setleri')} {datasets && <span className="hint">· {datasets.length}</span>}</h2>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <span className="sr-only">{t('Veri seti ara')}</span>
              <input type="search" placeholder={t('ara')} value={filter} onChange={e => setFilter(e.target.value)} />
            </label>
          </div>
          <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
            <table className="simple light">
              <thead><tr><th>{t('Veri seti')}</th><th>{t('Tip')}</th></tr></thead>
              <tbody>
                {shown.map(d => <tr key={d.name}><td className="mono">{d.name}</td><td>{d.kind}</td></tr>)}
              </tbody>
            </table>
            {datasets === null && <div className="empty">{t('Yükleniyor…')}</div>}
            {datasets && shown.length === 0 && (sel.type === 'prometheus'
              ? <div className="empty">{t('Prometheus / Thanos kaynaklarında veri seti yerine her rapor kendi PromQL sorgusunu kullanır.')}</div>
              : <div className="empty">{t('Bu kullanıcının görebildiği veri seti yok.')}</div>)}
          </div>
        </section>
      )}
      {form && <DataSourceForm initial={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
    </>
  )
}
