"""Uygulama ayarları. Hepsi ortam değişkeniyle değiştirilebilir (RM_ önekli)."""
import os
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.environ.get("RM_DATA_DIR", ROOT / "data"))
# Veri kaynaklarının cred_file / ca_file yolları göreliyse bu dizine göre çözülür (Kubernetes'te Secret/ConfigMap mount'u).
SECRETS_DIR = Path(os.environ.get("RM_SECRETS_DIR", DATA_DIR / "certs"))


def secret_path(p: str | None) -> Path | None:
    if not p:
        return None
    path = Path(p)
    return path if path.is_absolute() else SECRETS_DIR / path
EXPORT_DIR = DATA_DIR / "exports"
DATABASE_URL = os.environ.get("RM_DATABASE_URL", f"sqlite:///{DATA_DIR / 'rapor-merkezi.db'}")
TIMEZONE = ZoneInfo(os.environ.get("RM_TIMEZONE", "UTC"))
DEFAULT_LANGUAGE = os.environ.get("RM_DEFAULT_LANGUAGE", "en") if os.environ.get("RM_DEFAULT_LANGUAGE") in ("tr", "en") else "en"


def _tz_label() -> str:
    off = datetime.now(TIMEZONE).utcoffset() or timedelta(0)
    h, m = divmod(int(off.total_seconds()) // 60, 60)
    return f"{TIMEZONE.key}, UTC{'+' if off >= timedelta(0) else '-'}{abs(h)}{f':{m:02d}' if m else ''}"


# Excel ve arayüzde saat dilimi etiketi (ör. "TSİ, UTC+3"); verilmezse saat diliminden üretilir.
TZ_LABEL = os.environ.get("RM_TZ_LABEL") or _tz_label()

PREVIEW_LIMIT = int(os.environ.get("RM_PREVIEW_LIMIT", "500"))
EXPORT_LIMIT = int(os.environ.get("RM_EXPORT_LIMIT", "1000000"))  # Excel satır sınırının altında
CORS_ORIGINS = [o for o in os.environ.get("RM_CORS_ORIGINS", "http://localhost:5173").split(",") if o]
# İlk açılışta içe aktarılacak veri kaynağı / ortam / şablon dosyası (JSON; bkz. app.cli). Var olan kayıtlara dokunulmaz.
BOOTSTRAP_FILE = Path(p) if (p := os.environ.get("RM_BOOTSTRAP_FILE")) else None
# Ana Sayfa sağlık kontrolleri (JSON; bkz. examples/health-checks.example.json) ve önbellek süresi
HEALTH_CHECKS_FILE = Path(p) if (p := os.environ.get("RM_HEALTH_CHECKS_FILE")) else None
HEALTH_TTL = int(os.environ.get("RM_HEALTH_TTL_SECONDS", "900"))
HEALTH_TIMEOUT = float(os.environ.get("RM_HEALTH_TIMEOUT_SECONDS", "10"))  # sağlık kontrollerinde kaynak başına
# --- giriş ---
# Tek yerel hesap (admin). İlk parola "admin"dir ve ilk girişte değiştirilmesi zorunludur. Kullanıcı eklenemez.
LOCAL_LOGIN = os.environ.get("RM_LOCAL_LOGIN", "true").lower() not in ("false", "0", "no")
LOCAL_ADMIN_USER = "admin"
MIN_PASSWORD_LENGTH = int(os.environ.get("RM_MIN_PASSWORD_LENGTH", "12"))
# OpenID Connect (Keycloak vb.); RM_OIDC_ISSUER verilmezse yalnız yerel giriş
OIDC_DISPLAY_NAME = os.environ.get("RM_OIDC_DISPLAY_NAME", "Kurumsal hesap (SSO)")
OIDC_ISSUER = os.environ.get("RM_OIDC_ISSUER", "")
OIDC_CLIENT_ID = os.environ.get("RM_OIDC_CLIENT_ID", "rapor-merkezi")
OIDC_SCOPES = os.environ.get("RM_OIDC_SCOPES", "openid profile email groups")
OIDC_ROLES_CLAIM = os.environ.get("RM_OIDC_ROLES_CLAIM", "groups")
_set = lambda name: {g.strip().lstrip("/") for g in os.environ.get(name, "").split(",") if g.strip()}
OIDC_ADMIN_GROUPS = _set("RM_OIDC_ADMIN_GROUPS")
OIDC_DESIGNER_GROUPS = _set("RM_OIDC_DESIGNER_GROUPS")
OIDC_VIEWER_GROUPS = _set("RM_OIDC_VIEWER_GROUPS")  # boşsa giriş yapabilen herkes görüntüleyici
OIDC_CA_FILE = secret_path(os.environ.get("RM_OIDC_CA_FILE"))
# Erişim yönetiminde grupları / kullanıcıları kimlik sağlayıcıdan listele (Keycloak; istemcinin servis hesabıyla)
OIDC_DIRECTORY = os.environ.get("RM_OIDC_DIRECTORY", "true").lower() not in ("false", "0", "no")
# Uygulamaya ait grupların öneki (ör. "RaporMerkezi-"). Verilirse: Erişim yönetiminde yalnız bu gruplar listelenir ve
# bu öneke sahip herhangi bir gruba üye olan kullanıcı en az görüntüleyici olarak girebilir.
OIDC_GROUP_PREFIX = os.environ.get("RM_OIDC_GROUP_PREFIX", "")


def app_group(name: str) -> bool:
    return not OIDC_GROUP_PREFIX or name.startswith(OIDC_GROUP_PREFIX)
PUBLIC_URL = os.environ.get("RM_PUBLIC_URL", "").rstrip("/")  # ör. https://rapor.example.com (yönlendirme adresi için)
SESSION_MAX_AGE = int(os.environ.get("RM_SESSION_MAX_AGE", str(8 * 3600)))


def _secret(env: str) -> str:
    """Değer doğrudan RM_X ile veya dosyadan RM_X_FILE ile verilir (Kubernetes Secret mount'u için)."""
    if os.environ.get(env + "_FILE"):
        f = Path(os.environ[env + "_FILE"])
        return f.read_text().strip() if f.is_file() else ""  # isteğe bağlı Secret mount edilmemiş olabilir
    return os.environ.get(env, "")


def oidc_client_secret() -> str:
    return _secret("RM_OIDC_CLIENT_SECRET")


def database_password() -> str:
    """RM_DATABASE_URL'de şifre yazmak yerine RM_DATABASE_PASSWORD(_FILE) ile verilebilir."""
    return _secret("RM_DATABASE_PASSWORD")


FRONTEND_DIST = Path(os.environ.get("RM_FRONTEND_DIST", ROOT / "frontend" / "dist"))

DATA_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)


def _session_secret() -> str:
    """Oturum çerezini imzalayan anahtar. Verilmezse veri dizininde bir kez üretilip saklanır (yeniden başlatmada oturumlar düşmez)."""
    s = _secret("RM_SESSION_SECRET")
    if s:
        if len(s) < 32:
            raise RuntimeError("RM_SESSION_SECRET en az 32 karakter olmalı")
        return s
    key = DATA_DIR / "session.key"
    if not key.exists():
        import secrets
        key.touch(mode=0o600)
        key.write_text(secrets.token_urlsafe(48))
    return key.read_text().strip()


SESSION_SECRET = _session_secret()
