import { useEffect, useState } from 'react'
import { api, fmtDateTime, tz, type ExportRecord, type TemplateSummary } from '../api'
import { IconCheck, IconDownload } from '../components/Icons'
import { t } from '../i18n'

const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-8)}`

export default function History() {
  const [items, setItems] = useState<ExportRecord[] | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [tid, setTid] = useState('')
  const [user, setUser] = useState('')
  const [sha, setSha] = useState('')
  const [sel, setSel] = useState<ExportRecord | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { api.templates().then(setTemplates).catch(() => {}) }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      api.exports({ template_id: tid ? Number(tid) : undefined, user: user || undefined, sha256: sha || undefined })
        .then(r => { setItems(r); setSel(s => r.find(x => x.id === s?.id) ?? r[0] ?? null) })
        .catch(e => setError(e.message))
    }, 250)
    return () => clearTimeout(timer)
  }, [tid, user, sha])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Export geçmişi')}</h1>
          <div className="lead">{t('Alınan her rapor değiştirilemez bir kayıt olarak saklanır: kim, ne zaman, hangi parametreler, kayıt sayısı ve özetler.')}</div>
        </div>
      </div>
      {error && <div className="banner err" role="alert">{error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label className="field">{t('Rapor')}
          <select value={tid} onChange={e => setTid(e.target.value)} style={{ minWidth: 240 }}>
            <option value="">{t('Tümü')}</option>
            {templates.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
        <label className="field">{t('Alan kişi')}<input type="search" placeholder={t('kullanıcı ara')} value={user} onChange={e => setUser(e.target.value)} /></label>
        <label className="field">{t('SHA-256 ile doğrula')}
          <input type="search" className="mono" placeholder={t('dosya özetini yapıştır')} value={sha} onChange={e => setSha(e.target.value)} style={{ minWidth: 320 }} /></label>
        {sha && items && (items.length
          ? <span className="status ok" role="status">{t('Bu özet sistemdeki bir export ile eşleşiyor')}</span>
          : <span className="status bad" role="status">{t('Eşleşen export yok: dosya değiştirilmiş veya bu sistemden alınmamış')}</span>)}
      </div>

      <section className="card table-wrap" aria-label={t('Export listesi')}>
        <table className="simple" style={{ minWidth: 1060 }}>
          <thead>
            <tr><th>{t('Alınma zamanı')}</th><th>{t('Rapor')}</th><th>{t('Dönem')}</th><th>{t('Alan kişi')}</th><th>{t('Kayıt')}</th><th>{t('Eksiksizlik')}</th><th>{t('Dosya SHA-256')}</th><th><span className="sr-only">{t('İşlem')}</span></th></tr>
          </thead>
          <tbody>
            {items?.map(e => (
              <tr key={e.id} className={`clickable${sel?.id === e.id ? ' selected' : ''}`} onClick={() => setSel(e)}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</td>
                <td style={{ fontWeight: 500 }}>{e.template_name} <span className="hint">v{e.template_version}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.period_from)} – {fmtDateTime(e.period_to)}</td>
                <td>{e.created_by}</td>
                <td>{e.row_count}</td>
                <td>
                  <span className="status ok" style={{ display: 'inline-flex' }}><IconCheck size={14} />{e.source_count} / {e.row_count}</span>
                  {e.partial && <span className="badge digest_change" style={{ marginLeft: 8 }}>{t('Kısmi dönem')}</span>}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{short(e.file_sha256)}</td>
                <td><a className="btn sm" href={api.downloadUrl(e.id)} onClick={ev => ev.stopPropagation()}><IconDownload size={14} />{t('İndir')}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        {items?.length === 0 && <div className="empty">{t('Kayıt yok.')}</div>}
      </section>

      {sel && (
        <section className="card card-pad" aria-label={t('Export ayrıntısı')}>
          <h2 style={{ marginBottom: 14 }}>{t('Seçili export · {name}', { name: sel.file_name })}</h2>
          <div className="detail-grid">
            <div><span>{t('Dönem')}</span><span>{fmtDateTime(sel.period_from)} – {fmtDateTime(sel.period_to)} {t('(bitiş hariç, {tz})', { tz: tz.label })}</span></div>
            <div><span>{t('Şablon')}</span><span>{sel.template_name} · {t('sürüm {n}', { n: sel.template_version })}</span></div>
            <div><span>{t('Seçilen parametreler')}</span><span>{Object.entries(sel.params.params).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || t('yok')}</span></div>
            <div><span>{t('Eksiksizlik')}</span><span>{t('Kaynak {src} = rapor {rows}', { src: sel.source_count, rows: sel.row_count })}</span></div>
            <div><span>{t('Veri özeti (SHA-256)')}</span><span className="mono break" style={{ fontSize: 12 }}>{sel.data_sha256}</span></div>
            <div><span>{t('Dosya SHA-256')}</span><span className="mono break" style={{ fontSize: 12 }}>{sel.file_sha256}</span></div>
            <div className="wide"><span>{t('Kaynak sorgusu')}</span><span className="mono break" style={{ fontSize: 12 }}>{sel.query_summary}</span></div>
            <div className="wide"><span>{t('Kolonlar')}</span><span className="mono break" style={{ fontSize: 12 }}>{sel.params.columns.join(' · ')}</span></div>
          </div>
        </section>
      )}
    </>
  )
}
