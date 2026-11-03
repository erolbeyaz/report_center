"""Giriş: tek yerel hesap (admin) ve isteğe bağlı OpenID Connect (Keycloak, Entra ID, Authentik…).

Yerel hesap: kullanıcı adı "admin", ilk parola "admin". İlk girişte parola değiştirilmeden uygulama kullanılamaz.
Başka yerel kullanıcı eklenemez; kurum kullanıcıları OIDC ile girer. RM_LOCAL_LOGIN=false ile kapatılabilir.

OIDC: authorization code + PKCE. Roller ID token'daki bir claim'den (varsayılan "groups") eşlenir.

Her iki yolda da kullanıcı imzalı, HttpOnly bir oturum çerezinde tutulur; token saklanmaz (çıkış için id_token hariç).
"""
import base64
import hashlib
import hmac
import logging
import secrets
import ssl
import threading
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from . import config
from .i18n import t as _t
from .db import KnownUser, LocalAccount, SessionLocal

ROLES = ("viewer", "designer", "admin")
log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/auth")

_discovery: dict = {"doc": None, "at": 0.0}
_jwks: dict = {"keys": None, "at": 0.0}


def oidc_enabled() -> bool:
    return bool(config.OIDC_ISSUER)


# --- parola özeti (scrypt, standart kütüphane) ---
_N, _R, _P = 2 ** 15, 8, 1


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=64 * 1024 * 1024)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(got, base64.b64decode(dk))
    except ValueError:
        return False


def ensure_local_admin():
    """Yerel admin hesabı yoksa ilk parola "admin" ile oluşturulur (değiştirilmesi zorunlu)."""
    if not config.LOCAL_LOGIN:
        return
    with SessionLocal() as db:
        if db.scalar(select(LocalAccount).limit(1)) is None:  # tek hesap; kullanıcı adı sonradan değiştirilebilir
            db.add(LocalAccount(username=config.LOCAL_ADMIN_USER, password_hash=hash_password("admin"), must_change=True))
            db.commit()
            log.warning("Yerel yönetici hesabı oluşturuldu: admin / admin. İlk girişte parola değiştirilmelidir.")


