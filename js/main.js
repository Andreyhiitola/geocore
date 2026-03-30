/**
 * GeoCore Academy — main.js
 * Точка входа. Инициализация и обработчики событий.
 */

import { init3D } from './core/threeInit.js';
import { loadTemplate } from './data/templates.js';
import { runModel } from './core/model.js';
import { calculateVariogram, drawVariogram } from './ui/variogram.js';
import { renderProjects, loadProjects, saveProjects } from './ui/projects.js';
import { botReply } from './ui/chat.js';
import { setStatus, getParam, setRunReady } from './utils/helpers.js';
import { copyToClipboard } from './utils/clipboard.js';
import { parseCSV } from './data/csvParser.js';
import { parseOBJ } from './data/objParser.js';
import { visualizeHoles, visualizeOreFromVertices } from './core/visualization.js';
import { getCurrentHoles, setCurrentHoles } from './data/templates.js';
import { updateUI, updateScriptOnly } from './ui/stats.js';

// ─── Глобальные функции для onclick в HTML ───────────────────
window.loadProject = function(i) {
  const p = loadProjects()[i];
  if (!p?.holesData) return;
  setCurrentHoles(p.holesData);
  visualizeHoles(p.holesData);
  updateUI(p.holesData, [], 'idw', 1.0, p.standard);
  setRunReady(true);
  document.getElementById('sandbox')?.scrollIntoView({ behavior: 'smooth' });
};

window.deleteProject = function(i) {
  const p = loadProjects();
  p.splice(i, 1);
  saveProjects(p);
  renderProjects();
};

