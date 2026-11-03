"""Rapor şablonu tanımı ve API gövdeleri. Sorgu modeli kaynaktan bağımsızdır."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

FilterOp = Literal["eq", "neq", "in", "not_in", "exists", "not_exists", "gt", "gte", "lt", "lte", "prefix", "not_prefix"]
ColumnFormat = Literal["text", "datetime", "list", "badge", "mono"]


class Filter(BaseModel):
    field: str
    op: FilterOp
    value: Any = None


class Param(BaseModel):
    """Raporu alan kişinin seçebildiği filtre (ör. geçiş tipi)."""
    field: str
    label: str
    options: list[str]


class Column(BaseModel):
    field: str
    label: str
    width: int = 18
    format: ColumnFormat = "text"


class RowRule(BaseModel):
    field: str
    equals: str
    fill: str  # RRGGBB


class SortSpec(BaseModel):
    field: str
    dir: Literal["asc", "desc"] = "asc"


class MetaSpec(BaseModel):
    title: str
    scope: str = ""
    notes: list[tuple[str, str]] = []


class TemplateDefinition(BaseModel):
    description: str = ""
    datasource_id: int
    dataset: str
    time_field: str = "@timestamp"
    fixed_filters: list[Filter] = []
    params: list[Param] = []
    columns: list[Column]
    row_rules: list[RowRule] = []
    sort: list[SortSpec] = [SortSpec(field="@timestamp")]
    meta: MetaSpec
    step: str | None = Field(default=None, description="Prometheus: sorgu adımı (ör. 1h, 1d)")


class TemplateCreate(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    scope: str = Field(default="Genel", max_length=80)
    group: str = Field(default="Genel", max_length=80)
    description: str = ""
    datasource_id: int
    dataset: str
    time_field: str
    step: str | None = None


class TemplateSave(BaseModel):
    name: str
    scope: str = "Genel"
    group: str = "Genel"
    definition: TemplateDefinition


class RunRequest(BaseModel):
    period_from: datetime = Field(description="Yerel saat (RM_TIMEZONE), saat dilimi olmadan")
    period_to: datetime
    params: dict[str, str | None] = {}
    columns: list[str] | None = Field(default=None, description="Bu çalıştırma için kolon sırası/seçimi (alan adları)")
    limit: int | None = Field(default=None, ge=1, description="Önizleme satır sınırı (en çok RM_PREVIEW_LIMIT)")
    sort: list[SortSpec] | None = Field(default=None, description="Bu çalıştırma için sıralama (kolon başlığına tıklama); yoksa şablonunki")


class ScopeIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    kind: Literal["kubernetes", "server", "application", "network", "other"] = "other"
    description: str = ""


class DataSourceIn(BaseModel):
    name: str
    type: Literal["elasticsearch", "prometheus", "postgresql", "mssql"] = "elasticsearch"
    config: dict
