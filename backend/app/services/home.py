"""Ana Sayfa sağlık özeti.

Kontroller koda gömülü değildir; RM_HEALTH_CHECKS_FILE ile verilen JSON dosyasından okunur (örnek:
examples/health-checks.example.json). Dosya yoksa yalnızca veri kaynağı bağlantıları kontrol edilir.

Dış kaynaklara gittiği için hiçbir istek hesaplamayı beklemez: özet arka planda üretilir (uygulama açılırken, TTL dolunca
veya "Yenile" ile) ve istek o anki önbelleği döner. Her kaynak çağrısı RM_HEALTH_TIMEOUT_SECONDS ile sınırlıdır.
"""
import json
import logging
import operator
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .. import config
from ..connectors import make_connector
from ..connectors.base import Query
from ..db import DataSource, ReportTemplate, SessionLocal
from ..schemas import SortSpec
from ..i18n import current, later, t
from . import report

log = logging.getLogger(__name__)

CRITICAL, WARNING, INFO, OK = "Kritik", "Uyarı", "Bilgi", "Sorunsuz"
LEVEL_ORDER = {CRITICAL: 0, WARNING: 1, INFO: 2}
OPS = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le, "==": operator.eq, "!=": operator.ne}

_lock = threading.Lock()
_state: dict = {"data": None, "at": 0.0, "running": False}


def load_checks() -> dict:
    path = config.HEALTH_CHECKS_FILE
    if not path:
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.error("Sağlık kontrolleri okunamadı (%s): %s", path, e)
        return {"_error": later(t, "Sağlık kontrolleri dosyası okunamadı: {error}", error=str(e))}


def fmt(v: float, kind: str | None) -> str:
    """İstek diline göre biçimler; arka planda later(fmt, v, kind) olarak saklanır."""
    tr = current() == "tr"
    if kind == "hours":
        return t("{n} saat", n=f"{v:.0f}") if v >= 1 else t("{n} dk", n=f"{v * 60:.0f}")
    if kind == "percent":
        return "%" + f"{v:.1f}".replace(".", ",") if tr else f"{v:.1f}%"
    if kind == "count":
        return f"{v:,.0f}".replace(",", ".") if tr else f"{v:,.0f}"
    return f"{v:g}"


def _value(v: float, kind: str | None, unit: str | None):
    return later(lambda a, u: f"{a} {u}" if u else a, later(fmt, v, kind), unit)


def _level(spec, labels: dict, v: float) -> str | None:
    """level: "Kritik" | {"label": "severity", "map": {...}} | {"warning": 75, "critical": 90} (eşik)."""
    if isinstance(spec, str):
        return spec
    if "label" in spec:
        return spec.get("map", {}).get(labels.get(spec["label"], ""))
    if "critical" in spec and v >= spec["critical"]:
        return CRITICAL
    if "warning" in spec and v >= spec["warning"]:
        return WARNING
    return None


def _when(spec, v: float) -> bool:
    return not spec or OPS[spec.get("op", ">")](v, spec["value"])


