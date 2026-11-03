"""İlişkisel veritabanı connector'ları: PostgreSQL ve Microsoft SQL Server.

Veri seti "şema.tablo" (veya görünüm) adı ya da özel bir SELECT sorgusudur. Özel sorgu bir alt sorgu olarak sarılır:
  SELECT ... FROM (<sorgu>) AS rm_q WHERE <dönem ve filtreler> ORDER BY ...
Böylece yalnız tek bir sorgu ifadesi çalışabilir (DML / birden çok ifade alt sorgu içinde geçersizdir). Dönem, filtre ve
sıralama değerleri her iki durumda da parametre olarak gider; kullanıcıdan gelen değer SQL metnine eklenmez.

Bağlantı salt okuma içindir: kullanıcıya yalnız SELECT yetkisi verin. PostgreSQL'de oturum ayrıca
default_transaction_read_only ile açılır; her iki veritabanında da sorgu zaman aşımı uygulanır.

config:
  host, port, database, cred_file (1. satır kullanıcı, 2. satır şifre)
  PostgreSQL: sslmode (disable | prefer | require | verify-ca | verify-full; varsayılan verify-full), ca_file
  MSSQL:      encrypt (true | false; varsayılan true), ca_file (sunucu sertifikası, PEM) veya trust_server_certificate
  timezone:   saat dilimi olmayan tarih kolonlarının saat dilimi (varsayılan UTC)
  timeout:    sorgu zaman aşımı, saniye (varsayılan 120)
"""
import re
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Iterator
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Column, MetaData, Table, and_, column, create_engine, func, inspect, not_, or_, select, text
from sqlalchemy.engine import URL, Engine
from sqlalchemy.exc import NoSuchTableError, SQLAlchemyError
from sqlalchemy.pool import NullPool
from sqlalchemy.types import Boolean, Date, DateTime, Float, Integer, Numeric, String

from ..config import secret_path
from ..i18n import t as _t
from .base import Connector, ConnectorError, Dataset, FieldInfo, Query

FACET_SIZE = 10
SQL_RE = re.compile(r"^\s*(select|with)\b", re.I)
MAX_SQL = 20000


def is_sql(dataset: str) -> bool:
    return bool(SQL_RE.match(dataset or ""))


def _credentials(config: dict) -> tuple[str, str]:
    try:
        lines = secret_path(config["cred_file"]).read_text().split()
    except (KeyError, OSError) as e:
        raise ConnectorError(_t("Kimlik dosyası okunamadı: {file}", file=getattr(e, "filename", None) or _t("cred_file verilmedi"))) from e
    if len(lines) < 2:
        raise ConnectorError(_t("Kimlik dosyası 2 satır olmalı: kullanıcı, şifre"))
    return lines[0], lines[1]


