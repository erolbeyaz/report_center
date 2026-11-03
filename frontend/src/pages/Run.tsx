import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ColumnMovedEvent, type RowClassParams, type SortChangedEvent } from 'ag-grid-community'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { can, api, tz, type Column, type ExportRecord, type Preview, type Template } from '../api'
import { Grip, IconCheck, IconColumns, IconDownload, IconEdit, IconEye, IconEyeOff } from '../components/Icons'
import DateRangePicker, { quickRanges, toValue, type Range } from '../components/DateRangePicker'
import { t } from '../i18n'
import { tn } from '../components/plural'

ModuleRegistry.registerModules([AllCommunityModule])

const gridTheme = themeQuartz.withParams({
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  fontSize: 13,
  headerBackgroundColor: '#1F4E78',
  headerTextColor: '#FFFFFF',
  headerFontWeight: 600,
  headerColumnResizeHandleColor: '#7FB2E0',
  borderColor: '#E8ECF0',
  rowHoverColor: '#F3F7FB',
  oddRowBackgroundColor: '#FAFBFC',
  accentColor: '#1F4E78',
  wrapperBorderRadius: 0,
  wrapperBorder: false,
  cellHorizontalPadding: 12,
})

const QUICK_PILLS = ['this-month', 'last-7d', 'today', 'last-month']

interface ColState { field: string; visible: boolean }

function SortableChip({ col, label, onToggle }: { col: ColState; label: string; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.field })
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, boxShadow: isDragging ? '0 6px 18px rgba(15,34,53,.18)' : undefined }
  return (
    <span ref={setNodeRef} style={style} className={`col-chip${col.visible ? '' : ' off'}`} {...attributes} {...listeners}
      aria-label={t('{label} kolonu, sürükleyerek taşı', { label })}>
      <Grip />{label}
      <button type="button" onPointerDown={e => e.stopPropagation()} onClick={onToggle}
        aria-label={col.visible ? t('{label} kolonunu gizle', { label }) : t('{label} kolonunu göster', { label })} aria-pressed={col.visible}>
        {col.visible ? <IconEye /> : <IconEyeOff />}
      </button>
    </span>
  )
}

function BadgeCell({ value }: { value: string | null }) {
  return value ? <span className={`badge ${value}`}>{value}</span> : null
}

