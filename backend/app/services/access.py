"""Ortam / kategori bazında rapor görünürlüğü.

Yönetici her şeyi görür. Diğer kullanıcılar yalnız kendilerine (kullanıcı adıyla) veya gruplarından birine verilmiş
AccessRule'larla eşleşen ortam + kategorideki raporları görür. Kural yoksa hiçbir rapor görünmez.
Gruplar, kullanıcının son girişindeki OIDC grup claim'inden (KnownUser) okunur.
"""
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..db import AccessRule, KnownUser, ReportTemplate

ALL = "*"


@dataclass
class Access:
    is_admin: bool
    pairs: set[tuple[str, str]] = field(default_factory=set)  # (ortam, kategori); "*" joker

    def allows(self, scope: str, category: str) -> bool:
        if self.is_admin:
            return True
        return any(s in (ALL, scope) and c in (ALL, category) for s, c in self.pairs)

    def allows_scope(self, scope: str, scopes_with_reports: set[str] | None = None) -> bool:
        """Ortam listede görünsün mü: yönetici; o ortama açık yetki; tüm ortam + tüm kategori; veya görebildiği bir rapor."""
        if self.is_admin:
            return True
        if any(s == scope or (s == ALL and c == ALL) for s, c in self.pairs):
            return True
        return scopes_with_reports is not None and scope in scopes_with_reports

    def template(self, t: ReportTemplate) -> bool:
        return self.allows(t.scope, t.group)


def user_groups(db: Session, username: str) -> list[str]:
    ku = db.scalar(select(KnownUser).where(KnownUser.username == username))
    return list(ku.groups or []) if ku else []


def for_user(db: Session, u: dict) -> Access:
    if "admin" in u.get("roles", []):
        return Access(is_admin=True)
    groups = user_groups(db, u["username"])
    q = select(AccessRule).where(or_(
        (AccessRule.subject_type == "user") & (AccessRule.subject == u["username"]),
        (AccessRule.subject_type == "group") & (AccessRule.subject.in_(groups or [""])),
    ))
    return Access(is_admin=False, pairs={(r.scope, r.category) for r in db.scalars(q)})


def for_subject(db: Session, subject_type: str, subject: str, roles: list[str] | None = None) -> Access:
    """Yönetim ekranı için: bir kullanıcının (grupları dahil) veya tek bir grubun etkin yetkisi."""
    if subject_type == "user":
        return for_user(db, {"username": subject, "roles": roles or []})
    q = select(AccessRule).where(AccessRule.subject_type == "group", AccessRule.subject == subject)
    return Access(is_admin=False, pairs={(r.scope, r.category) for r in db.scalars(q)})
