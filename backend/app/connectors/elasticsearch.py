"""Elasticsearch connector. Okuma: PIT + search_after; eksiksizlik kontrolü: _count."""
import time
from datetime import datetime, timezone
from typing import Any, Iterator

import httpx

from ..config import secret_path
from ..i18n import t as _t
from .base import Connector, ConnectorError, Dataset, FieldInfo, Query

OPS_TEXT = {"eq": "=", "neq": "≠", "in": "∈", "not_in": "∉", "exists": "dolu", "not_exists": "boş",
            "gt": ">", "gte": "≥", "lt": "<", "lte": "≤", "prefix": "ile başlar:", "not_prefix": "ile başlamaz:"}  # sözcükler t() ile


class ElasticsearchConnector(Connector):
    """config: url, ca_file (TLS doğrulaması için kurum CA'sı), cred_file (1. satır kullanıcı, 2. satır şifre)."""
    type = "elasticsearch"

    def __init__(self, config: dict):
        super().__init__(config)
        try:
            lines = secret_path(config["cred_file"]).read_text().split()
        except OSError as e:
            raise ConnectorError(_t("Kimlik dosyası okunamadı: {file}", file=e.filename)) from e
        if len(lines) < 2:
            raise ConnectorError(_t("Kimlik dosyası 2 satır olmalı: kullanıcı, şifre"))
        self._client = httpx.Client(base_url=config["url"].rstrip("/"), auth=(lines[0], lines[1]),
                                    verify=str(secret_path(config.get("ca_file")) or "") or True, timeout=config.get("timeout", 60))
        self._sort_cache: dict[tuple, dict] = {}

    def _req(self, method: str, path: str, body: dict | None = None) -> dict:
        try:
            r = self._client.request(method, path, json=body)
        except httpx.HTTPError as e:
            raise ConnectorError(_t("Elasticsearch'e bağlanılamadı: {error}", error=e)) from e
        if r.status_code >= 400:
            raise ConnectorError(f"Elasticsearch {r.status_code}: {r.text[:300]}")
        return r.json()

    def test(self) -> dict:
        t = time.monotonic()
        info = self._req("GET", "/")
        user = self._req("GET", "/_security/_authenticate")
        return {"ok": True, "version": info["version"]["number"], "cluster": info.get("cluster_name"),
                "user": user.get("username"), "ms": round((time.monotonic() - t) * 1000)}

    def datasets(self) -> list[Dataset]:
        r = self._req("GET", "/_resolve/index/*?expand_wildcards=open")
        out = [Dataset(d["name"], "data stream") for d in r.get("data_streams", [])]
        out += [Dataset(a["name"], "alias") for a in r.get("aliases", []) if not a["name"].startswith(".")]
        out += [Dataset(i["name"], "index") for i in r.get("indices", [])
                if not i["name"].startswith(".") and "data_stream" not in i]
        return sorted(out, key=lambda d: d.name)

    def fields(self, dataset: str) -> list[FieldInfo]:
        r = self._req("GET", f"/{dataset}/_field_caps?fields=*&include_unmapped=false")
        out = []
        for name, types in r.get("fields", {}).items():
            if name.startswith("_"):
                continue
            t = [k for k in types if k not in ("object", "nested")]
            if t:
                out.append(FieldInfo(name, "conflict" if len(t) > 1 else t[0]))
        return sorted(out, key=lambda f: f.name)

    @staticmethod
    def _filter_clause(f):
        # Metin değerlerde match_phrase: keyword alanda birebir eşleşme; aynı alan bazı (eski) index'lerde
        # text ise orada da eşleşir. Sayı ve mantıksal değerlerde term.
        def eq(v):
            return {"term": {f.field: v}} if isinstance(v, (bool, int, float)) else {"match_phrase": {f.field: v}}
        if f.op in ("eq", "neq"):
            return ("filter" if f.op == "eq" else "must_not"), eq(f.value)
        if f.op in ("in", "not_in"):
            c = {"bool": {"should": [eq(v) for v in f.value], "minimum_should_match": 1}}
            return ("filter" if f.op == "in" else "must_not"), c
        if f.op in ("gt", "gte", "lt", "lte"):
            return "filter", {"range": {f.field: {f.op: f.value}}}
        if f.op in ("prefix", "not_prefix"):
            vals = f.value if isinstance(f.value, list) else [f.value]
            c = {"bool": {"should": [{"prefix": {f.field: v}} for v in vals], "minimum_should_match": 1}}
            return ("filter" if f.op == "prefix" else "must_not"), c
        if f.op == "exists":
            return "filter", {"exists": {"field": f.field}}
        return "must_not", {"exists": {"field": f.field}}

    @staticmethod
    def _utc(dt) -> str:
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def dsl(self, q: Query) -> dict:
        # Değerler UTC gönderilir ve "format" ile ayrıştırılır: alanın kendi (özel) tarih biçiminden bağımsız çalışır.
        rng = {"gte": self._utc(q.period_from), "lt": self._utc(q.period_to), "format": "strict_date_optional_time"}
        b = {"filter": [{"range": {q.time_field: rng}}], "must_not": []}
        for f in q.filters:
            k, c = self._filter_clause(f)
            b[k].append(c)
        return {"bool": b}

    def _sort_field(self, dataset: str, field: str) -> dict:
        """Metin (text) alanlar sıralanamaz: ".keyword" alt alanı kullanılır. Alan bazı index'lerde yoksa sona düşer."""
        key = (dataset, field)
        if key not in self._sort_cache:
            caps = self._req("GET", f"/{dataset}/_field_caps?fields={field},{field}.keyword&ignore_unavailable=true").get("fields", {})
            types = set(caps.get(field, {}))
            if "text" in types and f"{field}.keyword" in caps:
                self._sort_cache[key] = {"name": f"{field}.keyword", "unmapped_type": "keyword"}
            elif "text" in types:
                raise ConnectorError(_t("{field} metin alanı; sıralanamaz (keyword alt alanı yok)", field=field))
            else:
                t = next(iter(types - {"unmapped"}), "keyword")
                self._sort_cache[key] = {"name": field, "unmapped_type": t if t in ("date", "long", "double", "keyword", "boolean") else "keyword"}
        return self._sort_cache[key]

    def _sort(self, q: Query) -> list:
        out = []
        for x in q.sort:
            f = self._sort_field(q.dataset, x.field)
            out.append({f["name"]: {"order": x.dir, "unmapped_type": f["unmapped_type"]}})
        s = out or [{q.time_field: "asc"}]
        return s

    def count(self, q: Query) -> int:
        return self._req("POST", f"/{q.dataset}/_count", {"query": self.dsl(q)})["count"]

    def search(self, q: Query, limit: int) -> list[dict[str, Any]]:
        body = {"size": limit, "query": self.dsl(q), "sort": self._sort(q), "track_total_hits": False}
        if q.fields:
            body["_source"] = q.fields
        return [h["_source"] for h in self._req("POST", f"/{q.dataset}/_search", body)["hits"]["hits"]]

    def time_bounds(self, dataset: str, time_field: str) -> tuple[datetime | None, datetime | None]:
        r = self._req("POST", f"/{dataset}/_search", {"size": 0, "aggs": {
            "lo": {"min": {"field": time_field}}, "hi": {"max": {"field": time_field}}}})["aggregations"]
        conv = lambda v: datetime.fromtimestamp(v / 1000, tz=timezone.utc) if v is not None else None
        return conv(r["lo"]["value"]), conv(r["hi"]["value"])

    def _terms(self, dataset: str, field: str, size: int, query: dict | None = None) -> dict[str, int]:
        # Alan bazı index'lerde text (dinamik eşleme) ise değerleri "<alan>.keyword" alt alanındadır; ikisi toplanır.
        # Ayrı istekler: text alanda terms hatası o shard'daki diğer agregasyonu da düşürür.
        out: dict[str, int] = {}
        for f in (field, f"{field}.keyword"):
            body = {"size": 0, "aggs": {"f": {"terms": {"field": f, "size": size}}}}
            if query:
                body["query"] = query
            for b in self._req("POST", f"/{dataset}/_search", body)["aggregations"]["f"]["buckets"]:
                out[str(b["key"])] = out.get(str(b["key"]), 0) + b["doc_count"]
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    def values(self, dataset: str, field: str, size: int = 50) -> list[str]:
        return list(self._terms(dataset, field, size))

    def facet(self, q: Query, field: str) -> dict[str, int]:
        return self._terms(q.dataset, field, 50, self.dsl(q))

    def stream(self, q: Query) -> Iterator[dict[str, Any]]:
        pit = self._req("POST", f"/{q.dataset}/_pit?keep_alive=2m")["id"]
        body = {"size": 1000, "query": self.dsl(q), "pit": {"id": pit, "keep_alive": "2m"},
                "sort": self._sort(q) + [{"_shard_doc": "asc"}], "track_total_hits": False}
        if q.fields:
            body["_source"] = q.fields
        try:
            while True:
                r = self._req("POST", "/_search", body)
                hits = r["hits"]["hits"]
                if not hits:
                    return
                for h in hits:
                    yield h["_source"]
                body["pit"]["id"] = r["pit_id"]
                body["search_after"] = hits[-1]["sort"]
        finally:
            try:
                self._req("DELETE", "/_pit", {"id": pit})
            except ConnectorError:
                pass

    def describe(self, q: Query) -> str:
        parts = [f"{q.dataset}", f"{q.time_field} ∈ [{q.period_from:%d.%m.%Y %H:%M}, {q.period_to:%d.%m.%Y %H:%M})"]
        for f in q.filters:
            v = ", ".join(map(str, f.value)) if isinstance(f.value, list) else ("" if f.value is None else str(f.value))
            parts.append(f"{f.field} {_t(OPS_TEXT[f.op])} {v}".strip())
        return " · ".join(parts)
