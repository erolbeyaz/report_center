import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { authApi, session } from '../api'
import { t } from '../i18n'
import { EyeToggle, Spinner } from './AuthShell'

// Yerel hesap parola değiştirme formu: zorunlu ilk değişiklik sayfası ve Ayarlar › Hesap ortak kullanır.
export default function PasswordForm({ onDone, autoFocus, className = 'auth-form', footer }: {
  onDone: () => void; autoFocus?: boolean; className?: string; footer?: ReactNode
}) {
  const [min, setMin] = useState(12)
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { authApi.config().then(c => setMin(c.min_password_length)).catch(() => {}) }, [])

  const rules = [
    { ok: pw.length >= min, text: t('En az {n} karakter', { n: min }) },
    { ok: pw.length > 0 && pw !== current && !['admin', session.user.toLowerCase()].includes(pw.toLowerCase()), text: t('Eski parola ve kullanıcı adından farklı') },
    { ok: pw.length > 0 && pw === pw2, text: t('İki giriş aynı') },
  ]
  const valid = current.length > 0 && rules.every(r => r.ok)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError('')
    authApi.changePassword(current, pw)
      .then(() => { setBusy(false); setCurrent(''); setPw(''); setPw2(''); onDone() })
      .catch(err => { setError(err.message); setBusy(false) })
  }

  const type = shown ? 'text' : 'password'
  return (
    <form className={className} onSubmit={submit} noValidate>
      {error && <div className="banner err" role="alert">{error}</div>}
      <label className="field">{t('Mevcut parola')}
        <span className="pw-wrap">
          <input type={type} autoComplete="current-password" autoFocus={autoFocus} value={current} onChange={e => setCurrent(e.target.value)} />
          <EyeToggle shown={shown} onClick={() => setShown(v => !v)} />
        </span>
      </label>
      <label className="field">{t('Yeni parola')}
        <input type={type} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} aria-describedby="pw-rules" />
      </label>
      <label className="field">{t('Yeni parola (tekrar)')}
        <input type={type} autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
      </label>
      <ul id="pw-rules" className="pw-rules" aria-live="polite">
        {rules.map(r => (
          <li key={r.text} className={r.ok ? 'ok' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              {r.ok ? <path d="M5 12l5 5 9-10" /> : <circle cx="12" cy="12" r="4" />}
            </svg>
            {r.text}<span className="sr-only">{r.ok ? t(': sağlandı') : t(': sağlanmadı')}</span>
          </li>
        ))}
      </ul>
      <button className={`btn primary${className === 'auth-form' ? ' block' : ''}`} disabled={busy || !valid} aria-busy={busy}>{busy && <Spinner />}{t('Parolayı kaydet')}</button>
      {footer}
    </form>
  )
}
