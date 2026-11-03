import { useEffect, useMemo, useState } from 'react'
import { api, type TemplateSummary } from '../api'
import { lang, t } from '../i18n'

const NEW = '__yeni__'

// Seçili ortamın kategorileri; yoksa yeni kategori adı yazılır. Kategori, ilk rapor kaydedildiğinde oluşur.
export default function CategorySelect({ scope, value, onChange }: { scope: string; value: string; onChange: (v: string) => void }) {
  const [all, setAll] = useState<TemplateSummary[]>([])
  const [adding, setAdding] = useState(false)
  useEffect(() => { api.templates().then(setAll).catch(() => {}) }, [])

  const inScope = useMemo(() => [...new Set(all.filter(t => t.scope === scope).map(t => t.group))].sort((a, b) => a.localeCompare(b, lang)), [all, scope])
  const elsewhere = useMemo(() => [...new Set(all.map(t => t.group))].filter(g => !inScope.includes(g)).sort((a, b) => a.localeCompare(b, lang)), [all, inScope])
  const known = inScope.includes(value) || elsewhere.includes(value)
  useEffect(() => { if (value && !known && all.length) setAdding(true) }, [value, known, all.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label className="field">{t('Kategori')}
        <select value={adding ? NEW : value} onChange={e => {
          if (e.target.value === NEW) { setAdding(true); onChange('') } else { setAdding(false); onChange(e.target.value) }
        }}>
          <option value="" disabled>{t('Kategori seç…')}</option>
          {inScope.length > 0 && <optgroup label={t('{scope} ortamında', { scope })}>{inScope.map(g => <option key={g} value={g}>{g}</option>)}</optgroup>}
          {elsewhere.length > 0 && <optgroup label={t('Diğer ortamlarda kullanılan')}>{elsewhere.map(g => <option key={g} value={g}>{g}</option>)}</optgroup>}
          <option value={NEW}>{t('+ Yeni kategori…')}</option>
        </select>
      </label>
      {adding && (
        <label className="field">{t('Yeni kategori adı')}
          <input value={value} onChange={e => onChange(e.target.value)} placeholder={t('ör. Sunucu Audit Logları')} autoFocus /></label>
      )}
    </div>
  )
}
