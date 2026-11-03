"""Kimlik sağlayıcı dizini: Erişim yönetimi ekranında grup ve kullanıcıları listeden seçmek için.

Şu an Keycloak desteklenir (issuer .../realms/<realm>). Uygulamanın OIDC istemcisinin servis hesabıyla
(client credentials) Keycloak Admin API'sine salt okuma erişir. Servis hesabına realm-management istemcisinin
query-groups, query-users ve view-users rolleri verilmelidir. Erişim yoksa ekran elle yazmaya döner.
RM_OIDC_DIRECTORY=false ile kapatılır.
"""
import threading
import time

from .. import auth, config
from ..i18n import t as _t

_lock = threading.Lock()
_token: dict = {"value": None, "exp": 0.0}
_groups: dict = {"list": None, "at": 0.0}
GROUP_TTL = 300


class DirectoryError(Exception):
    pass


def available() -> bool:
    return bool(config.OIDC_ISSUER) and "/realms/" in config.OIDC_ISSUER and config.OIDC_DIRECTORY


def _admin_base() -> str:
    return config.OIDC_ISSUER.rstrip("/").replace("/realms/", "/admin/realms/", 1)


def _access_token(c) -> str:
    with _lock:
        if _token["value"] and _token["exp"] - 30 > time.time():
            return _token["value"]
    r = c.post(auth.discovery()["token_endpoint"], auth=(config.OIDC_CLIENT_ID, config.oidc_client_secret()),
               data={"grant_type": "client_credentials"})
    if r.status_code != 200:
        raise DirectoryError(_t("Servis hesabı token alamadı (istemcide 'Service accounts' açık mı?)"))
    body = r.json()
    with _lock:
        _token.update(value=body["access_token"], exp=time.time() + body.get("expires_in", 60))
    return body["access_token"]


def _get(c, path: str, params: dict | None = None):
    r = c.get(_admin_base() + path, params=params, headers={"Authorization": f"Bearer {_access_token(c)}"})
    if r.status_code == 403:
        raise DirectoryError(_t("Servis hesabının Keycloak dizin yetkisi yok (realm-management: query-groups, query-users, view-users)"))
    if r.status_code >= 400:
        raise DirectoryError(f"Keycloak {r.status_code}: {r.text[:150]}")
    return r.json()


def groups() -> list[dict]:
    """Gruplar (alt gruplar dahil; RM_OIDC_GROUP_PREFIX verildiyse yalnız o önekle başlayanlar): ad ve yol. 5 dk önbellek."""
    with _lock:
        if _groups["list"] is not None and time.time() - _groups["at"] < GROUP_TTL:
            return _groups["list"]
    out: list[dict] = []
    with auth._client() as c:
        def walk(items, parent=""):
            for g in items:
                path = g.get("path") or f"{parent}/{g['name']}"
                if config.app_group(g["name"]):
                    out.append({"name": g["name"], "path": path})
                subs = g.get("subGroups") or []
                if not subs and g.get("subGroupCount"):
                    subs = _get(c, f"/groups/{g['id']}/children", {"max": 1000, "briefRepresentation": "true"})
                walk(subs, path)
        params = {"max": 1000, "briefRepresentation": "true"}
        if config.OIDC_GROUP_PREFIX:
            params["search"] = config.OIDC_GROUP_PREFIX  # Keycloak'ta daralt; kesin eşleşme yukarıda
        walk(_get(c, "/groups", params))
    out.sort(key=lambda g: g["name"].lower())
    with _lock:
        _groups.update(list=out, at=time.time())
    return out


def users(q: str, limit: int = 20) -> list[dict]:
    with auth._client() as c:
        items = _get(c, "/users", {"search": q, "max": limit, "briefRepresentation": "true"})
    return [{"username": u.get("username"), "name": " ".join(filter(None, [u.get("firstName"), u.get("lastName")])),
             "email": u.get("email") or "", "enabled": u.get("enabled", True)} for u in items]