export default function Run() {
  const id = Number(useParams().id)
  const [tpl, setTpl] = useState<Template | null>(null)
  const quick = useMemo(() => quickRanges(), [])
  const pills = useMemo(() => [
    ...QUICK_PILLS.map(id => quick.find(q => q.id === id)!),
  ], [quick])
  const [range, setRange] = useState<Range>(() => quick.find(q => q.id === 'this-month')!)
  const { from, to } = range
  const [params, setParams] = useState<Record<string, string | null>>({})
  const [cols, setCols] = useState<ColState[]>([])
  const [colPanel, setColPanel] = useState(false)
  const [data, setData] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<ExportRecord | null>(null)
  // Başlığa tıklama: sunucuda sıralanır (önizleme ve Excel aynı sırada); yoksa şablonun varsayılan sıralaması
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const reqId = useRef(0)

  useEffect(() => {
    api.template(id).then(x => {
      setTpl(x)
      setCols(x.definition.columns.map(c => ({ field: c.field, visible: true })))
    }).catch(e => setError(e.message))
  }, [id])

  const byField = useMemo(() => Object.fromEntries((tpl?.definition.columns ?? []).map(c => [c.field, c])) as Record<string, Column>, [tpl])
  const visibleFields = cols.filter(c => c.visible).map(c => c.field)
  const sortList = sort ? [sort] : undefined
  const body = useMemo(() => ({ period_from: from, period_to: to, params, columns: visibleFields, sort: sortList }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, to, params, visibleFields.join('|'), sort])

  // Kolon değişikliği önizlemeyi yeniden sorgulamaz; dönem, parametreler ve sıralama sorgular.
  const queryKey = JSON.stringify({ from, to, params, sort })
  useEffect(() => {
    if (!tpl) return
    const my = ++reqId.current
    setLoading(true); setError('')
    const timer = setTimeout(() => {
      api.preview(id, { period_from: from, period_to: to, params, sort: sortList })
        .then(d => { if (my === reqId.current) setData(d) })
        .catch(e => { if (my === reqId.current) { setError(e.message); setData(null) } })
        .finally(() => { if (my === reqId.current) setLoading(false) })
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, queryKey])

  const chooseRange = (r: Range) => { setRange(r); setExported(null) }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    setCols(cs => arrayMove(cs, cs.findIndex(c => c.field === e.active.id), cs.findIndex(c => c.field === e.over!.id)))
  }

  const colDefs = useMemo<ColDef[]>(() => cols.filter(c => c.visible).map(c => {
    const col = byField[c.field]
    const def: ColDef = { field: c.field, headerName: col?.label ?? c.field, valueGetter: p => p.data?.values?.[c.field] ?? null,
      width: Math.max(90, (col?.width ?? 18) * 8), resizable: true,
      sortable: true, sort: sort?.field === c.field ? sort.dir : null, comparator: () => 0 }  // satırlar sunucudan sıralı gelir
    if (col?.format === 'badge') def.cellRenderer = BadgeCell
    if (col?.format === 'mono' || col?.format === 'list') def.cellStyle = { fontFamily: 'var(--mono)', fontSize: '12px' }
    if (col?.format === 'list') { def.wrapText = true; def.autoHeight = true; def.cellStyle = { ...def.cellStyle as object, whiteSpace: 'pre-line', lineHeight: '1.5', paddingTop: 8, paddingBottom: 8 } }
    return def
  }), [cols, byField, sort])

  const onSortChanged = useCallback((e: SortChangedEvent) => {
    const c = e.api.getColumnState().find(s => s.sort)
    setSort(c ? { field: c.colId, dir: c.sort as 'asc' | 'desc' } : null)
    setExported(null)
  }, [])

  const onColumnMoved = useCallback((e: ColumnMovedEvent) => {
    if (!e.finished) return
    const order = e.api.getAllDisplayedColumns().map(c => c.getColId())
    setCols(cs => {
      const hidden = cs.filter(c => !c.visible)
      return [...order.map(f => ({ field: f, visible: true })), ...hidden]
    })
  }, [])

  const getRowStyle = useCallback((p: RowClassParams) => p.data?.fill ? { background: `#${p.data.fill}` } : undefined, [])

  const doExport = async () => {
    setExporting(true); setError(''); setExported(null)
    try { setExported(await api.export(id, body)) } catch (e) { setError((e as Error).message) } finally { setExporting(false) }
  }

  if (!tpl) return error ? <div className="banner err" role="alert">{error}</div> : <div className="hint">{t('Yükleniyor…')}</div>
  const d = tpl.definition
  const facet = d.params[0] ? data?.facets?.[d.params[0].field] ?? {} : {}
  if (d.columns.length === 0) {
    return (
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <h1>{tpl.name}</h1>
        <span className="lead">{t('Bu raporda henüz kolon yok. Önce hangi alanların raporda yer alacağını seç.')}</span>
        {can('designer') && <Link to={`/tasarim/${id}`} className="btn primary"><IconEdit />{t('Kolonları seç')}</Link>}
      </div>
    )
  }
  const partial = new Date(to) > new Date()

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb"><Link to="/raporlar">{t('Raporlar')}</Link> › <Link to={`/raporlar?ortam=${encodeURIComponent(tpl.scope)}`}>{tpl.scope}</Link> › <Link to={`/raporlar?ortam=${encodeURIComponent(tpl.scope)}&kategori=${encodeURIComponent(tpl.group)}`}>{tpl.group}</Link></div>
          <h1>{tpl.name}</h1>
          <div className="lead">{d.description}</div>
        </div>
        <div className="actions">
          {can('designer') && <Link to={`/tasarim/${id}`} className="btn"><IconEdit />{t('Şablonu düzenle')}</Link>}
          <button className="btn primary" onClick={doExport} disabled={exporting || loading || !data || data.total === 0 || !data.coverage?.complete}
            title={data && !data.coverage?.complete ? t('Seçilen dönemin bir kısmı kaynakta yok') : undefined}>
            {exporting ? <span className="spinner" /> : <IconDownload />}{t("Excel'e aktar")}
          </button>
        </div>
      </div>

      {exported && (
        <div className="banner ok" role="status">
          <IconCheck />
          <strong>{t('Rapor hazırlandı: {name}', { name: exported.file_name })}</strong>
          <span>{tn(exported.row_count, '{n} kayıt · kaynak sayısı ile eşleşti')}</span>
          <span className="mono" style={{ fontSize: 13 }}>sha256 {exported.file_sha256.slice(0, 8)}…{exported.file_sha256.slice(-7)}</span>
          <a className="btn sm primary" href={api.downloadUrl(exported.id)}><IconDownload />{t('İndir')}</a>
          <Link to="/gecmis" className="push">{t('Export geçmişinde gör')}</Link>
        </div>
      )}
      {error && <div className="banner err" role="alert">{error}</div>}

      <section className="card card-pad" aria-label={t('Parametreler')}>
        <div className="param-row">
          <span className="param-label">{t('Dönem')}</span>
          <DateRangePicker value={range} onChange={chooseRange} earliest={data?.coverage?.earliest} />
          <div className="pills" aria-label={t('Hızlı dönem')}>
            {pills.map(p => <button key={p.label} className="pill" aria-pressed={range.label === p.label} onClick={() => chooseRange(p)}>{p.label}</button>)}
          </div>
          <span className="hint" style={{ marginLeft: 'auto' }}>{tz.label}</span>
        </div>
        {d.params.map(p => (
          <div className="param-row" key={p.field}>
            <span className="param-label">{p.label}</span>
            <div className="pills">
              <button className="pill" aria-pressed={!params[p.field]} onClick={() => { setParams(s => ({ ...s, [p.field]: null })); setExported(null) }}>{t('Tümü')}</button>
              {p.options.map(o => (
                <button key={o} className="pill" aria-pressed={params[p.field] === o} onClick={() => { setParams(s => ({ ...s, [p.field]: o })); setExported(null) }}>
                  {o}{p.field === d.params[0]?.field && !params[p.field] && <span className="n">{facet[o] ?? 0}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        {d.fixed_filters.length > 0 && (
          <div className="param-row">
            <span className="param-label">{t('Sabit filtre')}</span>
            {d.meta.scope && <span className="tag">{t('Kapsam: {scope}', { scope: d.meta.scope })}</span>}
            <span className="hint">{t('Şablonda tanımlı; raporu alan kişi değiştiremez')}</span>
          </div>
        )}
      </section>

      <div className="stats">
        <div className="card stat"><span>{t('Kayıt')}</span><strong>{data?.total ?? '–'}</strong></div>
        {d.params[0]?.options.slice(0, 2).map(o => (
          <div key={o} className="card stat"><span>{d.params[0].label}: {o}</span>
            <strong style={{ color: o === 'rollback' ? 'var(--rollback)' : 'var(--brand)' }}>{data ? facet[o] ?? 0 : '–'}</strong></div>
        ))}
        <div className="card stat"><span>{t('Eksiksizlik')}</span>
          {data ? <span className="ok"><IconCheck />{tn(data.total, 'Kaynak: {n} kayıt')}</span> : <strong>–</strong>}
        </div>
      </div>

      {data?.coverage && !data.coverage.complete && (
        <div className="banner err" role="alert"><strong>{t('Dönem kaynakta tam değil.')}</strong> {data.coverage.message}
          {data.coverage.earliest && (
            <button className="btn sm push" onClick={() => chooseRange({ from: toValue(new Date(Math.ceil(new Date(data.coverage.earliest!).getTime() / 60000) * 60000)), to })}>{t('Dönemi en eski kayıttan başlat')}</button>
          )}
        </div>
      )}
      {partial && <div className="banner warn">{t('Seçilen dönem henüz bitmedi; alınacak rapor "kısmi" olarak işaretlenir.')}</div>}

      <section className="card" aria-label={t('Önizleme')} style={{ minWidth: 0 }}>
        <div className="card-head">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2>{t('Önizleme')}</h2>
            <span className="hint">{t('Excel çıktısı bu kolon sırası ve başlıklarla üretilir · başlıkları sürükleyerek de sıralayabilirsin')}</span>
            {loading && <span className="spinner" style={{ color: 'var(--brand)' }} aria-label={t('Yükleniyor')} />}
          </div>
          <button className="btn sm" onClick={() => setColPanel(v => !v)} aria-expanded={colPanel}>
            <IconColumns />{t('Kolonlar ({shown}/{all})', { shown: visibleFields.length, all: cols.length })}
          </button>
        </div>
        {colPanel && (
          <div className="col-panel">
            <span className="hint" style={{ fontSize: 13 }}>{t('Sürükleyerek sırala, göz simgesiyle gizle / göster. Değişiklik yalnızca bu çalıştırma için; kalıcı yapmak için şablonu düzenle.')}</span>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={cols.map(c => c.field)} strategy={horizontalListSortingStrategy}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {cols.map(c => <SortableChip key={c.field} col={c} label={byField[c.field]?.label ?? c.field}
                    onToggle={() => setCols(cs => cs.map(x => x.field === c.field ? { ...x, visible: !x.visible } : x))} />)}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
        <div style={{ height: 560 }}>
          <AgGridReact theme={gridTheme} rowData={data?.rows ?? []} columnDefs={colDefs} onColumnMoved={onColumnMoved} onSortChanged={onSortChanged}
            getRowStyle={getRowStyle} suppressDragLeaveHidesColumns animateRows={false}
            overlayNoRowsTemplate={loading ? t('Yükleniyor…') : t('Bu dönem ve filtre için kayıt yok.')}
            overlayLoadingTemplate={t('Yükleniyor…')} />
        </div>
        <div className="card-foot">
          <span className="mono" title={data?.query}>{t('Sorgu: {q}', { q: data?.query ?? '–' })}</span>
          {sort && <span>{t("Sıralama: {col} ({dir}) · Excel'e de uygulanır", { col: byField[sort.field]?.label ?? sort.field, dir: sort.dir === 'desc' ? t('azalan') : t('artan') })}</span>}
          {data && data.total > data.shown && <span>{t("Önizlemede ilk {shown} kayıt; Excel'de tamamı ({total}) yer alır", { shown: data.shown, total: data.total })}</span>}
        </div>
      </section>
    </>
  )
}
