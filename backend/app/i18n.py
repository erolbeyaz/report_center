"""Kullanıcıya dönen metinlerin dili (tr | en).

Kaynak metinler Türkçedir; t() istek dili İngilizceyse EN sözlüğünden çevirir, sözlükte olmayan metin olduğu
gibi kalır. İstek dili arayüzün yazdığı rm_lang çerezinden, yoksa Accept-Language başlığından gelir;
ikisi de yoksa RM_DEFAULT_LANGUAGE kullanılır.
"""
from contextvars import ContextVar

from . import config

LANGS = ("tr", "en")
_lang: ContextVar[str] = ContextVar("lang", default=config.DEFAULT_LANGUAGE)

# Türkçe kaynak metin → İngilizce. {ad} yer tutucuları str.format ile doldurulur.
EN: dict[str, str] = {
    "Kullanıcı adı yalnız yerel hesap için değiştirilebilir": "The username can only be changed for the local account",
    "Kullanıcı adı 3-80 karakter olmalı; harf, rakam ve . _ @ - kullanılabilir": "The username must be 3-80 characters: letters, digits and . _ @ -",
    "Bu kullanıcı adı kurumsal bir hesap tarafından kullanılıyor": "This username is already used by a corporate account",
    'Çok fazla hatalı deneme. {n} dakika sonra tekrar deneyin.': 'Too many failed attempts. Try again in {n} minutes.',
    'Yerel giriş kapalı': 'Local sign-in is disabled',
    'Kullanıcı adı veya parola hatalı': 'Incorrect username or password',
    'Yerel yönetici': 'Local administrator',
    'Parola yalnız yerel hesap için değiştirilebilir': 'The password can only be changed for the local account',
    'Yeni parola en az {n} karakter olmalı': 'The new password must be at least {n} characters long',
    'Yeni parola eskisiyle veya kullanıcı adıyla aynı olamaz': 'The new password cannot be the same as the old password or the username',
    'Mevcut parola hatalı': 'Current password is incorrect',
    'Token imza anahtarı bulunamadı': 'Token signing key not found',
    'Giriş reddedildi: {reason}': 'Sign-in rejected: {reason}',
    'Giriş isteğinin süresi dolmuş; tekrar deneyin.': 'The sign-in request has expired; please try again.',
    'Kimlik sağlayıcıdan token alınamadı.': 'Could not obtain a token from the identity provider.',
    'Geçersiz giriş yanıtı (nonce).': 'Invalid sign-in response (nonce).',
    'Bu uygulamayı kullanma yetkiniz yok. Yetki için sistem yöneticinize başvurun.': 'You are not authorized to use this application. Contact your system administrator for access.',
    'Oturum açılmamış': 'Not signed in',
    'Bu işlem için yetkiniz yok': 'You are not authorized to perform this action',
    'Veri kaynağına bağlanılamıyor: {name}': 'Cannot connect to data source: {name}',
    'Sağlık kontrolleri dosyası okunamadı: {error}': 'Could not read the health checks file: {error}',
    '{n} saat': '{n} h',
    '{n} dk': '{n} min',
    'Prometheus veri kaynağı bulunamadı: {name}': 'Prometheus data source not found: {name}',
    'bağlantı yok': 'no connection',
    'yok': 'none',
    'Sağlık özeti hesaplanamadı: {error}': 'Could not compute the health summary: {error}',
    'Şablonun veri kaynağı bulunamadı': "The template's data source was not found",
    'Şablonda kolon yok; önce Rapor tasarımı ekranından kolon ekleyin': 'The template has no columns; add columns in Report design first',
    'Bitiş zamanı başlangıçtan sonra olmalı': 'End time must be after the start time',
    'Geçersiz parametre: {field}={value}': 'Invalid parameter: {field}={value}',
    'Bu alana göre sıralanamaz: {fields}': 'Cannot sort by this field: {fields}',
    'Veri setinde kayıt yok.': 'The dataset has no records.',
    'Seçilen dönemin başı ({start}) veri setindeki en eski kayıttan ({earliest}) önce. Bu aralık kaynakta yok (saklama süresi dolmuş olabilir); eksiksiz rapor için dönemi en eski kayıttan başlatın veya veriyi yedekten geri yükleyin.': 'The start of the selected period ({start}) is before the oldest record in the dataset ({earliest}). This range is not in the source (retention may have expired); for a complete report, start the period at the oldest record or restore the data from backup.',
    'Export üretilmedi.': 'No export was produced.',
    '{count} kayıt Excel sınırını ({limit}) aşıyor; dönemi daraltın': '{count} records exceed the Excel limit ({limit}); narrow the period',
    'Eksiksizlik kontrolü başarısız: kaynak {source}, okunan {read}.': 'Completeness check failed: source {source}, read {read}.',
    'Rapor': 'Report',
    'Dönem': 'Period',
    '{start} – {end} (bitiş hariç, {tz})': '{start} – {end} (end exclusive, {tz})',
    'Kapsam': 'Scope',
    'Seçilen parametreler': 'Selected parameters',
    'Sıralama': 'Sort order',
    'azalan': 'descending',
    'artan': 'ascending',
    'Kayıt sayısı': 'Record count',
    'Kaynak sorgusu': 'Source query',
    'Eksiksizlik kontrolü': 'Completeness check',
    'Kaynaktaki kayıt sayısı ({source}) ile rapordaki satır sayısı ({rows}) eşleşti.': 'The record count in the source ({source}) matches the row count in the report ({rows}).',
    'Veri kapsamı': 'Data coverage',
    'Veri setindeki en eski kayıt {earliest}; seçilen dönemin tamamı kaynakta mevcut.': 'Oldest record in the dataset: {earliest}; the entire selected period is available in the source.',
    'Saat dilimi': 'Time zone',
    'Tüm tarihler {tz}.': 'All dates are in {tz}.',
    'Şablon': 'Template',
    '{name} · sürüm {version}': '{name} · version {version}',
    'Veri özeti (SHA-256)': 'Data digest (SHA-256)',
    'Oluşturan / zaman': 'Created by / at',
    'UYARI': 'WARNING',
    'Dönem henüz bitmedi; rapor {at} itibarıyla kısmidir.': 'The period has not ended yet; the report is partial as of {at}.',
    'Hazırlayan': 'Prepared by',
    'İmza / Tarih': 'Signature / Date',
    'Onaylayan': 'Approved by',
    'Rapor Bilgisi': 'Report Info',
    'Sayfa &P / &N': 'Page &P of &N',
    "Servis hesabı token alamadı (istemcide 'Service accounts' açık mı?)": "The service account could not obtain a token (is 'Service accounts' enabled on the client?)",
    'Servis hesabının Keycloak dizin yetkisi yok (realm-management: query-groups, query-users, view-users)': 'The service account lacks Keycloak directory permissions (realm-management: query-groups, query-users, view-users)',
    'Eksik alan: {fields}': 'Missing field: {fields}',
    '{key}: yalnız dosya adı girin (RM_SECRETS_DIR altında), yol değil': '{key}: enter only a file name (under RM_SECRETS_DIR), not a path',
    "'{name}' adında bir veri kaynağı zaten var": "A data source named '{name}' already exists",
    'Veri kaynağı bulunamadı': 'Data source not found',
    'Veri kaynağının tipi değiştirilemez; yeni bir kaynak ekleyin': "A data source's type cannot be changed; add a new source instead",
    'Bu kaynağı {n} rapor kullanıyor; önce raporları başka kaynağa taşıyın veya silin': '{n} reports use this source; move them to another source or delete them first',
    "'{name}' adında bir ortam zaten var": "An environment named '{name}' already exists",
    'Ortam bulunamadı: {name}. Önce ortamı oluşturun.': 'Environment not found: {name}. Create the environment first.',
    'Şablon bulunamadı': 'Template not found',
    "'{scope} › {category}' için yetkiniz yok": "You are not authorized for '{scope} › {category}'",
    "Zaman alanı '{field}' bu veri setinde tarih tipinde değil": "Time field '{field}' is not a date field in this dataset",
    'Tarih ({tz})': 'Date ({tz})',
    'Kaynak': 'Source',
    'Export bulunamadı': 'Export not found',
    'Export dosyası bulunamadı': 'Export file not found',
    'Grup veya kullanıcı adı girin': 'Enter a group or username',
    'Ortam bulunamadı: {name}': 'Environment not found: {name}',
    'Bu yetki zaten var': 'This permission already exists',
    'Yetki bulunamadı': 'Permission not found',
    'Kimlik sağlayıcı dizini yapılandırılmamış': 'Identity provider directory is not configured',
    'Desteklenmeyen veri kaynağı tipi: {type}': 'Unsupported data source type: {type}',
    'Kimlik dosyası okunamadı: {file}': 'Could not read the credentials file: {file}',
    'Kimlik dosyası 2 satır olmalı: kullanıcı, şifre': 'The credentials file must have 2 lines: username, password',
    "Elasticsearch'e bağlanılamadı: {error}": 'Could not connect to Elasticsearch: {error}',
    '{field} metin alanı; sıralanamaz (keyword alt alanı yok)': '{field} is a text field and cannot be sorted (no keyword sub-field)',
    'Geçersiz adım: {step} (ör. 5m, 1h, 1d)': 'Invalid step: {step} (e.g. 5m, 1h, 1d)',
    "Prometheus'a bağlanılamadı: {error}": 'Could not connect to Prometheus: {error}',
    'Dönem bu adım ({step}) için çok uzun: en çok {max} nokta. Adımı büyütün veya dönemi daraltın.': 'The period is too long for this step ({step}): at most {max} points. Increase the step or narrow the period.',
    'adım {step}': 'step {step}',
    'cred_file verilmedi': 'cred_file not set',
    'Veri kaynağı ayarı eksik: {key}': 'Missing data source setting: {key}',
    'Sorgu çok uzun (en çok {max} karakter)': 'Query is too long (at most {max} characters)',
    'Tek bir SELECT sorgusu yazın (; ile ayrılmış birden çok ifade çalıştırılamaz)': 'Write a single SELECT query (multiple statements separated by ; cannot be run)',
    'Sorgu SELECT veya WITH ile başlamalı': 'The query must start with SELECT or WITH',
    'Sorgu çalışmadı: {error}': 'Query failed: {error}',
    'Sorgudaki her kolonun benzersiz bir adı olmalı (hesaplanan kolonlara AS ile ad verin)': 'Every column in the query must have a unique name (name computed columns with AS)',
    'Tablo veya görünüm bulunamadı: {name}': 'Table or view not found: {name}',
    'Kolon bulunamadı: {name} ({source})': 'Column not found: {name} ({source})',
    'sorgu': 'query',
    '{column} için geçersiz değer: {value}': 'Invalid value for {column}: {value}',
    'tablo': 'table',
    'görünüm': 'view',
    "SQL Server'da WITH (CTE) alt sorgu içinde kullanılamaz; sorguyu alt sorgu (FROM (SELECT ...) x) ile yazın": 'SQL Server does not allow WITH (CTE) inside a subquery; rewrite it as a subquery (FROM (SELECT ...) x)',
    'dolu': 'is set',
    'boş': 'is empty',
    'ile başlar:': 'starts with:',
    'ile başlamaz:': 'does not start with:',
    "Kubernetes cluster'ları": 'Kubernetes clusters',
    'Sunucular': 'Servers',
    'Uygulamalar ve platformlar': 'Applications and platforms',
    'Ağ ve güvenlik cihazları': 'Network and security devices',
    'Diğer': 'Other',
    'Desteklenmeyen filtre: {op}': 'Unsupported filter: {op}',
}


