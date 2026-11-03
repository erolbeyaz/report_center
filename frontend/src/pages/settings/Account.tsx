import { useState, type FormEvent } from 'react'
import { authApi, can, session } from '../../api'
import { t } from '../../i18n'
import { EyeToggle, Spinner } from '../../components/AuthShell'
import PasswordForm from '../../components/PasswordForm'

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{2,79}$/
const roleLabel = () => (can('admin') ? t('Yönetici') : can('designer') ? t('Tasarımcı') : t('Görüntüleyici'))

// Ayarlar › Hesap: yerel hesapta kullanıcı adı ve parola değiştirme; kurumsal hesapta yalnız bilgi.
export default function Account() {
  const local = session.source === 'local'
  const [saved, setSaved] = useState('')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Hesap')}</h1>
          <div className="lead">{local ? t('Yerel yönetici hesabı. Uygulamada yalnız bir yerel hesap bulunur.') : t('Hesabınız kurumsal kimlik sağlayıcısında yönetilir.')}</div>
        </div>
      </div>
      {saved && <div className="banner ok" role="status" style={{ marginBottom: 16 }}>{saved}</div>}
      <div className="settings-grid">
        <section className="card card-pad settings-card" aria-labelledby="acc-info">
          <h2 id="acc-info">{t('Oturum bilgisi')}</h2>
          <dl className="settings-dl">
            <dt>{t('Kullanıcı adı')}</dt><dd className="mono">{session.user}</dd>
            {session.name && <><dt>{t('Ad')}</dt><dd>{session.name}</dd></>}
            <dt>{t('Rol')}</dt><dd>{roleLabel()}</dd>
            <dt>{t('Hesap türü')}</dt><dd>{local ? t('Yerel hesap') : t('Kurumsal hesap')}</dd>
          </dl>
          {!local && <p className="hint">{t('Ad, parola ve grup üyelikleri kimlik sağlayıcısında değiştirilir; grup değişiklikleri bir sonraki girişte geçerli olur.')}</p>}
        </section>
        {local && <UsernameCard onDone={u => setSaved(t('Kullanıcı adı {user} olarak değiştirildi.', { user: u }))} />}
        {local && (
          <section className="card card-pad settings-card" aria-labelledby="acc-pw">
            <h2 id="acc-pw">{t('Parola')}</h2>
            <PasswordForm className="settings-form" onDone={() => setSaved(t('Parola değiştirildi.'))} />
          </section>
        )}
      </div>
    </>
  )
}

function UsernameCard({ onDone }: { onDone: (u: string) => void }) {
  const [name, setName] = useState(session.user)
  const [pw, setPw] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = USERNAME_RE.test(name.trim()) && name.trim() !== session.user && pw.length > 0

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError('')
    authApi.changeUsername(pw, name.trim())
      .then(r => { session.user = r.username; setPw(''); setBusy(false); onDone(r.username) })
      .catch(err => { setError(err.message); setBusy(false) })
  }

  return (
    <section className="card card-pad settings-card" aria-labelledby="acc-user">
      <h2 id="acc-user">{t('Kullanıcı adı')}</h2>
      <form className="settings-form" onSubmit={submit} noValidate>
        {error && <div className="banner err" role="alert">{error}</div>}
        <label className="field">{t('Yeni kullanıcı adı')}
          <input autoComplete="username" value={name} onChange={e => setName(e.target.value)} aria-describedby="user-hint" />
        </label>
        <span id="user-hint" className="hint">{t('3-80 karakter; harf, rakam ve . _ @ - kullanılabilir. Geçmiş export kayıtlarında eski ad korunur.')}</span>
        <label className="field">{t('Mevcut parola')}
          <span className="pw-wrap">
            <input type={shown ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} />
            <EyeToggle shown={shown} onClick={() => setShown(v => !v)} />
          </span>
        </label>
        <button className="btn primary" disabled={busy || !valid} aria-busy={busy}>{busy && <Spinner />}{t('Kullanıcı adını kaydet')}</button>
      </form>
    </section>
  )
}
