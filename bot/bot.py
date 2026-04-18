import os
import time
import threading
import subprocess
import requests
from datetime import datetime

TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = int(os.environ['TELEGRAM_CHAT_ID'])
API = f"https://api.telegram.org/bot{TOKEN}"

CONTAINERS = ['geocore_db', 'geocore_moodle', 'geocore_frontend', 'geocore_api',
              'geocore_backup', 'geocore_watchtower', 'geocore_bot']
ENDPOINTS = ['https://geocore-academy.ru', 'https://courses.geocore-academy.ru',
             'https://api.geocore-academy.ru/api/health']

DISK_WARN = int(os.environ.get('DISK_WARN', '85'))
RAM_WARN  = int(os.environ.get('RAM_WARN', '90'))
CPU_WARN  = int(os.environ.get('CPU_WARN', '95'))
INTERVAL  = int(os.environ.get('CHECK_INTERVAL', '300'))


KEYBOARD = {'inline_keyboard': [[
    {'text': '📊 Статус', 'callback_data': '/status'},
    {'text': '💾 Бэкап',  'callback_data': '/backup'},
]]}


def send(text, chat_id=None, keyboard=False):
    try:
        payload = {
            'chat_id': chat_id or CHAT_ID,
            'text': text,
            'parse_mode': 'Markdown',
        }
        if keyboard:
            payload['reply_markup'] = KEYBOARD
        requests.post(f"{API}/sendMessage", json=payload, timeout=10)
    except Exception:
        pass


# ── Метрики ──────────────────────────────────────────────────────────────────

def get_ram():
    mem = {}
    with open('/proc/meminfo') as f:
        for line in f:
            k, v = line.split(':')
            mem[k.strip()] = int(v.split()[0])
    total = mem['MemTotal']
    used  = total - mem['MemAvailable']
    return used * 100 // total, used // 1024, total // 1024


def get_cpu():
    def read():
        with open('/proc/stat') as f:
            p = f.readline().split()
        idle = int(p[4])
        return idle, sum(int(x) for x in p[1:])
    i1, t1 = read(); time.sleep(1); i2, t2 = read()
    dt = t2 - t1
    return 100 - (i2 - i1) * 100 // dt if dt > 0 else 0


def get_disk():
    r = subprocess.run(['df', '-h', '/rootfs'], capture_output=True, text=True)
    parts = r.stdout.splitlines()[1].split()
    return int(parts[4].rstrip('%')), parts[2], parts[1]


def get_uptime():
    with open('/proc/uptime') as f:
        secs = int(float(f.read().split()[0]))
    d, r = divmod(secs, 86400); h, r = divmod(r, 3600); m = r // 60
    return f"{d}д {h}ч {m}м" if d else f"{h}ч {m}м"


def get_containers():
    r = subprocess.run(['docker', 'ps', '-a', '--format', '{{.Names}}\t{{.Status}}'],
                       capture_output=True, text=True)
    out = {}
    for line in r.stdout.strip().splitlines():
        if '\t' in line:
            name, status = line.split('\t', 1)
            out[name] = status
    return out


def led(pct, warn, mid=None):
    return '🔴' if pct >= warn else ('🟡' if mid and pct >= mid else '🟢')


# ── Команда /status ───────────────────────────────────────────────────────────

def status_text():
    ram_pct, ram_used, ram_total = get_ram()
    cpu_pct   = get_cpu()
    disk_pct, disk_used, disk_total = get_disk()
    containers = get_containers()

    lines = [
        f"*GeoCore VPS* — {datetime.now().strftime('%d.%m.%Y %H:%M')}\n",
        "*Метрики:*",
        f"{led(cpu_pct,  CPU_WARN, 80)} CPU: {cpu_pct}%",
        f"{led(ram_pct,  RAM_WARN, 75)} RAM: {ram_pct}% ({ram_used} / {ram_total} MB)",
        f"{led(disk_pct, DISK_WARN, 70)} Диск: {disk_pct}% ({disk_used} / {disk_total})",
        f"⏱ Uptime: {get_uptime()}\n",
        "*Контейнеры:*",
    ]
    for name in CONTAINERS:
        status = containers.get(name, 'not found')
        lines.append(f"{'🟢' if status.startswith('Up') else '🔴'} `{name}`: {status}")
    return '\n'.join(lines)


