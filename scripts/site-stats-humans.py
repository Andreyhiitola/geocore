#!/usr/bin/env python3
"""GeoCore-Academy — статистика «только люди» по логам nginx.

Читает все доступные логи geocore-site-access.log* (текущий, ротированные, .gz),
отбрасывает ботов/сканеров/свои проверки, считает людей по дням и копит историю
в /var/lib/geocore-stats (IP там маскируются до /24, полные адреса не хранятся).

Человек за день = пара (IP, User-Agent), у которой одновременно:
  * UA похож на настоящий браузер (не бот, не сканер, не headless);
  * был запрос HTML-страницы (200/304) И подгрузка статики (js/css/images, не og-*);
  * не было серии 4xx (сканеры дёргают .env, .git и т.п.);
  * IP не в списке исключений и не заходил в /site-stats/ под логином (это вы сами).

Выход:
  /var/lib/geocore-stats/human/YYYY-MM-DD.log   — строки людей (COMBINED, время Алматы, IP /24)
  /var/lib/geocore-stats/daily/YYYY-MM-DD.json  — сводка дня
  /var/www/geocore-stats/index.html             — сводная страница
"""
import glob
import gzip
import html
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

LOG_GLOB = "/var/log/nginx/geocore-site-access.log*"
STATE = "/var/lib/geocore-stats"
OUT_DIR = "/var/www/geocore-stats"
EXCLUDE_FILE = "/opt/geocore/stats-exclude-ips.txt"  # по одному IP на строку, # — комментарий
TZ = timezone(timedelta(hours=5))  # Казахстан, UTC+5

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}
LINE = re.compile(
    r'^(\S+) \S+ (\S+) \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) (\S+) "([^"]*)" "([^"]*)"')

PREVIEW_UA = re.compile(r"TelegramBot|WhatsApp|facebookexternalhit|Twitterbot|Slackbot|Discordbot|LinkedInBot|vkShare", re.I)
BOT_UA = re.compile(
    r"bot\b|bot/|crawl|spider|slurp|censys|scan|research|headless|python|curl|wget|go-http|java/|okhttp|"
    r"libwww|httpclient|lighthouse|pagespeed|axios|node-fetch|postman|monitor|uptime|probe|inspect|"
    r"petalbot|ahrefs|semrush|mj12|dotbot|bytespider|gptbot|claude|perplexity|nexus 5x|phantomjs|"
    r"zgrab|masscan|nmap|nuclei|expanse|netcraft|paloalto|cortex|bingpreview|yandex|google-read|"
    r"apis-google|mediapartners|adsbot|feedfetcher|applebot|duckduck|seznam|barkrowler|dataforseo|"
    r"gptbot|ccbot|amazonbot|headlesschrome|puppeteer|selenium|playwright", re.I)
BROWSER_UA = re.compile(r"Chrome/|Firefox/|Safari/|Edg/|OPR/", re.I)
ASSET = re.compile(r"^/(js|css|images|fonts|assets)/")
IGNORE_4XX = re.compile(r"favicon|robots\.txt|apple-touch|og-|sitemap|\.well-known")


def parse_time(s):
    # 22/Nov/2026:15:04:19 +0000
    d, rest = s.split(":", 1)
    day, mon, year = d.split("/")
    hms, off = rest.split(" ")
    h, m, sec = map(int, hms.split(":"))
    sign = 1 if off[0] == "+" else -1
    tz = timezone(sign * timedelta(hours=int(off[1:3]), minutes=int(off[3:5])))
    return datetime(int(year), MONTHS[mon], int(day), h, m, sec, tzinfo=tz)


def mask_ip(ip):
    if ":" in ip:
        return ":".join(ip.split(":")[:3]) + "::"
    parts = ip.split(".")
    return ".".join(parts[:3] + ["0"]) if len(parts) == 4 else ip


def open_log(path):
    return gzip.open(path, "rt", errors="replace") if path.endswith(".gz") else open(path, errors="replace")


def load_excludes():
    ips = set()
    try:
        for ln in open(EXCLUDE_FILE):
            ln = ln.split("#")[0].strip()
            if ln:
                ips.add(ln)
    except OSError:
        pass
    return ips


