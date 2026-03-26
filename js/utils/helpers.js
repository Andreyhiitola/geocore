// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

export function setStatus(id, text, color) {
  const el = document.getElementById(id);
  if (el) { 
    el.textContent = text; 
    el.style.color = color; 
    console.log(`[STATUS] ${id}: ${text}`);
  }
}

export function getParam(id) {
  return +(document.getElementById(id)?.value) || 0;
}

export function setRunReady(yes) {
  const btn = document.getElementById('runBtn');
  const txt = document.getElementById('runBtnText');
  if (!btn) return;
  if (yes) {
    btn.className = 'run-btn ready';
    btn.disabled = false;  // ← Убираем disabled
    if (txt) txt.textContent = '▶ Запустить построение блочной модели';
    console.log('[BUTTON] Готов к запуску');
  } else {
    btn.className = 'run-btn';
    btn.disabled = true;   // ← Добавляем disabled
    if (txt) txt.textContent = '▶ Загрузите CSV для запуска';
    console.log('[BUTTON] Ожидание данных');
  }
}
export function clearGroup(g) {
  if (!g) return;
  while (g.children.length) g.remove(g.children[0]);
}

export function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function calculateAverageGrade(holes) {
  if (!holes || holes.length === 0) return 3.0;
  let total = 0, count = 0;
  holes.forEach(h => {
    h.intervals.forEach(([,,v]) => {
      total += v;
      count++;
    });
  });
  return count > 0 ? total / count : 3.0;
}