# ── Watchdog ──────────────────────────────────────────────────────────────────

_alerts: set = set()


def alert(key, msg):
    if key not in _alerts:
        _alerts.add(key)
        send(f"⚠️ *GeoCore Alert*\n{msg}")


def clear(key):
    _alerts.discard(key)


def check():
    ram_pct, ram_used, ram_total = get_ram()
    cpu_pct = get_cpu()
    disk_pct, disk_used, disk_total = get_disk()
    containers = get_containers()

    if disk_pct >= DISK_WARN:
        alert('disk', f"Диск заполнен на *{disk_pct}%* ({disk_used}/{disk_total})\nСвяжитесь с провайдером или почистите логи.")
    else:
        clear('disk')

    if ram_pct >= RAM_WARN:
        alert('ram', f"RAM: *{ram_pct}%* ({ram_used}/{ram_total} MB)\nВозможна нехватка ресурсов — проверьте контейнеры.")
    else:
        clear('ram')

    if cpu_pct >= CPU_WARN:
        alert('cpu', f"CPU: *{cpu_pct}%* — высокая нагрузка\nЕсли держится долго — свяжитесь с провайдером.")
    else:
        clear('cpu')

    for name in CONTAINERS:
        status = containers.get(name, 'not found')
        if not status.startswith('Up'):
            alert(f'c:{name}', f"Контейнер упал: `{name}`\nСтатус: _{status}_")
        else:
            clear(f'c:{name}')

    for url in ENDPOINTS:
        try:
            r = requests.get(url, timeout=10, allow_redirects=True)
            if r.status_code >= 500:
                alert(f'http:{url}', f"Сайт недоступен: {url}\nHTTP {r.status_code}")
            else:
                clear(f'http:{url}')
        except Exception:
            alert(f'http:{url}', f"Сайт недоступен: {url}\n(timeout / нет ответа)")


def watchdog_loop():
    while True:
        try:
            check()
        except Exception:
            pass
        time.sleep(INTERVAL)


# ── Polling ───────────────────────────────────────────────────────────────────

def handle(upd):
    cb = upd.get('callback_query')
    if cb:
        cid  = cb.get('message', {}).get('chat', {}).get('id')
        text = cb.get('data', '').strip()
        try:
            requests.post(f"{API}/answerCallbackQuery",
                          json={'callback_query_id': cb['id']}, timeout=5)
        except Exception:
            pass
    else:
        msg  = upd.get('message', {})
        cid  = msg.get('chat', {}).get('id')
        text = msg.get('text', '').strip()

    if cid != CHAT_ID:
        return
    if text in ('/start', '/help'):
        send("*GeoCore Bot*\n\n📊 /status — метрики VPS и статус контейнеров\n💾 /backup — запустить бэкап вручную", cid, keyboard=True)
    elif text == '/status':
        try:
            send(status_text(), cid)
        except Exception as e:
            send(f"Ошибка: {e}", cid)
    elif text == '/backup':
        send("⏳ Запускаю бэкап...", cid)
        r = subprocess.run(['docker', 'exec', 'geocore_backup', '/scripts/backup.sh'],
                           capture_output=True, text=True)
        send("✅ Бэкап завершён" if r.returncode == 0 else f"❌ Ошибка\n```{r.stderr[-400:]}```", cid)


def poll():
    offset = 0
    while True:
        try:
            r = requests.get(f"{API}/getUpdates",
                             params={'offset': offset, 'timeout': 30}, timeout=35)
            for upd in r.json().get('result', []):
                offset = upd['update_id'] + 1
                handle(upd)
        except Exception:
            time.sleep(5)


if __name__ == '__main__':
    send("🟢 *GeoCore Bot запущен*")
    threading.Thread(target=watchdog_loop, daemon=True).start()
    poll()
