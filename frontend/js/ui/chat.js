const _API = 'https://api.geocore-academy.ru';
const _history = [];

const _FALLBACK_RULES = [
  q => q.match(/вариограмм|variogram/)       && 'Вариограмма описывает пространственную корреляцию геологических данных. Подробнее — в курсе «Геостатистика».',
  q => q.match(/jorc/)                        && 'JORC Code требует классификации ресурсов на Measured, Indicated, Inferred по уровню геологической уверенности.',
  q => q.match(/гкз/)                         && 'ГКЗ использует категории A, B, C1, C2. Подробнее — в курсе «Комплексный кейс Тренажёра».',
  q => q.match(/datamine|датамайн/)           && 'Datamine Studio RM — ведущее ПО для блочного моделирования месторождений.',
  q => q.match(/кригин|kriging/)              && 'Ordinary Kriging (OK) — метод интерполяции BLUE, учитывающий пространственную корреляцию через вариограмму.',
  q => q.match(/leapfrog|лифрог/)             && 'Leapfrog — ПО для быстрого 3D-геологического моделирования. Есть курс «Leapfrog Viewer для руководителей».',
  () => 'Ассистент временно недоступен. Опишите свой вопрос — мы свяжемся с вами через форму консультации.',
];

function _localFallback(q) {
  const lower = q.toLowerCase();
  for (const fn of _FALLBACK_RULES) {
    const r = fn(lower);
    if (r) return r;
  }
  return _FALLBACK_RULES[_FALLBACK_RULES.length - 1]();
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
