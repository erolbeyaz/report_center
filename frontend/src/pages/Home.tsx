import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { can, api, fmtDateTime, type HomeSummary, type ScopeState } from '../api'
import { KIND_ICON } from '../components/Glyphs'
import { IconPlus } from '../components/Icons'
import { Spinner } from '../components/AuthShell'
import { locale, t } from '../i18n'
import { tn } from '../components/plural'

const nf = new Intl.NumberFormat(locale)
const LIST_LIMIT = 8

// Durum her zaman ikon + yazı ile gösterilir (yalnız renge dayanmaz).
const STATE_ICON: Record<ScopeState, React.ReactNode> = {
  Kritik: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></svg>,
  'Uyarı': <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>,
  Bilgi: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></svg>,
  Sorunsuz: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>,
}
const STATE_CLASS: Record<ScopeState, string> = { Kritik: 'crit', 'Uyarı': 'warn', Bilgi: 'info', Sorunsuz: 'ok' }
// API değerleri Türkçe sabitlerdir; yalnız gösterim çevrilir.
const STATE_LABEL: Record<ScopeState, string> = { Kritik: t('Kritik'), 'Uyarı': t('Uyarı'), Bilgi: t('Bilgi'), Sorunsuz: t('Sorunsuz') }

function StateChip({ state }: { state: ScopeState }) {
  return <span className={`state-chip ${STATE_CLASS[state]}`}>{STATE_ICON[state]}{STATE_LABEL[state]}</span>
}

function ago(iso: string | null | undefined) {
  if (!iso) return '–'
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6
  if (h < 1) return tn(Math.max(1, Math.round(h * 60)), '{n} dk önce')
  if (h < 48) return tn(Math.round(h), '{n} sa önce')
  return tn(Math.round(h / 24), '{n} gün önce')
}

