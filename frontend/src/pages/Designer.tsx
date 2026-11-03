import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { can, api, type Column, type ColumnFormat, type Definition, type FieldInfo, type Filter, type Template, type TemplateSummary, isSql } from '../api'
import { Grip, IconPlus, IconTrash } from '../components/Icons'
import ScopeSelect from '../components/ScopeSelect'
import CategorySelect from '../components/CategorySelect'
import { t } from '../i18n'

const FORMATS: { v: ColumnFormat; label: string }[] = [
  { v: 'text', label: t('Metin') }, { v: 'datetime', label: t('Tarih · gg.aa.yyyy ss:dd:nn') }, { v: 'list', label: t('Liste → satır satır') },
  { v: 'badge', label: t('Etiket (renkli)') }, { v: 'mono', label: t('Sabit genişlikli') },
]
const OPS: { v: Filter['op']; label: string }[] = [
  { v: 'eq', label: '=' }, { v: 'neq', label: '≠' }, { v: 'in', label: `∈ ${t('(virgülle)')}` }, { v: 'not_in', label: `∉ ${t('(virgülle)')}` },
  { v: 'exists', label: t('dolu') }, { v: 'not_exists', label: t('boş') },
  { v: 'gt', label: '>' }, { v: 'gte', label: '≥' }, { v: 'lt', label: '<' }, { v: 'lte', label: '≤' },
  { v: 'prefix', label: t('ile başlar (virgülle)') }, { v: 'not_prefix', label: t('ile başlamaz (virgülle)') },
]
const OP_TEXT: Partial<Record<Filter['op'], string>> = { prefix: t('ile başlar'), not_prefix: t('ile başlamaz') }
const opText = (op: Filter['op']) => OP_TEXT[op] ?? OPS.find(o => o.v === op)?.label.split(' ')[0] ?? op