class SqlConnector(Connector):
    dialect = ""
    default_port = 0
    system_schemas: set[str] = set()
    default_schema = ""

    def __init__(self, config: dict):
        super().__init__(config)
        for k in ("host", "database"):
            if not config.get(k):
                raise ConnectorError(_t("Veri kaynağı ayarı eksik: {key}", key=k))
        self.tz = ZoneInfo(config.get("timezone") or "UTC")
        self.timeout = int(config.get("timeout", 120))
        try:
            self.engine: Engine = self._engine(*_credentials(config))
        except SQLAlchemyError as e:
            raise ConnectorError(self._msg(e)) from e
        self._tables: dict[str, Table] = {}

    # --- alt sınıflar ---
    def _engine(self, user: str, password: str) -> Engine:
        raise NotImplementedError

    def _version_sql(self) -> str:
        raise NotImplementedError

    # --- yardımcılar ---
    @staticmethod
    def _msg(e: Exception) -> str:
        return str(getattr(e, "orig", None) or e).strip().splitlines()[0][:300]

    def _split(self, dataset: str) -> tuple[str | None, str]:
        schema, _, name = dataset.rpartition(".")
        return (schema or self.default_schema or None), name

    def _validate_sql(self, sql: str) -> str:
        sql = sql.strip().rstrip(";").strip()
        if len(sql) > MAX_SQL:
            raise ConnectorError(_t("Sorgu çok uzun (en çok {max} karakter)", max=MAX_SQL))
        if ";" in sql:
            raise ConnectorError(_t("Tek bir SELECT sorgusu yazın (; ile ayrılmış birden çok ifade çalıştırılamaz)"))
        if not is_sql(sql):
            raise ConnectorError(_t("Sorgu SELECT veya WITH ile başlamalı"))
        return sql

    def _sql_source(self, sql: str):
        """Özel sorgunun kolonlarını (0 satır çekerek) öğrenir ve filtrelenebilir bir alt sorgu döner."""
        sql = self._validate_sql(sql)
        body = sql.replace(":", r"\:")  # metindeki ":ad" bağlama parametresi sanılmasın
        try:
            with self.engine.connect() as c:
                desc = c.execute(text(f"SELECT * FROM ({body}) AS rm_q WHERE 1 = 0")).cursor.description
        except SQLAlchemyError as e:
            raise ConnectorError(_t("Sorgu çalışmadı: {error}", error=self._msg(e))) from e
        names = [d[0] for d in desc]
        if any(not n for n in names) or len(set(names)) != len(names):
            raise ConnectorError(_t("Sorgudaki her kolonun benzersiz bir adı olmalı (hesaplanan kolonlara AS ile ad verin)"))
        cols = [column(d[0], self._sql_type(d[1])) for d in desc]
        return text(body).columns(*cols).subquery("rm_q")

    @staticmethod
    def _sql_type(code):
        raise NotImplementedError

    def _table(self, dataset: str) -> Table:
        if is_sql(dataset):
            if dataset not in self._tables:
                self._tables[dataset] = self._sql_source(dataset)
            return self._tables[dataset]
        if dataset not in self._tables:
            schema, name = self._split(dataset)
            try:
                self._tables[dataset] = Table(name, MetaData(), schema=schema, autoload_with=self.engine)
            except NoSuchTableError:
                raise ConnectorError(_t("Tablo veya görünüm bulunamadı: {name}", name=dataset))
            except SQLAlchemyError as e:
                raise ConnectorError(self._msg(e)) from e
        return self._tables[dataset]

    @staticmethod
    def _col(t: Table, name: str) -> Column:
        try:
            return t.c[name]
        except KeyError:
            raise ConnectorError(_t("Kolon bulunamadı: {name} ({source})", name=name, source=getattr(t, "fullname", None) or _t("sorgu")))

    def _time_param(self, col: Column, dt: datetime):
        # Saat dilimli kolona saat dilimli değer; saat dilimsiz kolona kaynağın saat diliminde saat dilimsiz değer
        if getattr(col.type, "timezone", False):
            return dt
        return dt.astimezone(self.tz).replace(tzinfo=None)

    @staticmethod
    def _coerce(col: Column, v):
        """Parametre değerleri metin gelir; kolonun tipine çevrilir (ör. sayı kolonu = '5')."""
        if v is None or not isinstance(v, str):
            return v
        try:
            py = col.type.python_type
        except NotImplementedError:
            return v
        try:
            if py is bool:
                return v.strip().lower() in ("1", "true", "evet", "yes")
            if py in (int, float, Decimal):
                return py(v)
            if py is datetime:
                return datetime.fromisoformat(v.replace("Z", "+00:00"))
            if py is date:
                return date.fromisoformat(v)
        except ValueError:
            raise ConnectorError(_t("{column} için geçersiz değer: {value}", column=col.name, value=repr(v)))
        return v

    def _cond(self, t: Table, f):
        col = self._col(t, f.field)
        vals = f.value if isinstance(f.value, list) else [f.value]
        c = lambda v: self._coerce(col, v)
        if f.op == "eq":
            return col == c(f.value)
        if f.op == "neq":
            return or_(col != c(f.value), col.is_(None))
        if f.op == "in":
            return col.in_([c(v) for v in vals])
        if f.op == "not_in":
            return or_(col.not_in([c(v) for v in vals]), col.is_(None))
        if f.op in ("gt", "gte", "lt", "lte"):
            return {"gt": col > c(f.value), "gte": col >= c(f.value), "lt": col < c(f.value), "lte": col <= c(f.value)}[f.op]
        if f.op in ("prefix", "not_prefix"):
            like = or_(*[col.startswith(str(v), autoescape=True) for v in vals])
            return like if f.op == "prefix" else or_(not_(like), col.is_(None))
        if f.op == "exists":
            return col.is_not(None)
        if f.op == "not_exists":
            return col.is_(None)
        raise ConnectorError(_t("Desteklenmeyen filtre: {op}", op=f.op))

    def _where(self, t: Table, q: Query):
        tc = self._col(t, q.time_field)
        conds = [tc >= self._time_param(tc, q.period_from), tc < self._time_param(tc, q.period_to)]
        conds += [self._cond(t, f) for f in q.filters]
        return and_(*conds)

    def _select(self, t: Table, q: Query):
        cols = [self._col(t, f) for f in q.fields] if q.fields else list(t.c)
        stmt = select(*cols).where(self._where(t, q))
        order = [self._col(t, s.field).desc() if s.dir == "desc" else self._col(t, s.field).asc() for s in q.sort]
        return stmt.order_by(*(order or [self._col(t, q.time_field).asc()]))

    def _value(self, v):
        if isinstance(v, datetime):
            return (v if v.tzinfo else v.replace(tzinfo=self.tz)).isoformat()
        if isinstance(v, date):
            return v.isoformat()
        if isinstance(v, Decimal):
            return int(v) if v == v.to_integral_value() else float(v)
        if isinstance(v, UUID):
            return str(v)
        if isinstance(v, (bytes, bytearray, memoryview)):
            return bytes(v).hex()
        return v

    def _row(self, m) -> dict[str, Any]:
        return {k: self._value(v) for k, v in m.items()}

    def _run(self, fn):
        try:
            with self.engine.connect() as c:
                return fn(c)
        except SQLAlchemyError as e:
            raise ConnectorError(self._msg(e)) from e

    # --- Connector arayüzü ---
    def test(self) -> dict:
        t = time.monotonic()
        def go(c):
            return c.exec_driver_sql(self._version_sql()).scalar(), c.exec_driver_sql(self._user_sql()).scalar()
        version, user = self._run(go)
        return {"ok": True, "version": str(version).splitlines()[0][:80], "cluster": self.config["database"], "user": user,
                "ms": round((time.monotonic() - t) * 1000)}

    def _user_sql(self) -> str:
        return "SELECT current_user"

    def datasets(self) -> list[Dataset]:
        def go(c):
            ins = inspect(c)
            out = []
            for schema in ins.get_schema_names():
                if schema in self.system_schemas or schema.startswith(("pg_", "db_")):
                    continue
                out += [Dataset(f"{schema}.{n}", _t("tablo")) for n in ins.get_table_names(schema=schema)]
                out += [Dataset(f"{schema}.{n}", _t("görünüm")) for n in ins.get_view_names(schema=schema)]
            return sorted(out, key=lambda d: d.name)
        return self._run(go)

    def fields(self, dataset: str) -> list[FieldInfo]:
        out = []
        for col in self._table(dataset).c:
            if isinstance(col.type, (DateTime, Date)):
                kind = "date"
            else:
                try:
                    py = col.type.python_type
                    kind = {int: "long", float: "double", Decimal: "double", bool: "boolean"}.get(py, "keyword")
                except NotImplementedError:
                    kind = "keyword"
            out.append(FieldInfo(col.name, kind))
        return out

    def count(self, q: Query) -> int:
        t = self._table(q.dataset)
        return self._run(lambda c: c.execute(select(func.count()).select_from(t).where(self._where(t, q))).scalar())

    def search(self, q: Query, limit: int) -> list[dict[str, Any]]:
        stmt = self._select(self._table(q.dataset), q).limit(limit)
        return self._run(lambda c: [self._row(r) for r in c.execute(stmt).mappings()])

    def stream(self, q: Query) -> Iterator[dict[str, Any]]:
        stmt = self._select(self._table(q.dataset), q)
        try:
            with self.engine.connect() as c:
                for r in c.execution_options(stream_results=True, yield_per=2000).execute(stmt).mappings():
                    yield self._row(r)
        except SQLAlchemyError as e:
            raise ConnectorError(self._msg(e)) from e

    def sample(self, dataset: str, limit: int = 20) -> list[dict[str, Any]]:
        t = self._table(dataset)
        return self._run(lambda c: [self._row(r) for r in c.execute(select(*t.c).limit(limit)).mappings()])

    def time_bounds(self, dataset: str, time_field: str):
        t = self._table(dataset)
        col = self._col(t, time_field)
        lo, hi = self._run(lambda c: c.execute(select(func.min(col), func.max(col))).one())
        conv = lambda v: (v if v.tzinfo else v.replace(tzinfo=self.tz)).astimezone(timezone.utc) if isinstance(v, datetime) else None
        return conv(lo), conv(hi)

    def _group(self, t: Table, field: str, where, size: int) -> dict[str, int]:
        col = self._col(t, field)
        n = func.count().label("n")
        stmt = select(col, n).where(col.is_not(None))
        if where is not None:
            stmt = stmt.where(where)
        stmt = stmt.group_by(col).order_by(n.desc()).limit(size)
        return self._run(lambda c: {str(self._value(v)): int(k) for v, k in c.execute(stmt)})

    def values(self, dataset: str, field: str, size: int = 50) -> list[str]:
        return list(self._group(self._table(dataset), field, None, size))

    def facet(self, q: Query, field: str) -> dict[str, int]:
        t = self._table(q.dataset)
        return self._group(t, field, self._where(t, q), FACET_SIZE)

    def describe(self, q: Query) -> str:
        stmt = self._select(self._table(q.dataset), q)
        try:
            sql = str(stmt.compile(self.engine, compile_kwargs={"literal_binds": True}))
        except Exception:  # bazı tiplerde değer metne çevrilemez; parametreli hali yazılır
            sql = str(stmt.compile(self.engine))
        return f"{self.config['host']}/{self.config['database']}: " + " ".join(sql.split())


