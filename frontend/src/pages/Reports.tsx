import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { can, api, fmtDateTime, type Scope, type ScopeKind, type TemplateSummary } from '../api'
import { IconEdit, IconPlus } from '../components/Icons'
import { Chevron, KIND_ICON, KIND_ORDER, categoryStyle } from '../components/Glyphs'
import ReportPeek from '../components/ReportPeek'
import { lang, locale, t } from '../i18n'
import { tn } from '../components/plural'

const norm = (s: string) => s.toLocaleLowerCase(locale)
const ALL = '__tum__'
const WIDTH_KEY = 'rm:rapor-sutunlari'
const DEFAULT_W: [number, number] = [260, 250]
const MIN_W = 180, MAX_W = 480

function loadWidths(): [number, number] {
  try {
    const v = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? 'null')
    if (Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number')) return v as [number, number]
  } catch { /* erişilemiyorsa varsayılan */ }
  return DEFAULT_W
}
const clamp = (n: number) => Math.min(MAX_W, Math.max(MIN_W, Math.round(n)))

function ReportRow({ t: x, crumb, selected, onPick }: { t: TemplateSummary; crumb?: string; selected: boolean; onPick: () => void }) {
  return (
    <li className={`rx-report${selected ? ' selected' : ''}`} onClick={onPick}>
      <div className="rx-report-body">
        {crumb && <span className="rx-crumb">{crumb}</span>}
        <button type="button" className="rx-report-name linklike" onClick={e => { e.stopPropagation(); onPick() }} aria-pressed={selected}>{x.name}</button>
        <span className="rx-report-desc">{x.description}</span>
        <span className="rx-report-meta">
          <span className="rx-ds mono">{x.dataset}</span>
          {x.params.map(p => <span key={p} className="rx-param">{p}</span>)}
          <span>{x.last_export_at ? tn(x.export_count ?? 0, 'Son export {at} · {n} kez', { at: fmtDateTime(x.last_export_at) }) : t('Henüz export alınmadı')}</span>
        </span>
      </div>
      <div className="rx-report-actions" onClick={e => e.stopPropagation()}>
        {can('designer') && <Link to={`/tasarim/${x.id}`} className="icon-btn edit" aria-label={t('{name} şablonunu düzenle', { name: x.name })} title={t('Şablonu düzenle')}><IconEdit /></Link>}
        <Link to={`/rapor/${x.id}`} className="btn sm primary">{t('Çalıştır')}</Link>
      </div>
    </li>
  )
}

