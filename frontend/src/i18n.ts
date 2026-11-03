// Arayüz dili (tr | en). Kaynak metinler Türkçedir; t() İngilizcede locales/en/*.ts sözlüklerinden çevirir,
// sözlükte olmayan metin olduğu gibi kalır. Dil değişince sayfa yeniden yüklenir, böylece modül düzeyindeki
// etiketler de yeni dille kurulur. Seçim tarayıcıda (localStorage + rm_lang çerezi) tutulur; çerez backend'in
// hata mesajlarını ve Excel etiketlerini aynı dilde üretmesini sağlar.
export type Lang = 'tr' | 'en'
export const LANGS: { code: Lang; label: string }[] = [{ code: 'tr', label: 'Türkçe' }, { code: 'en', label: 'English' }]

const KEY = 'rm_lang'
const stored = (): string | null => { try { return localStorage.getItem(KEY) } catch { return null } }
const detect = (): Lang => {
  const s = stored()
  if (s === 'tr' || s === 'en') return s
  return (navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export const lang: Lang = detect()
export const locale = lang === 'tr' ? 'tr-TR' : 'en-GB'
document.documentElement.lang = lang
document.cookie = `${KEY}=${lang}; path=/; max-age=31536000; samesite=lax`

const en: Record<string, string> = Object.assign({}, ...Object.values(
  import.meta.glob<{ default: Record<string, string> }>('./locales/en/*.ts', { eager: true })).map(m => m.default))

// t('{n} rapor', { n: 3 }) — {ad} yer tutucuları her iki dilde de doldurulur.
export function t(s: string, vars?: Record<string, string | number>): string {
  const out = lang === 'en' ? (en[s] ?? s) : s
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out
}

export function setLang(l: Lang) {
  if (l === lang) return
  try { localStorage.setItem(KEY, l) } catch { /* özel pencere */ }
  document.cookie = `${KEY}=${l}; path=/; max-age=31536000; samesite=lax`
  window.location.reload()
}