class PostgresConnector(SqlConnector):
    type = "postgresql"
    default_port = 5432
    default_schema = "public"
    system_schemas = {"information_schema", "pg_catalog", "pg_toast"}

    def _engine(self, user, password):
        url = URL.create("postgresql+psycopg", username=user, password=password, host=self.config["host"],
                         port=int(self.config.get("port") or self.default_port), database=self.config["database"])
        args = {"connect_timeout": 10, "application_name": "rapor-merkezi",
                "sslmode": self.config.get("sslmode") or "verify-full",
                "options": f"-c default_transaction_read_only=on -c statement_timeout={self.timeout * 1000}"}
        if self.config.get("ca_file"):
            args["sslrootcert"] = str(secret_path(self.config["ca_file"]))
        elif args["sslmode"] in ("verify-ca", "verify-full"):
            args["sslrootcert"] = "system"  # libpq 16+: sistem güven deposu
        return create_engine(url, poolclass=NullPool, connect_args=args)

    def _version_sql(self):
        return "SELECT version()"

    # psycopg: sonuç kolonunun tip OID'i
    _OID = {16: Boolean(), 20: Integer(), 21: Integer(), 23: Integer(), 700: Float(), 701: Float(), 1700: Numeric(),
            1082: Date(), 1114: DateTime(), 1184: DateTime(timezone=True)}

    @classmethod
    def _sql_type(cls, code):
        return cls._OID.get(code, String())