export default function Reports() {
  const [items, setItems] = useState<TemplateSummary[] | null>(null)
  const [scopes, setScopes] = useState<Scope[]>([])
  const [kinds, setKinds] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [widths, setWidths] = useState<[number, number]>(loadWidths)
  const [dragging, setDragging] = useState<number | null>(null)
  const [sp, setSp] = useSearchParams()
  useEffect(() => {
    Promise.all([api.templates(), api.scopes()])
      .then(([x, s]) => { setItems(x); setScopes(s.items); setKinds(s.kinds) })
      .catch(e => setError(e.message))
  }, [])
  useEffect(() => { try { localStorage.setItem(WIDTH_KEY, JSON.stringify(widths)) } catch { /* yoksay */ } }, [widths])

  const q = sp.get('q') ?? ''
  const all = items ?? []
  const scopeName = sp.get('ortam') ?? scopes.find(s => s.report_count > 0)?.name ?? scopes[0]?.name ?? ''
  const cat = sp.get('kategori') ?? ALL
  const peekId = Number(sp.get('onizle')) || null
  const set = useCallback((patch: Record<string, string | null>) => {
    setSp(prev => {
      const n = new URLSearchParams(prev)
      Object.entries(patch).forEach(([k, v]) => v ? n.set(k, v) : n.delete(k))
      return n
    }, { replace: true })
  }, [setSp])
  const closePeek = useCallback(() => set({ onizle: null }), [set])

  // Sütun genişliği: tutamacı sürükle, ok tuşlarıyla ayarla, çift tıklayınca varsayılana dön.
  const startDrag = (i: number) => (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    const startX = e.clientX, start = widths[i]
    setDragging(i); document.body.classList.add('resizing')
    const move = (ev: PointerEvent) => setWidths(w => { const n = [...w] as [number, number]; n[i] = clamp(start + ev.clientX - startX); return n })
    const up = () => { setDragging(null); document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const keyResize = (i: number) => (e: RKeyboardEvent<HTMLButtonElement>) => {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
    if (d) { e.preventDefault(); setWidths(w => { const n = [...w] as [number, number]; n[i] = clamp(n[i] + d); return n }) }
  }
  const resetWidth = (i: number) => () => setWidths(w => { const n = [...w] as [number, number]; n[i] = DEFAULT_W[i]; return n })

  const byKind = useMemo(() => KIND_ORDER.map(k => [k, scopes.filter(s => s.kind === k)] as const).filter(([, l]) => l.length), [scopes])
  const scope = scopes.find(s => s.name === scopeName)
  const inScope = all.filter(x => x.scope === scopeName)
  const categories = useMemo(() => {
    const m = new Map<string, number>()
    inScope.forEach(x => m.set(x.group, (m.get(x.group) ?? 0) + 1))
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], lang))
  }, [inScope])
  const reports = inScope.filter(x => cat === ALL || x.group === cat).sort((a, b) => a.name.localeCompare(b.name, lang))
  const needle = norm(q.trim())
  const hits = needle ? all.filter(x => [x.name, x.description, x.group, x.scope, x.dataset, ...x.params].some(x => norm(x ?? '').includes(needle))) : []
  const peek = all.find(x => x.id === peekId)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Raporlar')}</h1>
          <div className="lead">{t('Ortamı, ardından kategoriyi seç; rapora tıklayıp önizle. {r} rapor · {s} ortam.', { r: all.length, s: scopes.length })}</div>
        </div>
        <div className="actions">
          <div className="rl-search" style={{ minWidth: 320 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6B7B" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
            <label className="sr-only" htmlFor="rq">{t('Tüm raporlarda ara')}</label>
            <input id="rq" type="search" placeholder={t('Tüm raporlarda ara')} value={q} onChange={e => set({ q: e.target.value })} />
          </div>
          {can('designer') && <Link to={`/yeni${scopeName ? `?ortam=${encodeURIComponent(scopeName)}` : ''}`} className="btn primary"><IconPlus size={16} />{t('Yeni rapor')}</Link>}
        </div>
      </div>
      {error && <div className="banner err" role="alert">{error}</div>}

      {items !== null && !error && scopes.length === 0 && !can('admin') ? (
        <section className="card card-pad no-access" role="status">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <div>
            <h2>{t('Henüz görebileceğiniz bir rapor yok')}</h2>
            <p className="lead">{t('Raporlar ortam ve kategori bazında yetkilendirilir. Erişim için sistem yöneticinize başvurun.')}</p>
          </div>
        </section>
      ) : needle ? (
        <section className="card" aria-label={t('Arama sonuçları')}>
          <div className="card-head"><h2>{tn(hits.length, '"{q}" için {n} rapor', { q })}</h2><button className="btn sm" onClick={() => set({ q: null })}>{t('Aramayı temizle')}</button></div>
          {hits.length ? <ul className="rx-reports">{hits.map(x => <ReportRow key={x.id} t={x} crumb={`${x.scope} › ${x.group}`} selected={x.id === peekId} onPick={() => set({ onizle: String(x.id) })} />)}</ul>
            : <div className="empty">{t('Eşleşen rapor yok.')}</div>}
        </section>
      ) : (
        <div className="rx card" style={{ gridTemplateColumns: `${widths[0]}px ${widths[1]}px minmax(0, 1fr)` }}>
          <nav className="rx-col rx-env" aria-label={t('Ortam')}>
            <div className="rx-col-head">{t('Ortam')}</div>
            <div className="rx-scroll">
              {byKind.map(([k, list]) => (
                <div key={k} className="rx-kind">
                  <div className="rx-kind-head">{t(kinds[k] ?? k)}</div>
                  {list.map(s => (
                    <button key={s.id} className={`rx-item${s.name === scopeName ? ' on' : ''}`} aria-current={s.name === scopeName}
                      onClick={() => set({ ortam: s.name, kategori: null, onizle: null })}>
                      <span className="rx-ico">{KIND_ICON[s.kind as ScopeKind]}</span>
                      <span className="rx-label" title={s.name}>{s.name}</span>
                      <span className="rl-n">{s.report_count}</span>
                      <Chevron />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </nav>

          <nav className="rx-col rx-cat" aria-label={t('Kategori')}>
            <div className="rx-col-head">{t('Kategori')}</div>
            <div className="rx-scroll">
              {/* Ortam sütunundaki tür başlığıyla aynı yükseklikte; satırlar iki sütunda aynı hizada başlar */}
              {scope && <div className="rx-kind-head" title={scope.name}>{scope.name}</div>}
              {scope && (
                <button className={`rx-item${cat === ALL ? ' on' : ''}`} aria-current={cat === ALL} onClick={() => set({ kategori: null })}>
                  <span className="rx-ico plain">{KIND_ICON[scope.kind as ScopeKind]}</span>
                  <span className="rx-label">{t('Tüm raporlar')}</span><span className="rl-n">{inScope.length}</span><Chevron />
                </button>
              )}
              {categories.map(([c, n]) => {
                const st = categoryStyle(c)
                return (
                  <button key={c} className={`rx-item${cat === c ? ' on' : ''}`} aria-current={cat === c} onClick={() => set({ kategori: c })}>
                    <span className="rx-ico" style={{ background: st.bg, color: st.fg }}>{st.icon}</span>
                    <span className="rx-label" title={c}>{c}</span><span className="rl-n">{n}</span><Chevron />
                  </button>
                )
              })}
              {scope && categories.length === 0 && <div className="empty">{t('Bu ortamda henüz rapor yok.')}</div>}
            </div>
          </nav>

          <section className="rx-col rx-rep" aria-label={t('Raporlar')}>
            <div className="rx-col-head rx-rep-head">
              <span>{scope ? <>{scope.name}<span className="rx-sep">›</span>{cat === ALL ? t('Tüm raporlar') : cat}</> : t('Raporlar')}</span>
              <span className="rl-n">{reports.length}</span>
            </div>
            {scope?.description && <div className="rx-scope-desc">{scope.description}</div>}
            <div className="rx-scroll">
              {items === null && !error && <div className="empty">{t('Yükleniyor…')}</div>}
              {items && reports.length === 0 && (
                <div className="empty">{t('Bu seçimde rapor yok.')} <Link to={`/yeni?ortam=${encodeURIComponent(scopeName)}`}>{t('Rapor ekle')}</Link></div>
              )}
              <ul className="rx-reports">
                {reports.map(x => <ReportRow key={x.id} t={x} crumb={cat === ALL ? x.group : undefined} selected={x.id === peekId} onPick={() => set({ onizle: String(x.id) })} />)}
              </ul>
            </div>
          </section>

          {[0, 1].map(i => (
            <button key={i} type="button" className={`rx-resizer${dragging === i ? ' dragging' : ''}`} style={{ left: i === 0 ? widths[0] : widths[0] + widths[1] }}
              role="separator" aria-orientation="vertical" aria-valuenow={widths[i]} aria-valuemin={MIN_W} aria-valuemax={MAX_W}
              aria-label={i === 0 ? t('Ortam sütununun genişliği') : t('Kategori sütununun genişliği')} title={t('Sürükle: genişlik · çift tık: varsayılan')}
              onPointerDown={startDrag(i)} onKeyDown={keyResize(i)} onDoubleClick={resetWidth(i)} />
          ))}
        </div>
      )}

      {peek && <ReportPeek summary={peek} onClose={closePeek} />}
    </>
  )
}