def read_days():
    days = defaultdict(list)  # date -> [(dt_local, ip, user, method, path, status, size, ref, ua, raw_req)]
    seen = set()
    for path in sorted(glob.glob(LOG_GLOB)):
        try:
            fh = open_log(path)
        except OSError:
            continue
        with fh:
            for raw in fh:
                m = LINE.match(raw)
                if not m:
                    continue
                if raw in seen and False:
                    continue
                ip, user, ts, method, url, status, size, ref, ua = m.groups()
                try:
                    dt = parse_time(ts).astimezone(TZ)
                except Exception:
                    continue
                days[dt.date().isoformat()].append((dt, ip, user, method, url, int(status), size, ref, ua))
    return days


def classify_day(rows, excl_ips):
    """Возвращает (human_rows, preview_rows, stats)."""
    self_ips = set(excl_ips)
    for dt, ip, user, method, url, status, size, ref, ua in rows:
        if user != "-" or url.startswith("/site-stats"):
            self_ips.add(ip)

    clients = defaultdict(list)
    for r in rows:
        clients[(r[1], r[8])].append(r)

    # ip -> число «плохих» 4xx
    bad4xx = Counter()
    for dt, ip, user, method, url, status, size, ref, ua in rows:
        if 400 <= status < 500 and not IGNORE_4XX.search(url):
            bad4xx[ip] += 1

    human, previews = [], []
    n_bot = n_scan = n_unknown = n_self = 0
    for (ip, ua), rs in clients.items():
        if ip in self_ips:
            n_self += 1
            continue
        if PREVIEW_UA.search(ua):
            previews.extend(rs)
            continue
        if not ua or ua == "-" or BOT_UA.search(ua) or not BROWSER_UA.search(ua):
            n_bot += 1
            continue
        if bad4xx[ip] >= 3:
            n_scan += 1
            continue
        has_page = any(r[3] == "GET" and r[5] in (200, 304) and not ASSET.match(r[4])
                       and (r[4].split("?")[0].endswith((".html", "/"))) for r in rs)
        has_asset = any(ASSET.match(r[4]) and "og-" not in r[4] and r[5] in (200, 304) for r in rs)
        if has_page and has_asset:
            human.extend(rs)
        else:
            n_unknown += 1

    human.sort(key=lambda r: r[0])
    return human, previews, {
        "bots": n_bot, "scanners": n_scan, "unclear": n_unknown, "self": n_self,
        "total_lines": len(rows),
    }


def day_summary(date, human, previews, st):
    page_rows = [r for r in human if r[3] == "GET" and r[5] in (200, 304)
                 and not ASSET.match(r[4]) and r[4].split("?")[0].endswith((".html", "/"))]
    visitors = {(r[1], r[8]) for r in human}
    pages = Counter(urlsplit(r[4]).path for r in page_rows)
    refs = Counter()
    for r in page_rows:
        ref = r[7]
        if ref and ref != "-":
            host = urlsplit(ref).netloc.lower().removeprefix("www.")
            if host and host != "geocore-academy.kz":
                refs[host] += 1
    utm = Counter()
    for r in page_rows:
        q = parse_qs(urlsplit(r[4]).query)
        if "utm_source" in q or "utm_campaign" in q:
            utm[f'{q.get("utm_source", ["?"])[0]} / {q.get("utm_campaign", ["?"])[0]}'] += 1
    prev_apps = Counter()
    prev_urls = Counter()
    for r in previews:
        m = PREVIEW_UA.search(r[8])
        app = {"telegrambot": "Telegram", "whatsapp": "WhatsApp"}.get(m.group(0).lower(), m.group(0))
        if not ASSET.match(r[4]) and r[5] == 200:
            prev_apps[app] += 1
            prev_urls[urlsplit(r[4]).path] += 1
    first_visit = Counter(r[0].hour for r in page_rows)
    return {
        "date": date, "humans": len(visitors), "page_views": len(page_rows),
        "pages": dict(pages.most_common(15)), "referrers": dict(refs.most_common(10)),
        "utm": dict(utm.most_common(10)), "previews": dict(prev_apps),
        "preview_urls": dict(prev_urls.most_common(10)), "hours": dict(sorted(first_visit.items())),
        **st,
    }


def write_archive(date, human, summary):
    os.makedirs(f"{STATE}/human", exist_ok=True)
    os.makedirs(f"{STATE}/daily", exist_ok=True)
    jpath = f"{STATE}/daily/{date}.json"
    # Не затираем день, если сейчас видим меньше данных (старый день уже выпал из ротации)
    try:
        old = json.load(open(jpath))
        if old.get("total_lines", 0) > summary["total_lines"]:
            return
    except (OSError, ValueError):
        pass
    lines = []
    for dt, ip, user, method, url, status, size, ref, ua in human:
        ts = dt.strftime("%d/%b/%Y:%H:%M:%S %z")
        lines.append(f'{mask_ip(ip)} - - [{ts}] "{method} {url} HTTP/1.1" {status} {size} "{ref}" "{ua}"\n')
    with open(f"{STATE}/human/{date}.log", "w") as f:
        f.writelines(lines)
    with open(jpath, "w") as f:
        json.dump(summary, f, ensure_ascii=False)


