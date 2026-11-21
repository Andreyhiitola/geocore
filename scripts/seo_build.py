#!/usr/bin/env python3
"""SEO-разметка статического сайта frontend/ (идемпотентно, можно гонять повторно).

Что делает:
  * вставляет между <!--seo:start--> и <!--seo:end--> canonical, Open Graph,
    Twitter Card и JSON-LD (Organization / Article / CollectionPage);
  * превращает теги статей (.art-tag) в ссылки на страницы-хабы tag/<slug>.html;
  * генерирует хабы tag/*.html, sitemap.xml, robots.txt, images/og-default.jpg;
  * admin.html получает noindex.

Запуск из корня репозитория:  python3 scripts/seo_build.py
"""
import html
import json
import re
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FE = ROOT / "frontend"
BASE = "https://geocore-academy.kz"
SITE = "GeoCore-Academy"
OG_IMAGE = f"{BASE}/images/og-default.jpg"
TODAY = date.today().isoformat()

# ── страницы верхнего уровня ────────────────────────────────────────────────
# description: None → берём из страницы (если там уже есть)
PAGES = {
    "index.html": {
        "url": "/",
        "description": "Онлайн-курсы по Datamine, Leapfrog, Micromine и стандартам JORC, ГКЗ, KAZRC. "
                       "Консультации и оценка месторождений. Первый урок — бесплатно.",
        "jsonld": "org",
        "priority": "1.0",
    },
    "courses.html": {"url": "/courses.html", "description": None, "priority": "0.9"},
    "corporate.html": {
        "url": "/corporate.html",
        "description": "Корпоративное обучение ГГИС для горнодобывающих компаний: Datamine, Leapfrog, Micromine, "
                       "стандарты JORC, KAZRC, ГКЗ. Онлайн, под NDA. Первый урок бесплатно.",
        "jsonld": "service",
        "priority": "0.8",
    },
    "privacy.html": {
        "url": "/privacy.html",
        "description": "Политика конфиденциальности GeoCore-Academy: какие данные собираются и как обрабатываются.",
        "priority": "0.2",
    },
}
# недоделанные/служебные страницы: без индексации, в sitemap и robots не упоминаются
NOINDEX = ["admin.html", "lab.html", "sandbox.html"]

# ── теги → хабы ─────────────────────────────────────────────────────────────
HUBS = {
    "datamine": ("Datamine", "Datamine Studio RM — ГГИС для геологического моделирования и оценки ресурсов. "
                 "Материалы GeoCore-Academy о блочных моделях, классификации ресурсов и работе в Datamine."),
    "leapfrog-geo": ("Leapfrog Geo", "Leapfrog Geo — ПО для неявного 3D-геологического моделирования. "
                     "Материалы GeoCore-Academy и разбор реального разведочного проекта."),
    "jorc": ("JORC", "Кодекс JORC — международный стандарт отчётности о минеральных ресурсах и рудных запасах "
             "(семейство CRIRSCO). Классификация ресурсов, роль Competent Person, сравнение с ГКЗ."),
    "gkz": ("ГКЗ", "ГКЗ — российская система государственной экспертизы и классификации запасов. "
            "Материалы о том, чем она отличается от JORC и как соотносятся категории."),
    "geostatistics": ("Геостатистика", "Геостатистика: вариография, кригинг и интерполяция содержаний. "
                      "Практические материалы для геологов."),
    "resource-estimation": ("Оценка ресурсов и запасов", "Оценка ресурсов и запасов: блочное моделирование, "
                            "категоризация, подсчёт. Материалы GeoCore-Academy."),
}
# текст тега в статье → slug хаба (теги без хаба остаются обычными метками)
TAG_TO_HUB = {
    "Datamine": "datamine", "Datamine Studio RM": "datamine",
    "Leapfrog": "leapfrog-geo",
    "JORC": "jorc", "Competent Person": "jorc",
    "ГКЗ": "gkz",
    "Геостатистика": "geostatistics", "Вариограмма": "geostatistics", "Кригинг": "geostatistics",
    "Блочная модель": "resource-estimation", "Категории запасов": "resource-estimation",
}
# дополнительные хабы для статей без явных тегов по теме
EXTRA_HUBS = {
    "article_sections_vs_datamine.html": ["datamine", "resource-estimation"],
    "JORC_vs_GKZ_articel.html": ["jorc", "gkz", "resource-estimation"],
}


