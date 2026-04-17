import requests, os
t = os.environ['TELEGRAM_BOT_TOKEN']
r = requests.get(f'https://api.telegram.org/bot{t}/getMe', timeout=5)
print(r.status_code, r.json())