function ColRow({ col, onChange, onRemove }: { col: Column; onChange: (c: Column) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.field })
  return (
    <tr ref={setNodeRef} className={`sort-row${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition, position: 'relative', zIndex: isDragging ? 2 : undefined, borderBottom: '1px solid #EEF1F4' }}>
      <td><button className="grip" {...attributes} {...listeners} aria-label={t('{label} kolonunu taşı', { label: col.label })}><Grip /></button></td>
      <td><input className="inline-input" aria-label={t('Excel başlığı')} value={col.label} onChange={e => onChange({ ...col, label: e.target.value })} /></td>
      <td className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{col.field}</td>
      <td>
        <select className="inline-input" aria-label={t('Biçim')} value={col.format} onChange={e => onChange({ ...col, format: e.target.value as ColumnFormat })}>
          {FORMATS.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
        </select>
      </td>
      <td><input className="inline-input num" type="number" min={6} max={120} aria-label={t('Excel kolon genişliği')} value={col.width}
        onChange={e => onChange({ ...col, width: Number(e.target.value) || 10 })} /></td>
      <td><button className="icon-btn" onClick={onRemove} aria-label={t('{label} kolonunu kaldır', { label: col.label })}><IconTrash /></button></td>
    </tr>
  )
}

export default function Designer() {
  const params = useParams()
  const nav = useNavigate()
  const [list, setList] = useState<TemplateSummary[]>([])
  const [tpl, setTpl] = useState<Template | null>(null)
  const [def, setDef] = useState<Definition | null>(null)
  const [name, setName] = useState('')
  const [fields, setFields] = useState<FieldInfo[]>([])
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [nf, setNf] = useState<{ field: string; op: Filter['op']; value: string }>({ field: '', op: 'eq', value: '' })
  const [np, setNp] = useState({ field: '', label: '' })
  const [npBusy, setNpBusy] = useState(false)
  const [sqlBusy, setSqlBusy] = useState(false)
  const [group, setGroup] = useState('')
  const [scope, setScope] = useState('')
  const isNew = new URLSearchParams(useLocation().search).has('yeni')

  useEffect(() => { api.templates().then(setList).catch(e => setMsg({ kind: 'err', text: e.message })) }, [])
  const id = params.id ? Number(params.id) : list[0]?.id
  useEffect(() => {
    if (!id) return
    api.template(id).then(r => {
      setTpl(r); setDef(structuredClone(r.definition)); setName(r.name); setGroup(r.group); setScope(r.scope)
      api.fields(r.definition.datasource_id, r.definition.dataset).then(setFields).catch(e => setMsg({ kind: 'err', text: e.message }))
    }).catch(e => setMsg({ kind: 'err', text: e.message }))
  }, [id])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const used = useMemo(() => new Set(def?.columns.map(c => c.field)), [def])
  const dirty = useMemo(() => tpl && def && (JSON.stringify(def) !== JSON.stringify(tpl.definition) || name !== tpl.name || group !== tpl.group || scope !== tpl.scope), [tpl, def, name, group, scope])

  if (!def || !tpl) return msg ? <div className={`banner ${msg.kind}`}>{msg.text}</div> : <div className="hint">{t('Yükleniyor…')}</div>

  const upd = (patch: Partial<Definition>) => { setDef({ ...def, ...patch }); setMsg(null) }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const cols = def.columns
    upd({ columns: arrayMove(cols, cols.findIndex(c => c.field === e.active.id), cols.findIndex(c => c.field === e.over!.id)) })
  }
  const addField = (f: FieldInfo) => upd({ columns: [...def.columns, { field: f.name, label: f.name, width: 18, format: f.type === 'date' ? 'datetime' : 'text' }] })
  const addFilter = () => {
    if (!nf.field) return
    const value = nf.op === 'in' || nf.op === 'not_in' || nf.op === 'prefix' || nf.op === 'not_prefix' ? nf.value.split(',').map(s => s.trim()).filter(Boolean)
      : nf.op === 'exists' || nf.op === 'not_exists' ? null
      : ['gt', 'gte', 'lt', 'lte'].includes(nf.op) && nf.value.trim() !== '' && !isNaN(Number(nf.value)) ? Number(nf.value)
      : nf.value
    upd({ fixed_filters: [...def.fixed_filters, { field: nf.field, op: nf.op, value }] })
    setNf({ field: '', op: 'eq', value: '' })
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await api.saveTemplate(tpl.id, { name, scope: scope.trim() || 'Genel', group: group.trim() || 'Genel', definition: def })
      setTpl(r); setDef(structuredClone(r.definition))
      setMsg({ kind: 'ok', text: t('Şablon kaydedildi · sürüm {v}', { v: r.version }) })
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) } finally { setSaving(false) }
  }
  const addParam = async () => {
    if (!np.field) return
    setNpBusy(true)
    try {
      const options = await api.values(def.datasource_id, def.dataset, np.field)
      if (options.length === 0) { setMsg({ kind: 'err', text: t('{field} alanında değer bulunamadı', { field: np.field }) }); return }
      upd({ params: [...def.params, { field: np.field, label: np.label.trim() || np.field, options }] })
      setNp({ field: '', label: '' })
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) } finally { setNpBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(t('"{name}" raporu silinsin mi?\n\nRapor listelerden kalkar. Daha önce alınmış export\'lar ve dosyaları denetim kaydı olarak saklanmaya devam eder.', { name: tpl.name }))) return
    try { await api.deleteTemplate(tpl.id); nav(`/raporlar?ortam=${encodeURIComponent(tpl.scope)}`) }
    catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) }
  }
  const checkSql = async () => {
    setSqlBusy(true)
    try {
      const f = await api.fields(def.datasource_id, def.dataset)
      setFields(f)
      const missing = def.columns.map(c => c.field).filter(c => !f.some(x => x.name === c))
      setMsg(missing.length ? { kind: 'err', text: t('Sorgu çalıştı ama şu kolonlar artık yok: {list}', { list: missing.join(', ') }) }
        : { kind: 'ok', text: t('Sorgu çalıştı · {n} kolon. Kaydetmeyi unutmayın.', { n: f.length }) })
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }) } finally { setSqlBusy(false) }
  }
  const keywordFields = fields.filter(f => ['keyword', 'boolean', 'long', 'integer', 'constant_keyword'].includes(f.type) && !def.params.some(p => p.field === f.name))
  const shown = fields.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">{t('Rapor tasarımı')} › {tpl.name}</div>
          <h1>{t('Şablon: kolonlar ve Excel çıktısı')}</h1>
          <div className="lead">{t('Veri kaynağı')} #{def.datasource_id} · {t('veri seti')} <b className="mono">{isSql(def.dataset) ? t('özel SQL sorgusu') : def.dataset}</b> · {t('zaman alanı')} <b className="mono">{def.time_field}</b> · {t('sürüm {v}', { v: tpl.version })}</div>
        </div>
        <div className="actions">
          {list.length > 1 && (
            <select className="btn" aria-label={t('Şablon seç')} value={tpl.id} onChange={e => nav(`/tasarim/${e.target.value}`)}>
              {list.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          {can('admin') && <button className="btn danger-ghost" onClick={remove}><IconTrash size={16} />{t('Raporu sil')}</button>}
          <Link to={`/rapor/${tpl.id}`} className="btn">{t('Önizle')}</Link>
          <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving && <span className="spinner" />}{t('Şablonu kaydet')}</button>
        </div>
      </div>
      {isSql(tpl.definition.dataset) && (
        <section className="card card-pad sql-card" aria-labelledby="sql-baslik">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 id="sql-baslik">{t('SQL sorgusu')}</h2>
            <button className="btn sm" disabled={sqlBusy || !def.dataset.trim()} onClick={checkSql}>{sqlBusy && <span className="spinner" />}{t('Sorguyu doğrula')}</button>
          </div>
          <textarea rows={8} className="mono sql-editor" spellCheck={false} value={def.dataset} aria-labelledby="sql-baslik"
            onChange={e => upd({ dataset: e.target.value })} />
          <span className="hint">{t('Değişiklik, şablon kaydedilince yeni bir sürüm olarak saklanır. Sorgudan çıkan bir kolon şablonda kullanılıyorsa raporlar hata verir; önce doğrulayın.')}</span>
        </section>
      )}
      {isNew && tpl.version === 1 && !msg && (
        <div className="banner warn" role="status">
          {t('Rapor oluşturuldu. Soldaki listeden alanları + ile ekle, sırala, gerekirse sabit filtre ve parametre tanımla, sonra')} <b>{t('Şablonu kaydet')}</b>.
        </div>
      )}
      {msg && <div className={`banner ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>}

      <div className="designer">
        <section className="card fields" aria-label={t('Kullanılabilir alanlar')}>
          <div className="card-head" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <h2>{t('Alanlar')} <span className="hint">· {fields.length}</span></h2>
            <label className="field">{t('Alan ara')}
              <input type="search" placeholder={t('ör. user')} value={search} onChange={e => setSearch(e.target.value)} /></label>
            <span className="hint">{t('Kaynaktaki alan listesi otomatik okunur. + ile rapora ekle.')}</span>
          </div>
          <ul className="field-list">
            {shown.map(f => (
              <li key={f.name} className={`field-item${used.has(f.name) ? ' used' : ''}`}>
                <span className="mono" style={{ wordBreak: 'break-all' }}>{f.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="type">{f.type}</span>
                  {!used.has(f.name) && <button onClick={() => addField(f)} aria-label={t('{name} alanını ekle', { name: f.name })}><IconPlus /></button>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card cols" aria-label={t('Rapor kolonları')}>
          <div className="card-head">
            <h2>{t('Rapor kolonları')} <span className="hint">· {def.columns.length} · {t('Excel\'deki sırası')}</span></h2>
            <span className="hint">{t('Tutamaçtan sürükle · başlığı yeniden adlandır · çöp kutusuyla kaldır')}</span>
          </div>
          <div className="table-wrap">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <table className="simple light" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><span className="sr-only">{t('Sırala')}</span></th>
                    <th>{t('Excel başlığı')}</th><th>{t('Alan')}</th><th>{t('Biçim')}</th><th style={{ width: 84 }}>{t('Genişlik')}</th>
                    <th style={{ width: 52 }}><span className="sr-only">{t('Kaldır')}</span></th>
                  </tr>
                </thead>
                <SortableContext items={def.columns.map(c => c.field)} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {def.columns.map((c, i) => (
                      <ColRow key={c.field} col={c}
                        onChange={nc => upd({ columns: def.columns.map((x, j) => j === i ? nc : x) })}
                        onRemove={() => upd({ columns: def.columns.filter((_, j) => j !== i) })} />
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </DndContext>
          </div>
        </section>

        <section className="side" aria-label={t('Şablon ayarları')}>
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{t('Genel')}</h2>
            <label className="field">{t('Rapor adı')}<input value={name} onChange={e => { setName(e.target.value); setMsg(null) }} /></label>
            <ScopeSelect value={scope} onChange={s => { setScope(s); setMsg(null) }} />
            <CategorySelect scope={scope} value={group} onChange={g => { setGroup(g); setMsg(null) }} />
            <label className="field">{t('Açıklama')}<textarea rows={2} value={def.description} onChange={e => upd({ description: e.target.value })} /></label>
            <label className="field">{t('Excel başlığı (Rapor Bilgisi)')}<input value={def.meta.title} onChange={e => upd({ meta: { ...def.meta, title: e.target.value } })} /></label>
            <label className="field">{t('Kapsam metni')}<textarea rows={2} value={def.meta.scope} onChange={e => upd({ meta: { ...def.meta, scope: e.target.value } })} /></label>
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{t('Sabit filtreler')}</h2>
            {def.fixed_filters.map((f, i) => (
              <div key={i} className="filter-item" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <span><span className="mono">{f.field}</span> {opText(f.op)} {Array.isArray(f.value) ? f.value.join(', ') : String(f.value ?? '')}</span>
                <button className="icon-btn" aria-label={t('Filtreyi kaldır')} onClick={() => upd({ fixed_filters: def.fixed_filters.filter((_, j) => j !== i) })}><IconTrash /></button>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8 }}>
              <select className="inline-input" aria-label={t('Filtre alanı')} value={nf.field} onChange={e => setNf({ ...nf, field: e.target.value })}>
                <option value="">{t('Alan seç…')}</option>
                {fields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
              <select className="inline-input" aria-label={t('Operatör')} value={nf.op} onChange={e => setNf({ ...nf, op: e.target.value as Filter['op'] })}>
                {OPS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              {nf.op !== 'exists' && nf.op !== 'not_exists' &&
                <input className="inline-input" style={{ gridColumn: '1 / -1' }} aria-label={t('Değer')} placeholder={t('değer')} value={nf.value} onChange={e => setNf({ ...nf, value: e.target.value })} />}
            </div>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={addFilter} disabled={!nf.field}><IconPlus />{t('Filtre ekle')}</button>
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{t('Parametreler')}</h2>
            <span className="hint">{t('Raporu alan kişinin seçebileceği filtreler (ör. olay tipi). Seçenekler alandaki değerlerden okunur.')}</span>
            {def.params.map((p, i) => (
              <div key={p.field} className="param-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span><b>{p.label}</b> · <span className="mono">{p.field}</span></span>
                  <button className="icon-btn" aria-label={t('{label} parametresini kaldır', { label: p.label })} onClick={() => upd({ params: def.params.filter((_, j) => j !== i) })}><IconTrash /></button>
                </div>
                <div className="opts">
                  {p.options.map(o => (
                    <span key={o} className="tag" style={{ padding: '2px 4px 2px 8px', gap: 2 }}>{o}
                      <button className="grip" aria-label={t('{option} seçeneğini kaldır', { option: o })} onClick={() => upd({ params: def.params.map((x, j) => j === i ? { ...x, options: x.options.filter(y => y !== o) } : x) })}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <select className="inline-input" aria-label={t('Parametre alanı')} value={np.field} onChange={e => setNp({ ...np, field: e.target.value })}>
                <option value="">{t('Alan seç…')}</option>
                {keywordFields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
              <input className="inline-input" aria-label={t('Parametre adı')} placeholder={t('ekranda görünen ad')} value={np.label} onChange={e => setNp({ ...np, label: e.target.value })} />
            </div>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={addParam} disabled={!np.field || npBusy}>{npBusy ? <span className="spinner" /> : <IconPlus />}{t('Parametre ekle')}</button>
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{t('Satır kuralları')}</h2>
            {def.row_rules.map((r, i) => (
              <div key={i} className="rule">
                <input type="color" aria-label={t('Satır rengi')} value={`#${r.fill}`} className="swatch" style={{ padding: 0, width: 24, height: 24 }}
                  onChange={e => upd({ row_rules: def.row_rules.map((x, j) => j === i ? { ...x, fill: e.target.value.slice(1).toUpperCase() } : x) })} />
                <span><span className="mono">{r.field}</span> = {r.equals}</span>
              </div>
            ))}
            {def.row_rules.length === 0 && <span className="hint">{t('Kural yok')}</span>}
          </div>

          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2>{t('Rapor Bilgisi notları')}</h2>
            {def.meta.notes.map(([k, v], i) => (
              <label key={i} className="field">{k}
                <textarea rows={2} value={v} onChange={e => upd({ meta: { ...def.meta, notes: def.meta.notes.map((n, j) => j === i ? [k, e.target.value] : n) } })} />
              </label>
            ))}
            <span className="hint">{t('Excel\'de ayrıca dönem, sorgu, eksiksizlik kontrolü, veri SHA-256 ve imza alanları otomatik eklenir.')}</span>
          </div>
        </section>
      </div>
    </>
  )
}
