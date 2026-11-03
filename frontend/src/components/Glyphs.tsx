import type { ReactNode } from 'react'
import type { ScopeKind } from '../api'

const svg = (d: ReactNode, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)

// Ortam türü ikonları
export const KIND_ICON: Record<ScopeKind, ReactNode> = {
  kubernetes: svg(<><path d="M12 2.5l8.5 4.1 2 9.2-5.9 7.4H7.4L1.5 15.8l2-9.2z" /><circle cx="12" cy="12" r="2.5" /><path d="M12 5v4.5M12 14.5V19M5.6 9l4.1 2M14.3 13l4.1 2M18.4 9l-4.1 2M9.7 13l-4.1 2" /></>),
  server: svg(<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" /></>),
  application: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></>),
  network: svg(<><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /></>),
  other: svg(<><circle cx="12" cy="12" r="8" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>),
}
export const KIND_ORDER: ScopeKind[] = ['kubernetes', 'server', 'application', 'network', 'other']

// Kategori adına göre ikon ve renk (bilinmeyen kategoriler varsayılanı alır).
const CATEGORY_STYLE: { match: RegExp; icon: ReactNode; bg: string; fg: string }[] = [
  { match: /alarm/i, icon: svg(<><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>), bg: '#FCE9DE', fg: '#8A2F08' },
  { match: /yedek|backup/i, icon: svg(<><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>), bg: '#E8EEF8', fg: '#2C4A7A' },
  { match: /performans/i, icon: svg(<><path d="M12 14l4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></>), bg: '#E4F1EE', fg: '#14524A' },
  { match: /kimlik|erişim yönetimi|keycloak/i, icon: svg(<><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" /></>), bg: '#EEE8F7', fg: '#45306E' },
  { match: /metrik.*kapasite|kapasite/i, icon: svg(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>), bg: '#E6F0FA', fg: '#1D4F80' },
  { match: /metrik.*sağlık|sağlık|health/i, icon: svg(<><path d="M3 12h4l3-7 4 14 3-7h4" /></>), bg: '#E5F3EA', fg: '#1E6B3A' },
  { match: /argo|sürüm|deploy/i, icon: svg(<><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="9" r="2.5" /><path d="M6 8.5v7M18 11.5c0 3-3 4-9.5 5.5" /></>), bg: '#E3EDF7', fg: '#163A5A' },
  { match: /istek|rr|http/i, icon: svg(<><path d="M4 8h13l-3-3M20 16H7l3 3" /></>), bg: '#E4F1EE', fg: '#14524A' },
  { match: /uygulama|log/i, icon: svg(<><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>), bg: '#FCE9DE', fg: '#8A2F08' },
  { match: /veritaban|sql/i, icon: svg(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>), bg: '#EEE8F7', fg: '#45306E' },
  { match: /pod|container/i, icon: svg(<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>), bg: '#FFF2D6', fg: '#6B4A00' },
  { match: /denetim|audit|güvenlik|kubernetes|erişim/i, icon: svg(<><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>), bg: '#E6ECF2', fg: '#22394F' },
]
const DEFAULT_STYLE = { icon: svg(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></>), bg: '#EEF2F6', fg: '#33414E' }
export const categoryStyle = (group: string) => CATEGORY_STYLE.find(s => s.match.test(group)) ?? DEFAULT_STYLE

export const Chevron = () => svg(<path d="M9 6l6 6-6 6" />, 16)