def _compute() -> dict:
    cfg = load_checks()
    errors = [cfg["_error"]] if "_error" in cfg else []
    scope_label = cfg.get("scope_label", "cluster")
    scopes: dict[str, dict] = cfg.get("scopes", {})  # etiket değeri → {"scope": ortam adı, "key": rapor slug öneki}
    by_scope = {s["scope"]: {**s, "value": val} for val, s in scopes.items()}
    checks = cfg.get("checks", [])

    db = SessionLocal()
    try:
        # Veritabanı oturumu thread'ler arasında paylaşılmaz: gereken her şey burada okunur.
        tpls = {t.slug: t for t in db.scalars(select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None)))}
        defs = {slug: report.current_definition(t) for slug, t in tpls.items()}
        sources = list(db.scalars(select(DataSource).order_by(DataSource.name)))
        ds_by_name = {s.name: s for s in sources}
        ds_by_id = {s.id: s for s in sources}
        conn = lambda ds: make_connector(ds.type, {**ds.config, "timeout": config.HEALTH_TIMEOUT})

        def ref(pattern: str | None, ctx: dict) -> dict:
            slug = pattern.format_map(_Safe(ctx)) if pattern else None
            t = tpls.get(slug) if slug else None
            return {"template_id": t.id, "report": t.name} if t else {"template_id": None, "report": "–"}

        def test(ds):
            try:
                conn(ds).test()
                return {"name": ds.name, "type": ds.type, "ok": True, "error": None}
            except Exception as e:  # bağlantı hatası özet kartında gösterilir
                return {"name": ds.name, "type": ds.type, "ok": False, "error": str(e)[:200]}

        def run_promql(chk):
            ds = ds_by_name.get(chk.get("datasource") or cfg.get("prometheus", ""))
            if ds is None or ds.type != "prometheus":
                raise ValueError(t("Prometheus veri kaynağı bulunamadı: {name}", name=chk.get("datasource") or cfg.get("prometheus")))
            return conn(ds)._get("/api/v1/query", {"query": chk["query"]})["result"]

        def run_report(chk, s):
            # Bir raporun veri setinde son kayıt (report_last) veya kayıt sayısı (report_count)
            slug = chk["report"].format_map(_Safe(s))
            t, d = tpls.get(slug), defs.get(slug)
            if t is None or d.datasource_id not in ds_by_id:
                return None
            c = conn(ds_by_id[d.datasource_id])
            now = datetime.now(timezone.utc)
            if chk["type"] == "report_count":
                q = Query(dataset=d.dataset, time_field=d.time_field, period_from=now - timedelta(hours=chk.get("window_hours", 24)),
                          period_to=now, filters=d.fixed_filters if chk.get("use_filters") else [])
                return {"count": c.count(q), "template": t}
            fields = chk.get("fields", [])
            q = Query(dataset=d.dataset, time_field=d.time_field, period_from=now - timedelta(days=chk.get("window_days", 30)),
                      period_to=now, filters=d.fixed_filters, sort=[SortSpec(field=d.time_field, dir="desc")],
                      fields=[d.time_field, *fields])
            rows = c.search(q, 1)
            if not rows:
                return {"row": None, "template": t}
            at = report.to_datetime(report.get_path(rows[0], d.time_field))
            return {"row": rows[0], "at": at.astimezone(timezone.utc).isoformat() if at else None, "template": t,
                    "summary": ", ".join(str(report.get_path(rows[0], f)) for f in fields if report.get_path(rows[0], f) is not None)}

        with ThreadPoolExecutor(max_workers=8) as ex:
            f_src = [ex.submit(test, s) for s in sources]
            futures = []
            for i, chk in enumerate(checks):
                if chk.get("type", "promql") == "promql":
                    futures.append((i, None, ex.submit(run_promql, chk)))
                else:
                    futures += [(i, name, ex.submit(run_report, chk, s)) for name, s in by_scope.items()]
            src = [f.result() for f in f_src]
            results: dict[tuple, object] = {}
            for i, scope, f in futures:
                try:
                    results[(i, scope)] = f.result()
                except Exception as e:
                    errors.append(f"{checks[i].get('id', i)}{' · ' + scope if scope else ''}: {str(e)[:200]}")

        items: list[dict] = []
        facts: dict[str, dict[str, dict]] = {name: {} for name in by_scope}

        def add_item(spec, level, ctx, value):
            items.append({"level": level, "title": spec.get("title", "").format_map(_Safe(ctx)), "scope": ctx.get("scope", "–"),
                          "value": _value(value, spec.get("value"), spec.get("unit")), **ref(spec.get("report"), ctx)})

        for s in src:
            if not s["ok"]:
                items.append({"level": CRITICAL, "title": later(t, "Veri kaynağına bağlanılamıyor: {name}", name=s["name"]),
                              "scope": "Rapor Merkezi", "value": later(t, "bağlantı yok"), "template_id": None, "report": s["error"] or "–"})

        for i, chk in enumerate(checks):
            fact, item = chk.get("fact"), chk.get("item")
            if chk.get("type", "promql") == "promql":
                series = results.get((i, None)) or []
                agg: dict[str, list[float]] = {}
                for r in series:
                    labels, v = r["metric"], float(r["value"][1])
                    s = scopes.get(labels.get(scope_label, ""))
                    if s is None:
                        continue
                    ctx = {**labels, **s}
                    if fact and all(labels.get(k) == w for k, w in fact.get("where", {}).items()):
                        agg.setdefault(s["scope"], []).append(v)
                    if item and _when(item.get("when"), v):
                        lvl = _level(item.get("level", WARNING), labels, v)
                        if lvl:
                            add_item(item, lvl, ctx, v)
                if fact:
                    for name in by_scope:
                        vals = agg.get(name, [])
                        how = fact.get("agg", "max")
                        if how == "count":
                            facts[name][fact["label"]] = {"text": str(len(vals))}
                        elif vals:
                            v = {"min": min, "max": max, "sum": sum}[how](vals)
                            facts[name][fact["label"]] = ({"at": (datetime.now(timezone.utc) - timedelta(hours=v)).isoformat()}
                                                          if fact.get("format") == "ago_hours" else {"text": later(fmt, v, fact.get("format"))})
                continue
            for name, s in by_scope.items():
                res = results.get((i, name))
                if res is None:
                    continue
                ctx = {**s}
                if chk["type"] == "report_count":
                    n = res["count"]
                    if fact:
                        facts[name][fact["label"]] = {"text": later(fmt, n, "count")}
                    if item and _when(item.get("when"), n):
                        add_item(item, _level(item.get("level", INFO), {}, n) or INFO, ctx, n)
                elif fact:
                    facts[name][fact["label"]] = ({"at": res["at"], "suffix": res["summary"]} if res.get("row")
                                                  else {"text": fact.get("empty") or later(t, "yok")})

        items.sort(key=lambda it: (LEVEL_ORDER[it["level"]], it["scope"], str(it["title"])))
        health = {}
        for name in by_scope:
            levels = {it["level"] for it in items if it["scope"] == name}
            state = CRITICAL if CRITICAL in levels else WARNING if WARNING in levels else OK
            order = [c["fact"]["label"] for c in checks if c.get("fact")]
            health[name] = {"state": state, "facts": [{"label": lbl, **facts[name][lbl]} for lbl in order if lbl in facts[name]]}
        return {"generated_at": datetime.now(timezone.utc).isoformat(), "sources": src, "items": items, "health": health,
                "errors": errors, "configured": bool(checks)}
    finally:
        db.close()