def esc(s):
    return html.escape(s, quote=True)


def git_date(path):
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", str(path)],
                             cwd=ROOT, capture_output=True, text=True).stdout.strip()
        return out or TODAY
    except Exception:
        return TODAY


def meta_block(url, title, desc, og_type="website", jsonld=None, extra_head=""):
    full = BASE + url
    parts = [
        "<!--seo:start-->",
        f'<link rel="canonical" href="{esc(full)}">',
        f'<meta property="og:type" content="{og_type}">',
        f'<meta property="og:site_name" content="{SITE}">',
        f'<meta property="og:locale" content="ru_RU">',
        f'<meta property="og:url" content="{esc(full)}">',
        f'<meta property="og:title" content="{esc(title)}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        f'<meta property="og:image" content="{OG_IMAGE}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(title)}">',
        f'<meta name="twitter:description" content="{esc(desc)}">',
        f'<meta name="twitter:image" content="{OG_IMAGE}">',
    ]
    if extra_head:
        parts.append(extra_head)
    if jsonld:
        parts.append('<script type="application/ld+json">'
                     + json.dumps(jsonld, ensure_ascii=False) + "</script>")
    parts.append("<!--seo:end-->")
    return "\n".join(parts)


SEO_RE = re.compile(r"<!--seo:start-->.*?<!--seo:end-->\n?", re.S)


def inject(text, block, add_description=None):
    text = SEO_RE.sub("", text)
    if add_description and not re.search(r'<meta name="description"', text):
        block = f'<meta name="description" content="{esc(add_description)}">\n' + block
    m = re.search(r"</title>", text)
    assert m, "нет <title>"
    return text[:m.end()] + "\n" + block + text[m.end():]


def get_title(text):
    return html.unescape(re.search(r"<title>(.*?)</title>", text, re.S).group(1).strip())


def get_desc(text):
    m = re.search(r'<meta name="description" content="([^"]*)"', text)
    return html.unescape(m.group(1)) if m else None


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


BORTSOV_LINKEDIN = "https://www.linkedin.com/in/%D0%BA%D0%BE%D0%BD%D1%81%D1%82%D0%B0%D0%BD%D1%82%D0%B8%D0%BD-%D0%B1%D0%BE%D1%80%D1%86%D0%BE%D0%B2-15170151/"

ORG = {
    "@type": "Organization",
    "@id": BASE + "/#org",
    "name": SITE,
    "url": BASE + "/",
    "logo": BASE + "/images/og-default.jpg",
    "description": "Информационно-образовательный горно-геологический портал: обучение ГГИС и консалтинг "
                   "в области оценки месторождений.",
}

# ── статьи ──────────────────────────────────────────────────────────────────
articles = []
for f in sorted((FE / "articles").glob("*.html")):
    t = f.read_text(encoding="utf-8")
    t = SEO_RE.sub("", t)
    title = get_title(t)
    desc = get_desc(t) or title
    h1 = html.unescape(re.sub(r"<[^>]+>", "", re.search(r'<h1[^>]*>(.*?)</h1>', t, re.S).group(1)).strip())
    year = re.search(r'art-meta-item"><strong>(20\d\d)</strong>', t)
    author = re.search(r'art-meta-item"><strong>([^<]+)</strong></div>\s*<div class="art-meta-item"><strong>20', t)
    tags = [html.unescape(x) for x in re.findall(r'class="art-tag"[^>]*>([^<]*)<', t)]
    hubs = []
    for tg in tags:
        h = TAG_TO_HUB.get(tg)
        if h and h not in hubs:
            hubs.append(h)
    for h in EXTRA_HUBS.get(f.name, []):
        if h not in hubs:
            hubs.append(h)
    articles.append(dict(file=f, name=f.name, title=title, h1=h1, desc=desc,
                         year=year.group(1) if year else None,
                         author=author.group(1) if author else SITE, hubs=hubs, text=t))

