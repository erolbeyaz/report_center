import { tz } from '../../api'
import { LANGS, lang, setLang, t } from '../../i18n'

// Ayarlar › Genel: arayüz dili (tarayıcıda saklanır) ve sunucunun saat dilimi bilgisi.
export default function General() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Genel')}</h1>
          <div className="lead">{t('Arayüz tercihleri. Dil seçimi bu tarayıcıda saklanır.')}</div>
        </div>
      </div>
      <div className="settings-grid">
        <section className="card card-pad settings-card" aria-labelledby="set-lang">
          <h2 id="set-lang">{t('Dil')}</h2>
          <p className="hint">{t('Menüler, mesajlar ve Excel dosyalarının etiketleri bu dilde olur. Rapor adları ve kolon başlıkları değişmez.')}</p>
          <div className="lang-options" role="radiogroup" aria-labelledby="set-lang">
            {LANGS.map(l => (
              <button key={l.code} type="button" role="radio" aria-checked={l.code === lang} lang={l.code}
                      className="lang-option" onClick={() => setLang(l.code)}>
                <span className="lang-code" aria-hidden="true">{l.code.toUpperCase()}</span>
                <span>{l.label}</span>
                {l.code === lang && <span className="lang-current">{t('Kullanılıyor')}</span>}
              </button>
            ))}
          </div>
        </section>
        <section className="card card-pad settings-card" aria-labelledby="set-tz">
          <h2 id="set-tz">{t('Saat dilimi')}</h2>
          <p className="hint">{t('Dönem seçimi, tarihler ve Excel dosyaları sunucunun saat diliminde gösterilir. Yönetici RM_TIMEZONE ile değiştirir.')}</p>
          <dl className="settings-dl">
            <dt>{t('Saat dilimi')}</dt><dd className="mono">{tz.name}</dd>
            <dt>{t('Etiket')}</dt><dd>{tz.label}</dd>
          </dl>
        </section>
      </div>
    </>
  )
}
