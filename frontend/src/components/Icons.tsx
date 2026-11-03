// Satır içi çizgi ikonlar (harici ikon paketi yok).
type P = { size?: number }
const s = (size = 18) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

export const IconHome = ({ size }: P) => <svg {...s(size)}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
export const IconShield = ({ size }: P) => <svg {...s(size)}><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M9.5 12l1.8 1.8L15 10" /></svg>
export const IconReports = ({ size }: P) => <svg {...s(size)}><path d="M4 4h16v16H4z" /><path d="M4 9h16M9 9v11" /></svg>
export const IconDesign = ({ size }: P) => <svg {...s(size)}><path d="M4 6h10M4 12h16M4 18h7" /><circle cx="18" cy="6" r="2" /><circle cx="15" cy="18" r="2" /></svg>
export const IconHistory = ({ size }: P) => <svg {...s(size)}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
export const IconDb = ({ size }: P) => <svg {...s(size)}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></svg>
export const IconSettings = ({ size }: P) => <svg {...s(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
export const IconUser = ({ size }: P) => <svg {...s(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
export const IconGlobe = ({ size }: P) => <svg {...s(size)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></svg>
export const IconDownload = ({ size = 16 }: P) => <svg {...s(size)}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
export const IconEdit = ({ size = 16 }: P) => <svg {...s(size)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
export const IconColumns = ({ size = 16 }: P) => <svg {...s(size)}><path d="M4 5h4v14H4zM10 5h4v14h-4zM16 5h4v14h-4z" /></svg>
export const IconCheck = ({ size = 18 }: P) => <svg {...s(size)} strokeWidth={2.4}><path d="M5 12l5 5 9-10" /></svg>
export const IconTrash = ({ size = 16 }: P) => <svg {...s(size)}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
export const IconEye = ({ size = 14 }: P) => <svg {...s(size)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
export const IconEyeOff = ({ size = 14 }: P) => <svg {...s(size)}><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></svg>
export const IconPlus = ({ size = 14 }: P) => <svg {...s(size)}><path d="M12 5v14M5 12h14" /></svg>
export const Grip = () => (
  <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true" fill="#8796A5">
    <circle cx="3" cy="3" r="1.4" /><circle cx="9" cy="3" r="1.4" /><circle cx="3" cy="8" r="1.4" />
    <circle cx="9" cy="8" r="1.4" /><circle cx="3" cy="13" r="1.4" /><circle cx="9" cy="13" r="1.4" />
  </svg>
)
export const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
    <rect x="1" y="1" width="26" height="26" rx="6" fill="none" stroke="#7FB2E0" strokeWidth="2" />
    <path d="M8 19V12M14 19V8M20 19v-5" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)
