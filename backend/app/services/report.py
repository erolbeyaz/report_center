"""Şablon + çalıştırma parametreleri → sorgu, önizleme ve export."""
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from .. import config
from ..i18n import t as _t
from ..connectors import ConnectorError, Query, make_connector
from ..db import DataSource, Export, ReportTemplate
from ..schemas import Column, Filter, RunRequest, TemplateDefinition
from .xlsx import build_workbook


class ReportError(Exception):
    pass


def current_definition(t: ReportTemplate) -> TemplateDefinition:
    v = next(v for v in t.versions if v.version == t.current_version)
    return TemplateDefinition.model_validate(v.definition)


def connector_for(db: Session, d: TemplateDefinition):
    ds = db.get(DataSource, d.datasource_id)
    if ds is None:
        raise ReportError(_t("Şablonun veri kaynağı bulunamadı"))
    return ds, make_connector(ds.type, ds.config)


def local(dt: datetime) -> datetime:
    """İstemciden gelen saat dilimsiz değeri RM_TIMEZONE kabul eder."""
    return dt.replace(tzinfo=config.TIMEZONE) if dt.tzinfo is None else dt.astimezone(config.TIMEZONE)


def run_columns(d: TemplateDefinition, req: RunRequest) -> list[Column]:
    if not req.columns:
        return d.columns
    by_field = {c.field: c for c in d.columns}
    return [by_field[f] for f in req.columns if f in by_field]


def build_query(d: TemplateDefinition, req: RunRequest, cols: list[Column]) -> Query:
    if not cols:
        raise ReportError(_t("Şablonda kolon yok; önce Rapor tasarımı ekranından kolon ekleyin"))
    p_from, p_to = local(req.period_from), local(req.period_to)
    if p_to <= p_from:
        raise ReportError(_t("Bitiş zamanı başlangıçtan sonra olmalı"))
    filters = list(d.fixed_filters)
    allowed = {p.field: p for p in d.params}
    for field, value in req.params.items():
        if value in (None, "", "all"):
            continue
        p = allowed.get(field)
        if p is None or value not in p.options:
            raise ReportError(_t("Geçersiz parametre: {field}={value}", field=field, value=value))
        filters.append(Filter(field=field, op="eq", value=value))
    fields = sorted({c.field for c in cols} | {r.field for r in d.row_rules} | {d.time_field})
    sort = d.sort
    if req.sort:
        bad = [s.field for s in req.sort if s.field not in {c.field for c in d.columns} | {d.time_field}]
        if bad:
            raise ReportError(_t("Bu alana göre sıralanamaz: {fields}", fields=", ".join(bad)))
        sort = req.sort
    return Query(dataset=d.dataset, time_field=d.time_field, period_from=p_from, period_to=p_to,
                 filters=filters, sort=sort, fields=fields, options={"step": d.step} if d.step else {})


def _label(d: TemplateDefinition, field: str) -> str:
    return next((c.label for c in d.columns if c.field == field), field)


