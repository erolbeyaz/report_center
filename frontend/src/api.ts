import { locale } from './i18n'
export type ColumnFormat = 'text' | 'datetime' | 'list' | 'badge' | 'mono'
export interface Column { field: string; label: string; width: number; format: ColumnFormat }
export interface Filter { field: string; op: 'eq' | 'neq' | 'in' | 'not_in' | 'exists' | 'not_exists' | 'gt' | 'gte' | 'lt' | 'lte' | 'prefix' | 'not_prefix'; value: unknown }
export interface Coverage { earliest: string | null; latest: string | null; complete: boolean; message: string | null }
export interface Param { field: string; label: string; options: string[] }
export interface RowRule { field: string; equals: string; fill: string }
export interface Definition {
  description: string
  datasource_id: number
  dataset: string
  time_field: string
  fixed_filters: Filter[]
  params: Param[]
  columns: Column[]
  row_rules: RowRule[]
  sort: { field: string; dir: 'asc' | 'desc' }[]
  meta: { title: string; scope: string; notes: [string, string][] }
  step?: string | null
}
export interface TemplateSummary {
  id: number; slug: string; name: string; scope: string; group: string; version: number
  updated_at: string; updated_by: string; description: string
  dataset: string; params: string[]; column_count: number
  export_count?: number; last_export_at?: string | null
}
export interface Template extends TemplateSummary { definition: Definition }
export interface PreviewRow { values: Record<string, string | null>; fill: string | null }
export interface Preview {
  total: number; shown: number; limit: number; rows: PreviewRow[]; columns: Column[]
  facets: Record<string, Record<string, number>>; query: string; coverage: Coverage
}
export interface ExportRecord {
  id: number; template_id: number; template_name: string; template_version: number
  params: { period_from: string; period_to: string; params: Record<string, string | null>; columns: string[] }
  period_from: string; period_to: string; partial: boolean; row_count: number; source_count: number
  data_sha256: string; file_sha256: string; file_name: string; query_summary: string
  created_by: string; created_at: string
}
export type ScopeKind = 'kubernetes' | 'server' | 'application' | 'network' | 'other'
export interface Scope { id: number; name: string; kind: ScopeKind; description: string; report_count: number }
export type DataSourceType = 'elasticsearch' | 'prometheus' | 'postgresql' | 'mssql'
export interface DataSource { id: number; name: string; type: DataSourceType; config: Record<string, string>; credential: string; template_count: number }
export type TestResult = { ok: boolean; version?: string; cluster?: string; user?: string; ms?: number; error?: string }
export interface Dataset { name: string; kind: string }
export interface FieldInfo { name: string; type: string }
export interface RunBody { period_from: string; period_to: string; params: Record<string, string | null>; columns?: string[]; limit?: number; sort?: { field: string; dir: 'asc' | 'desc' }[] }

export type Level = 'Kritik' | 'Uyarı' | 'Bilgi'
export type ScopeState = Level | 'Sorunsuz'
export interface HomeItem { level: Level; title: string; scope: string; value: string; template_id: number | null; report: string }
export interface HealthFact { label: string; text?: string; at?: string | null; suffix?: string }
export interface ScopeHealth { state: ScopeState; facts: HealthFact[] }
export interface HomeSummary {
  reports: number; categories: number
  scopes: { name: string; kind: ScopeKind; kind_label: string; report_count: number; health: ScopeHealth | null }[]
  exports_month: { count: number; rows: number }
  recent_exports: { id: number; template_id: number; template_name: string; created_by: string; created_at: string; row_count: number }[]
  sources: { name: string; type: string; ok: boolean; error: string | null }[]
  items: HomeItem[]; errors: string[]
  generated_at: string | null; refreshing: boolean; pending: boolean; ttl_minutes: number; health_configured: boolean
}

const AUTH_PAGES = ['/giris', '/parola']
const here = () => window.location.pathname + window.location.search
export const toLogin = () => {
  if (!AUTH_PAGES.includes(window.location.pathname)) window.location.href = `/giris?next=${encodeURIComponent(here())}`
}
const toPasswordChange = () => {
  if (window.location.pathname !== '/parola') window.location.href = `/parola?next=${encodeURIComponent(here())}`
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 401 && url !== '/auth/local/login' && !AUTH_PAGES.includes(window.location.pathname)) {
    toLogin()
    return new Promise<T>(() => { /* giriş sayfasına yönlendiriliyor */ })
  }
  if (!r.ok) {
    let msg = `${r.status}`
    try { msg = (await r.json()).detail ?? msg } catch { /* boş gövde */ }
    if (r.status === 403 && msg === 'password_change_required') {
      toPasswordChange()
      return new Promise<T>(() => { /* parola değiştirme sayfasına yönlendiriliyor */ })
    }
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return r.json()
}

