import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { accessApi, api, fmtDateTime, type AccessRuleT, type KnownUserT, type Scope } from '../api'
import { IconEdit, IconPlus, IconTrash } from '../components/Icons'
import Combobox, { type Option } from '../components/Combobox'
import { locale, t } from '../i18n'

const ALL = '*'
const show = (v: string, all: string) => (v === ALL ? all : v)

export default function Access() {
  const [rules, setRules] = useState<AccessRuleT[] | null>(null)
  const [users, setUsers] = useState<KnownUserT[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [cats, setCats] = useState<[string, string][]>([])
  const [scopes, setScopes] = useState<Scope[]>([])
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [form, setForm] = useState({ subject_type: 'group' as 'group' | 'user', subject: '', scope: ALL, category: ALL })
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<AccessRuleT | null>(null)
  const formRef = useRef<HTMLElement>(null)
  const EMPTY = { subject_type: 'group' as 'group' | 'user', subject: '', scope: ALL, category: ALL }
  const [filter, setFilter] = useState('')
  const [dir, setDir] = useState<{ available: boolean; error: string | null; groups: { name: string; path: string }[]; prefix?: string } | null>(null)
  const [dirUsers, setDirUsers] = useState<Option[]>([])
  const [userQ, setUserQ] = useState('')
  const [userLoading, setUserLoading] = useState(false)

  const load = () => Promise.all([accessApi.rules(), accessApi.subjects(), api.scopes()])
    .then(([r, s, sc]) => { setRules(r); setUsers(s.users); setGroups(s.groups); setCats(s.categories); setScopes(sc.items) })
    .catch(e => setError(e.message))
  useEffect(() => { load(); accessApi.directoryGroups().then(setDir).catch(() => setDir({ available: false, error: null, groups: [] })) }, [])
  // Kullanıcı araması: Keycloak dizininde (en az 2 harf), yazmayı bitirince
  useEffect(() => {
    if (form.subject_type !== 'user' || !dir?.available || userQ.trim().length < 2) { setDirUsers([]); return }
    setUserLoading(true)
    const timer = setTimeout(() => {
      accessApi.directoryUsers(userQ).then(r => setDirUsers(r.map(u => ({ value: u.username, label: u.name || undefined, hint: [u.email, u.enabled ? '' : t('devre dışı')].filter(Boolean).join(' · ') }))))
        .catch(() => setDirUsers([])).finally(() => setUserLoading(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [userQ, form.subject_type, dir])

  const groupOptions: Option[] = useMemo(() => {
    const m = new Map<string, Option>()
    for (const g of dir?.groups ?? []) m.set(g.name, { value: g.name, hint: g.path !== `/${g.name}` ? g.path : 'Keycloak' })
    for (const g of groups) if (!m.has(g)) m.set(g, { value: g, hint: t('girişlerden') })
    for (const o of m.values()) if (/-(Admins|Designers|Users)$/.test(o.value)) o.hint = o.value.endsWith('Admins') ? t('rol grubu · yönetici') : o.value.endsWith('Designers') ? t('rol grubu · tasarımcı') : t('rol grubu · tüm kullanıcılar')
    return [...m.values()]
  }, [dir, groups])
  const userOptions: Option[] = useMemo(() => {
    const m = new Map<string, Option>()
    for (const u of dirUsers) m.set(u.value, u)
    const n = userQ.trim().toLocaleLowerCase(locale)
    for (const u of users) if (!m.has(u.username) && (!n || `${u.username} ${u.name}`.toLocaleLowerCase(locale).includes(n)))
      m.set(u.username, { value: u.username, label: u.name || undefined, hint: t('giriş yapmış') })
    return [...m.values()]
  }, [dirUsers, users, userQ])

  const categoryOptions = useMemo(() => {
    const list = cats.filter(([s]) => form.scope === ALL || s === form.scope).map(([, c]) => c)
    return [...new Set(list)].sort((a, b) => a.localeCompare(b, locale))
  }, [cats, form.scope])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.subject.trim()) return
    setBusy(true); setError(''); setOk('')
    const body = { ...form, subject: form.subject.trim() }
    const p = editing ? accessApi.update(editing.id, body) : accessApi.create(body)
    p.then(r => {
        setOk(t(editing ? 'Yetki güncellendi: {subject} → {scope} › {category} ({n} rapor)' : 'Yetki verildi: {subject} → {scope} › {category} ({n} rapor)',
          { subject: r.subject, scope: show(r.scope, t('tüm ortamlar')), category: show(r.category, t('tüm kategoriler')), n: r.report_count }))
        if (editing) { setEditing(null); setForm(EMPTY) } else setForm(f => ({ ...f, subject: '' }))
        return load()
      })
      .catch(err => setError(err.message))
      .finally(() => setBusy(false))
  }
  const edit = (r: AccessRuleT) => {
    setEditing(r); setOk(''); setError('')
    setForm({ subject_type: r.subject_type, subject: r.subject, scope: r.scope, category: r.category })
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const cancelEdit = () => { setEditing(null); setForm(EMPTY) }
  const remove = (r: AccessRuleT) => {
    if (!window.confirm(t('{subject} için "{scope} › {category}" yetkisi kaldırılsın mı?', { subject: r.subject, scope: show(r.scope, t('Tüm ortamlar')), category: show(r.category, t('Tüm kategoriler')) }))) return
    accessApi.remove(r.id).then(load).catch(e => setError(e.message))
  }

  const shownRules = (rules ?? []).filter(r => `${r.subject} ${r.scope} ${r.category}`.toLowerCase().includes(filter.toLowerCase()))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Erişim yönetimi')}</h1>
          <div className="lead">{t('Yöneticiler tüm raporları görür. Diğer kullanıcılar yalnız burada kendilerine veya gruplarına yetki verilen ortam ve kategorilerdeki raporları görür, önizler ve Excel\'e aktarır.')}</div>
        </div>
      </div>
      {error && <div className="banner err" role="alert">{error}</div>}
      {ok && <div className="banner ok" role="status">{ok}</div>}

      <section ref={formRef} className={`card card-pad${editing ? ' acl-editing' : ''}`} aria-labelledby="yeni-yetki">
        <h2 id="yeni-yetki" style={{ marginBottom: 14 }}>
          {editing ? <>{t('Yetkiyi düzenle')} <span className="hint">· {editing.subject} → {show(editing.scope, t('Tüm ortamlar'))} › {show(editing.category, t('Tüm kategoriler'))}</span></> : t('Yetki ver')}
        </h2>
        <form className="acl-form" onSubmit={submit}>
          <div className="field">
            <span id="kim">{t('Kime')}</span>
            <div className="seg" role="radiogroup" aria-labelledby="kim">
              {(['group', 'user'] as const).map(st => (
                <button type="button" key={st} role="radio" aria-checked={form.subject_type === st} className={form.subject_type === st ? 'on' : ''}
                        onClick={() => setForm(f => ({ ...f, subject_type: st, subject: '' }))}>{st === 'group' ? t('Keycloak grubu') : t('Kullanıcı')}</button>
              ))}
            </div>
          </div>
          <div className="field acl-subject">
            <span>{form.subject_type === 'group' ? t('Grup') : t('Kullanıcı')}</span>
            {form.subject_type === 'group'
              ? <Combobox label={t('Grup')} value={form.subject} onChange={v => setForm(f => ({ ...f, subject: v }))} options={groupOptions}
                          loading={dir === null} placeholder={dir?.available ? t('{n} grup içinde ara', { n: dir.groups.length }) : t('grup adı')}
                          emptyText={t('Bu adda grup yok; yazdığınız ad kullanılır')} />
              : <Combobox label={t('Kullanıcı')} value={form.subject} onChange={v => setForm(f => ({ ...f, subject: v }))} options={userOptions}
                          onQuery={setUserQ} loading={userLoading} placeholder={dir?.available ? t('ad, kullanıcı adı veya e-posta ile ara') : t('kullanıcı adı')}
                          emptyText={userQ.trim().length < 2 ? t('Aramak için en az 2 harf yazın') : t('Eşleşen kullanıcı yok')} />}
          </div>
          <label className="field">{t('Ortam')}
            <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value, category: ALL }))}>
              <option value={ALL}>{t('Tüm ortamlar')}</option>
              {scopes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          <label className="field">{t('Kategori')}
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              <option value={ALL}>{form.scope === ALL ? t('Tüm kategoriler') : t('Bu ortamdaki tüm kategoriler')}</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="acl-actions">
            {editing && <button type="button" className="btn" onClick={cancelEdit}>{t('Vazgeç')}</button>}
            <button className="btn primary" disabled={busy || !form.subject.trim()}>{editing ? t('Kaydet') : <><IconPlus size={16} />{t('Yetki ver')}</>}</button>
          </div>
        </form>
        <p className="hint" style={{ margin: '12px 0 0' }}>
          {dir?.available
            ? <>{dir.prefix ? t('Gruplar ve kullanıcılar Keycloak\'tan listelenir (yalnız {prefix}* grupları).', { prefix: dir.prefix }) : t('Gruplar ve kullanıcılar Keycloak\'tan listelenir.')} </>
            : <><b>{dir?.error ? t('Keycloak dizini kullanılamıyor: {error}.', { error: dir.error }) : t('Keycloak dizini kullanılamıyor.')}</b> {t('Grup ve kullanıcı adlarını elle yazabilirsiniz.')} </>}
          {dir?.prefix
            ? t('Yeni bir ekip için Keycloak\'ta {prefix}EkipAdı grubu açıp üyeleri ekleyin; gruba üye olan uygulamaya görüntüleyici olarak girebilir, göreceği raporları burada belirlersiniz. Tek kişiye özel yetki için "Kullanıcı" seçin.', { prefix: dir.prefix })
            : t('Keycloak\'ta ortam / kategori için ayrıca grup açmanız gerekmez; var olan herhangi bir gruba veya doğrudan kullanıcıya yetki verebilirsiniz.')}
          {' '}{t('Kullanıcının grupları her girişte güncellenir.')}
          {' '}{t('"Tüm ortamlar" ile bir kategori seçmek, o kategoriyi her ortamda yetkilendirir (ör. her ortamdaki "Denetim kayıtları").')}
        </p>
      </section>

      <section className="card" aria-labelledby="yetkiler">
        <div className="card-head">
          <h2 id="yetkiler">{t('Yetkiler')} {rules && <span className="hint">· {rules.length}</span>}</h2>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <span className="sr-only">{t('Yetkilerde ara')}</span>
            <input type="search" placeholder={t('ara')} value={filter} onChange={e => setFilter(e.target.value)} />
          </label>
        </div>
        <div className="table-wrap">
          <table className="simple light">
            <thead><tr><th>{t('Kime')}</th><th>{t('Ortam')}</th><th>{t('Kategori')}</th><th style={{ textAlign: 'right' }}>{t('Kapsadığı rapor')}</th><th>{t('Veren')}</th><th><span className="sr-only">{t('İşlem')}</span></th></tr></thead>
            <tbody>
              {shownRules.map(r => (
                <tr key={r.id} className={editing?.id === r.id ? 'selected' : ''}>
                  <td><span className={`acl-chip ${r.subject_type}`}>{r.subject_type === 'group' ? t('Grup') : t('Kullanıcı')}</span> <b>{r.subject}</b></td>
                  <td>{r.scope === ALL ? <i>{t('Tüm ortamlar')}</i> : r.scope}</td>
                  <td>{r.category === ALL ? <i>{t('Tüm kategoriler')}</i> : r.category}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.report_count}</td>
                  <td className="hint">{r.created_by} · {fmtDateTime(r.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="icon-btn edit" onClick={() => edit(r)} aria-label={t('{subject} yetkisini düzenle', { subject: r.subject })} title={t('Düzenle')}><IconEdit /></button>{' '}
                    <button className="icon-btn" onClick={() => remove(r)} aria-label={t('{subject} yetkisini kaldır', { subject: r.subject })} title={t('Yetkiyi kaldır')}><IconTrash /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rules?.length === 0 && <div className="empty">{t('Henüz yetki yok. Yönetici olmayan kullanıcılar şu an hiçbir rapor görmüyor.')}</div>}
        </div>
      </section>

      <section className="card" aria-labelledby="kullanicilar">
        <div className="card-head">
          <h2 id="kullanicilar">{t('Giriş yapmış kullanıcılar')}</h2>
          <span className="hint">{t('Kim kaç rapor görüyor: yetkileri doğrulamak için')}</span>
        </div>
        <div className="table-wrap">
          <table className="simple light">
            <thead><tr><th>{t('Kullanıcı')}</th><th>{t('Rol')}</th><th>{t('Gruplar')}</th><th style={{ textAlign: 'right' }}>{t('Görebildiği rapor')}</th><th>{t('Son giriş')}</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.username}>
                  <td><b>{u.name || u.username}</b><div className="hint mono">{u.username}</div></td>
                  <td>{u.is_admin ? t('Yönetici') : u.roles.includes('designer') ? t('Tasarımcı') : t('Görüntüleyici')}</td>
                  <td className="acl-groups">{u.groups.length ? u.groups.map(g => <span key={g} className="badge">{g}</span>) : <span className="hint">–</span>}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.is_admin ? t('tümü') : u.report_count}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(u.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <div className="empty">{t('Henüz kimse giriş yapmadı.')}</div>}
        </div>
      </section>
    </>
  )
}