def current() -> str:
    return _lang.get()


def t(msg: str, **kw) -> str:
    out = EN.get(msg, msg) if _lang.get() == "en" else msg
    return out.format(**kw) if kw else out


class later:
    """İstek dışında (arka plan thread'i, önbellek) üretilen metin: fonksiyon çağrısı yanıt anında, istek diliyle yapılır.
    later(t, "Veri kaynağına bağlanılamıyor: {name}", name=...) veya later(fmt, değer, tür)."""
    __slots__ = ("fn", "args", "kw")

    def __init__(self, fn, *args, **kw):
        self.fn, self.args, self.kw = fn, args, kw

    def resolve(self):
        return self.fn(*(render(a) for a in self.args), **{k: render(v) for k, v in self.kw.items()})

    def __str__(self):
        return str(self.resolve())


def render(obj):
    """Yapı içindeki later değerlerini çözer; diğer değerler aynen kalır (önbellekteki yapı değişmez)."""
    if isinstance(obj, later):
        return obj.resolve()
    if isinstance(obj, dict):
        return {k: render(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [render(v) for v in obj]
    return obj


def pick(cookie: str | None, accept: str | None) -> str:
    if cookie in LANGS:
        return cookie
    for part in (accept or "").split(","):
        code = part.split(";")[0].strip().lower()[:2]
        if code in LANGS:
            return code
    return config.DEFAULT_LANGUAGE


class LanguageMiddleware:
    """Saf ASGI: her istek için dili ContextVar'a koyar (StreamingResponse'larda da geçerli)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers", [])}
        cookie = None
        for item in headers.get("cookie", "").split(";"):
            k, _, v = item.strip().partition("=")
            if k == "rm_lang":
                cookie = v
        token = _lang.set(pick(cookie, headers.get("accept-language")))
        try:
            await self.app(scope, receive, send)
        finally:
            _lang.reset(token)
