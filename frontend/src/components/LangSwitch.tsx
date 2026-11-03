import { LANGS, lang, setLang, t } from '../i18n'

// Dil seçimi (TR | EN); seçim tarayıcıda saklanır ve sayfa yeni dille yeniden yüklenir.
export default function LangSwitch({ className = '' }: { className?: string }) {
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label={t('Dil')}>
      {LANGS.map(l => (
        <button key={l.code} type="button" lang={l.code} aria-pressed={l.code === lang} title={l.label}
                onClick={() => setLang(l.code)}>{l.code.toUpperCase()}</button>
      ))}
    </div>
  )
}
