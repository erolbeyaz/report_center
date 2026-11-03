import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, type DataSource, type Dataset, type FieldInfo } from '../api'
import ScopeSelect from '../components/ScopeSelect'
import CategorySelect from '../components/CategorySelect'
import { t } from '../i18n'

const TYPE_LABEL: Record<string, string> = { elasticsearch: 'Elasticsearch', prometheus: 'Prometheus / Thanos', postgresql: 'PostgreSQL', mssql: 'SQL Server' }

// Yeni rapor: 1) ad ve grup 2) veri kaynağı ve veri seti 3) zaman alanı → oluştur, kolonları tasarım ekranında seç.
export default function NewReport() {
  const nav = useNavigate()
  const [sources, setSources] = useState<DataSource[]>([])
  const [name, setName] = useState('')
  const [scope, setScope] = useState(new URLSearchParams(useLocation().search).get('ortam') ?? '')
  const [group, setGroup] = useState('')
  const [description, setDescription] = useState('')
  const [dsId, setDsId] = useState<number | null>(null)
  const [datasets, setDatasets] = useState<Dataset[] | null>(null)
  const [dsFilter, setDsFilter] = useState('')
  const [dataset, setDataset] = useState('')
  const [fields, setFields] = useState<FieldInfo[] | null>(null)
  const [timeField, setTimeField] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [promql, setPromql] = useState('')
  const [step, setStep] = useState('1h')
  const dsType = sources.find(s => s.id === dsId)?.type
  const isProm = dsType === 'prometheus'
  const isSqlSource = dsType === 'postgresql' || dsType === 'mssql'
  const [sqlMode, setSqlMode] = useState(false)   // SQL kaynağında: tablo seçimi yerine özel sorgu
  const [sql, setSql] = useState('')
  const [sample, setSample] = useState<Record<string, unknown>[] | null>(null)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    api.datasources().then(r => { setSources(r); if (r[0]) setDsId(r[0].id) }).catch(e => setError(e.message))
  }, [])
  useEffect(() => {
    if (dsId == null) return
    setDatasets(null); setDataset(''); setFields(null); setSample(null); setSqlMode(false)
    api.datasets(dsId).then(setDatasets).catch(e => setError(e.message))
  }, [dsId])
  useEffect(() => {
    if (dsId == null || !dataset || sqlMode) return
    setFields(null); setTimeField('')
    api.fields(dsId, dataset).then(f => {
      setFields(f)
      const dates = f.filter(x => x.type === 'date')
      setTimeField(dates.find(x => x.name === '@timestamp')?.name ?? dates[0]?.name ?? '')
    }).catch(e => setError(e.message))
  }, [dsId, dataset])

  const testSql = () => {
    if (dsId == null || !sql.trim()) return
    setProbing(true); setError(''); setFields(null); setSample(null); setDataset('')
    api.probe(dsId, sql.trim(), 5)
      .then(r => {
        setDataset(sql.trim()); setFields(r.fields); setSample(r.rows)
        setTimeField(r.fields.find(x => x.type === 'date')?.name ?? '')
      })
      .catch(e => setError(e.message))
      .finally(() => setProbing(false))
  }

  const dateFields = useMemo(() => (fields ?? []).filter(f => f.type === 'date'), [fields])
  const shown = (datasets ?? []).filter(d => d.name.toLowerCase().includes(dsFilter.toLowerCase()))
  const ready = name.trim().length >= 3 && scope && group.trim() && dsId != null && dataset && timeField

  const create = async () => {
    if (!ready || dsId == null) return
    setSaving(true); setError('')
    try {
      const tpl = await api.createTemplate({ name: name.trim(), scope: scope.trim() || 'Genel', group: group.trim() || 'Genel', description, datasource_id: dsId, dataset, time_field: timeField, step: isProm ? step : undefined })
      nav(`/tasarim/${tpl.id}?yeni=1`)
    } catch (e) { setError((e as Error).message); setSaving(false) }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link to="/raporlar">{t('Raporlar')}</Link> › {t('Yeni rapor')}</div>
          <h1>{t('Yeni rapor')}</h1>
          <div className="lead">{t('Veri setini ve zaman alanını seç. Kolonları, filtreleri ve Excel ayarlarını bir sonraki adımda belirleyeceksin.')}</div>
        </div>
        <div className="actions">
          <Link to="/raporlar" className="btn">{t('Vazgeç')}</Link>
          <button className="btn primary" onClick={create} disabled={!ready || saving}>{saving && <span className="spinner" />}{t('Oluştur ve kolonları seç')}</button>
        </div>
      </div>
      {error && <div className="banner err" role="alert">{error}</div>}

      <div className="new-grid">
        <section className="card card-pad step" aria-labelledby="s1">
          <h2 id="s1"><span className="step-no">1</span>{t('Rapor')}</h2>
          <label className="field">{t('Rapor adı')}<input value={name} onChange={e => setName(e.target.value)} placeholder={t('ör. Aylık yetki değişiklikleri')} autoFocus /></label>
          <ScopeSelect value={scope} onChange={setScope} />
          <CategorySelect scope={scope} value={group} onChange={setGroup} />
          <label className="field">{t('Açıklama')}<textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder={t('Raporun neyi gösterdiği; Raporlar ekranında görünür')} /></label>
        </section>

        <section className="card card-pad step" aria-labelledby="s2">
          <h2 id="s2"><span className="step-no">2</span>{isProm ? t('Sorgu') : t('Veri seti')}</h2>
          <label className="field">{t('Veri kaynağı')}
            <select value={dsId ?? ''} onChange={e => setDsId(Number(e.target.value))}>
              {sources.map(s => <option key={s.id} value={s.id}>{s.name} ({TYPE_LABEL[s.type] ?? s.type})</option>)}
            </select></label>
          {isProm ? (
            <>
              <label className="field">{t('PromQL sorgusu')}
                <textarea rows={6} className="mono" value={promql} onChange={e => setPromql(e.target.value)}
                  placeholder={t('ör. {query}', { query: 'sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[1d])) > 0' })} /></label>
              <label className="field">{t('Adım (her satır bir adımın değeri)')}
                <select value={step} onChange={e => setStep(e.target.value)}>
                  {[['5m', t('5 dakika')], ['15m', t('15 dakika')], ['1h', t('1 saat')], ['6h', t('6 saat')], ['1d', t('1 gün')], ['1w', t('1 hafta')]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></label>
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!promql.trim()} onClick={() => setDataset(promql.trim())}>{t('Sorguyu test et')}</button>
              <span className="hint">{t('Etiketler (namespace, pod, instance…) kolon, filtre ve parametre olarak kullanılabilir; değer "value" kolonudur.')}</span>
            </>
          ) : isSqlSource && sqlMode ? (
            <>
              <div className="seg" role="radiogroup" aria-label={t('Veri seti türü')}>
                <button role="radio" aria-checked={false} onClick={() => { setSqlMode(false); setDataset(''); setFields(null); setSample(null) }}>{t('Tablo / görünüm')}</button>
                <button role="radio" aria-checked={true} className="on">{t('Özel SQL sorgusu')}</button>
              </div>
              <label className="field">{t('SELECT sorgusu')}
                <textarea rows={10} className="mono sql-editor" value={sql} spellCheck={false}
                  onChange={e => { setSql(e.target.value); setDataset(''); setFields(null); setSample(null) }}
                  placeholder={t('ör.') + '\nSELECT o.created_at, c.customer_no, o.amount, o.channel\nFROM orders o JOIN customers c ON c.id = o.customer_id\nWHERE o.amount > 100000'} /></label>
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!sql.trim() || probing} onClick={testSql}>
                {probing && <span className="spinner" />}{t('Sorguyu test et')}</button>
              <span className="hint">
                {dsType === 'postgresql' ? t('Tek bir SELECT (veya WITH … SELECT) yazın; sonuçta bir tarih kolonu olmalı.') : t('Tek bir SELECT yazın; sonuçta bir tarih kolonu olmalı.')}
                {' '}{t('Dönem, filtre ve sıralama sorgunun dışından uygulanır; sorguya tarih koşulu yazmanıza gerek yok. Hesaplanan kolonlara AS ile ad verin.')}
                {dsType === 'mssql' && <> {t('datetimeoffset kolonları için CAST(x AS datetime2) kullanın.')}</>}
              </span>
            </>
          ) : (
            <>
              {isSqlSource && (
                <div className="seg" role="radiogroup" aria-label={t('Veri seti türü')}>
                  <button role="radio" aria-checked={true} className="on">{t('Tablo / görünüm')}</button>
                  <button role="radio" aria-checked={false} onClick={() => { setSqlMode(true); setDataset(''); setFields(null) }}>{t('Özel SQL sorgusu')}</button>
                </div>
              )}
              <label className="field">{t('Veri seti ara')}<input type="search" value={dsFilter} onChange={e => setDsFilter(e.target.value)} placeholder={t('ör. logs')} /></label>
              <div className="pick-list" role="listbox" aria-label={t('Veri setleri')}>
                {datasets === null && <div className="empty">{t('Yükleniyor…')}</div>}
                {shown.map(d => (
                  <button key={d.name} role="option" aria-selected={dataset === d.name} className="pick" onClick={() => setDataset(d.name)}>
                    <span className="mono">{d.name}</span><span className="type">{d.kind}</span>
                  </button>
                ))}
                {datasets && shown.length === 0 && <div className="empty">{t('Eşleşen veri seti yok.')}</div>}
              </div>
            </>
          )}
        </section>

        <section className="card card-pad step" aria-labelledby="s3">
          <h2 id="s3"><span className="step-no">3</span>{isProm ? t('Sorgu sonucu') : t('Zaman alanı')}</h2>
          {!dataset && <span className="hint">{isProm || sqlMode ? t('Sorguyu yazıp "Sorguyu test et"e bas.') : t('Önce bir veri seti seç.')}</span>}
          {sqlMode && sample && fields && (
            <div className="sql-sample">
              <span className="hint">{t('Sorgu çalıştı · {cols} kolon · ilk {rows} satır', { cols: fields.length, rows: sample.length })}</span>
              <div className="table-wrap">
                <table className="simple light">
                  <thead><tr>{fields.map(f => <th key={f.name}>{f.name}<small className="type"> {f.type === 'date' ? t('tarih') : f.type === 'keyword' ? t('metin') : t('sayı')}</small></th>)}</tr></thead>
                  <tbody>{sample.map((r, i) => <tr key={i}>{fields.map(f => <td key={f.name}>{r[f.name] == null ? '–' : String(r[f.name])}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
          {isProm && fields && (
            <div className="summary">
              <div><span>{t('Etiketler')}</span><b>{fields.filter(f => f.type === 'keyword').map(f => f.name).join(', ') || '–'}</b></div>
              <div><span>{t('Adım')}</span><b>{step}</b></div>
            </div>
          )}
          {dataset && fields === null && <span className="hint">{t('Alanlar okunuyor…')}</span>}
          {fields && (
            <>
              <label className="field">{t('Dönem filtresi bu alana uygulanır')}
                <select value={timeField} onChange={e => setTimeField(e.target.value)}>
                  {dateFields.length === 0 && <option value="">{t('Tarih tipinde alan yok')}</option>}
                  {dateFields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                </select></label>
              <div className="summary">
                <div><span>{t('Veri seti')}</span><b className="mono">{sqlMode ? t('Özel SQL sorgusu') : dataset}</b></div>
                <div><span>{t('Alan sayısı')}</span><b>{fields.length}</b></div>
                <div><span>{t('İlk kolon')}</span><b>{t('Tarih ({field})', { field: timeField || '–' })}</b></div>
              </div>
              <span className="hint">{t('Oluşturduktan sonra Rapor tasarımı ekranında kolonları ekleyip sıralayacak, sabit filtreleri ve raporu alan kişinin seçebileceği parametreleri tanımlayacaksın.')}</span>
            </>
          )}
        </section>
      </div>
    </>
  )
}
