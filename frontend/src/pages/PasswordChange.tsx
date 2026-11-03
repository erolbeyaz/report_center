import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { session } from '../api'
import { t } from '../i18n'
import AuthShell from '../components/AuthShell'
import PasswordForm from '../components/PasswordForm'

// Varsayılan parolayla ilk girişte zorunlu parola belirleme (uygulama menüsü olmadan).
export default function PasswordChange() {
  const [sp] = useSearchParams()
  const next = sp.get('next')?.startsWith('/') && sp.get('next') !== '/parola' ? sp.get('next')! : '/'
  const forced = session.mustChange

  useEffect(() => {
    if (!session.user) window.location.href = '/giris'
    else if (session.source !== 'local') window.location.href = '/'
  }, [])

  return (
    <AuthShell>
      <h1>{forced ? t('Parolanızı belirleyin') : t('Parola değiştir')}</h1>
      <p className="lead">
        {forced
          ? t('Varsayılan parola ile giriş yaptınız. Devam etmek için yeni bir parola belirleyin.')
          : t('Yerel hesap: {user}', { user: session.user })}
      </p>
      <PasswordForm autoFocus onDone={() => { window.location.href = next }}
        footer={forced
          ? <a className="auth-link" href="/auth/logout">{t('Çıkış yap')}</a>
          : <Link className="auth-link" to={next}>{t('Vazgeç')}</Link>} />
    </AuthShell>
  )
}
