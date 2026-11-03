import logging
import re
from pathlib import Path
from datetime import datetime, timezone

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query as Q
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth, config
from ..connectors import ConnectorError, make_connector
from ..i18n import render, t as _t
from ..db import SCOPE_KINDS, AccessRule, DataSource, Export, KnownUser, ReportTemplate, Scope, SessionLocal, TemplateVersion
from ..schemas import (Column, DataSourceIn, MetaSpec, RunRequest, ScopeIn, SortSpec, TemplateCreate, TemplateDefinition,
                       TemplateSave)
from ..services import access as acl
from ..services import directory, home, report

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/api", dependencies=[Depends(auth.viewer)])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


current_user = auth.username


def _iso(dt: datetime | None) -> str | None:
    """Zamanlar UTC saklanır; SQLite saat dilimini düşürdüğü için saat dilimsiz değerler UTC kabul edilir."""
    if dt is None:
        return None
    return (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)).isoformat()


def _ds_out(ds: DataSource, usage: int = 0) -> dict:
    # cred_file yalnız bir dosya adıdır (içerik değil); düzenleme formu için döner
    return {"id": ds.id, "name": ds.name, "type": ds.type, "config": ds.config,
            "credential": "dosyadan" if ds.config.get("cred_file") else "yok", "template_count": usage}


REQUIRED = {"elasticsearch": ["url", "cred_file"], "prometheus": ["url"],
            "postgresql": ["host", "database", "cred_file"], "mssql": ["host", "database", "cred_file"]}


def _clean_config(body: DataSourceIn) -> dict:
    cfg = {k: v.strip() if isinstance(v, str) else v for k, v in body.config.items() if v not in (None, "")}
    missing = [k for k in REQUIRED[body.type] if not cfg.get(k)]
    if missing:
        _err(ValueError(_t("Eksik alan: {fields}", fields=", ".join(missing))))
    for k in ("cred_file", "ca_file"):
        if cfg.get(k) and ("/" in cfg[k] or cfg[k].startswith(".")):
            _err(ValueError(_t("{key}: yalnız dosya adı girin (RM_SECRETS_DIR altında), yol değil", key=k)))
    return cfg


def _ds_usage(db) -> dict[int, int]:
    out: dict[int, int] = {}
    for t in db.scalars(select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None))):
        d = next(v for v in t.versions if v.version == t.current_version).definition
        out[d.get("datasource_id")] = out.get(d.get("datasource_id"), 0) + 1
    return out


def _tpl_out(t: ReportTemplate, full: bool = False, stats: dict | None = None) -> dict:
    cur = next(v for v in t.versions if v.version == t.current_version)
    d = cur.definition
    out = {"id": t.id, "slug": t.slug, "name": t.name, "scope": t.scope, "group": t.group, "version": t.current_version,
           "updated_at": _iso(cur.created_at), "updated_by": cur.created_by,
           "description": d.get("description", ""), "dataset": d.get("dataset"),
           "params": [p["label"] for p in d.get("params", [])], "column_count": len(d.get("columns", []))}
    if stats is not None:
        out.update(stats)
    if full:
        out["definition"] = d
    return out


def _export_out(e: Export) -> dict:
    return {"id": e.id, "template_id": e.template_id, "template_name": e.template_name,
            "template_version": e.template_version, "params": e.params,
            "period_from": _iso(e.period_from), "period_to": _iso(e.period_to), "partial": e.partial,
            "row_count": e.row_count, "source_count": e.source_count, "data_sha256": e.data_sha256,
            "file_sha256": e.file_sha256, "file_name": e.file_name, "query_summary": e.query_summary,
            "created_by": e.created_by, "created_at": _iso(e.created_at)}


def get_access(u: dict = Depends(auth.viewer), db: Session = Depends(get_db)) -> acl.Access:
    return acl.for_user(db, u)


def _err(e: Exception):
    raise HTTPException(status_code=400, detail=str(e))


# --- veri kaynakları ---
@router.get("/datasources")
def list_datasources(db: Session = Depends(get_db)):
    usage = _ds_usage(db)
    return [_ds_out(d, usage.get(d.id, 0)) for d in db.scalars(select(DataSource).order_by(DataSource.name))]


@router.get("/datasources/secret-files")
def secret_files(_: dict = Depends(auth.admin)):
    """RM_SECRETS_DIR altındaki dosya adları (içerik okunmaz); formda kimlik / CA dosyası seçmek için."""
    d = config.SECRETS_DIR
    return sorted(p.name for p in d.iterdir() if p.is_file() and not p.name.startswith(".")) if d.is_dir() else []


