import { Link, NavLink, Outlet } from 'react-router-dom'
import { can, session } from '../api'
import { t, locale } from '../i18n'
import { IconDesign, IconHistory, IconHome, IconReports, IconSettings, Logo } from './Icons'

const initials = (n: string) => n.split(/[\s._@-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toLocaleUpperCase(locale)).join('') || '?'
const roleLabel = () => (can('admin') ? t('Yönetici') : can('designer') ? t('Tasarımcı') : t('Görüntüleyici'))

export default function Layout() {
  return (
    <div className="shell">
      <nav className="nav" aria-label={t('Ana menü')}>
        <Link to="/" className="nav-brand" aria-label={t('Rapor Merkezi ana sayfa')}>
          <Logo />
          <div><b>{t('Rapor Merkezi')}</b></div>
        </Link>
        <NavLink to="/" end><IconHome />{t('Ana Sayfa')}</NavLink>
        <NavLink to="/raporlar"><IconReports />{t('Raporlar')}</NavLink>
        {can('designer') && <NavLink to="/tasarim"><IconDesign />{t('Rapor tasarımı')}</NavLink>}
        <NavLink to="/gecmis"><IconHistory />{t('Export geçmişi')}</NavLink>
        <NavLink to="/ayarlar"><IconSettings />{t('Ayarlar')}</NavLink>
        <section className="profile" aria-label={t('Oturum')}>
          <Link to="/ayarlar/hesap" className="profile-id" title={t('Hesap ayarları')}>
            <span className="avatar" aria-hidden="true">{initials(session.name || session.user)}</span>
            <span className="profile-text">
              <b title={session.user}>{session.name || session.user}</b>
              <small>{roleLabel()} · {session.source === 'local' ? t('Yerel hesap') : t('Kurumsal hesap')}</small>
            </span>
          </Link>
          <div className="profile-actions">
            <a href="/auth/logout" className="profile-btn logout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></svg>
              {t('Çıkış yap')}
            </a>
          </div>
        </section>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
