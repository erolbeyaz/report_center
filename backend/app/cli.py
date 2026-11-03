"""Veri kaynağı, ortam ve şablonları JSON olarak dışa / içe aktarma.

  python -m app.cli export rapor-merkezi.json        # mevcut kurulumu yedekle / başka ortama taşı
  python -m app.cli import rapor-merkezi.json        # yalnız olmayanları ekler
  python -m app.cli import rapor-merkezi.json --update   # değişen şablonlara yeni sürüm ekler
  python -m app.cli reset-admin                      # yerel hesabı admin / admin yapar (kullanıcı adı da sıfırlanır)

Kimlik bilgileri dosyaya yazılmaz: veri kaynağında yalnızca cred_file / ca_file yolu tutulur (göreli yol
RM_SECRETS_DIR'e göre çözülür). Şablonlar veri kaynağına ID ile değil adıyla bağlanır.
"""
import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select

from .db import DataSource, LocalAccount, ReportTemplate, Scope, SessionLocal, TemplateVersion, init_db
from .schemas import TemplateDefinition

FORMAT_VERSION = 1


def dump(db) -> dict:
    ds_names = {d.id: d.name for d in db.scalars(select(DataSource))}
    templates = []
    for t in db.scalars(select(ReportTemplate).where(ReportTemplate.deleted_at.is_(None)).order_by(ReportTemplate.scope, ReportTemplate.group, ReportTemplate.name)):
        d = dict(next(v for v in t.versions if v.version == t.current_version).definition)
        d["datasource"] = ds_names.get(d.pop("datasource_id"))
        templates.append({"slug": t.slug, "name": t.name, "scope": t.scope, "group": t.group, "definition": d})
    return {
        "format": FORMAT_VERSION,
        "datasources": [{"name": d.name, "type": d.type, "config": d.config} for d in db.scalars(select(DataSource).order_by(DataSource.id))],
        "scopes": [{"name": s.name, "kind": s.kind, "description": s.description} for s in db.scalars(select(Scope).order_by(Scope.name))],
        "templates": templates,
    }


def load(db, data: dict, update: bool = False, user: str = "import") -> dict:
    if data.get("format") != FORMAT_VERSION:
        raise ValueError(f"Desteklenmeyen dosya biçimi: {data.get('format')!r} (beklenen {FORMAT_VERSION})")
    stats = {"datasources": 0, "scopes": 0, "templates": 0, "versions": 0}
    ds = {d.name: d for d in db.scalars(select(DataSource))}
    for item in data.get("datasources", []):
        if item["name"] not in ds:
            ds[item["name"]] = DataSource(name=item["name"], type=item["type"], config=item.get("config", {}))
            db.add(ds[item["name"]])
            stats["datasources"] += 1
    db.flush()
    scopes = set(db.scalars(select(Scope.name)))
    for item in data.get("scopes", []):
        if item["name"] not in scopes:
            db.add(Scope(name=item["name"], kind=item.get("kind", "other"), description=item.get("description", "")))
            scopes.add(item["name"])
            stats["scopes"] += 1
    for item in data.get("templates", []):
        d = dict(item["definition"])
        src = ds.get(d.pop("datasource", None))
        if src is None:
            raise ValueError(f"{item['slug']}: veri kaynağı bulunamadı ({item['definition'].get('datasource')})")
        definition = TemplateDefinition.model_validate({**d, "datasource_id": src.id}).model_dump()
        if item["scope"] not in scopes:
            db.add(Scope(name=item["scope"], kind="other"))
            scopes.add(item["scope"])
            stats["scopes"] += 1
        t = db.scalar(select(ReportTemplate).where(ReportTemplate.slug == item["slug"]))
        if t is None:
            t = ReportTemplate(slug=item["slug"], name=item["name"], scope=item["scope"], group=item["group"], current_version=1)
            db.add(t)
            db.flush()
            db.add(TemplateVersion(template_id=t.id, version=1, definition=definition, created_by=user))
            stats["templates"] += 1
        elif t.deleted_at is not None:
            continue  # yönetici silmiş; içe aktarma geri getirmez
        elif update:
            cur = next(v for v in t.versions if v.version == t.current_version)
            if cur.definition != definition or (t.name, t.scope, t.group) != (item["name"], item["scope"], item["group"]):
                t.current_version += 1
                t.name, t.scope, t.group = item["name"], item["scope"], item["group"]
                db.add(TemplateVersion(template_id=t.id, version=t.current_version, definition=definition, created_by=user))
                stats["versions"] += 1
    db.commit()
    return stats


def bootstrap(path: Path) -> dict:
    with SessionLocal() as db:
        return load(db, json.loads(path.read_text(encoding="utf-8")), user="bootstrap")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export", help="kurulumu JSON'a yaz")
    e.add_argument("file", nargs="?", help="çıktı dosyası (yoksa stdout)")
    i = sub.add_parser("import", help="JSON'dan içe aktar")
    i.add_argument("file")
    i.add_argument("--update", action="store_true", help="var olan şablonlarda değişiklik varsa yeni sürüm ekle")
    sub.add_parser("reset-admin", help="yerel hesabı admin / admin yap; ilk girişte parola değiştirilmesi zorunlu")
    a = ap.parse_args(argv)
    init_db()
    with SessionLocal() as db:
        if a.cmd == "reset-admin":
            from .auth import hash_password
            acc = db.scalar(select(LocalAccount).order_by(LocalAccount.id).limit(1))
            if acc is None:
                db.add(LocalAccount(username="admin", password_hash=hash_password("admin"), must_change=True))
            else:
                acc.username, acc.password_hash, acc.must_change = "admin", hash_password("admin"), True
            db.commit()
            print("Yerel hesap admin / admin yapıldı; ilk girişte parola değiştirilmesi gerekiyor.", file=sys.stderr)
        elif a.cmd == "export":
            out = json.dumps(dump(db), ensure_ascii=False, indent=2)
            Path(a.file).write_text(out + "\n", encoding="utf-8") if a.file else print(out)
        else:
            print(load(db, json.loads(Path(a.file).read_text(encoding="utf-8")), update=a.update), file=sys.stderr)


if __name__ == "__main__":
    main()
