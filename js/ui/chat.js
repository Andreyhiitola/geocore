const CHAT_RESPONSES = [
  q => q.match(/вариограмм|variogram/)            && 'Вариограмма описывает пространственную корреляцию данных. Ключевые параметры: ранг, порог, самородок.',
  q => q.match(/jorc/)                            && 'JORC Code требует классификации ресурсов на Measured, Indicated, Inferred.',
  q => q.match(/гкз/)                             && 'ГКЗ использует категории A, B, C1, C2.',
  q => q.match(/datamine|датамайн/)               && 'Datamine Studio RM — ведущее ПО для блочного моделирования.',
  q => q.match(/кригин|kriging/)                  && 'Ordinary Kriging (OK) — метод BLUE, учитывающий вариограмму.',
  q => q.match(/idw/)                             && 'IDW — простой метод интерполяции, вес обратно пропорционален расстоянию.',
  q => q.match(/блоч|block model/)                && 'Блочная модель — 3D-сетка блоков с атрибутами.',
  () => 'Для получения детальной консультации по вашему проекту — запишитесь к нашему эксперту.'
];

export function botReply(q) {
  const lower = q.toLowerCase();
  for (const fn of CHAT_RESPONSES) {
    const r = fn(lower);
    if (r) return r;
  }
  return CHAT_RESPONSES[CHAT_RESPONSES.length - 1]();
}