# --- kaba kuvvet koruması: aynı IP'den 5 hatalı denemede 5 dk bekleme ---
_fails: dict[str, list[float]] = {}
_fails_lock = threading.Lock()
MAX_FAILS, LOCK_SECONDS = 5, 300


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _check_lock(ip: str):
    with _fails_lock:
        recent = [t for t in _fails.get(ip, []) if time.time() - t < LOCK_SECONDS]
        _fails[ip] = recent
        if len(recent) >= MAX_FAILS:
            raise HTTPException(429, _t("Çok fazla hatalı deneme. {n} dakika sonra tekrar deneyin.", n=LOCK_SECONDS // 60))


def _fail(ip: str):
    with _fails_lock:
        _fails.setdefault(ip, []).append(time.time())


def _start_session(request: Request, user: dict):
    request.session.clear()  # oturum sabitleme saldırısına karşı yeni oturum
    request.session["user"] = {**user, "exp": int(time.time()) + config.SESSION_MAX_AGE}


# --- yerel giriş ---
class LocalLogin(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    current: str
    new: str


class UsernameChange(BaseModel):
    password: str
    username: str


USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@-]{2,79}$")


@router.get("/config")
def auth_config():
    return {"local": config.LOCAL_LOGIN, "oidc": oidc_enabled(), "oidc_label": config.OIDC_DISPLAY_NAME,
            "min_password_length": config.MIN_PASSWORD_LENGTH}


@router.post("/local/login")
def local_login(body: LocalLogin, request: Request):
    if not config.LOCAL_LOGIN:
        raise HTTPException(404, _t("Yerel giriş kapalı"))
    ip = _client_ip(request)
    _check_lock(ip)
    with SessionLocal() as db:
        acc = db.scalar(select(LocalAccount).where(LocalAccount.username == body.username.strip()))
        ok = acc is not None and verify_password(body.password, acc.password_hash)
        if not ok:
            _fail(ip)
            log.warning("Yerel giriş başarısız: kullanıcı=%r ip=%s", body.username[:80], ip)
            raise HTTPException(401, _t("Kullanıcı adı veya parola hatalı"))
        acc.last_login_at = datetime.now(timezone.utc)
        db.commit()
        must_change = acc.must_change
    _start_session(request, {"username": acc.username, "name": _t("Yerel yönetici"), "email": "", "roles": list(ROLES),
                             "source": "local", "must_change": must_change})
    _remember(acc.username, _t("Yerel yönetici"), "", "local", set(), list(ROLES))
    log.info("Yerel giriş: kullanıcı=%s ip=%s", acc.username, ip)
    return {"must_change": must_change}


@router.post("/local/password")
def change_password(body: PasswordChange, request: Request):
    u = session_user(request)
    if u is None or u.get("source") != "local":
        raise HTTPException(401, _t("Parola yalnız yerel hesap için değiştirilebilir"))
    ip = _client_ip(request)
    _check_lock(ip)
    if len(body.new) < config.MIN_PASSWORD_LENGTH:
        raise HTTPException(400, _t("Yeni parola en az {n} karakter olmalı", n=config.MIN_PASSWORD_LENGTH))
    if body.new == body.current or body.new.lower() in ("admin", u["username"].lower()):
        raise HTTPException(400, _t("Yeni parola eskisiyle veya kullanıcı adıyla aynı olamaz"))
    with SessionLocal() as db:
        acc = db.scalar(select(LocalAccount).where(LocalAccount.username == u["username"]))
        if acc is None or not verify_password(body.current, acc.password_hash):
            _fail(ip)
            raise HTTPException(400, _t("Mevcut parola hatalı"))
        acc.password_hash, acc.must_change = hash_password(body.new), False
        acc.password_changed_at = datetime.now(timezone.utc)
        db.commit()
    _start_session(request, {**u, "must_change": False})
    log.info("Yerel hesap parolası değiştirildi: kullanıcı=%s ip=%s", u["username"], ip)
    return {"ok": True}


@router.post("/local/username")
def change_username(body: UsernameChange, request: Request):
    """Tek yerel hesabın kullanıcı adını değiştirir (mevcut parola istenir). Export kayıtlarındaki eski ad korunur."""
    u = session_user(request)
    if u is None or u.get("source") != "local":
        raise HTTPException(401, _t("Kullanıcı adı yalnız yerel hesap için değiştirilebilir"))
    ip = _client_ip(request)
    _check_lock(ip)
    new = body.username.strip()
    if not USERNAME_RE.match(new):
        raise HTTPException(400, _t("Kullanıcı adı 3-80 karakter olmalı; harf, rakam ve . _ @ - kullanılabilir"))
    with SessionLocal() as db:
        acc = db.scalar(select(LocalAccount).where(LocalAccount.username == u["username"]))
        if acc is None or not verify_password(body.password, acc.password_hash):
            _fail(ip)
            raise HTTPException(400, _t("Mevcut parola hatalı"))
        if new == acc.username:
            return {"ok": True, "username": new}
        other = db.scalar(select(KnownUser).where(KnownUser.username == new))
        if other is not None and other.source != "local":
            raise HTTPException(409, _t("Bu kullanıcı adı kurumsal bir hesap tarafından kullanılıyor"))
        old, acc.username = acc.username, new
        ku = db.scalar(select(KnownUser).where(KnownUser.username == old, KnownUser.source == "local"))
        if ku is not None:
            if other is not None:
                db.delete(other)
                db.flush()
            ku.username = new
        db.commit()
    _start_session(request, {**u, "username": new})
    log.info("Yerel hesabın kullanıcı adı değiştirildi: %s -> %s ip=%s", old, new, ip)
    return {"ok": True, "username": new}


# --- OpenID Connect ---
def _client() -> httpx.Client:
    ctx = ssl.create_default_context(cafile=str(config.OIDC_CA_FILE) if config.OIDC_CA_FILE else None)
    if config.OIDC_CA_FILE:
        ctx.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN  # kendinden imzalı sunucu sertifikası doğrudan güvenilir olabilir
    return httpx.Client(verify=ctx, timeout=15)


def discovery() -> dict:
    if not _discovery["doc"] or time.time() - _discovery["at"] > 3600:
        with _client() as c:
            r = c.get(config.OIDC_ISSUER.rstrip("/") + "/.well-known/openid-configuration")
            r.raise_for_status()
            _discovery.update(doc=r.json(), at=time.time())
    return _discovery["doc"]


def _signing_key(kid: str):
    for attempt in range(2):
        if not _jwks["keys"] or attempt or time.time() - _jwks["at"] > 3600:
            with _client() as c:
                r = c.get(discovery()["jwks_uri"])
                r.raise_for_status()
                _jwks.update(keys=r.json()["keys"], at=time.time())
        for k in _jwks["keys"]:
            if k.get("kid") == kid:
                return jwt.PyJWK(k)
    raise HTTPException(401, _t("Token imza anahtarı bulunamadı"))


def _groups(claims: dict) -> set[str]:
    raw = claims
    for part in config.OIDC_ROLES_CLAIM.split("."):  # ör. "groups" veya "realm_access.roles"
        raw = raw.get(part, {}) if isinstance(raw, dict) else {}
    return {str(g).lstrip("/") for g in (raw if isinstance(raw, list) else [])}


def _remember(username: str, name: str, email: str, source: str, groups: set[str], roles: list[str]):
    """Kullanıcının son girişteki grupları saklanır; ortam / kategori yetkileri bunlarla değerlendirilir."""
    with SessionLocal() as db:
        ku = db.scalar(select(KnownUser).where(KnownUser.username == username))
        if ku is None:
            ku = KnownUser(username=username)
            db.add(ku)
        ku.name, ku.email, ku.source, ku.groups, ku.roles = name, email, source, sorted(groups), roles
        ku.last_login_at = datetime.now(timezone.utc)
        db.commit()


def _roles(claims: dict) -> list[str]:
    groups = _groups(claims)
    if groups & config.OIDC_ADMIN_GROUPS:
        return ["admin", "designer", "viewer"]
    if groups & config.OIDC_DESIGNER_GROUPS:
        return ["designer", "viewer"]
    if not config.OIDC_VIEWER_GROUPS or groups & config.OIDC_VIEWER_GROUPS:
        return ["viewer"]
    if config.OIDC_GROUP_PREFIX and any(config.app_group(g) for g in groups):  # ör. RaporMerkezi-ProjeAnaliz
        return ["viewer"]
    return []


def _base_url(request: Request) -> str:
    return config.PUBLIC_URL or str(request.base_url).rstrip("/")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _safe_next(next: str) -> str:
    return next if next.startswith("/") and not next.startswith("//") else "/"


def _login_error(msg: str) -> RedirectResponse:
    return RedirectResponse("/giris?" + urlencode({"hata": msg}))


@router.get("/login")
def login(request: Request, next: str = "/"):
    if not oidc_enabled():
        return RedirectResponse("/giris")
    verifier, state, nonce = secrets.token_urlsafe(48), secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    request.session["oidc"] = {"state": state, "nonce": nonce, "verifier": verifier, "next": _safe_next(next)}
    q = {"response_type": "code", "client_id": config.OIDC_CLIENT_ID, "redirect_uri": _base_url(request) + "/auth/callback",
         "scope": config.OIDC_SCOPES, "state": state, "nonce": nonce,
         "code_challenge": _b64(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256"}
    return RedirectResponse(discovery()["authorization_endpoint"] + "?" + urlencode(q))


@router.get("/callback")
def callback(request: Request, code: str = "", state: str = "", error: str = "", error_description: str = ""):
    pending = request.session.pop("oidc", None)
    if error:
        return _login_error(_t("Giriş reddedildi: {reason}", reason=error_description or error))
    if not pending or not secrets.compare_digest(state, pending["state"]):
        return _login_error(_t("Giriş isteğinin süresi dolmuş; tekrar deneyin."))
    with _client() as c:
        r = c.post(discovery()["token_endpoint"], auth=(config.OIDC_CLIENT_ID, config.oidc_client_secret()), data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": _base_url(request) + "/auth/callback",
            "code_verifier": pending["verifier"]})
    if r.status_code != 200:
        log.warning("OIDC token alınamadı: %s %s", r.status_code, r.text[:200])
        return _login_error(_t("Kimlik sağlayıcıdan token alınamadı."))
    id_token = r.json()["id_token"]
    key = _signing_key(jwt.get_unverified_header(id_token).get("kid", ""))
    claims = jwt.decode(id_token, key=key, algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"],
                        audience=config.OIDC_CLIENT_ID, issuer=discovery()["issuer"], leeway=30)
    if claims.get("nonce") != pending["nonce"]:
        return _login_error(_t("Geçersiz giriş yanıtı (nonce)."))
    username = claims.get("preferred_username") or claims.get("email") or claims["sub"]
    roles = _roles(claims)
    if not roles:
        log.warning("OIDC giriş reddedildi (yetki grubu yok): kullanıcı=%s", username)
        return _login_error(_t("Bu uygulamayı kullanma yetkiniz yok. Yetki için sistem yöneticinize başvurun."))
    _remember(username, claims.get("name") or "", claims.get("email") or "", "oidc", _groups(claims), roles)
    _start_session(request, {"username": username, "name": claims.get("name") or "", "email": claims.get("email") or "",
                             "roles": roles, "source": "oidc", "must_change": False})
    request.session["id_token"] = id_token  # çıkışta sağlayıcı oturumunu da kapatmak için
    log.info("OIDC giriş: kullanıcı=%s roller=%s", username, ",".join(roles))
    return RedirectResponse(pending["next"])


@router.get("/logout")
def logout(request: Request):
    u = request.session.get("user") or {}
    id_token = request.session.get("id_token")
    request.session.clear()
    if u.get("source") != "oidc" or not oidc_enabled():
        return RedirectResponse("/giris")
    end = discovery().get("end_session_endpoint")
    if not end:
        return RedirectResponse("/giris")
    q = {"post_logout_redirect_uri": _base_url(request) + "/giris", "client_id": config.OIDC_CLIENT_ID}
    if id_token:
        q["id_token_hint"] = id_token
    return RedirectResponse(end + "?" + urlencode(q))


# --- yetki ---
def session_user(request: Request) -> dict | None:
    u = request.session.get("user")
    if not u or u.get("exp", 0) < time.time():
        return None
    return u


def require(role: str, allow_pending_change: bool = False):
    def dep(request: Request) -> dict:
        u = session_user(request)
        if u is None:
            raise HTTPException(401, _t("Oturum açılmamış"))
        if u.get("must_change") and not allow_pending_change:
            raise HTTPException(403, "password_change_required")
        if role not in u["roles"]:
            raise HTTPException(403, _t("Bu işlem için yetkiniz yok"))
        return u
    return dep


viewer, designer, admin = require("viewer"), require("designer"), require("admin")
any_session = require("viewer", allow_pending_change=True)


@router.get("/me")
def me(u: dict = Depends(any_session)):
    return {"timezone": str(config.TIMEZONE), "tz_label": config.TZ_LABEL, "user": u["username"], "name": u["name"],
            "roles": u["roles"], "source": u.get("source"), "must_change": bool(u.get("must_change")),
            "preview_limit": config.PREVIEW_LIMIT}


def username(u: dict = Depends(viewer)) -> str:
    return u["username"]