// ─── Главная функция обработчиков ────────────────────────────
function wireEvents() {
  console.log('[EVENTS] Настройка обработчиков событий');

  // ── Шаблоны ────────────────────────────────────────────────
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      loadTemplate(card.dataset.template);
    });
  });

  // ── Загрузка CSV ───────────────────────────────────────────
  document.getElementById('csvIn')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const holes = parseCSV(ev.target.result);
      if (!holes.length) {
        setStatus('csvStatus', '❌ Ошибка формата', '#E87070');
        return;
      }
      setCurrentHoles(holes);
      visualizeHoles(holes);
      updateUI(holes, [], 'idw', getParam('cutoff'), document.getElementById('stdSel')?.value || 'JORC');
      setRunReady(true);
      setStatus('csvStatus', `✓ Загружено: ${holes.length} скважин`, '#7ee787');
    };
    r.readAsText(f);
  });

  // ── Загрузка OBJ ───────────────────────────────────────────
  document.getElementById('objIn')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const { vertices, faces } = parseOBJ(ev.target.result);
      if (vertices.length && faces.length) {
        visualizeOreFromVertices(vertices, faces, getCurrentHoles());
        setStatus('objStatus', `✓ OBJ: ${vertices.length} вершин, ${faces.length} граней`, '#7ee787');
      } else {
        setStatus('objStatus', '❌ OBJ: нет данных', '#E87070');
      }
    };
    r.readAsText(f);
  });

  // ── Кнопка запуска модели ──────────────────────────────────
  const runBtn = document.getElementById('runBtn');
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      console.log('[EVENTS] Запуск модели');
      runModel();
    });
    console.log('[EVENTS] runBtn подключён');
  } else {
    console.error('[EVENTS] runBtn НЕ НАЙДЕН');
  }

  // ── Копирование скрипта ────────────────────────────────────
  document.getElementById('copyBtn')?.addEventListener('click', function() {
    const script = document.getElementById('scriptOut')?.textContent || '';
    copyToClipboard(script);
    this.textContent = '✓ Скопировано!';
    setTimeout(() => this.textContent = '📋 Копировать скрипт', 2000);
  });

  // ── Экспорт отчёта (CSV + текст) ──────────────────────────
  document.getElementById('exportBtn')?.addEventListener('click', () => {
    const blocks = window.currentBlocks || [];
    if (!blocks.length) { alert('Сначала постройте блочную модель'); return; }

    // CSV блоков
    let csv = 'X,Y,Z,Grade,Category\n';
    blocks.forEach(b => { csv += `${b.x},${b.y},${b.z},${b.grade.toFixed(3)},${b.category}\n`; });
    _download(csv, 'blocks.csv', 'text/csv');

    // Текстовый отчёт
    const stats = document.getElementById('statsOut')?.textContent || '';
    _download(
      `Отчёт GeoCore Academy\nДата: ${new Date().toLocaleString('ru')}\n\n${stats}`,
      'report.txt', 'text/plain'
    );
  });

  // ── Экспорт .blockmodel для Datamine ──────────────────────
  document.getElementById('exportBlockmodelBtn')?.addEventListener('click', () => {
    const blocks = window.currentBlocks || [];
    if (!blocks.length) { alert('Сначала постройте блочную модель'); return; }
    let content = '! GeoCore Academy — Datamine Block Model\n! Format: X Y Z GRADE CATEGORY\n';
    blocks.forEach(b => {
      content += `${b.x} ${b.y} ${b.z} ${b.grade.toFixed(4)} ${b.category}\n`;
    });
    _download(content, 'geocore_model.blockmodel', 'text/plain');
    console.log('[EXPORT] .blockmodel скачан');
  });

  // ── Экспорт .wrl каркаса ───────────────────────────────────
  document.getElementById('exportWireframeBtn')?.addEventListener('click', () => {
    const vertices = window.currentWireframeVertices;
    const facesData = window.currentWireframeFaces;

    if (!vertices?.length) { alert('Каркас не загружен'); return; }

    let wrl = '#VRML V2.0 utf8\n# GeoCore Academy Wireframe\nShape {\n  geometry IndexedFaceSet {\n    coord Coordinate {\n      point [\n';
    vertices.forEach(v => { wrl += `        ${v[0]} ${v[1]} ${v[2]},\n`; });
    wrl += '      ]\n    }\n    coordIndex [\n';
    (facesData || []).forEach(f => { wrl += `      ${f.v[0]} ${f.v[1]} ${f.v[2]} -1,\n`; });
    wrl += '    ]\n  }\n}\n';
    _download(wrl, 'wireframe.wrl', 'model/vrml');
    console.log('[EXPORT] .wrl скачан');
  });

  // ── Сброс к золоту ─────────────────────────────────────────
  document.getElementById('resetDemoBtn')?.addEventListener('click', () => loadTemplate('gold'));

  // ── Сохранение проекта ────────────────────────────────────
  document.getElementById('saveProjectBtn')?.addEventListener('click', () => {
    const holes = getCurrentHoles();
    if (!holes.length) { alert('Нет данных для сохранения'); return; }
    const name = prompt('Название проекта:', `Проект ${new Date().toLocaleDateString('ru')}`);
    if (!name) return;
    let ti = 0, tg = 0;
    holes.forEach(h => { ti += h.intervals.length; h.intervals.forEach(([,, v]) => tg += v); });
    const proj = loadProjects();
    proj.unshift({
      name,
      date: new Date().toLocaleDateString('ru'),
      holes: holes.length,
      avgVal: ti ? (tg / ti).toFixed(2) : '0',
      standard: document.getElementById('stdSel')?.value || 'JORC',
      holesData: holes,
    });
    saveProjects(proj);
    renderProjects();
    alert(`Проект «${name}» сохранён!`);
  });

  // ── Очистка проектов ───────────────────────────────────────
  document.getElementById('clearAll')?.addEventListener('click', () => {
    if (confirm('Удалить все проекты?')) { saveProjects([]); renderProjects(); }
  });

  // ── Вариограмма (инлайн-канвас) ────────────────────────────
  document.getElementById('calcVariogramBtn')?.addEventListener('click', () => {
    const holes = getCurrentHoles();
    if (!holes.length) { alert('Загрузите данные'); return; }
    const vg = calculateVariogram(holes);
    if (!vg) { alert('Недостаточно точек (минимум 10)'); return; }

    const container = document.getElementById('variogramCanvas');
    if (container) container.style.display = 'block';

    // Пробуем большой канвас (модальное окно), если нет — малый
    const targetId = document.getElementById('variogramPlotLarge')
      ? 'variogramPlotLarge'
      : 'variogramPlot';

    const fittedParams = drawVariogram(vg, targetId);

    // Статистика под графиком
    const statsId = targetId === 'variogramPlotLarge'
      ? 'variogramStatsLarge'
      : 'variogramStats';
    const statsDiv = document.getElementById(statsId);
    if (statsDiv && fittedParams) {
      let html = '';
      const colors = { strike: '#E87070', dip: '#7ee787', perp: '#C9A84C' };
      const labels = { strike: 'Простирание', dip: 'Падение', perp: 'Поперечное' };
      for (const [dir, p] of Object.entries(fittedParams)) {
        if (!p) continue;
        html += `<span style="color:${colors[dir]}">${labels[dir]}</span>: ` +
                `Nugget=${p.nugget.toFixed(3)} Sill=${p.sill.toFixed(3)} Range=${p.range.toFixed(1)}м R²=${p.r2.toFixed(3)}<br>`;
      }
      statsDiv.innerHTML = html || 'Параметры не определены';
    }

    // Открыть модальное окно если есть
    const modal = document.getElementById('variogramModal');
    if (modal) modal.style.display = 'flex';
  });

  // ── Модальное окно вариограммы ─────────────────────────────
  document.getElementById('closeVariogramModal')?.addEventListener('click', () => {
    document.getElementById('variogramModal')?.style.setProperty('display', 'none');
  });
  document.getElementById('variogramModal')?.addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });

  // ── Управление видимостью 3D ───────────────────────────────
  let showOreShell = true;
  let showHoles    = true;

  document.getElementById('toggleOreShell')?.addEventListener('click', function() {
    showOreShell = !showOreShell;
    this.classList.toggle('active', showOreShell);
    if (window.oreGrp) window.oreGrp.visible = showOreShell;
    console.log(`[VIS] Каркас ${showOreShell ? 'показан' : 'скрыт'}`);
  });

  document.getElementById('toggleHoles')?.addEventListener('click', function() {
    showHoles = !showHoles;
    this.classList.toggle('active', showHoles);
    if (window.holesGrp) window.holesGrp.visible = showHoles;
    console.log(`[VIS] Скважины ${showHoles ? 'показаны' : 'скрыты'}`);
  });

  // ── Сброс камеры ───────────────────────────────────────────
  document.getElementById('resetCamera')?.addEventListener('click', () => {
    if (window.camera && window.controls) {
      window.camera.position.set(50, 40, 55);
      window.camera.lookAt(0, -8, 0);
      window.controls.target.set(0, -8, 0);
      window.controls.update();
    }
  });

  // ── Автообновление скрипта при смене параметров ────────────
  ['blockSize', 'methodSel', 'cutoff', 'stdSel'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      const holes = getCurrentHoles();
      if (!holes.length) return;
      const method   = document.getElementById('methodSel')?.value || 'idw';
      const cutoff   = getParam('cutoff') || 1.0;
      const standard = document.getElementById('stdSel')?.value || 'JORC';
      updateScriptOnly(holes, method, cutoff, standard);
      // Сбрасываем статус кнопки если модель уже построена
      const btn = document.getElementById('runBtn');
      if (btn?.classList.contains('done')) {
        btn.className = 'run-btn ready';
        btn.innerHTML = '<span id="runBtnText">▶ Запустить построение блочной модели</span>';
      }
    });
  });

  // ── Чат ────────────────────────────────────────────────────
  const chatSend  = document.getElementById('chatSend');
  const chatInput = document.getElementById('chatInput');
  const chatMsgs  = document.getElementById('chatMsgs');

  function addChatMsg(role, text) {
    if (!chatMsgs) return;
    const d = document.createElement('div');
    d.className = `msg ${role}`;
    d.innerHTML = `<div class="msg-b">${text}</div>` +
      `<div class="msg-t">${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</div>`;
    chatMsgs.appendChild(d);
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  chatSend?.addEventListener('click', () => {
    const q = chatInput?.value.trim();
    if (!q) return;
    chatInput.value = '';
    addChatMsg('user', q);
    setTimeout(() => addChatMsg('bot', botReply(q)), 500);
  });
  chatInput?.addEventListener('keypress', e => { if (e.key === 'Enter') chatSend?.click(); });

  // ── Тема ───────────────────────────────────────────────────
  const themeBtn = document.getElementById('themeBtn');
  let dark = !localStorage.getItem('geocoreLight');

  function applyTheme() {
    document.body.classList.toggle('light', !dark);
    if (themeBtn) themeBtn.textContent = dark ? '🌙' : '☀️';
  }
  applyTheme();
  themeBtn?.addEventListener('click', () => {
    dark = !dark;
    localStorage.setItem('geocoreLight', dark ? '' : '1');
    applyTheme();
  });

  // ── Scroll reveal ──────────────────────────────────────────
  const obs = new IntersectionObserver(
    entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('vis'); }),
    { threshold: 0.08 }
  );
  document.querySelectorAll('.rv, .stg').forEach(el => obs.observe(el));

  // ── Плавная навигация ──────────────────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id && id !== '#') {
        e.preventDefault();
        document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // ── Автозагрузка золота при старте ─────────────────────────
  loadTemplate('gold');
  renderProjects();

  console.log('[EVENTS] Все обработчики подключены');
}

// ─── Вспомогательная функция скачивания ──────────────────────
function _download(content, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ─── Запуск ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init3D();
  wireEvents();
});
