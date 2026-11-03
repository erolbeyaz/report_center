from ..i18n import t as _t
from .base import Connector, ConnectorError, Query
from .elasticsearch import ElasticsearchConnector
from .prometheus import PrometheusConnector
from .sql import MssqlConnector, PostgresConnector

REGISTRY: dict[str, type[Connector]] = {
    ElasticsearchConnector.type: ElasticsearchConnector,
    PrometheusConnector.type: PrometheusConnector,
    PostgresConnector.type: PostgresConnector,
    MssqlConnector.type: MssqlConnector,
}


def make_connector(ds_type: str, config: dict) -> Connector:
    try:
        return REGISTRY[ds_type](config)
    except KeyError:
        raise ConnectorError(_t("Desteklenmeyen veri kaynağı tipi: {type}", type=ds_type))


__all__ = ["Connector", "ConnectorError", "Query", "REGISTRY", "make_connector"]
