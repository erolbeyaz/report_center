import { useEffect, useId, useRef, useState } from 'react'
import { locale, t } from '../i18n'

export interface Option { value: string; label?: string; hint?: string }

// Yazarak filtrelenen seçim kutusu (ARIA combobox). Listede olmayan değer de yazılabilir.
export default function Combobox({ value, onChange, options, placeholder, loading, emptyText, onQuery, label }: {
  value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; loading?: boolean
  emptyText?: string; onQuery?: (q: string) => void; label: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const needle = value.trim().toLocaleLowerCase(locale)
  const shown = (onQuery ? options : options.filter(o =>
    `${o.value} ${o.label ?? ''} ${o.hint ?? ''}`.toLocaleLowerCase(locale).includes(needle))).slice(0, 80)

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  useEffect(() => { setActive(0) }, [value])
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])

  const pick = (o: Option) => { onChange(o.value); setOpen(false) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); pick(shown[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="combo" ref={box}>
      <input role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
             aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
             value={value} placeholder={placeholder} autoComplete="off"
             onChange={e => { onChange(e.target.value); onQuery?.(e.target.value); setOpen(true) }}
             onFocus={() => setOpen(true)} onKeyDown={onKey} />
      <svg className="combo-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      {open && (
        <ul className="combo-list" role="listbox" id={`${id}-list`} ref={list}>
          {loading && <li className="combo-empty">{t('Yükleniyor…')}</li>}
          {!loading && shown.length === 0 && <li className="combo-empty">{emptyText ?? t('Eşleşme yok')}</li>}
          {shown.map((o, i) => (
            <li key={o.value} id={`${id}-${i}`} data-i={i} role="option" aria-selected={i === active}
                className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(o) }}>
              <span className="combo-main">{o.label ?? o.value}{o.label && <span className="mono combo-sub"> {o.value}</span>}</span>
              {o.hint && <span className="combo-hint">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
