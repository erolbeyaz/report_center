from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import logging
import secrets

from . import config
from .cli import bootstrap
from .db import init_db
from . import auth
from .i18n import LanguageMiddleware
from .services import home
from .routers.api import router

log = logging.getLogger("uvicorn.error")
app = FastAPI(title="Rapor Merkezi", version="0.1.0")
app.add_middleware(LanguageMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(SessionMiddleware, secret_key=config.SESSION_SECRET or secrets.token_urlsafe(32), session_cookie="rm_session",
                   max_age=config.SESSION_MAX_AGE, same_site="lax", https_only=config.PUBLIC_URL.startswith("https://"))
app.include_router(auth.router)
app.include_router(router)


@app.on_event("startup")
def _startup():
    init_db()
    auth.ensure_local_admin()
    if config.BOOTSTRAP_FILE:
        log.info("İlk veri içe aktarıldı (%s): %s", config.BOOTSTRAP_FILE, bootstrap(config.BOOTSTRAP_FILE))
    home.refresh_in_background()  # Ana Sayfa sağlık özeti ilk ziyaretten önce hazır olsun (içe aktarılan kaynaklarla)


@app.get("/healthz")
def healthz():
    return {"ok": True}


# Üretimde React build'i aynı süreçten sunulur (tek imaj).
if config.FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = config.FRONTEND_DIST / path
        return FileResponse(f if path and f.is_file() else config.FRONTEND_DIST / "index.html")