export const api = {
  home: (refresh = false) => call<HomeSummary>('GET', `/api/home${refresh ? '?yenile=true' : ''}`),
  templates: () => call<TemplateSummary[]>('GET', '/api/templates'),
  scopes: () => call<{ kinds: Record<ScopeKind, string>; items: Scope[] }>('GET', '/api/scopes'),
  createScope: (body: { name: string; kind: ScopeKind; description: string }) => call<Scope>('POST', '/api/scopes', body),
  template: (id: number) => call<Template>('GET', `/api/templates/${id}`),
  createTemplate: (body: { name: string; scope: string; group: string; description: string; datasource_id: number; dataset: string; time_field: string; step?: string }) =>
    call<Template>('POST', '/api/templates', body),
  saveTemplate: (id: number, body: { name: string; scope: string; group: string; definition: Definition }) =>
    call<Template>('PUT', `/api/templates/${id}`, body),
  deleteTemplate: (id: number) => call<{ ok: boolean }>('DELETE', `/api/templates/${id}`),
  preview: (id: number, body: RunBody) => call<Preview>('POST', `/api/templates/${id}/preview`, body),
  export: (id: number, body: RunBody) => call<ExportRecord>('POST', `/api/templates/${id}/export`, body),
  exports: (q: { template_id?: number; user?: string; sha256?: string } = {}) => {
    const p = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, String(v)))
    return call<ExportRecord[]>('GET', `/api/exports?${p}`)
  },
  downloadUrl: (id: number) => `/api/exports/${id}/download`,
  datasources: () => call<DataSource[]>('GET', '/api/datasources'),
  testDatasource: (id: number) => call<TestResult>('POST', `/api/datasources/${id}/test`),
  testDatasourceConfig: (body: { name: string; type: DataSourceType; config: Record<string, string> }) =>
    call<TestResult>('POST', '/api/datasources/test-config', body),
  createDatasource: (body: { name: string; type: DataSourceType; config: Record<string, string> }) => call<DataSource>('POST', '/api/datasources', body),
  updateDatasource: (id: number, body: { name: string; type: DataSourceType; config: Record<string, string> }) =>
    call<DataSource>('PUT', `/api/datasources/${id}`, body),
  deleteDatasource: (id: number) => call<{ ok: boolean }>('DELETE', `/api/datasources/${id}`),
  secretFiles: () => call<string[]>('GET', '/api/datasources/secret-files'),
  datasets: (id: number) => call<Dataset[]>('GET', `/api/datasources/${id}/datasets`),
  // POST: veri seti özel bir SQL sorgusu olabilir (URL'ye sığmaz)
  probe: (id: number, dataset: string, limit = 20) =>
    call<{ fields: FieldInfo[]; rows: Record<string, unknown>[] }>('POST', `/api/datasources/${id}/probe`, { dataset, limit }),
  fields: (id: number, dataset: string) =>
    call<{ fields: FieldInfo[] }>('POST', `/api/datasources/${id}/probe`, { dataset, limit: 1 }).then(r => r.fields),
  values: (id: number, dataset: string, field: string) => call<string[]>('POST', `/api/datasources/${id}/values`, { dataset, field }),
}

export interface Meta { timezone: string; tz_label: string; user: string; name: string; roles: string[]; preview_limit: number; source: 'local' | 'oidc'; must_change: boolean }
export interface AuthConfig { local: boolean; oidc: boolean; oidc_label: string; min_password_length: number }

// Sunucunun saat dilimi (RM_TIMEZONE); uygulama açılırken /api/meta'dan yüklenir.
export const tz = { name: 'UTC', label: 'UTC' }
// Oturumdaki kullanıcı; yetkiyi asıl backend denetler, arayüz yalnız yetkisiz düğmeleri gizler.
export const session = { user: '', name: '', roles: [] as string[], source: '' as '' | 'local' | 'oidc', mustChange: false }
export const can = (role: 'designer' | 'admin') => session.roles.includes(role)
export const loadMeta = () => call<Meta>('GET', '/auth/me')
  .then(m => {
    tz.name = m.timezone; tz.label = m.tz_label
    Object.assign(session, { user: m.user, name: m.name, roles: m.roles, source: m.source, mustChange: m.must_change })
    if (m.must_change) toPasswordChange()
  })
  .catch(() => { /* varsayılan UTC */ })

export const authApi = {
  config: () => call<AuthConfig>('GET', '/auth/config'),
  login: (username: string, password: string) => call<{ must_change: boolean }>('POST', '/auth/local/login', { username, password }),
  changePassword: (current: string, next: string) => call<{ ok: boolean }>('POST', '/auth/local/password', { current, new: next }),
  changeUsername: (password: string, username: string) => call<{ ok: boolean; username: string }>('POST', '/auth/local/username', { password, username }),
}

export interface AccessRuleT { id: number; subject_type: 'group' | 'user'; subject: string; scope: string; category: string; created_by: string; created_at: string; report_count: number }
export interface KnownUserT { username: string; name: string; source: string; groups: string[]; roles: string[]; last_login_at: string; is_admin: boolean; report_count: number }
export const accessApi = {
  rules: () => call<AccessRuleT[]>('GET', '/api/access/rules'),
  create: (b: { subject_type: 'group' | 'user'; subject: string; scope: string; category: string }) => call<AccessRuleT>('POST', '/api/access/rules', b),
  remove: (id: number) => call<{ ok: boolean }>('DELETE', `/api/access/rules/${id}`),
  update: (id: number, b: { subject_type: 'group' | 'user'; subject: string; scope: string; category: string }) => call<AccessRuleT>('PUT', `/api/access/rules/${id}`, b),
  directoryGroups: () => call<{ available: boolean; error: string | null; groups: { name: string; path: string }[]; prefix: string }>('GET', '/api/access/directory/groups'),
  directoryUsers: (q: string) => call<{ username: string; name: string; email: string; enabled: boolean }[]>('GET', `/api/access/directory/users?q=${encodeURIComponent(q)}`),
  subjects: () => call<{ users: KnownUserT[]; groups: string[]; categories: [string, string][] }>('GET', '/api/access/subjects'),
}

export const isSql = (dataset: string) => /^\s*(select|with)\b/i.test(dataset)

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(locale, { timeZone: tz.name, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
