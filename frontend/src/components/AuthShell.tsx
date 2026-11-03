import type { ReactNode } from 'react'
import { Logo } from './Icons'
import LangSwitch from './LangSwitch'
import { t } from '../i18n'

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5 9-10" />
  </svg>
)

// Giriş ve parola sayfalarının ortak iki sütunlu düzeni: solda tanıtım, sağda form.
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden="true">
        <div className="auth-logo"><Logo /><b>{t('Rapor Merkezi')}</b></div>
        <div className="auth-pitch">
          <h2>{t('Denetime hazır raporlar, tek yerden.')}</h2>
          <ul>
            <li><Check />{t('Elasticsearch, Prometheus ve SQL veritabanlarından Excel')}</li>
            <li><Check />{t('Eksiksizlik kontrolü ve SHA-256 ile doğrulanabilir dosyalar')}</li>
            <li><Check />{t('Kim, ne zaman, hangi raporu aldı: değiştirilemez geçmiş')}</li>
          </ul>
        </div>
        <span className="auth-foot">{t('Rapor Merkezi')}</span>
      </aside>
      <main className="auth-main">
        <LangSwitch className="auth-lang" />
        <div className="auth-card">{children}</div>
      </main>
    </div>
  )
}

export const EyeToggle = ({ shown, onClick }: { shown: boolean; onClick: () => void }) => (
  <button type="button" className="pw-toggle" onClick={onClick} aria-label={shown ? t('Parolayı gizle') : t('Parolayı göster')} aria-pressed={shown}>
    {shown
      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></svg>
      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>}
  </button>
)

export const Spinner = () => (
  <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-6.2-8.6" />
  </svg>
)
