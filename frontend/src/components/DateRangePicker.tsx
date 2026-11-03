import { useEffect, useMemo, useRef, useState } from 'react'
import { tz } from '../api'
import { lang, t } from '../i18n'

// Değerler "YYYY-MM-DDTHH:mm" (sunucu saat dilimi, RM_TIMEZONE). `to` hariç tutulan bitiştir; kullanıcıya dahil bitiş (to − 1 dk) gösterilir.
export interface Range { from: string; to: string; label?: string; id?: string }

const MONTHS = lang === 'tr'
  ? ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
  : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = lang === 'tr' ? ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'] : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
export const toValue = (d: Date) => `${ymd(d)}T${hm(d)}`
const parse = (v: string) => new Date(v)
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMin = (d: Date, n: number) => new Date(d.getTime() + n * 60000)
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b)
const fmt = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${hm(d)}`

export function quickRanges(now = new Date()): Range[] {
  const d0 = dayStart(now)
  const m0 = new Date(d0.getFullYear(), d0.getMonth(), 1)
  const mondayOffset = (d0.getDay() + 6) % 7
  const r = (id: string, label: string, from: Date, to: Date): Range => ({ id, label, from: toValue(from), to: toValue(to) })
  return [
    r('today', t('Bugün'), d0, addDays(d0, 1)),
    r('yesterday', t('Dün'), addDays(d0, -1), d0),
    r('this-week', t('Bu hafta'), addDays(d0, -mondayOffset), addDays(d0, 1)),
    r('last-7d', t('Son 7 gün'), addDays(d0, -6), addDays(d0, 1)),
    r('last-30d', t('Son 30 gün'), addDays(d0, -29), addDays(d0, 1)),
    r('this-month', t('Bu ay'), m0, new Date(d0.getFullYear(), d0.getMonth() + 1, 1)),
    r('last-month', t('Geçen ay ({month})', { month: MONTHS[(d0.getMonth() + 11) % 12] }), new Date(d0.getFullYear(), d0.getMonth() - 1, 1), m0),
    r('last-3m', t('Son 3 ay'), new Date(d0.getFullYear(), d0.getMonth() - 2, 1), new Date(d0.getFullYear(), d0.getMonth() + 1, 1)),
    r('this-year', t('Bu yıl'), new Date(d0.getFullYear(), 0, 1), new Date(d0.getFullYear() + 1, 0, 1)),
  ]
}

function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7) cells.push(null)
  return cells
}

interface Props { value: Range; onChange: (r: Range) => void; earliest?: string | null }

export default function DateRangePicker({ value, onChange, earliest }: Props) {
  const [open, setOpen] = useState(false)
  const from = parse(value.from)
  const endIncl = addMin(parse(value.to), -1)
  const [view, setView] = useState(() => new Date(endIncl.getFullYear(), endIncl.getMonth() - 1, 1))
  const [start, setStart] = useState<Date | null>(dayStart(from))
  const [end, setEnd] = useState<Date | null>(dayStart(endIncl))
  const [hover, setHover] = useState<Date | null>(null)
  const [tFrom, setTFrom] = useState(hm(from))
  const [tTo, setTTo] = useState(hm(endIncl))
  const [label, setLabel] = useState<string | undefined>(value.label)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const quick = useMemo(() => quickRanges(), [])
  const minDay = earliest ? dayStart(new Date(earliest)) : null
  const today = dayStart(new Date())

  const reset = () => {
    const f = parse(value.from), e = addMin(parse(value.to), -1)
    setStart(dayStart(f)); setEnd(dayStart(e)); setTFrom(hm(f)); setTTo(hm(e)); setLabel(value.label)
    setView(new Date(e.getFullYear(), e.getMonth() - 1, 1)); setHover(null)
  }
  const toggle = () => { if (!open) reset(); setOpen(o => !o) }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const pickDay = (d: Date) => {
    setLabel(undefined)
    if (!start || end) { setStart(d); setEnd(null) }
    else if (d < start) { setEnd(start); setStart(d) }
    else setEnd(d)
  }
  const pickQuick = (r: Range) => {
    const f = parse(r.from), e = addMin(parse(r.to), -1)
    setStart(dayStart(f)); setEnd(dayStart(e)); setTFrom(hm(f)); setTTo(hm(e)); setLabel(r.label)
    setView(new Date(e.getFullYear(), e.getMonth() - 1, 1))
  }
  const draftFrom = start ? new Date(`${ymd(start)}T${tFrom || '00:00'}`) : null
  const draftEnd = end ? new Date(`${ymd(end)}T${tTo || '23:59'}`) : null
  const valid = draftFrom && draftEnd && draftEnd >= draftFrom
  const apply = () => {
    if (!valid) return
    onChange({ from: toValue(draftFrom!), to: toValue(addMin(draftEnd!, 1)), label })
    setOpen(false); trigger.current?.focus()
  }

  const lo = start, hi = end ?? (start && hover && hover > start ? hover : null)
  const dayClass = (d: Date) => {
    const c = ['drp-day']
    if (minDay && d < minDay) c.push('nodata')
    if (d > today) c.push('future')
    if (lo && sameDay(d, lo)) c.push('edge', 'start')
    if (hi && sameDay(d, hi)) c.push('edge', 'end')
    if (lo && hi && d > lo && d < hi) c.push('inrange')
    if (sameDay(d, today)) c.push('today')
    return c.join(' ')
  }
  const days = draftFrom && draftEnd ? Math.round((dayStart(draftEnd).getTime() - dayStart(draftFrom).getTime()) / 86400000) + 1 : 0
  const outOfData = minDay && start && start < minDay

  return (
    <div className="drp" ref={box}>
      <button ref={trigger} type="button" className="drp-trigger" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5B6B7B" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        <span className="drp-text">{fmt(from)} <span aria-hidden="true">→</span> {fmt(endIncl)}</span>
        {value.label && <span className="drp-chip">{value.label}</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B6B7B" strokeWidth="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="drp-pop" role="dialog" aria-label={t('Dönem seç')}>
          <div className="drp-quick" role="list" aria-label={t('Hızlı seçim')}>
            {quick.map(q => (
              <button key={q.label} type="button" role="listitem" className={label === q.label ? 'on' : ''} onClick={() => pickQuick(q)}>{q.label}</button>
            ))}
          </div>
          <div className="drp-main">
            <div className="drp-months">
              {[0, 1].map(i => {
                const m = new Date(view.getFullYear(), view.getMonth() + i, 1)
                return (
                  <div key={i} className="drp-month">
                    <div className="drp-mhead">
                      {i === 0 ? <button type="button" className="drp-nav" aria-label={t('Önceki ay')} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button> : <span />}
                      <strong>{MONTHS[m.getMonth()]} {m.getFullYear()}</strong>
                      {i === 1 ? <button type="button" className="drp-nav" aria-label={t('Sonraki ay')} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button> : <span />}
                    </div>
                    <div className="drp-grid" role="grid">
                      {DAYS.map(d => <span key={d} className="drp-dow">{d}</span>)}
                      {monthGrid(m.getFullYear(), m.getMonth()).map((d, k) => d
                        ? <button key={k} type="button" className={dayClass(d)} onClick={() => pickDay(d)} onMouseEnter={() => setHover(d)}
                            title={minDay && d < minDay ? t('Bu gün için kaynakta veri yok') : undefined}
                            aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`}
                            aria-pressed={!!((lo && sameDay(d, lo)) || (hi && sameDay(d, hi)))}>{d.getDate()}</button>
                        : <span key={k} />)}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="drp-foot">
              <label className="drp-time">{t('Başlangıç saati')}<input type="time" value={tFrom} onChange={e => { setTFrom(e.target.value); setLabel(undefined) }} /></label>
              <label className="drp-time">{t('Bitiş saati (dahil)')}<input type="time" value={tTo} onChange={e => { setTTo(e.target.value); setLabel(undefined) }} /></label>
              <div className="drp-summary">
                {draftFrom && draftEnd ? <><b>{fmt(draftFrom)} – {fmt(draftEnd)}</b><span>{days === 1 ? t('1 gün') : t('{n} gün', { n: days })} · {tz.label}</span></>
                  : <span>{start ? t('Bitiş gününü seç') : t('Başlangıç gününü seç')}</span>}
                {outOfData && <span className="drp-warn">{t('Başlangıç, veri setindeki en eski kayıttan önce')}</span>}
              </div>
              <div className="drp-btns">
                <button type="button" className="btn sm" onClick={() => setOpen(false)}>{t('Vazgeç')}</button>
                <button type="button" className="btn sm primary" onClick={apply} disabled={!valid}>{t('Uygula')}</button>
              </div>
            </div>
            {minDay && (
              <div className="drp-legend"><span className="drp-swatch" aria-hidden="true" />{t('{date} öncesi için kaynakta veri yok (saklama süresi)', { date: fmt(new Date(earliest!)) })}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