for a in articles:
    t = a["text"]
    # теги → ссылки на хабы
    def retag(m):
        label = html.unescape(m.group(2))
        slug = TAG_TO_HUB.get(label)
        if slug:
            return f'<a class="art-tag" href="../tag/{slug}.html">{m.group(2)}</a>'
        return f'<span class="art-tag">{m.group(2)}</span>'
    t = re.sub(r'<(span|a)[^>]*class="art-tag"[^>]*>([^<]*)</\1>', retag, t)
    url = f"/articles/{a['name']}"
    author_ld = ({"@type": "Person", "name": "Константин Владимирович Борцов", "sameAs": [BORTSOV_LINKEDIN]}
                 if "Борцов" in a["author"] else {"@id": BASE + "/#org"})
    ld = {"@context": "https://schema.org", "@graph": [ORG, {
        "@type": "Article", "headline": a["h1"], "description": a["desc"],
        "inLanguage": "ru", "mainEntityOfPage": BASE + url,
        "image": OG_IMAGE, "author": author_ld, "publisher": {"@id": BASE + "/#org"},
        **({"datePublished": a["year"]} if a["year"] else {}),
        "dateModified": git_date(a["file"]),
    }]}
    css = '<style>a.art-tag{text-decoration:none;transition:.2s}a.art-tag:hover{background:var(--gold);color:var(--dark)}</style>'
    t = inject(t, meta_block(url, a["title"], a["desc"], "article", ld, css))
    write(a["file"], t)
    a["text"] = t
    a["lastmod"] = git_date(a["file"])

# ── верхнеуровневые страницы ────────────────────────────────────────────────
sitemap = []
for name, cfg in PAGES.items():
    p = FE / name
    t = p.read_text(encoding="utf-8")
    t = SEO_RE.sub("", t)
    desc = cfg["description"] or get_desc(t)
    title = get_title(t)
    ld = None
    if cfg.get("jsonld") == "org":
        ld = {"@context": "https://schema.org", "@graph": [
            ORG, {"@type": "WebSite", "url": BASE + "/", "name": SITE, "inLanguage": "ru",
                  "publisher": {"@id": BASE + "/#org"}}]}
    if cfg.get("jsonld") == "service":
        ld = {"@context": "https://schema.org", "@graph": [ORG, {
            "@type": "Service", "name": "Корпоративное обучение ГГИС", "description": desc,
            "serviceType": "Обучение горно-геологическим информационным системам",
            "provider": {"@id": BASE + "/#org"}, "areaServed": "KZ", "inLanguage": "ru",
            "url": BASE + cfg["url"]}]}
    t = inject(t, meta_block(cfg["url"], title, desc, "website", ld),
               add_description=cfg["description"])
    write(p, t)
    sitemap.append((cfg["url"], git_date(p), cfg["priority"]))

for name in NOINDEX:
    p = FE / name
    t = SEO_RE.sub("", p.read_text(encoding="utf-8"))
    t = inject(t, '<!--seo:start-->\n<meta name="robots" content="noindex,nofollow">\n<!--seo:end-->')
    write(p, t)

# ── хабы тегов ──────────────────────────────────────────────────────────────
src = (FE / "articles" / "Variogramma_article.html").read_text(encoding="utf-8")
STYLE = next(s for s in re.findall(r"<style>.*?</style>", src, re.S) if ":root{" in s)
HUB_CSS = """<style>
.hub-list{display:grid;gap:16px;margin:8px 0 40px}
.hub-card{display:block;text-decoration:none;border:1px solid var(--border-dim);background:var(--dark-3);padding:20px 24px;transition:.2s}
.hub-card:hover{border-color:var(--gold)}
.hub-card h3{font-family:'Playfair Display',serif;font-size:20px;margin:0 0 8px;color:var(--text)}
.hub-card p{font-size:14px;font-weight:300;color:var(--text-muted);margin:0 0 10px}
.hub-card span{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim)}
.hub-h2{font-family:'Playfair Display',serif;font-size:24px;margin:40px 0 16px;color:var(--text)}
.hub-cta{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 8px}
.hub-tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:32px}
</style>"""
FONTS = re.search(r'<link href="https://fonts.googleapis[^>]*>', src).group(0)
THEME_JS = re.search(r"<script>\nconst obs.*?</script>", src, re.S).group(0)

