"""Prometheus / Thanos connector.

Şablonun "dataset" alanı bir PromQL ifadesidir. Dönem için query_range çalıştırılır; her (seri, zaman) bir satır olur:
  {"@timestamp": ISO, <etiketler>..., "value": float}
Filtreler ve parametreler etiketler (ve "value") üzerinde sonuç kümesine uygulanır.
"""
import math
import re
import ssl
import time
from datetime import datetime, timezone
from typing import Any, Iterator

import httpx

from ..config import secret_path
from ..i18n import t as _t
from .base import Connector, ConnectorError, Dataset, FieldInfo, Query

STEP_RE = re.compile(r"^(\d+)([smhdw])$")
STEP_SEC = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}
MAX_POINTS = 10000  # Prometheus seri başına 11.000 nokta sınırının altında


def step_seconds(step: str) -> int:
    m = STEP_RE.match(step or "")
    if not m:
        raise ConnectorError(_t("Geçersiz adım: {step} (ör. 5m, 1h, 1d)", step=repr(step)))
    return int(m.group(1)) * STEP_SEC[m.group(2)]


class PrometheusConnector(Connector):
    """config: url (Thanos Query / Prometheus), ca_file (isteğe bağlı; yoksa sistem sertifikaları), timeout."""
    type = "prometheus"

    def __init__(self, config: dict):
        super().__init__(config)
        # Kendinden imzalı sunucu sertifikası güven deposundaysa (veya ca_file ise) curl gibi kısmi zinciri kabul et
        # (sertifikanın kendisi güvenilir listede olmalı — doğrulama kapatılmıyor).
        ca = secret_path(config.get("ca_file"))
        ctx = ssl.create_default_context(cafile=str(ca) if ca else None)
        if not ca:
            ctx.load_verify_locations(cafile="/etc/ssl/certs/ca-certificates.crt")
        ctx.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
        self._client = httpx.Client(base_url=config["url"].rstrip("/"), verify=ctx, timeout=config.get("timeout", 120))
        self._cache: dict[tuple, list[dict]] = {}

    def _get(self, path: str, params: dict | None = None) -> Any:
        try:
            r = self._client.post(path, data=params) if params else self._client.get(path)
        except httpx.HTTPError as e:
            raise ConnectorError(_t("Prometheus'a bağlanılamadı: {error}", error=e)) from e
        try:
            body = r.json()
        except ValueError:
            raise ConnectorError(f"Prometheus {r.status_code}: {r.text[:300]}")
        if r.status_code >= 400 or body.get("status") != "success":
            raise ConnectorError(f"Prometheus {r.status_code}: {body.get('error', r.text[:300])}")
        return body["data"]

    def test(self) -> dict:
        t = time.monotonic()
        info = self._get("/api/v1/status/buildinfo")
        return {"ok": True, "version": info.get("version"), "cluster": "Thanos/Prometheus", "user": "-",
                "ms": round((time.monotonic() - t) * 1000)}

    def datasets(self) -> list[Dataset]:
        return []  # veri seti serbest PromQL'dir

    # --- sorgu ---
    def _rows(self, q: Query) -> list[dict]:
        step = (q.options or {}).get("step", "1h")
        sec = step_seconds(step)
        start, end = q.period_from.timestamp(), q.period_to.timestamp()
        if (end - start) / sec > MAX_POINTS:
            raise ConnectorError(_t("Dönem bu adım ({step}) için çok uzun: en çok {max} nokta. Adımı büyütün veya dönemi daraltın.", step=step, max=MAX_POINTS))
        key = (q.dataset, start, end, step)
        if key not in self._cache:
            # Bitiş hariç: son nokta bitişten bir adım önce
            data = self._get("/api/v1/query_range", {"query": q.dataset, "start": start, "end": end - 1, "step": sec})
            rows = []
            for series in data.get("result", []):
                labels = {k: v for k, v in series["metric"].items()}
                for ts, val in series.get("values", []):
                    v = float(val)
                    if math.isnan(v) or math.isinf(v):
                        continue
                    rows.append({"@timestamp": datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat(), **labels,
                                 "value": round(v, 4)})
            rows.sort(key=lambda r: (r["@timestamp"], tuple(sorted((k, str(v)) for k, v in r.items() if k not in ("@timestamp", "value")))))
            self._cache[key] = rows
        return [r for r in self._cache[key] if self._match(r, q)]

    @staticmethod
    def _match(row: dict, q: Query) -> bool:
        for f in q.filters:
            v = row.get(f.field)
            vals = f.value if isinstance(f.value, list) else [f.value]
            num = isinstance(v, (int, float))
            ok = {
                "eq": lambda: str(v) == str(f.value),
                "neq": lambda: str(v) != str(f.value),
                "in": lambda: str(v) in map(str, vals),
                "not_in": lambda: str(v) not in map(str, vals),
                "exists": lambda: v not in (None, ""),
                "not_exists": lambda: v in (None, ""),
                "gt": lambda: num and v > float(f.value),
                "gte": lambda: num and v >= float(f.value),
                "lt": lambda: num and v < float(f.value),
                "lte": lambda: num and v <= float(f.value),
                "prefix": lambda: any(str(v or "").startswith(str(p)) for p in vals),
                "not_prefix": lambda: not any(str(v or "").startswith(str(p)) for p in vals),
            }[f.op]()
            if not ok:
                return False
        return True

    def _sorted(self, rows: list[dict], q: Query) -> list[dict]:
        # Kararlı çok anahtarlı sıralama: son anahtardan ilke doğru sırala.
        for s in reversed(q.sort or []):
            present = [r for r in rows if r.get(s.field) is not None]
            missing = [r for r in rows if r.get(s.field) is None]
            rows = sorted(present, key=lambda r: r[s.field], reverse=s.dir == "desc") + missing
        return rows

    def count(self, q: Query) -> int:
        return len(self._rows(q))

    def search(self, q: Query, limit: int) -> list[dict[str, Any]]:
        return self._sorted(self._rows(q), q)[:limit]

    def stream(self, q: Query) -> Iterator[dict[str, Any]]:
        yield from self._sorted(self._rows(q), q)

    def facet(self, q: Query, field: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for r in self._rows(q):
            if r.get(field) not in (None, ""):
                out[str(r[field])] = out.get(str(r[field]), 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    def _instant(self, expr: str) -> list[dict]:
        return self._get("/api/v1/query", {"query": expr}).get("result", [])

    def fields(self, dataset: str) -> list[FieldInfo]:
        labels = sorted({k for s in self._instant(dataset) for k in s["metric"]})
        return [FieldInfo("@timestamp", "date"), *[FieldInfo(l, "keyword") for l in labels], FieldInfo("value", "double")]

    def values(self, dataset: str, field: str, size: int = 50) -> list[str]:
        vals: dict[str, int] = {}
        for s in self._instant(dataset):
            v = s["metric"].get(field)
            if v:
                vals[v] = vals.get(v, 0) + 1
        return sorted(vals, key=lambda k: -vals[k])[:size]

    def time_bounds(self, dataset: str, time_field: str):
        # Thanos: tüm store'ların en eski verisi; düz Prometheus: TSDB'nin en eski bloğu.
        try:
            stores = self._get("/api/v1/stores")
            mins = [s.get("minTime") for group in stores.values() for s in group if s.get("minTime") not in (None, 0)]
            lo = datetime.fromtimestamp(min(mins) / 1000, tz=timezone.utc) if mins else None
        except ConnectorError:
            r = self._instant("min(prometheus_tsdb_lowest_timestamp_seconds)")
            lo = datetime.fromtimestamp(float(r[0]["value"][1]), tz=timezone.utc) if r else None
        return lo, datetime.now(timezone.utc)

    def describe(self, q: Query) -> str:
        parts = [f"PromQL: {q.dataset}", _t("adım {step}", step=(q.options or {}).get("step", "1h")),
                 f"[{q.period_from:%d.%m.%Y %H:%M}, {q.period_to:%d.%m.%Y %H:%M})"]
        for f in q.filters:
            v = ", ".join(map(str, f.value)) if isinstance(f.value, list) else ("" if f.value is None else str(f.value))
            parts.append(f"{f.field} {f.op} {v}".strip())
        return " · ".join(parts)