class _Safe(dict):
    """str.format_map için: eksik etiket hata vermez, "?" yazılır."""
    def __missing__(self, key):
        return "?"


def _refresh():
    try:
        data = _compute()
    except Exception as e:  # hesaplama hatası önbelleği bozmasın; bir sonraki denemede yeniden
        log.exception("Sağlık özeti hesaplanamadı")
        data = None
        err = str(e)[:200]
    with _lock:
        if data is not None:
            _state.update(data=data, at=time.time())
        else:
            _state["at"] = time.time()  # hemen tekrar denemesin
            if _state["data"] is None:
                _state["data"] = {**_empty(), "errors": [later(t, "Sağlık özeti hesaplanamadı: {error}", error=err)]}
        _state["running"] = False


def _empty() -> dict:
    return {"generated_at": None, "sources": [], "items": [], "health": {}, "errors": [], "configured": bool(load_checks().get("checks"))}


def refresh_in_background(force: bool = False) -> bool:
    """Gerekiyorsa (önbellek yok, eski veya force) arka planda yeniler; zaten çalışıyorsa yenisini başlatmaz."""
    with _lock:
        stale = _state["data"] is None or time.time() - _state["at"] > config.HEALTH_TTL
        if _state["running"] or not (force or stale):
            return _state["running"]
        _state["running"] = True
    threading.Thread(target=_refresh, daemon=True, name="saglik-ozeti").start()
    return True


def health(force: bool = False) -> dict:
    """Önbellekteki sağlık özeti; hiç beklemeden döner. pending: henüz hiç hesaplanmadı."""
    refreshing = refresh_in_background(force)
    with _lock:
        data = _state["data"]
    return {**(data or _empty()), "refreshing": refreshing, "pending": data is None}
