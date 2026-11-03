import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { can, api, fmtDateTime, type ExportRecord, type Filter, type Preview, type Template, type TemplateSummary } from '../api'
import { IconDownload, IconEdit } from './Icons'
import { categoryStyle } from './Glyphs'
import { locale, t } from '../i18n'
import { tn } from './plural'

const OP: Record<Filter['op'], string> = {
  eq: '=', neq: '≠', in: '∈', not_in: '∉', exists: t('dolu'), not_exists: t('boş'), gt: '>', gte: '≥', lt: '<', lte: '≤',
  prefix: t('ile başlar:'), not_prefix: t('ile başlamaz:'),
}
const pad = (n: number) => String(n).padStart(2, '0')
const toValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const SAMPLE_ROWS = 6
const SAMPLE_COLS = 4

// Raporlar ekranında rapora tıklayınca açılan hızlı önizleme paneli.
export default function ReportPeek({ summary, onClose }: { summary: TemplateSummary; onClose: () => void }) {
  const [tpl, setTpl] = useState<Template | null>(null)
  const [data, setData] = useState<Preview | null>(null)
  const [exports, setExports] = useState<ExportRecord[] | null>(null)
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setTpl(null); setData(null); setExports(null); setError('')
    const to = new Date(); to.setSeconds(0, 0); to.setMinutes(to.getMinutes() + 1)
    const from = new Date(to); from.setDate(from.getDate() - 7)
    api.template(summary.id).then(setTpl).catch(e => setError(e.message))
    api.preview(summary.id, { period_from: toValue(from), period_to: toValue(to), params: {}, limit: SAMPLE_ROWS })
      .then(setData).catch(e => setError(e.message))
    api.exports({ template_id: summary.id }).then(r => setExports(r.slice(0, 3))).catch(() => setExports([]))
  }, [summary.id])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const st = categoryStyle(summary.group)
  const d = tpl?.definition
  const cols = data?.columns.slice(0, SAMPLE_COLS) ?? []
  const facetField = d?.params[0]?.field
  const facet = facetField ? Object.entries(data?.facets?.[facetField] ?? {}).slice(0, 5) : []
  const facetMax = Math.max(1, ...facet.map(([, n]) => n))

  return (
    <>
      <div className="peek-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="peek" role="dialog" aria-modal="true" aria-labelledby="peek-title">
        <header className="peek-head">
          <span className="rx-ico" style={{ background: st.bg, color: st.fg }}>{st.icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="rx-crumb">{summary.scope} › {summary.group}</div>
            <h2 id="peek-title" className="peek-title">{summary.name}</h2>
          </div>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label={t('Önizlemeyi kapat')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className="peek-body">
          <p className="peek-desc">{summary.description}</p>
          <div className="actions">
            <Link to={`/rapor/${summary.id}`} className="btn primary">{t('Raporu aç')}</Link>
            {can('designer') && <Link to={`/tasarim/${summary.id}`} className="btn"><IconEdit />{t('Şablonu düzenle')}</Link>}
          </div>
          {error && <div className="banner err" role="alert">{error}</div>}

          <section className="peek-sec" aria-label={t('Son 7 gün')}>
            <div className="peek-sec-head"><h3>{t('Son 7 gün')}</h3>{!data && !error && <span className="spinner" style={{ color: 'var(--brand)' }} aria-label={t('Yükleniyor')} />}</div>
            {data && (
              <>
                <div className="peek-stats">
                  <div><strong>{data.total.toLocaleString(locale)}</strong><span>{t('kayıt')}</span></div>
                  {facet.length > 0 && (
                    <div className="peek-facet" aria-label={d?.params[0]?.label}>
                      {facet.map(([k, n]) => (
                        <div key={k} className="peek-bar">
                          <span className="peek-bar-label">{k}</span>
                          <span className="peek-bar-track"><span style={{ width: `${(n / facetMax) * 100}%` }} /></span>
                          <span className="peek-bar-n">{n.toLocaleString(locale)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {data.coverage && !data.coverage.complete && <div className="hint">{t('Not: veri seti en eski kaydı {at}; 7 günün tamamı kaynakta yok.', { at: data.coverage.earliest ? fmtDateTime(data.coverage.earliest) : '–' })}</div>}
                {data.rows.length > 0 ? (
                  <div className="table-wrap peek-table">
                    <table className="simple light">
                      <thead><tr>{cols.map(c => <th key={c.field}>{c.label}</th>)}</tr></thead>
                      <tbody>
                        {data.rows.map((r, i) => (
                          <tr key={i} style={r.fill ? { background: `#${r.fill}` } : undefined}>
                            {cols.map(c => <td key={c.field} className={c.format === 'mono' || c.format === 'list' ? 'mono' : undefined}>{r.values[c.field] ?? ''}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="empty" style={{ padding: 16 }}>{t('Son 7 günde kayıt yok.')}</div>}
                {data.total > data.rows.length && <span className="hint">{t('İlk {rows} kayıt ve ilk {cols} kolon gösteriliyor.', { rows: data.rows.length, cols: cols.length })}</span>}
              </>
            )}
          </section>

          {d && (
            <section className="peek-sec" aria-label={t('Rapor tanımı')}>
              <h3>{t('Rapor tanımı')}</h3>
              <dl className="peek-dl">
                <dt>{t('Veri seti')}</dt><dd className="mono">{d.dataset}</dd>
                <dt>{t('Zaman alanı')}</dt><dd className="mono">{d.time_field}</dd>
                <dt>{t('Sabit filtreler')}</dt>
                <dd>{d.fixed_filters.length ? d.fixed_filters.map((f, i) => (
                  <div key={i}><span className="mono">{f.field}</span> {OP[f.op]} {Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? '')}</div>
                )) : t('yok')}</dd>
                <dt>{t('Parametreler')}</dt><dd>{d.params.length ? d.params.map(p => p.label).join(', ') : t('yok')}</dd>
                <dt>{t('Kolonlar')}</dt><dd><div className="peek-chips">{d.columns.map(c => <span key={c.field} className="tag">{c.label}</span>)}</div></dd>
                <dt>{t('Şablon')}</dt><dd>{t('Sürüm {n}', { n: tpl!.version })} · {fmtDateTime(tpl!.updated_at)} · {tpl!.updated_by}</dd>
              </dl>
            </section>
          )}

          <section className="peek-sec" aria-label={t("Son export'lar")}>
            <h3>{t("Son export'lar")}</h3>
            {exports === null ? <span className="hint">{t('Yükleniyor…')}</span> : exports.length === 0 ? <span className="hint">{t('Henüz export alınmadı.')}</span> : (
              <ul className="peek-exports">
                {exports.map(e => (
                  <li key={e.id}>
                    <div><b>{fmtDateTime(e.period_from)} – {fmtDateTime(e.period_to)}</b><span className="hint">{tn(e.row_count, '{n} kayıt')} · {e.created_by} · {fmtDateTime(e.created_at)}</span></div>
                    <a className="btn sm" href={api.downloadUrl(e.id)}><IconDownload size={14} />{t('İndir')}</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}
