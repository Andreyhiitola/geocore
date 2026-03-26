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
import { visualizeHoles, visualizeOreFromVertices, drawEllipsoidOreBody, drawCoalSeams, clearOreGrp } from './core/visualization.js';
import { getCurrentHoles, setCurrentHoles, TEMPLATES } from './data/templates.js';
import { updateUI, updateScriptOnly } from './ui/stats.js';

// Глобальные функции для onclick в HTML
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

export function wireEvents() {
  console.log('[EVENTS] Настройка обработчиков событий');
  
  // Шаблоны
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => loadTemplate(card.dataset.template));
  });

  // Загрузка CSV
  const csvIn = document.getElementById('csvIn');
  if (csvIn) {
    csvIn.addEventListener('change', e => {
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
  }

  // Загрузка OBJ
  const objIn = document.getElementById('objIn');
  if (objIn) {
    objIn.addEventListener('change', e => {
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
  }

  // Кнопка запуска модели
  const runBtn = document.getElementById('runBtn');
  if (runBtn) {
    console.log('[EVENTS] runBtn найден, добавляем обработчик');
    runBtn.addEventListener('click', () => {
      console.log('[EVENTS] Кнопка нажата!');
      runModel();
    });
  } else {
    console.error('[EVENTS] runBtn НЕ НАЙДЕН!');
  }

  // Копирование скрипта
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const script = document.getElementById('scriptOut')?.textContent || '';
      copyToClipboard(script);
      copyBtn.textContent = '✓ Скопировано!';
      setTimeout(() => copyBtn.textContent = '📋 Копировать скрипт', 2000);
    });
  }

  // Экспорт отчёта
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const currentBlocks = window.currentBlocks || [];
      if (!currentBlocks.length) {
        alert('Сначала постройте блочную модель');
        return;
      }
      let csv = 'X,Y,Z,Grade,Category\n';
      currentBlocks.forEach(b => { csv += `${b.x},${b.y},${b.z},${b.grade.toFixed(3)},${b.category}\n`; });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'blocks.csv';
      a.click();
      const stats = document.getElementById('statsOut')?.textContent || '';
      const b = document.createElement('a');
      b.href = URL.createObjectURL(new Blob([`Отчёт GeoCore\nДата: ${new Date().toLocaleString('ru')}\n\n${stats}`], { type: 'text/plain' }));
      b.download = 'report.txt';
      b.click();
    });
  }

  // Сброс к золоту
  const resetBtn = document.getElementById('resetDemoBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => loadTemplate('gold'));

  // Сохранение проекта
  const saveBtn = document.getElementById('saveProjectBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const holes = getCurrentHoles();
      if (!holes.length) { alert('Нет данных для сохранения'); return; }
      const name = prompt('Название проекта:', `Проект ${new Date().toLocaleDateString('ru')}`);
      if (!name) return;
      let ti = 0, tg = 0;
      holes.forEach(h => { ti += h.intervals.length; h.intervals.forEach(([,, v]) => tg += v); });
      const avg = ti ? (tg / ti).toFixed(2) : '0';
      const proj = loadProjects();
      proj.unshift({ name, date: new Date().toLocaleDateString('ru'), holes: holes.length, avgVal: avg, standard: document.getElementById('stdSel')?.value || 'JORC', holesData: holes });
      saveProjects(proj);
      renderProjects();
      alert(`Проект «${name}» сохранён!`);
    });
  }

  // Очистка проектов
  const clearAll = document.getElementById('clearAll');
  if (clearAll) {
    clearAll.addEventListener('click', () => {
      if (confirm('Удалить все проекты?')) { saveProjects([]); renderProjects(); }
    });
  }

  // Вариограмма
  const varioBtn = document.getElementById('calcVariogramBtn');
  if (varioBtn) {
    varioBtn.addEventListener('click', () => {
      const holes = getCurrentHoles();
      if (!holes.length) { alert('Загрузите данные'); return; }
      const vg = calculateVariogram(holes);
      if (!vg) { alert('Недостаточно точек (минимум 10)'); return; }
      const container = document.getElementById('variogramCanvas');
      if (container) container.style.display = 'block';
      drawVariogram(vg);
      const statsDiv = document.getElementById('variogramStats');
      if (statsDiv) statsDiv.textContent = 'Экспериментальная вариограмма построена.';
    });
  }

  // ── Toggle visibility buttons ──────────────────────────────
  let showOreShell = true;
  let showHolesVis = true;

  const toggleOreShellBtn = document.getElementById('toggleOreShell');
  if (toggleOreShellBtn) {
    toggleOreShellBtn.addEventListener('click', function() {
      showOreShell = !showOreShell;
      this.classList.toggle('active', showOreShell);
      const oreGrp = window.oreGrp;
      if (oreGrp) oreGrp.visible = showOreShell;
      console.log(`[VIS] Оболочка руды ${showOreShell ? 'показана' : 'скрыта'}`);
    });
    console.log('[EVENTS] Кнопка toggleOreShell найдена');
  } else {
    console.warn('[EVENTS] Кнопка toggleOreShell не найдена');
  }

  const toggleHolesBtn = document.getElementById('toggleHoles');
  if (toggleHolesBtn) {
    toggleHolesBtn.addEventListener('click', function() {
      showHolesVis = !showHolesVis;
      this.classList.toggle('active', showHolesVis);
      const holesGrp = window.holesGrp;
      if (holesGrp) holesGrp.visible = showHolesVis;
      console.log(`[VIS] Скважины ${showHolesVis ? 'показаны' : 'скрыты'}`);
    });
    console.log('[EVENTS] Кнопка toggleHoles найдена');
  } else {
    console.warn('[EVENTS] Кнопка toggleHoles не найдена');
  }

  // Автоматическое обновление алгоритма при изменении параметров
  const paramFields = ['blockSize', 'methodSel', 'cutoff', 'stdSel'];
  paramFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const holes = getCurrentHoles();
        if (holes.length > 0) {
          const method = document.getElementById('methodSel')?.value || 'idw';
          const cutoff = getParam('cutoff') || 1.0;
          const standard = document.getElementById('stdSel')?.value || 'JORC';
          updateScriptOnly(holes, method, cutoff, standard);
          
          const btn = document.getElementById('runBtn');
          if (btn && btn.classList.contains('done')) {
            btn.classList.remove('done');
            btn.classList.add('ready');
            btn.innerHTML = '<span>▶ Запустить построение блочной модели</span>';
          }
        }
      });
    }
  });

  // Чат
  const chatSend = document.getElementById('chatSend');
  const chatInput = document.getElementById('chatInput');
  const chatMsgs = document.getElementById('chatMsgs');
  function addMsg(role, text) {
    const d = document.createElement('div'); d.className = `msg ${role}`;
    d.innerHTML = `<div class="msg-b">${text}</div><div class="msg-t">${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</div>`;
    if (chatMsgs) { chatMsgs.appendChild(d); chatMsgs.scrollTop = chatMsgs.scrollHeight; }
  }
  if (chatSend && chatInput) {
    chatSend.addEventListener('click', () => {
      const q = chatInput.value.trim();
      if (!q) return;
      chatInput.value = '';
      addMsg('user', q);
      setTimeout(() => addMsg('bot', botReply(q)), 500);
    });
    chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') chatSend.click(); });
  }

  // Тема
  const themeBtn = document.getElementById('themeBtn');
  let dark = !localStorage.getItem('geocoreLight');
  function applyTheme() {
    document.body.classList.toggle('light', !dark);
    if (themeBtn) themeBtn.textContent = dark ? '🌙' : '☀️';
  }
  applyTheme();
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      dark = !dark;
      localStorage.setItem('geocoreLight', dark ? '' : '1');
      applyTheme();
    });
  }

  // Скролл-ревел
  const obs = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('vis'); }), { threshold: 0.08 });
  document.querySelectorAll('.rv,.stg').forEach(el => obs.observe(el));

  // Плавная навигация
  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id && id !== '#') { e.preventDefault(); document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' }); }
  }));

  // Автозагрузка золота
  loadTemplate('gold');
  renderProjects();
}

// Запуск после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
  init3D();
  wireEvents();
});
