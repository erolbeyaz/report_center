import { NavLink, Outlet } from 'react-router-dom'
import { can } from '../api'
import { t } from '../i18n'
import { IconDb, IconGlobe, IconShield, IconUser } from '../components/Icons'

// Ayarlar: genel (dil), hesap, veri kaynakları ve (yöneticiye) erişim yönetimi sekmeleri.
export default function Settings() {
  const tabs = [
    { to: 'genel', label: t('Genel'), icon: <IconGlobe size={16} /> },
    { to: 'hesap', label: t('Hesap'), icon: <IconUser size={16} /> },
    { to: 'kaynaklar', label: t('Veri kaynakları'), icon: <IconDb size={16} /> },
    ...(can('admin') ? [{ to: 'erisim', label: t('Erişim yönetimi'), icon: <IconShield size={16} /> }] : []),
  ]
  return (
    <>
      <nav className="settings-tabs" aria-label={t('Ayarlar')}>
        <span className="settings-title">{t('Ayarlar')}</span>
        {tabs.map(x => <NavLink key={x.to} to={x.to}>{x.icon}{x.label}</NavLink>)}
      </nav>
      <Outlet />
    </>
  )
}
