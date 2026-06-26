const _API   = 'https://api.geocore-academy.ru';
const _TG    = 'https://t.me/geocore_academy';
const _EMAIL = 'info@geocore-academy.ru';

const _history = [];

function _contactButtons(q) {
  const body = encodeURIComponent(`Здравствуйте!\n\nМой вопрос: ${q}`);
  const subj = encodeURIComponent('Вопрос эксперту GeoCore');
  return (
    `<span class="chat-cta">Наш эксперт ответит вам лично. Выберите удобный способ:</span>` +
    `<a class="chat-btn tg" href="${_TG}" target="_blank" rel="noopener">Telegram</a>` +
    `<a class="chat-btn em" href="mailto:${_EMAIL}?subject=${subj}&body=${body}">Email</a>`
  );
}

const _KW = [
  [/вариограмм|variogram/, 'Вариограмма описывает пространственную корреляцию геологических данных. Подробнее — в курсе «Геостатистика».'],
  [/jorc/,                 'JORC Code требует классификации ресурсов на Measured, Indicated, Inferred по уровню геологической уверенности.'],
  [/гкз/,                  'ГКЗ использует категории A, B, C1, C2. Подробнее — в курсе «Комплексный кейс Тренажёра».'],
  [/datamine|датамайн/,    'Datamine Studio RM — ведущее ПО для блочного моделирования месторождений.'],
  [/кригин|kriging/,       'Ordinary Kriging (OK) — метод интерполяции BLUE, учитывающий пространственную корреляцию через вариограмму.'],
  [/leapfrog|лифрог/,      'Leapfrog — ПО для быстрого 3D-геологического моделирования. Есть курс «Leapfrog Viewer для руководителей».'],
];

function _localFallback(q) {
  const lower = q.toLowerCase();
  for (const [re, hint] of _KW) {
    if (re.test(lower)) return `${hint}<br><br>${_contactButtons(q)}`;
  }
  return _contactButtons(q);
}

export async function fetchBotReply(q) {
  try {
    const r = await fetch(`${_API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, history: _history.slice(-6) }),
    });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    const reply = data.reply;
    _history.push({ role: 'user', content: q });
    _history.push({ role: 'assistant', content: reply });
    return reply;
  } catch {
    return _localFallback(q);
  }
}