export default function Home() {
  const [data, setData] = useState<HomeSummary | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [done, setDone] = useState(false)

  // Sunucu hiç beklemez: sağlık özeti arka planda hesaplanırken (refreshing) birkaç saniyede bir yeniden sorulur.
  const load = (refresh = false) => {
    if (refresh) { setLoading(true); setDone(false) }
    api.home(refresh).then(d => { setData(d); setError('') }).catch(e => { setError(e.message); setLoading(false) })
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!data) return
    if (data.refreshing) {
      const timer = setTimeout(() => load(), 2500)
      return () => clearTimeout(timer)
    }
    if (loading) {
      setLoading(false)
      setDone(true)
      const timer = setTimeout(() => setDone(false), 900)
      return () => clearTimeout(timer)
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) {
    return (
      <>
        <div className="page-head"><div><h1>{t('Ana Sayfa')}</h1><div className="lead">{t('Yükleniyor…')}</div></div></div>
        {error && <div className="banner err" role="alert">{error}</div>}
      </>
    )
  }

  const counts = { Kritik: 0, 'Uyarı': 0, Bilgi: 0 }
  data.items.forEach(i => { counts[i.level]++ })
  const okSources = data.sources.filter(s => s.ok)
  const kinds = data.scopes.reduce<Record<string, number>>((a, s) => ({ ...a, [s.kind_label]: (a[s.kind_label] ?? 0) + 1 }), {})
  const byScope = [...data.scopes].sort((a, b) => b.report_count - a.report_count)
  const max = Math.max(1, ...byScope.map(s => s.report_count))
  const items = showAll ? data.items : data.items.slice(0, LIST_LIMIT)
  const attention = counts.Kritik ? 'crit' : counts['Uyarı'] ? 'warn' : ''

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Ana Sayfa')}</h1>
          <div className="lead">
            {data.generated_at ? t('Sağlık özeti {at} itibarıyla', { at: fmtDateTime(data.generated_at) }) : t('Sağlık özeti hazırlanıyor')}
            {' · '}{t('{n} dakikada bir yenilenir', { n: data.ttl_minutes })}
            {data.refreshing && data.generated_at && ` · ${t('yenileniyor…')}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className={`btn refresh${loading ? ' spinning' : ''}${done ? ' done' : ''}`} onClick={() => load(true)} disabled={loading} aria-busy={loading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
            </svg>{t('Yenile')}
          </button>
          <span className="sr-only" role="status">{loading ? t('Yenileniyor') : done ? t('Yenilendi') : ''}</span>
          <Link to="/raporlar" className="btn">{t('Tüm raporlar')}</Link>
          {can('designer') && <Link to="/yeni" className="btn primary"><IconPlus />{t('Yeni rapor')}</Link>}
        </div>
      </div>
      {error && <div className="banner err" role="alert">{error}</div>}
      {data.errors.length > 0 && (
        <div className="banner warn" role="status">{t('Bazı kontroller çalışmadı, özet eksik olabilir: {list}', { list: data.errors.join(' · ') })}</div>
      )}

      <div className="stat-row">
        <Link to="/raporlar" className="stat-tile">
          <span className="stat-label">{t('Raporlar')}</span>
          <span className="stat-value">{nf.format(data.reports)}</span>
          <span className="stat-sub">{tn(data.categories, '{n} kategori')}</span>
        </Link>
        <div className="stat-tile">
          <span className="stat-label">{t('Ortamlar')}</span>
          <span className="stat-value">{data.scopes.length}</span>
          <span className="stat-sub">{Object.entries(kinds).map(([k, n]) => `${n} ${t(k).toLocaleLowerCase(locale)}`).join(' · ')}</span>
        </div>
        <Link to="/gecmis" className="stat-tile">
          <span className="stat-label">{t('Bu ay alınan export')}</span>
          <span className="stat-value">{nf.format(data.exports_month.count)}</span>
          <span className="stat-sub">{t('{n} satır', { n: nf.format(data.exports_month.rows) })}</span>
        </Link>
        <Link to="/ayarlar/kaynaklar" className="stat-tile">
          <span className="stat-label">{t('Veri kaynakları')}</span>
          <span className="stat-value">{data.pending ? '–' : `${okSources.length} / ${data.sources.length}`}</span>
          {data.pending ? <span className="stat-sub"><Spinner />{t('Kontrol ediliyor')}</span> : okSources.length === data.sources.length
            ? <span className="stat-sub ok">{STATE_ICON.Sorunsuz}{t('Bağlı: {list}', { list: data.sources.map(s => s.name.replace(/\s*\(.*\)$/, '')).join(', ') })}</span>
            : <span className="stat-sub crit">{STATE_ICON.Kritik}{t('Bağlanamayan: {list}', { list: data.sources.filter(s => !s.ok).map(s => s.name).join(', ') })}</span>}
        </Link>
        <a href="#dikkat" className={`stat-tile ${attention}`}>
          <span className="stat-label">{t('Dikkat gerektiren')}</span>
          <span className="stat-value">{data.pending ? '–' : data.items.length}</span>
          {data.pending ? <span className="stat-sub"><Spinner />{t('Hazırlanıyor')}</span> : data.items.length
            ? <span className={`stat-sub ${attention || 'muted'}`}>{STATE_ICON[counts.Kritik ? 'Kritik' : counts['Uyarı'] ? 'Uyarı' : 'Bilgi']}
                {t('{c} kritik · {w} uyarı · {i} bilgi', { c: counts.Kritik, w: counts['Uyarı'], i: counts.Bilgi })}</span>
            : <span className="stat-sub ok">{STATE_ICON.Sorunsuz}{t('Her şey yolunda')}</span>}
        </a>
      </div>

      <div className="home-split">
        <section id="dikkat" className="card attention" aria-labelledby="dikkat-baslik">
          <div className="card-head">
            <h2 id="dikkat-baslik">{t('Dikkat gerektirenler')} <span className="hint">· {t('son 24 saat')}</span></h2>
            <span className="hint">{data.health_configured ? t('Tanımlı sağlık kontrollerinden otomatik çıkarılır') : t('Sağlık kontrolü tanımlı değil (RM_HEALTH_CHECKS_FILE); yalnız veri kaynakları kontrol ediliyor')}</span>
          </div>
          {data.pending && (
            <ul className="att-list" aria-busy="true" aria-label={t('Sağlık özeti hazırlanıyor')}>
              {[0, 1, 2, 3].map(i => <li key={i} className="skeleton-row"><span className="sk sk-chip" /><span className="sk sk-line" /><span className="sk sk-val" /></li>)}
            </ul>
          )}
          {!data.pending && data.items.length === 0 && <div className="card-pad hint">{t('Son 24 saatte dikkat gerektiren bir durum yok.')}</div>}
          <ul className="att-list">
            {items.map((i, n) => (
              <li key={n}>
                <StateChip state={i.level} />
                <div className="att-main">
                  <span className="att-title">{i.title}</span>
                  <span className="hint">{i.scope} · {i.report}</span>
                </div>
                <span className="att-value">{i.value}</span>
                {i.template_id
                  ? <Link className="btn sm" to={`/raporlar?ortam=${encodeURIComponent(i.scope)}&onizle=${i.template_id}`}>{t('Raporu aç')}</Link>
                  : <span className="btn sm" aria-hidden="true" style={{ visibility: 'hidden' }}>{t('Raporu aç')}</span>}
              </li>
            ))}
          </ul>
          {data.items.length > LIST_LIMIT && (
            <div className="card-foot">
              <span>{t('{shown} / {all} gösteriliyor', { shown: items.length, all: data.items.length })}</span>
              <button className="linkish" onClick={() => setShowAll(v => !v)}>{showAll ? t('Daha az göster') : t('Tümünü göster ({n})', { n: data.items.length })}</button>
            </div>
          )}
        </section>

        <section className="card card-pad bars" aria-labelledby="ortam-rapor-baslik">
          <div>
            <h2 id="ortam-rapor-baslik">{t('Ortama göre rapor sayısı')}</h2>
            <span className="hint">{t('Toplam {n} rapor', { n: nf.format(data.reports) })}</span>
          </div>
          <div role="list" className="bar-list">
            {byScope.map(s => (
              <Link role="listitem" key={s.name} to={`/raporlar?ortam=${encodeURIComponent(s.name)}`} className="bar-row"
                    title={tn(s.report_count, '{name}: {n} rapor', { name: s.name })} aria-label={tn(s.report_count, '{name}: {n} rapor', { name: s.name })}>
                <span className="bar-name">{s.name}</span>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${(s.report_count / max) * 100}%` }} /></span>
                <span className="bar-n">{s.report_count}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="ortamlar-baslik" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 id="ortamlar-baslik">{t('Ortamlar')}</h2>
        <div className="env-grid">
          {data.scopes.map(s => {
            const h = s.health
            return (
              <Link key={s.name} to={`/raporlar?ortam=${encodeURIComponent(s.name)}`} className="card env-card">
                <div className="env-head">
                  <span className="env-icon">{KIND_ICON[s.kind]}</span>
                  <div className="env-title">
                    <span>{s.name}</span>
                    <span className="hint">{tn(s.report_count, '{n} rapor')}</span>
                  </div>
                  {h ? <StateChip state={h.state} /> : data.pending ? <span className="state-chip none"><Spinner />{t('Kontrol ediliyor')}</span> : <span className="state-chip none">{t('İzlenmiyor')}</span>}
                </div>
                {h && h.facts.length > 0 && (
                  <dl className="env-facts">
                    {h.facts.map(f => {
                      const text = f.at !== undefined ? [ago(f.at), f.suffix].filter(Boolean).join(' · ') : f.text ?? '–'
                      return [<dt key={`t${f.label}`}>{f.label}</dt>, <dd key={`d${f.label}`} title={text}>{text}</dd>]
                    })}
                  </dl>
                )}
              </Link>
            )
          })}
        </div>
      </section>

      <section className="card table-wrap" aria-labelledby="son-export-baslik">
        <div className="card-head">
          <h2 id="son-export-baslik">{t("Son export'lar")}</h2>
          <Link to="/gecmis" style={{ fontSize: 13, fontWeight: 600 }}>{t('Export geçmişi')}</Link>
        </div>
        {data.recent_exports.length === 0
          ? <div className="card-pad hint">{t('Henüz export alınmadı.')}</div>
          : (
            <table className="simple light">
              <thead><tr><th>{t('Zaman')}</th><th>{t('Rapor')}</th><th>{t('Alan kişi')}</th><th style={{ textAlign: 'right' }}>{t('Satır')}</th></tr></thead>
              <tbody>
                {data.recent_exports.map(e => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</td>
                    <td style={{ fontWeight: 500 }}><Link to={`/rapor/${e.template_id}`}>{e.template_name}</Link></td>
                    <td>{e.created_by}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf.format(e.row_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </>
  )
}