def to_datetime(v):
    """ISO metin veya epoch (ms / sn) → yerel (RM_TIMEZONE) saat dilimsiz datetime; çözülemezse None."""
    s = str(v).strip()
    try:
        if s.lstrip("-").isdigit() or isinstance(v, (int, float)):
            n = float(s)
            dt = datetime.fromtimestamp(n / 1000 if abs(n) > 1e11 else n, tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(config.TIMEZONE).replace(tzinfo=None)
    except (ValueError, OverflowError, OSError):
        return None


def get_path(src, path: str):
    """'a.b.c' alanını hem düz anahtar ("a.b.c") hem iç içe nesne ({a:{b:{c}}}) olarak okur; dizilerde her elemandan toplar."""
    if not isinstance(src, dict):
        return None
    if path in src:
        return src[path]
    parts = path.split(".")
    for i in range(len(parts) - 1, 0, -1):  # en uzun eşleşen önek: "tag.span@kind" → src["tag"]["span@kind"]
        head = ".".join(parts[:i])
        if head in src:
            nxt, rest = src[head], ".".join(parts[i:])
            if isinstance(nxt, list):
                vals = [get_path(x, rest) for x in nxt]
                vals = [x for x in vals if x not in (None, "")]
                return vals or None
            return get_path(nxt, rest)
    return None


def cell(src: dict, col: Column):
    v = get_path(src, col.field)
    if col.format == "datetime" and v not in (None, ""):
        return to_datetime(v) or str(v)
    if isinstance(v, list):
        v = "\n".join(map(str, v))
    return None if v in ("", None) else v


def row_fill(src: dict, d: TemplateDefinition) -> str | None:
    for r in d.row_rules:
        if str(get_path(src, r.field)) == r.equals:
            return r.fill
    return None


def coverage(conn, q: Query) -> dict:
    """Seçilen dönem veri setinde mevcut mu? ILM ile silinmiş kısım varsa eksiksizlik iddia edilemez."""
    lo, hi = conn.time_bounds(q.dataset, q.time_field)
    earliest = lo.astimezone(config.TIMEZONE) if lo else None
    complete = earliest is not None and q.period_from >= earliest
    msg = None
    if earliest is None:
        msg = _t("Veri setinde kayıt yok.")
    elif not complete:
        msg = _t("Seçilen dönemin başı ({start}) veri setindeki en eski kayıttan ({earliest}) önce. Bu aralık kaynakta yok "
                 "(saklama süresi dolmuş olabilir); eksiksiz rapor için dönemi en eski kayıttan başlatın veya veriyi yedekten geri yükleyin.",
                 start=f"{q.period_from:%d.%m.%Y %H:%M}", earliest=f"{earliest:%d.%m.%Y %H:%M}")
    return {"earliest": earliest.isoformat() if earliest else None,
            "latest": hi.astimezone(config.TIMEZONE).isoformat() if hi else None,
            "complete": complete, "message": msg}


def preview(db: Session, t: ReportTemplate, req: RunRequest) -> dict:
    d = current_definition(t)
    cols = run_columns(d, req)
    q = build_query(d, req, cols)
    _, conn = connector_for(db, d)
    try:
        cov = coverage(conn, q)
        total = conn.count(q)
        docs = conn.search(q, min(req.limit or config.PREVIEW_LIMIT, config.PREVIEW_LIMIT))
    except ConnectorError as e:
        raise ReportError(str(e))
    rows = []
    for s in docs:
        vals = {}
        for c in cols:
            v = cell(s, c)
            vals[c.field] = v.strftime("%d.%m.%Y %H:%M:%S") if isinstance(v, datetime) else v
        rows.append({"values": vals, "fill": row_fill(s, d)})
    try:
        facets = {p.field: conn.facet(q, p.field) for p in d.params}
    except ConnectorError as e:
        raise ReportError(str(e))
    return {"total": total, "shown": len(rows), "limit": config.PREVIEW_LIMIT, "rows": rows, "facets": facets, "coverage": cov,
            "columns": [c.model_dump() for c in cols], "query": conn.describe(q)}


def export(db: Session, t: ReportTemplate, req: RunRequest, user: str) -> Export:
    d = current_definition(t)
    cols = run_columns(d, req)
    q = build_query(d, req, cols)
    _, conn = connector_for(db, d)
    try:
        cov = coverage(conn, q)
        if not cov["complete"]:
            raise ReportError(cov["message"] + " " + _t("Export üretilmedi."))
        source_count = conn.count(q)
        if source_count > config.EXPORT_LIMIT:
            raise ReportError(_t("{count} kayıt Excel sınırını ({limit}) aşıyor; dönemi daraltın", count=source_count, limit=config.EXPORT_LIMIT))
        docs = list(conn.stream(q))
    except ConnectorError as e:
        raise ReportError(str(e))
    if len(docs) != source_count:
        raise ReportError(_t("Eksiksizlik kontrolü başarısız: kaynak {source}, okunan {read}.", source=source_count, read=len(docs)) + " " + _t("Export üretilmedi."))

    table = [[cell(s, c) for c in cols] for s in docs]
    fills = [row_fill(s, d) for s in docs]
    canon = "\n".join("|".join("" if v is None else (v.strftime("%Y-%m-%d %H:%M:%S") if isinstance(v, datetime) else str(v))
                               for v in r) for r in table)
    data_sha = hashlib.sha256(canon.encode()).hexdigest()
    now = datetime.now(config.TIMEZONE)
    partial = q.period_to > now
    param_text = ", ".join(f"{k}: {v}" for k, v in req.params.items() if v not in (None, "", "all")) or _t("yok")

    fmt = "%d.%m.%Y %H:%M"
    meta = [(_t("Rapor"), d.meta.title),
            (_t("Dönem"), _t("{start} – {end} (bitiş hariç, {tz})", start=q.period_from.strftime(fmt), end=q.period_to.strftime(fmt),
                             tz=config.TZ_LABEL)),
            (_t("Kapsam"), d.meta.scope or "-"),
            (_t("Seçilen parametreler"), param_text),
            (_t("Sıralama"), ", ".join(f"{_label(d, s.field)} ({_t('azalan') if s.dir == 'desc' else _t('artan')})" for s in q.sort) or "-"),
            (_t("Kayıt sayısı"), len(table)),
            (_t("Kaynak sorgusu"), conn.describe(q)),
            (_t("Eksiksizlik kontrolü"), _t("Kaynaktaki kayıt sayısı ({source}) ile rapordaki satır sayısı ({rows}) eşleşti.",
                                            source=source_count, rows=len(table))),
            (_t("Veri kapsamı"), _t("Veri setindeki en eski kayıt {earliest}; seçilen dönemin tamamı kaynakta mevcut.",
                                    earliest=f"{datetime.fromisoformat(cov['earliest']):%d.%m.%Y %H:%M:%S}")),
            (_t("Saat dilimi"), _t("Tüm tarihler {tz}.", tz=config.TZ_LABEL)),
            *d.meta.notes,
            (_t("Şablon"), _t("{name} · sürüm {version}", name=t.name, version=t.current_version)),
            (_t("Veri özeti (SHA-256)"), data_sha),
            (_t("Oluşturan / zaman"), f"{user} · {now:%d.%m.%Y %H:%M:%S}")]
    if partial:
        meta.append((_t("UYARI"), _t("Dönem henüz bitmedi; rapor {at} itibarıyla kısmidir.", at=now.strftime(fmt))))
    meta += [(_t("Hazırlayan"), ""), (_t("İmza / Tarih"), ""), (_t("Onaylayan"), ""), (_t("İmza / Tarih"), "")]

    rec = Export(template_id=t.id, template_version=t.current_version, template_name=t.name,
                 params={"period_from": req.period_from.isoformat(), "period_to": req.period_to.isoformat(),
                         "params": req.params, "columns": [c.field for c in cols],
                         "sort": [s.model_dump() for s in q.sort]},
                 period_from=q.period_from.astimezone(timezone.utc), period_to=q.period_to.astimezone(timezone.utc), partial=partial,
                 row_count=len(table), source_count=source_count, data_sha256=data_sha,
                 file_sha256="", file_name="", file_path="", query_summary=conn.describe(q), created_by=user)
    db.add(rec)
    db.flush()

    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", t.slug)
    name = f"{slug}_{q.period_from:%Y%m%d%H%M}-{q.period_to:%Y%m%d%H%M}_{rec.id}.xlsx"
    path = config.EXPORT_DIR / name
    build_workbook(path, d.meta.title, meta, cols, table, fills, sheet_title=t.name)
    rec.file_name, rec.file_path = name, name  # EXPORT_DIR'e göre; veri dizini taşınabilir kalır
    rec.file_sha256 = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    db.commit()
    return rec
