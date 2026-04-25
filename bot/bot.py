import os
import json
import time
import threading
import subprocess
import requests
from datetime import datetime, timedelta

TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = int(os.environ['TELEGRAM_CHAT_ID'])
API = f"https://api.telegram.org/bot{TOKEN}"

CONTAINERS = ['geocore_db', 'geocore_moodle', 'geocore_frontend', 'geocore_api',
              'geocore_backup', 'geocore_watchtower', 'geocore_bot']
ENDPOINTS = ['https://geocore-academy.ru', 'https://courses.geocore-academy.ru']

DISK_WARN = int(os.environ.get('DISK_WARN', '85'))
RAM_WARN  = int(os.environ.get('RAM_WARN', '90'))
CPU_WARN  = int(os.environ.get('CPU_WARN', '95'))
INTERVAL  = int(os.environ.get('CHECK_INTERVAL', '300'))

backup_running = threading.Event()

# ── Состояние бота (персистентное) ────────────────────────────────────────────

_STATE_FILE = '/app/data/state.json'
os.makedirs('/app/data', exist_ok=True)


def _load_state() -> dict:
    try:
        with open(_STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    try:
        with open(_STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception:
        pass


# ── Напоминалка о токенах ─────────────────────────────────────────────────────

def _tokens_text() -> str:
    state = _load_state()
    reminder = state.get('last_token_reminder')
    rotated  = state.get('last_admin_token_rotated')

    if reminder:
        days_ago  = (datetime.now() - datetime.fromisoformat(reminder)).days
        days_left = max(0, 90 - days_ago)
        timer_line = f"⏰ Следующее напоминание через *{days_left}* дн."
    else:
        timer_line = "⏰ Напоминание ещё не отправлялось"

    rotated_line = (f"🔄 Последняя ротация ADMIN\\_TOKEN: "
                    f"`{datetime.fromisoformat(rotated).strftime('%d.%m.%Y')}`"
                    if rotated else "🔄 ADMIN\\_TOKEN ещё не ротировался")

    return (
        "🔑 *Управление токенами*\n\n"
        "*Автоматически (кнопкой ниже):*\n"
        f"✅ `ADMIN_TOKEN` — {rotated_line}\n\n"
        "*Требуют ручной ротации:*\n"
        "• `GITHUB_TOKEN` → github.com/settings/tokens\n"
        "• `MOODLE_TOKEN` → Moodle → Web services → Токены\n"
        "• `TELEGRAM_BOT_TOKEN` → @BotFather `/revoke`\n"
        "• `SMTP_PASS` → Gmail → Пароли приложений\n"
        "• S3 ключи → Панель Selectel\n\n"
        f"{timer_line}"
    )


def _check_token_reminder() -> None:
    state = _load_state()
    last  = state.get('last_token_reminder')
    if last and (datetime.now() - datetime.fromisoformat(last)).days < 90:
        return
    state['last_token_reminder'] = datetime.now().isoformat()
    _save_state(state)
    send(
        "🔑 *Напоминание: ротация токенов*\n\n"
        "Прошло 90 дней. Рекомендуется обновить:\n"
        "• `GITHUB_TOKEN` → github.com/settings/tokens\n"
        "• `MOODLE_TOKEN` → Moodle → Web services\n"
        "• `TELEGRAM_BOT_TOKEN` → @BotFather `/revoke`\n"
        "• `SMTP_PASS` → Gmail → Пароли приложений\n"
        "• S3 ключи → Selectel\n\n"
        "ADMIN\\_TOKEN можно ротировать кнопкой 🔑 Токены"
    )


REPLY_KEYBOARD = {
    'keyboard': [
        [{'text': '📊 Статус'}, {'text': '💾 Бэкап'}],
        [{'text': '📋 История бэкапов'}, {'text': '🔑 Токены'}],
    ],
    'resize_keyboard': True,
    'persistent': True,
}


STATUS_KEYBOARD = {'inline_keyboard': [[
    {'text': '🔄 Обновить', 'callback_data': 'status_refresh'},
    {'text': '📋 Логи',     'callback_data': 'status_logs'},
    {'text': '🗑 Очистить', 'callback_data': 'status_prune'},
]]}

TOKEN_KEYBOARD = {'inline_keyboard': [
    [{'text': '🔔 Сбросить таймер (90 дней)', 'callback_data': 'token_reset_timer'}],
]}


def send(text, chat_id=None, keyboard=False, inline=None):
    try:
        payload = {
            'chat_id': chat_id or CHAT_ID,
            'text': text,
            'parse_mode': 'Markdown',
        }
        if keyboard:
            payload['reply_markup'] = REPLY_KEYBOARD
        if inline:
            payload['reply_markup'] = inline
        r = requests.post(f"{API}/sendMessage", json=payload, timeout=10)
        return r.json().get('result', {}).get('message_id')
    except Exception:
        return None


def edit(chat_id, message_id, text, inline=None, parse_mode='HTML'):
    try:
        payload = {
            'chat_id': chat_id,
            'message_id': message_id,
            'text': text,
            'parse_mode': parse_mode,
        }
        if inline:
            payload['reply_markup'] = inline
        requests.post(f"{API}/editMessageText", json=payload, timeout=10)
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


# ── История бэкапов ───────────────────────────────────────────────────────────

def backup_history_text():
    r = subprocess.run(
        ['docker', 'exec', 'geocore_backup', 'sh', '-c',
         'aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET/daily/"'],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return "📋 *История бэкапов*\n\nНе удалось получить данные."

    week_ago = datetime.now() - timedelta(days=7)
    entries = []
    for row in r.stdout.strip().splitlines():
        parts = row.split()
        if len(parts) < 4:
            continue
        filename = parts[3]
        if not filename.startswith('db-'):
            continue
        try:
            dt = datetime.strptime(f"{parts[0]} {parts[1]}", '%Y-%m-%d %H:%M:%S')
        except ValueError:
            continue
        if dt >= week_ago:
            entries.append((dt, filename))

    if not entries:
        return "📋 *История бэкапов за неделю*\n\nДанных нет."

    lines = ["📋 *История бэкапов за неделю*\n"]
    for dt, filename in sorted(entries, reverse=True):
        lines.append(f"✅ `{dt.strftime('%d.%m.%Y')}` в `{dt.strftime('%H:%M')}` — `{filename}`")
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

    if cpu_pct >= CPU_WARN and not backup_running.is_set():
        alert('cpu', f"CPU: *{cpu_pct}%* — высокая нагрузка\nЕсли держится долго — свяжитесь с провайдером.")
    else:
        clear('cpu')

    for name in CONTAINERS:
        status = containers.get(name, 'not found')
        if not status.startswith('Up'):
            alert(f'c:{name}', f"Контейнер упал: `{name}`\nСтатус: _{status}_")
        else:
            clear(f'c:{name}')

    if not backup_running.is_set():
        for url in ENDPOINTS:
            try:
                r = requests.get(url, timeout=10, allow_redirects=True)
                if r.status_code >= 500:
                    alert(f'http:{url}', f"Сайт недоступен: {url}\nHTTP {r.status_code}")
                else:
                    clear(f'http:{url}')
            except Exception:
                alert(f'http:{url}', f"Сайт недоступен: {url}\n(timeout / нет ответа)")


_last_token_check = 0.0


def watchdog_loop():
    global _last_token_check
    while True:
        try:
            check()
        except Exception:
            pass
        if time.time() - _last_token_check > 86400:
            try:
                _check_token_reminder()
            except Exception:
                pass
            _last_token_check = time.time()
        time.sleep(INTERVAL)


# ── Polling ───────────────────────────────────────────────────────────────────

def get_logs():
    lines = []
    for name in CONTAINERS:
        r = subprocess.run(['docker', 'logs', '--tail', '5', name],
                           capture_output=True, text=True)
        out = (r.stdout + r.stderr).strip()
        if out:
            lines.append(f"*{name}:*\n```\n{out[-300:]}\n```")
    return '\n\n'.join(lines) or 'Логи пусты.'


def handle(upd):
    cb = upd.get('callback_query')
    mid_cb = None
    if cb:
        cid    = cb.get('message', {}).get('chat', {}).get('id')
        mid_cb = cb.get('message', {}).get('message_id')
        text   = cb.get('data', '').strip()
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

    if text == 'status_refresh' and mid_cb:
        try:
            edit(cid, mid_cb, status_text(), inline=STATUS_KEYBOARD, parse_mode='Markdown')
        except Exception:
            pass
        return
    elif text == 'status_logs' and mid_cb:
        send(get_logs(), cid)
        return
    elif text == 'status_prune' and mid_cb:
        r = subprocess.run(['docker', 'system', 'prune', '-f'],
                           capture_output=True, text=True)
        freed = next((l for l in r.stdout.splitlines() if 'reclaimed' in l.lower()), 'готово')
        send(f"🗑 Очистка завершена\n{freed}", cid)
        return
    if text == 'token_reset_timer' and mid_cb:
        state = _load_state()
        state['last_token_reminder'] = datetime.now().isoformat()
        _save_state(state)
        edit(cid, mid_cb, _tokens_text(), inline=TOKEN_KEYBOARD)
        return

    if text in ('/start', '/help'):
        send("*GeoCore Bot*\n\n📊 Статус — метрики VPS и статус контейнеров\n💾 Бэкап — запустить бэкап вручную\n🔑 Токены — ротация и напоминания", cid, keyboard=True)
    elif text in ('/status', '📊 Статус'):
        try:
            send(status_text(), cid, inline=STATUS_KEYBOARD)
        except Exception as e:
            send(f"Ошибка: {e}", cid)
    elif text in ('/backup', '💾 Бэкап'):
        mid = send("⏳ *Бэкап запущен*\n\n`[ ]` Дамп БД\n`[ ]` Архив moodledata\n`[ ]` Загрузка в S3\n`[ ]` Ротация", cid)

        def run_backup(cid, mid):
            backup_running.set()
            done = {'db': '`[ ]`', 'arch': '`[ ]`', 's3': '`[ ]`', 'rot': '`[ ]`'}
            db_size = moodle_size = ''

            S = {'db': '⬜', 'arch': '⬜', 's3': '⬜', 'rot': '⬜'}

            def render(current=''):
                icons = {'⬜': '⬜', '▶': '▶️', '✅': '✅'}
                rows = [('db', 'Дамп БД'), ('arch', 'Архив moodledata'),
                        ('s3', 'Загрузка в S3'), ('rot', 'Ротация')]
                lines = ['⏳ <b>Бэкап в процессе</b>\n']
                for key, label in rows:
                    lines.append(f"{S[key]} {label}")
                if db_size:
                    lines.append(f"\nDB: <code>{db_size}</code>  data: <code>{moodle_size or '…'}</code>")
                if current:
                    lines.append(f"\n<i>{current}</i>")
                return '\n'.join(lines)

            output_lines = []
            proc = subprocess.Popen(
                ['docker', 'exec', 'geocore_backup', '/scripts/backup.sh'],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            for line in proc.stdout:
                line = line.strip()
                output_lines.append(line)
                if 'Дамп MariaDB' in line:
                    S['db'] = '▶'; edit(cid, mid, render('Создание дампа БД…'))
                elif 'БД:' in line:
                    db_size = line.split('БД:')[-1].strip()
                    S['db'] = '✅'; S['arch'] = '▶'
                    edit(cid, mid, render('Архивирование moodledata…'))
                elif 'moodledata:' in line:
                    moodle_size = line.split('moodledata:')[-1].strip()
                    S['arch'] = '✅'; S['s3'] = '▶'
                    edit(cid, mid, render('Загрузка в S3…'))
                elif 'Ротация' in line and S['rot'] == '⬜':
                    S['s3'] = '✅'; S['rot'] = '▶'
                    edit(cid, mid, render('Ротация старых бэкапов…'))
                elif 'Бэкап завершён' in line:
                    S['rot'] = '✅'
            proc.wait()
            backup_running.clear()
            if proc.returncode == 0:
                edit(cid, mid, f"✅ <b>Бэкап завершён</b>\n\n✅ Дамп БД — <code>{db_size}</code>\n✅ moodledata — <code>{moodle_size}</code>\n✅ Ротация")
            else:
                err = '\n'.join(output_lines[-10:])[-400:]
                edit(cid, mid, f"❌ <b>Бэкап завершился с ошибкой</b>\n\nDB: <code>{db_size}</code>\n\n<code>{err}</code>")

        threading.Thread(target=run_backup, args=(cid, mid), daemon=True).start()
    elif text in ('/backup_info', '📋 История бэкапов'):
        try:
            send(backup_history_text(), cid)
        except Exception as e:
            send(f"Ошибка: {e}", cid)
    elif text in ('/tokens', '🔑 Токены'):
        send(_tokens_text(), cid, inline=TOKEN_KEYBOARD)


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
    send("🟢 *GeoCore Bot запущен*", keyboard=True)
    threading.Thread(target=watchdog_loop, daemon=True).start()
    poll()
