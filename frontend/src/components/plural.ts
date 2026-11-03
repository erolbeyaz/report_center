import { t } from '../i18n'

// Sayıya bağlı metin: n === 1 iken sözlükte "<anahtar>#1" varsa (ör. "1 report") onu kullanır; Türkçede tekil/çoğul aynıdır.
export function tn(n: number, key: string, vars: Record<string, string | number> = {}): string {
  const v = { n, ...vars }
  if (n === 1) {
    const one = t(`${key}#1`, v)
    if (!one.endsWith('#1')) return one
  }
  return t(key, v)
}
