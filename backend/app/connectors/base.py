"""Connector arayüzü. Yeni bir veri kaynağı tipi bu sınıfı uygulayıp REGISTRY'ye eklenir."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterator

from ..schemas import Filter, SortSpec


@dataclass
class Query:
    dataset: str
    time_field: str
    period_from: datetime  # saat dilimli
    period_to: datetime    # hariç
    filters: list[Filter] = field(default_factory=list)
    sort: list[SortSpec] = field(default_factory=list)
    fields: list[str] | None = None
    options: dict = field(default_factory=dict)  # kaynağa özgü (ör. Prometheus adımı)


@dataclass
class Dataset:
    name: str
    kind: str  # data stream, index, alias, tablo ...


@dataclass
class FieldInfo:
    name: str
    type: str


class Connector:
    type: str = ""

    def __init__(self, config: dict):
        self.config = config

    def test(self) -> dict:
        raise NotImplementedError

    def datasets(self) -> list[Dataset]:
        raise NotImplementedError

    def fields(self, dataset: str) -> list[FieldInfo]:
        raise NotImplementedError

    def count(self, q: Query) -> int:
        raise NotImplementedError

    def search(self, q: Query, limit: int) -> list[dict[str, Any]]:
        raise NotImplementedError

    def stream(self, q: Query) -> Iterator[dict[str, Any]]:
        raise NotImplementedError

    def time_bounds(self, dataset: str, time_field: str) -> tuple[datetime | None, datetime | None]:
        """Veri setindeki en eski ve en yeni kaydın zamanı (dönem kapsama kontrolü için)."""
        raise NotImplementedError

    def values(self, dataset: str, field: str, size: int = 50) -> list[str]:
        """Bir alanın en sık değerleri (şablonda parametre seçenekleri için)."""
        raise NotImplementedError

    def facet(self, q: Query, field: str) -> dict[str, int]:
        """Bir alanın değerlerine göre kayıt sayıları (özet kartları için)."""
        raise NotImplementedError

    def describe(self, q: Query) -> str:
        """Rapor Bilgisi sayfası için sorgunun okunabilir özeti."""
        raise NotImplementedError


class ConnectorError(Exception):
    pass