def render_index():
    sums = []
    for p in sorted(glob.glob(f"{STATE}/daily/*.json")):
        try:
            sums.append(json.load(open(p)))
        except ValueError:
            pass
    sums.sort(key=lambda s: s["date"], reverse=True)

    def agg(key, n=12):
        c = Counter()
        for s in sums:
            for k, v in s.get(key, {}).items():
                c[k] += v
        return c.most_common(n)

    def table(rows, head):
        if not rows:
            return "<p class=muted>пока нет данных</p>"
        h = "".join(f"<th>{html.escape(x)}</th>" for x in head)
        b = "".join("<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in r) + "</tr>" for r in rows)
        return f"<table><tr>{h}</tr>{b}</table>"

    total_h = sum(s["humans"] for s in sums)
    total_pv = sum(s["page_views"] for s in sums)
    days_rows = [(s["date"], s["humans"], s["page_views"], sum(s.get("previews", {}).values()),
                  s["bots"] + s["scanners"]) for s in sums]
    now = datetime.now(TZ).strftime("%d.%m.%Y %H:%M")
    doc = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Посещаемость — GeoCore-Academy</title>
<style>
body{{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:16px;color:#1a1a1c;background:#f7f3e8}}
h1{{margin:.2em 0}} h2{{margin-top:1.6em;border-bottom:2px solid #b8922a;padding-bottom:.2em}}
.big{{display:flex;gap:12px;flex-wrap:wrap}} .card{{background:#fff;border-radius:10px;padding:12px 18px;flex:1;min-width:150px}}
.card b{{display:block;font-size:30px}} table{{border-collapse:collapse;width:100%;background:#fff}}
td,th{{padding:6px 10px;border-bottom:1px solid #eee;text-align:left}} th{{background:#efe8d2}}
.muted{{color:#777}} a{{color:#96700f}}
</style></head><body>
<h1>Посещаемость сайта</h1>
<p class=muted>Обновлено {now} (время Казахстана). Считаются только люди: боты, сканеры и ваши проверки отброшены.</p>
<div class=big>
<div class=card><b>{total_h}</b>человек (сумма по дням)</div>
<div class=card><b>{total_pv}</b>просмотров страниц</div>
<div class=card><b>{sums[0]["humans"] if sums else 0}</b>человек за последний день</div>
</div>
<h2>По дням</h2>
{table(days_rows, ["День", "Людей", "Просмотров", "Раз поделились ссылкой (Telegram/WhatsApp)", "Ботов и сканеров"])}
<h2>Что читают люди</h2>{table(agg("pages", 15), ["Страница", "Просмотров"])}
<h2>Откуда пришли</h2>{table(agg("referrers"), ["Сайт", "Заходов"])}
<h2>Рекламные метки (UTM)</h2>{table(agg("utm"), ["source / campaign", "Заходов"])}
<h2>Какими страницами делятся</h2>{table(agg("preview_urls"), ["Страница", "Превью запрошено"])}
<h2>Подробные отчёты</h2>
<p><a href="people.html">Люди — полный отчёт GoAccess за всю историю</a> ·
<a href="raw.html">Всё подряд, включая ботов (сегодня)</a></p>
<h2>Как считаем</h2>
<p class=muted>Человек за день — пара «IP + браузер», у которой был запрос страницы и подгрузка картинок/скриптов,
браузер настоящий (не бот), нет серии запросов к несуществующим адресам, и это не вы (заходы под логином исключаются).
Это оценка: человек с двух устройств считается дважды, несколько человек за одним корпоративным IP с одним браузером — один раз.
Если ходите на сайт сами, добавьте свой IP в <code>/opt/geocore/stats-exclude-ips.txt</code>.</p>
</body></html>"""
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(f"{OUT_DIR}/index.html", "w") as f:
        f.write(doc)


def main():
    excl = load_excludes()
    days = read_days()
    for date, rows in days.items():
        human, previews, st = classify_day(rows, excl)
        write_archive(date, human, day_summary(date, human, previews, st))
    render_index()
    n = len(glob.glob(f"{STATE}/daily/*.json"))
    print(f"days={n}")


if __name__ == "__main__":
    sys.exit(main())
