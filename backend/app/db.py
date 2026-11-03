from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import DATABASE_URL, database_password

_url = make_url(DATABASE_URL)
if database_password():
    _url = _url.set(password=database_password())
engine = create_engine(_url, pool_pre_ping=True,
                       connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def utcnow():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class DataSource(Base):
    """Bağlantı bilgisi. Şifre veritabanında tutulmaz: config.cred_file okunur (1. satır kullanıcı, 2. satır şifre)."""
    __tablename__ = "datasources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    type: Mapped[str] = mapped_column(String(40))  # elasticsearch
    config: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


SCOPE_KINDS = {"kubernetes": "Kubernetes cluster'ları", "server": "Sunucular", "application": "Uygulamalar ve platformlar",
               "network": "Ağ ve güvenlik cihazları", "other": "Diğer"}


class Scope(Base):
    """Raporların ait olduğu ortam: bir Kubernetes cluster'ı, sunucu grubu, uygulama/platform, ağ cihazı..."""
    __tablename__ = "scopes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    kind: Mapped[str] = mapped_column(String(20), default="other")
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReportTemplate(Base):
    __tablename__ = "templates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    scope: Mapped[str] = mapped_column(String(80), default="Genel")  # ortam: cluster / sunucu grubu / uygulama
    group: Mapped[str] = mapped_column(String(80), default="Genel")  # kategori (ör. İstek-Yanıt (RR))
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    # Silme yalnız yönetici; kayıt korunur (export geçmişi denetim kaydıdır), listelerden kalkar
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    versions: Mapped[list["TemplateVersion"]] = relationship(back_populates="template", order_by="TemplateVersion.version")


class TemplateVersion(Base):
    """Şablonun her kaydı yeni bir sürümdür; eski sürümler değişmez (export'lar hangi sürümle alındığını gösterir)."""
    __tablename__ = "template_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id"))
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str] = mapped_column(String(120))
    template: Mapped[ReportTemplate] = relationship(back_populates="versions")


class Export(Base):
    """Değiştirilemez export kaydı: güncelleme veya silme API'si yoktur."""
    __tablename__ = "exports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id"))
    template_version: Mapped[int] = mapped_column(Integer)
    template_name: Mapped[str] = mapped_column(String(200))
    params: Mapped[dict] = mapped_column(JSON)
    period_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_to: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    partial: Mapped[bool] = mapped_column(Boolean, default=False)
    row_count: Mapped[int] = mapped_column(Integer)
    source_count: Mapped[int] = mapped_column(Integer)
    data_sha256: Mapped[str] = mapped_column(String(64))
    file_sha256: Mapped[str] = mapped_column(String(64), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(Text)
    query_summary: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LocalAccount(Base):
    """Tek yerel hesap (admin). Parola scrypt ile özetlenir; düz metin saklanmaz."""
    __tablename__ = "local_accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    must_change: Mapped[bool] = mapped_column(Boolean, default=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccessRule(Base):
    """Ortam / kategori yetkisi. Yönetici olmayan kullanıcı yalnız eşleşen kurallardaki raporları görür.
    subject_type: group (OIDC grubu) | user (kullanıcı adı). scope / category "*" = tümü."""
    __tablename__ = "access_rules"
    __table_args__ = (UniqueConstraint("subject_type", "subject", "scope", "category"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(10))
    subject: Mapped[str] = mapped_column(String(200))
    scope: Mapped[str] = mapped_column(String(80), default="*")
    category: Mapped[str] = mapped_column(String(120), default="*")
    created_by: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KnownUser(Base):
    """Giriş yapmış kullanıcılar ve son girişteki grupları (yetki değerlendirmesi ve yönetim ekranı için)."""
    __tablename__ = "known_users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(200), unique=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    source: Mapped[str] = mapped_column(String(10), default="oidc")
    groups: Mapped[list] = mapped_column(JSON, default=list)
    roles: Mapped[list] = mapped_column(JSON, default=list)
    last_login_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# Var olan veritabanlarına sonradan eklenen kolonlar (SQLite ve PostgreSQL). Alembic'e geçilene kadar.
ADDED_COLUMNS = [
    ("templates", "scope", "VARCHAR(80) NOT NULL DEFAULT 'Genel'"),
    ("templates", "deleted_at", "TIMESTAMP WITH TIME ZONE NULL"),
    ("templates", "deleted_by", "VARCHAR(120) NULL"),
]


def init_db():
    from sqlalchemy import inspect
    Base.metadata.create_all(engine)
    with engine.begin() as c:
        ins = inspect(c)
        for table, col, ddl in ADDED_COLUMNS:
            if col not in {x["name"] for x in ins.get_columns(table)}:
                c.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    ensure_scopes()


def ensure_scopes():
    """Şablonlarda geçen her ortam adı için bir Scope kaydı olsun."""
    from sqlalchemy import select
    with SessionLocal() as db:
        known = set(db.scalars(select(Scope.name)))
        for name in set(db.scalars(select(ReportTemplate.scope).where(ReportTemplate.deleted_at.is_(None)))) - known:
            db.add(Scope(name=name, kind="kubernetes" if "cluster" in name.lower() else "other"))
        db.commit()
