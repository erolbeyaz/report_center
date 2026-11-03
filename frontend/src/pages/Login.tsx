import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { authApi, type AuthConfig } from '../api'
import { t } from '../i18n'
import AuthShell, { EyeToggle, Spinner } from '../components/AuthShell'

export default function Login() {
  const [sp] = useSearchParams()
  const next = sp.get('next')?.startsWith('/') ? sp.get('next')! : '/'
  const [cfg, setCfg] = useState<AuthConfig | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(sp.get('hata') ?? '')

  useEffect(() => { authApi.config().then(setCfg).catch(e => setError(e.message)) }, [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    authApi.login(username, password)
      .then(r => { window.location.href = r.must_change ? `/parola?next=${encodeURIComponent(next)}` : next })
      .catch(err => { setError(err.message); setBusy(false) })
  }

  return (
    <AuthShell>
      <h1>{t('Giriş yap')}</h1>
      <p className="lead">{t("Rapor Merkezi'ne devam etmek için oturum açın.")}</p>
      {error && <div className="banner err" role="alert">{error}</div>}

      {cfg?.oidc && (
        <a className="btn primary block" href={`/auth/login?next=${encodeURIComponent(next)}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
          {t('{name} ile giriş yap', { name: cfg.oidc_label })}
        </a>
      )}
      {cfg?.oidc && cfg.local && <div className="auth-or"><span>{t('veya yerel hesapla')}</span></div>}

      {cfg?.local && (
        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="field">{t('Kullanıcı adı')}
            <input name="username" autoComplete="username" autoFocus={!cfg.oidc} required value={username}
                   onChange={e => setUsername(e.target.value)} />
          </label>
          <label className="field">{t('Parola')}
            <span className="pw-wrap">
              <input name="password" type={shown ? 'text' : 'password'} autoComplete="current-password" required value={password}
                     onChange={e => setPassword(e.target.value)} />
              <EyeToggle shown={shown} onClick={() => setShown(v => !v)} />
            </span>
          </label>
          <button className={`btn block ${cfg.oidc ? '' : 'primary'}`} disabled={busy || !username || !password} aria-busy={busy}>
            {busy && <Spinner />}{t('Giriş yap')}
          </button>
        </form>
      )}
      {cfg && !cfg.local && !cfg.oidc && <p className="hint">{t('Hiçbir giriş yöntemi açık değil. Sistem yöneticinize başvurun.')}</p>}
    </AuthShell>
  )
}