@router.post("/datasources/test-config")
def test_datasource_config(body: DataSourceIn, _: dict = Depends(auth.admin)):
    """Kaydetmeden önce bağlantıyı dener."""
    try:
        return make_connector(body.type, _clean_config(body)).test()
    except (ConnectorError, OSError) as e:
        return {"ok": False, "error": str(e)}


@router.post("/datasources")
def create_datasource(body: DataSourceIn, db: Session = Depends(get_db), _: dict = Depends(auth.admin)):
    if db.scalar(select(DataSource).where(DataSource.name == body.name.strip())):
        _err(ValueError(_t("'{name}' adında bir veri kaynağı zaten var", name=body.name)))
    ds = DataSource(name=body.name.strip(), type=body.type, config=_clean_config(body))
    db.add(ds)
    db.commit()
    return _ds_out(ds)


@router.put("/datasources/{ds_id}")
def update_datasource(ds_id: int, body: DataSourceIn, db: Session = Depends(get_db), _: dict = Depends(auth.admin)):
    ds = db.get(DataSource, ds_id)
    if ds is None:
        raise HTTPException(404, _t("Veri kaynağı bulunamadı"))
    if body.type != ds.type:
        _err(ValueError(_t("Veri kaynağının tipi değiştirilemez; yeni bir kaynak ekleyin")))
    other = db.scalar(select(DataSource).where(DataSource.name == body.name.strip(), DataSource.id != ds_id))
    if other:
        _err(ValueError(_t("'{name}' adında bir veri kaynağı zaten var", name=body.name)))
    ds.name, ds.config = body.name.strip(), _clean_config(body)
    db.commit()
    return _ds_out(ds, _ds_usage(db).get(ds.id, 0))


@router.delete("/datasources/{ds_id}")
def delete_datasource(ds_id: int, db: Session = Depends(get_db), _: dict = Depends(auth.admin)):
    ds = db.get(DataSource, ds_id)
    if ds is None:
        raise HTTPException(404, _t("Veri kaynağı bulunamadı"))
    n = _ds_usage(db).get(ds_id, 0)
    if n:
        _err(ValueError(_t("Bu kaynağı {n} rapor kullanıyor; önce raporları başka kaynağa taşıyın veya silin", n=n)))
    db.delete(ds)
    db.commit()
    return {"ok": True}


def _conn(db, ds_id):
    ds = db.get(DataSource, ds_id)
    if ds is None:
        raise HTTPException(404, _t("Veri kaynağı bulunamadı"))
    try:
        return make_connector(ds.type, ds.config)
    except (ConnectorError, OSError) as e:
        _err(e)


@router.post("/datasources/{ds_id}/test")
def test_datasource(ds_id: int, db: Session = Depends(get_db)):
    try:
        return _conn(db, ds_id).test()
    except ConnectorError as e:
        return {"ok": False, "error": str(e)}


@router.get("/datasources/{ds_id}/datasets")
def datasets(ds_id: int, db: Session = Depends(get_db), _: dict = Depends(auth.designer)):
    try:
        return [d.__dict__ for d in _conn(db, ds_id).datasets()]
    except ConnectorError as e:
        _err(e)


@router.get("/datasources/{ds_id}/fields")
def fields(ds_id: int, dataset: str, db: Session = Depends(get_db), _: dict = Depends(auth.designer)):
    try:
        return [f.__dict__ for f in _conn(db, ds_id).fields(dataset)]
    except ConnectorError as e:
        _err(e)


class SqlProbe(BaseModel):
    dataset: str
    limit: int = 20


@router.post("/datasources/{ds_id}/probe")
def probe(ds_id: int, body: SqlProbe, db: Session = Depends(get_db), _: dict = Depends(auth.designer)):
    """Veri seti (özel SQL sorgusu dahil) için kolonlar ve ilk satırlar; "Sorguyu test et" düğmesi."""
    conn = _conn(db, ds_id)
    try:
        flds = conn.fields(body.dataset)
        rows = conn.sample(body.dataset, min(max(body.limit, 1), 100)) if hasattr(conn, "sample") else []
    except ConnectorError as e:
        _err(e)
    return {"fields": [{"name": f.name, "type": f.type} for f in flds], "rows": rows}


