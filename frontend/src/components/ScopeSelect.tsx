import { useEffect, useState } from 'react'
import { can, api, type Scope, type ScopeKind } from '../api'
import { KIND_ORDER } from './Glyphs'
import { t } from '../i18n'

const NEW = '__yeni__'

// Ortam seçimi; listede yoksa türüyle birlikte yeni ortam oluşturulur.
export default function ScopeSelect({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [scopes, setScopes] = useState<Scope[]>([])
  const [kinds, setKinds] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ScopeKind>('kubernetes')
  const [desc, setDesc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { api.scopes().then(s => { setScopes(s.items); setKinds(s.kinds) }).catch(e => setError(e.message)) }, [])
  useEffect(() => { if (!value && scopes[0]) onChange(scopes[0].name) }, [value, scopes, onChange])

  const create = async () => {
    setError('')
    try {
      const s = await api.createScope({ name: name.trim(), kind, description: desc })
      setScopes(l => [...l, s]); onChange(s.name); setAdding(false); setName(''); setDesc('')
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label className="field">{t('Ortam (cluster, sunucu grubu, uygulama…)')}
        <select value={adding ? NEW : value} onChange={e => { if (e.target.value === NEW) setAdding(true); else { setAdding(false); onChange(e.target.value) } }}>
          {KIND_ORDER.map(k => {
            const list = scopes.filter(s => s.kind === k)
            return list.length ? (
              <optgroup key={k} label={t(kinds[k] ?? k)}>
                {list.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </optgroup>
            ) : null
          })}
          {can('admin') && <option value={NEW}>{t('+ Yeni ortam…')}</option>}
        </select>
      </label>
      {adding && (
        <div className="param-item" style={{ gap: 8 }}>
          <label className="field">{t('Ortam adı')}<input value={name} onChange={e => setName(e.target.value)} placeholder={t('ör. Linux sunucuları (auditd)')} autoFocus /></label>
          <label className="field">{t('Tür')}
            <select value={kind} onChange={e => setKind(e.target.value as ScopeKind)}>
              {KIND_ORDER.map(k => <option key={k} value={k}>{t(kinds[k] ?? k)}</option>)}
            </select></label>
          <label className="field">{t('Açıklama')}<input value={desc} onChange={e => setDesc(e.target.value)} placeholder={t('isteğe bağlı')} /></label>
          <div className="actions">
            <button type="button" className="btn sm primary" onClick={create} disabled={name.trim().length < 2}>{t('Ortamı oluştur')}</button>
            <button type="button" className="btn sm" onClick={() => setAdding(false)}>{t('Vazgeç')}</button>
          </div>
        </div>
      )}
      {error && <span className="status bad">{error}</span>}
    </div>
  )
}