for slug, (name, intro) in HUBS.items():
    items = [a for a in articles if slug in a["hubs"]]
    if not items:
        continue
    url = f"/tag/{slug}.html"
    title = f"{name}: материалы и курсы — {SITE}"
    desc = intro if len(intro) <= 200 else intro[:197] + "…"
    cards = "\n".join(
        f'<a class="hub-card" href="../articles/{a["name"]}"><h3>{esc(a["h1"])}</h3>'
        f'<p>{esc(a["desc"])}</p><span>{esc(a["author"])}{" · " + a["year"] if a["year"] else ""}</span></a>'
        for a in items)
    others = "".join(f'<a class="art-tag" href="../tag/{s}.html">{esc(HUBS[s][0])}</a>'
                     for s in HUBS if s != slug and any(s in a["hubs"] for a in articles))
    ld = {"@context": "https://schema.org", "@graph": [ORG, {
        "@type": "CollectionPage", "name": title, "description": desc, "url": BASE + url, "inLanguage": "ru",
        "isPartOf": {"@id": BASE + "/#org"},
        "hasPart": [{"@type": "Article", "headline": a["h1"], "url": f"{BASE}/articles/{a['name']}"} for a in items],
    }, {
        "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": SITE, "item": BASE + "/"},
            {"@type": "ListItem", "position": 2, "name": name, "item": BASE + url}]}]}
    page = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
{meta_block(url, title, desc, "website", ld)}
{FONTS}
{STYLE}
{HUB_CSS}
</head>
<body>
<nav>
  <a href="../index.html" class="nav-logo"><div class="logo-hex"></div><span class="logo-text">Geo<span>Core</span></span></a>
  <a href="../index.html#blog" class="nav-back">← <span>Все статьи</span></a>
  <button class="theme-btn" id="themeBtn">🌙</button>
  <a href="../courses.html" class="nav-cta">Курсы</a>
</nav>
<div class="art-wrap">
  <div class="art-label">Тема</div>
  <h1 class="art-title">{esc(name)}</h1>
  <p class="art-sub">{esc(intro)}</p>
  <div class="hub-cta">
    <a href="../courses.html" class="btn-s">Курсы GeoCore-Academy</a>
    <a href="../index.html#consult" class="btn-s">Консультация</a>
  </div>
  <h2 class="hub-h2">Материалы</h2>
  <div class="hub-list">
{cards}
  </div>
  <div class="hub-tags">{others}</div>
</div>
<footer>
  <span class="f-copy">© {date.today().year} {SITE}</span>
  <a href="../index.html#blog" class="f-back">← Все статьи блога</a>
</footer>
{THEME_JS}
</body>
</html>
"""
    write(FE / "tag" / f"{slug}.html", page)
    sitemap.append((url, TODAY, "0.7"))

for a in articles:
    sitemap.append((f"/articles/{a['name']}", a["lastmod"], "0.6"))

# ── sitemap.xml / robots.txt ────────────────────────────────────────────────
sitemap.sort(key=lambda x: (-float(x[2]), x[0]))
xml = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for u, lm, pr in sitemap:
    xml.append(f"  <url><loc>{BASE}{u}</loc><lastmod>{lm}</lastmod><priority>{pr}</priority></url>")
xml.append("</urlset>\n")
write(FE / "sitemap.xml", "\n".join(xml))

write(FE / "robots.txt", f"""User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /pitch.html

Sitemap: {BASE}/sitemap.xml
""")

# ── og-image 1200x630 ───────────────────────────────────────────────────────
og = FE / "images" / "og-default.jpg"
if not og.exists():
    from PIL import Image, ImageDraw, ImageFont
    im = Image.open(FE / "images" / "hero-quarry.jpg").convert("RGB")
    w, h = im.size
    ch = int(w * 630 / 1200)
    top = max(0, (h - ch) // 2)
    im = im.crop((0, top, w, top + ch)).resize((1200, 630))
    ov = Image.new("RGB", im.size, (10, 10, 11))
    im = Image.blend(im, ov, 0.68)
    d = ImageDraw.Draw(im)
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    d.rectangle((72, 200, 78, 420), fill=(201, 168, 76))
    d.text((104, 200), "GeoCore-Academy", font=ImageFont.truetype(bold, 72), fill=(232, 230, 222))
    d.text((104, 300), "Оценка месторождений и ГГИС", font=ImageFont.truetype(reg, 38), fill=(201, 168, 76))
    d.text((104, 360), "JORC · ГКЗ · KAZRC · Datamine · Leapfrog", font=ImageFont.truetype(reg, 30), fill=(154, 152, 144))
    im.save(og, quality=85)

print(f"articles={len(articles)} sitemap_urls={len(sitemap)}")