class ValuesIn(BaseModel):
    dataset: str
    field: str


@router.post("/datasources/{ds_id}/values")
def values_post(ds_id: int, body: ValuesIn, db: Session = Depends(get_db), _: dict = Depends(auth.designer)):
    """Uzun veri seti adları (özel SQL sorgusu) URL'ye sığmadığı için POST."""
    try:
        return _conn(db, ds_id).values(body.dataset, body.field)
    except ConnectorError as e:
        _err(e)


@router.get("/datasources/{ds_id}/values")
def values(ds_id: int, dataset: str, field: str, db: Session = Depends(get_db), _: dict = Depends(auth.designer)):
    try:
        return _conn(db, ds_id).values(dataset, field)
    except ConnectorError as e:
        _err(e)


# --- ortamlar ---
def _visible_templates(db, a: acl.Access) -> list[ReportTemplate]:
    q = select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None)).order_by(ReportTemplate.scope, ReportTemplate.group, ReportTemplate.name)
    return [t for t in db.scalars(q) if a.template(t)]


@router.get("/scopes")
def list_scopes(db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    counts: dict[str, int] = {}
    for t in _visible_templates(db, a):
        counts[t.scope] = counts.get(t.scope, 0) + 1
    return {"kinds": {k: _t(v) for k, v in SCOPE_KINDS.items()},
            "items": [{"id": s.id, "name": s.name, "kind": s.kind, "description": s.description, "report_count": counts.get(s.name, 0)}
                      for s in db.scalars(select(Scope).order_by(Scope.name)) if a.allows_scope(s.name, set(counts))]}


@router.post("/scopes")
def create_scope(body: ScopeIn, db: Session = Depends(get_db), _: dict = Depends(auth.admin)):
    if db.scalar(select(Scope).where(Scope.name == body.name.strip())):
        _err(ValueError(_t("'{name}' adında bir ortam zaten var", name=body.name)))
    s = Scope(name=body.name.strip(), kind=body.kind, description=body.description)
    db.add(s)
    db.commit()
    return {"id": s.id, "name": s.name, "kind": s.kind, "description": s.description, "report_count": 0}


def _require_scope(db, name: str):
    if not db.scalar(select(Scope).where(Scope.name == name)):
        _err(ValueError(_t("Ortam bulunamadı: {name}. Önce ortamı oluşturun.", name=name)))


# --- şablonlar ---
def _tpl(db, tid, a: acl.Access) -> ReportTemplate:
    t = db.get(ReportTemplate, tid)
    if t is None or t.deleted_at is not None or not a.template(t):  # yetkisiz / silinmiş şablon "yok" sayılır
        raise HTTPException(404, _t("Şablon bulunamadı"))
    return t


def _require_access(a: acl.Access, scope: str, category: str):
    if not a.allows(scope, category):
        raise HTTPException(403, _t("'{scope} › {category}' için yetkiniz yok", scope=scope, category=category))


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    rows = db.execute(select(Export.template_id, func.count(Export.id), func.max(Export.created_at)).group_by(Export.template_id)).all()
    stats = {tid: {"export_count": n, "last_export_at": _iso(last)} for tid, n, last in rows}
    empty = {"export_count": 0, "last_export_at": None}
    return [_tpl_out(t, stats=stats.get(t.id, empty)) for t in _visible_templates(db, a)]


TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def _slug(db, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.translate(TR).lower()).strip("-")[:70] or "rapor"
    slug, n = base, 2
    while db.scalar(select(ReportTemplate).where(ReportTemplate.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    return slug


@router.post("/templates")
def create_template(body: TemplateCreate, db: Session = Depends(get_db), user: str = Depends(current_user), _: dict = Depends(auth.designer),
                    a: acl.Access = Depends(get_access)):
    """Yeni rapor: veri seti ve zaman alanıyla başlar; kolonlar Rapor tasarımı ekranında seçilir."""
    _require_scope(db, body.scope)
    _require_access(a, body.scope, body.group or "Genel")
    try:
        flds = {f.name: f.type for f in _conn(db, body.datasource_id).fields(body.dataset)}
    except ConnectorError as e:
        _err(e)
    if flds.get(body.time_field) != "date":
        _err(ValueError(_t("Zaman alanı '{field}' bu veri setinde tarih tipinde değil", field=body.time_field)))
    definition = TemplateDefinition(
        description=body.description, datasource_id=body.datasource_id, dataset=body.dataset,
        time_field=body.time_field,
        columns=[Column(field=body.time_field, label=_t("Tarih ({tz})", tz=config.TZ_LABEL), width=20, format="datetime")],
        sort=[SortSpec(field=body.time_field, dir="asc")],
        meta=MetaSpec(title=body.name, scope="", notes=[(_t("Kaynak"), f"{db.get(DataSource, body.datasource_id).name}: {body.dataset}")]),
        step=body.step,
    )
    t = ReportTemplate(slug=_slug(db, body.name), name=body.name, scope=body.scope or "Genel",
                       group=body.group or "Genel", current_version=1)
    db.add(t)
    db.flush()
    db.add(TemplateVersion(template_id=t.id, version=1, definition=definition.model_dump(), created_by=user))
    db.commit()
    db.refresh(t)
    return _tpl_out(t, full=True)


@router.get("/templates/{tid}")
def get_template(tid: int, db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    return _tpl_out(_tpl(db, tid, a), full=True)


@router.get("/templates/{tid}/versions")
def template_versions(tid: int, db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    return [{"version": v.version, "created_at": _iso(v.created_at), "created_by": v.created_by}
            for v in reversed(_tpl(db, tid, a).versions)]


@router.put("/templates/{tid}")
def save_template(tid: int, body: TemplateSave, db: Session = Depends(get_db), user: str = Depends(current_user), _: dict = Depends(auth.designer),
                  a: acl.Access = Depends(get_access)):
    t = _tpl(db, tid, a)
    _require_scope(db, body.scope)
    _require_access(a, body.scope, body.group or "Genel")  # başka ortam / kategoriye taşırken hedefte de yetki gerekir
    t.name, t.scope, t.group = body.name, body.scope, body.group or "Genel"
    t.current_version += 1
    db.add(TemplateVersion(template_id=t.id, version=t.current_version,
                           definition=body.definition.model_dump(), created_by=user))
    db.commit()
    db.refresh(t)
    return _tpl_out(t, full=True)


@router.delete("/templates/{tid}")
def delete_template(tid: int, db: Session = Depends(get_db), u: dict = Depends(auth.admin), a: acl.Access = Depends(get_access)):
    """Yalnız yönetici. Şablon ve sürümleri korunur, listelerden kalkar; export geçmişi ve dosyaları silinmez."""
    t = _tpl(db, tid, a)
    t.deleted_at, t.deleted_by = datetime.now(timezone.utc), u["username"]
    db.commit()
    log.info("Rapor silindi: id=%s ad=%r kullanıcı=%s", t.id, t.name, u["username"])
    return {"ok": True}


@router.post("/templates/{tid}/preview")
def preview(tid: int, body: RunRequest, db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    try:
        return report.preview(db, _tpl(db, tid, a), body)
    except report.ReportError as e:
        _err(e)


@router.post("/templates/{tid}/export")
def export(tid: int, body: RunRequest, db: Session = Depends(get_db), user: str = Depends(current_user),
           a: acl.Access = Depends(get_access)):
    try:
        return _export_out(report.export(db, _tpl(db, tid, a), body, user))
    except report.ReportError as e:
        _err(e)


# --- export geçmişi (yalnızca okuma) ---
@router.get("/exports")
def list_exports(template_id: int | None = None, user: str | None = None, sha256: str | None = Q(None),
                 db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    s = select(Export).order_by(Export.created_at.desc())
    if not a.is_admin:  # yalnız görebildiği raporların export'ları
        s = s.where(Export.template_id.in_([t.id for t in _visible_templates(db, a)] or [-1]))
    if template_id:
        s = s.where(Export.template_id == template_id)
    if user:
        s = s.where(Export.created_by.contains(user))
    if sha256:
        s = s.where(Export.file_sha256 == sha256.strip().lower())
    return [_export_out(e) for e in db.scalars(s.limit(500))]


@router.get("/exports/{eid}/download")
def download(eid: int, db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    e = db.get(Export, eid)
    t = db.get(ReportTemplate, e.template_id) if e else None
    if e is None or not (a.is_admin or (t is not None and a.template(t))):
        raise HTTPException(404, _t("Export bulunamadı"))
    path = config.EXPORT_DIR / Path(e.file_path).name  # eski kayıtlarda mutlak yol vardı
    if not path.is_file():
        raise HTTPException(404, _t("Export dosyası bulunamadı"))
    return FileResponse(path, media_type=XLSX, filename=e.file_name)


# --- ana sayfa ---
@router.get("/home")
def home_summary(yenile: bool = False, db: Session = Depends(get_db), a: acl.Access = Depends(get_access)):
    visible = _visible_templates(db, a)
    ids = {t.id for t in visible}
    counts: dict[str, int] = {}
    for t in visible:
        counts[t.scope] = counts.get(t.scope, 0) + 1
    groups = len({(t.scope, t.group) for t in visible})
    now_local = datetime.now(config.TIMEZONE)
    month_start = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
    ex = select(func.count(Export.id), func.coalesce(func.sum(Export.row_count), 0)).where(Export.created_at >= month_start)
    rq = select(Export).order_by(Export.created_at.desc()).limit(6)
    if not a.is_admin:
        ex, rq = ex.where(Export.template_id.in_(ids or {-1})), rq.where(Export.template_id.in_(ids or {-1}))
    m_count, m_rows = db.execute(ex).one()
    recent = db.scalars(rq)
    h = render(home.health(force=yenile))
    return {
        "reports": sum(counts.values()), "categories": groups,
        "scopes": [{"name": s.name, "kind": s.kind, "kind_label": _t(SCOPE_KINDS.get(s.kind, s.kind)), "report_count": counts.get(s.name, 0),
                    "health": h["health"].get(s.name)} for s in db.scalars(select(Scope).order_by(Scope.name)) if a.allows_scope(s.name, set(counts))],
        "exports_month": {"count": m_count, "rows": int(m_rows)},
        "recent_exports": [{"id": e.id, "template_id": e.template_id, "template_name": e.template_name, "created_by": e.created_by,
                            "created_at": _iso(e.created_at), "row_count": e.row_count} for e in recent],
        # dikkat maddeleri: yalnız görebildiği ortamlar; "Rapor Merkezi" (veri kaynağı bağlantısı) maddeleri yöneticiye
        "sources": h["sources"], "errors": h["errors"] if a.is_admin else [],
        "items": [i for i in h["items"] if (a.is_admin if i["scope"] == "Rapor Merkezi" else a.allows_scope(i["scope"], set(counts)))
                  and (i["template_id"] is None or i["template_id"] in ids or a.is_admin)],
        "generated_at": h["generated_at"], "refreshing": h["refreshing"], "pending": h["pending"], "ttl_minutes": config.HEALTH_TTL // 60,
        "health_configured": h["configured"],
    }


# --- erişim yönetimi (yalnız yönetici) ---
class AccessRuleIn(BaseModel):
    subject_type: Literal["group", "user"]
    subject: str
    scope: str = "*"
    category: str = "*"


def _rule_out(r: AccessRule, templates: list[ReportTemplate]) -> dict:
    a = acl.Access(is_admin=False, pairs={(r.scope, r.category)})
    return {"id": r.id, "subject_type": r.subject_type, "subject": r.subject, "scope": r.scope, "category": r.category,
            "created_by": r.created_by, "created_at": _iso(r.created_at), "report_count": sum(1 for t in templates if a.template(t))}


@router.get("/access/rules")
def list_rules(db: Session = Depends(get_db), _: dict = Depends(auth.admin)):
    tpls = list(db.scalars(select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None))))
    q = select(AccessRule).order_by(AccessRule.subject_type, AccessRule.subject, AccessRule.scope, AccessRule.category)
    return [_rule_out(r, tpls) for r in db.scalars(q)]


@router.post("/access/rules")
def create_rule(body: AccessRuleIn, db: Session = Depends(get_db), u: dict = Depends(auth.admin)):
    subject = body.subject.strip().lstrip("/")
    if not subject:
        _err(ValueError(_t("Grup veya kullanıcı adı girin")))
    if body.scope != "*" and not db.scalar(select(Scope).where(Scope.name == body.scope)):
        _err(ValueError(_t("Ortam bulunamadı: {name}", name=body.scope)))
    exists = db.scalar(select(AccessRule).where(AccessRule.subject_type == body.subject_type, AccessRule.subject == subject,
                                                AccessRule.scope == body.scope, AccessRule.category == body.category))
    if exists:
        _err(ValueError(_t("Bu yetki zaten var")))
    r = AccessRule(subject_type=body.subject_type, subject=subject, scope=body.scope, category=body.category, created_by=u["username"])
    db.add(r)
    db.commit()
    log.info("Yetki verildi: %s:%s → %s › %s (kullanıcı=%s)", r.subject_type, r.subject, r.scope, r.category, u["username"])
    return _rule_out(r, list(db.scalars(select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None)))))


@router.put("/access/rules/{rid}")
def update_rule(rid: int, body: AccessRuleIn, db: Session = Depends(get_db), u: dict = Depends(auth.admin)):
    r = db.get(AccessRule, rid)
    if r is None:
        raise HTTPException(404, _t("Yetki bulunamadı"))
    subject = body.subject.strip().lstrip("/")
    if not subject:
        _err(ValueError(_t("Grup veya kullanıcı adı girin")))
    if body.scope != "*" and not db.scalar(select(Scope).where(Scope.name == body.scope)):
        _err(ValueError(_t("Ortam bulunamadı: {name}", name=body.scope)))
    dup = db.scalar(select(AccessRule).where(AccessRule.subject_type == body.subject_type, AccessRule.subject == subject,
                                             AccessRule.scope == body.scope, AccessRule.category == body.category, AccessRule.id != rid))
    if dup:
        _err(ValueError(_t("Bu yetki zaten var")))
    old = f"{r.subject_type}:{r.subject} → {r.scope} › {r.category}"
    r.subject_type, r.subject, r.scope, r.category = body.subject_type, subject, body.scope, body.category
    db.commit()
    log.info("Yetki değiştirildi: %s ⇒ %s:%s → %s › %s (kullanıcı=%s)", old, r.subject_type, r.subject, r.scope, r.category, u["username"])
    return _rule_out(r, list(db.scalars(select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None)))))


@router.delete("/access/rules/{rid}")
def delete_rule(rid: int, db: Session = Depends(get_db), u: dict = Depends(auth.admin)):
    r = db.get(AccessRule, rid)
    if r is None:
        raise HTTPException(404, _t("Yetki bulunamadı"))
    log.info("Yetki kaldırıldı: %s:%s → %s › %s (kullanıcı=%s)", r.subject_type, r.subject, r.scope, r.category, u["username"])
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/access/subjects")
def access_subjects(db: Session = Depends(get_db), _: dict = Depends(auth.admin)):
    """Giriş yapmış kullanıcılar (grupları ve görebildiği rapor sayısıyla) ve bilinen gruplar."""
    tpls = list(db.scalars(select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None))))
    users, groups = [], set(config.OIDC_ADMIN_GROUPS | config.OIDC_DESIGNER_GROUPS | config.OIDC_VIEWER_GROUPS)
    for ku in db.scalars(select(KnownUser).order_by(KnownUser.last_login_at.desc())):
        groups |= set(ku.groups or [])
        a = acl.for_user(db, {"username": ku.username, "roles": ku.roles or []})
        users.append({"username": ku.username, "name": ku.name, "source": ku.source, "groups": [g for g in ku.groups or [] if config.app_group(g)],
                      "roles": ku.roles or [], "last_login_at": _iso(ku.last_login_at), "is_admin": a.is_admin,
                      "report_count": len(tpls) if a.is_admin else sum(1 for t in tpls if a.template(t))})
    rule_groups = set(db.scalars(select(AccessRule.subject).where(AccessRule.subject_type == "group")))
    return {"users": users, "groups": sorted(g for g in groups | rule_groups if config.app_group(g)),
            "categories": sorted({(t.scope, t.group) for t in tpls})}


@router.get("/access/directory/groups")
def directory_groups(_: dict = Depends(auth.admin)):
    """Kimlik sağlayıcıdaki gruplar; erişilemiyorsa available=false ve neden (ekran elle girişe döner)."""
    if not directory.available():
        return {"available": False, "error": _t("Kimlik sağlayıcı dizini yapılandırılmamış"), "groups": [], "prefix": config.OIDC_GROUP_PREFIX}
    try:
        return {"available": True, "error": None, "groups": directory.groups(), "prefix": config.OIDC_GROUP_PREFIX}
    except Exception as e:  # Keycloak'a erişim / yetki sorunu ekranda gösterilir
        return {"available": False, "error": str(e)[:200], "groups": [], "prefix": config.OIDC_GROUP_PREFIX}


@router.get("/access/directory/users")
def directory_users(q: str = Q("", min_length=0, max_length=80), _: dict = Depends(auth.admin)):
    if not directory.available() or len(q.strip()) < 2:
        return []
    try:
        return directory.users(q.strip())
    except Exception as e:
        _err(e)