class MssqlConnector(SqlConnector):
    type = "mssql"
    default_port = 1433
    default_schema = "dbo"
    system_schemas = {"sys", "INFORMATION_SCHEMA", "guest"}

    def _engine(self, user, password):
        encrypt = str(self.config.get("encrypt", "true")).lower() not in ("false", "no", "0")
        query = {"driver": "ODBC Driver 18 for SQL Server", "Encrypt": "yes" if encrypt else "no",
                 "LoginTimeout": "10", "ApplicationIntent": "ReadOnly", "APP": "rapor-merkezi"}
        if self.config.get("ca_file"):
            query["ServerCertificate"] = str(secret_path(self.config["ca_file"]))  # ODBC 18.1+: sertifika sabitleme
        if str(self.config.get("trust_server_certificate", "false")).lower() in ("true", "yes", "1"):
            query["TrustServerCertificate"] = "yes"
        url = URL.create("mssql+pyodbc", username=user, password=password, host=self.config["host"],
                         port=int(self.config.get("port") or self.default_port), database=self.config["database"], query=query)
        engine = create_engine(url, poolclass=NullPool)
        timeout = self.timeout

        from sqlalchemy import event

        @event.listens_for(engine, "connect")
        def _set_timeout(dbapi_conn, _):  # sorgu zaman aşımı (saniye)
            dbapi_conn.timeout = timeout
        return engine

    def _version_sql(self):
        return "SELECT @@VERSION"

    def _validate_sql(self, sql):
        sql = super()._validate_sql(sql)
        if re.match(r"^\s*with\b", sql, re.I):
            raise ConnectorError(_t("SQL Server'da WITH (CTE) alt sorgu içinde kullanılamaz; sorguyu alt sorgu (FROM (SELECT ...) x) ile yazın"))
        return sql

    @staticmethod
    def _sql_type(code):
        # pyodbc: sonuç kolonunun Python tipi
        return {datetime: DateTime(), date: Date(), int: Integer(), float: Float(), Decimal: Numeric(), bool: Boolean()}.get(code, String())

    def _user_sql(self):
        return "SELECT SUSER_SNAME()"
