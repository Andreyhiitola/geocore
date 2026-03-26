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

// Экспортируем глобальные переменные для window (для onclick в HTML)
window.loadProject = function(i) {
  const p = loadProjects()[i];
  if (!p?.holesData) return;
  setCurrentHoles(p.holesData);
  visualizeHoles(p.holesData);
  updateUI(p.holesData, [], "idw", 1.0, p.standard);
  setRunReady(true);
  document.getElementById("sandbox")?.scrollIntoView({ behavior: "smooth" });
};

window.deleteProject = function(i) {
  const p = loadProjects();
  p.splice(i, 1);
  saveProjects(p);
  renderProjects();
};
window.deleteProject = null;

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
     // Экспорт блочной модели для Datamine Viewer
  const exportBlockmodelBtn = document.getElementById('exportBlockmodelBtn');
  if (exportBlockmodelBtn) {
    exportBlockmodelBtn.addEventListener('click', () => {
      if (!currentBlocks || !currentBlocks.length) {
        alert('Сначала постройте блочную модель');
        return;
      }
      
      // Формат .blockmodel для Datamine (текстовый)
      let content = '# Datamine Studio Block Model\n';
      content += '# X Y Z Au_gpt Category\n';
      currentBlocks.forEach(b => {
        content += `${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.z.toFixed(1)} ${b.grade.toFixed(3)} ${b.category || 'Unknown'}\n`;
      });
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blockmodel_${new Date().toISOString().slice(0,19)}.blockmodel`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('[EXPORT] Блочная модель сохранена для Datamine Viewer');
    });
  }

  // Экспорт каркаса рудного тела в формате WRL (VRML для Datamine)
  const exportWireframeBtn = document.getElementById('exportWireframeBtn');
  if (exportWireframeBtn) {
    exportWireframeBtn.addEventListener('click', () => {
      const oreGrpChildren = window.oreGrp?.children;
      if (!oreGrpChildren || !oreGrpChildren.length) {
        alert('Нет загруженного каркаса рудного тела');
        return;
      }
      
      // Ищем каркасную сетку (не оболочку)
      let wireframeMesh = null;
      for (let child of oreGrpChildren) {
        if (child.isMesh && child.material && child.material.wireframe === true) {
          wireframeMesh = child;
          break;
        }
      }
      
      if (!wireframeMesh) {
        alert('Каркас рудного тела не найден');
        return;
      }
      
      // Получаем геометрию и преобразуем в WRL (VRML) формат
      const geometry = wireframeMesh.geometry;
      const positions = geometry.attributes.position.array;
      const indices = geometry.index.array;
      
      let wrl = '#VRML V2.0 utf8\n';
      wrl += '# Экспортировано из GeoCore Academy\n';
      wrl += 'Shape {\n';
      wrl += '  appearance Appearance {\n';
      wrl += '    material Material {\n';
      wrl += '      diffuseColor 0.8 0.65 0.3\n';
      wrl += '      emissiveColor 0.3 0.2 0.1\n';
      wrl += '    }\n';
      wrl += '  }\n';
      wrl += '  geometry IndexedLineSet {\n';
      wrl += '    coord Coordinate {\n';
      wrl += '      point [\n';
      
      // Вершины
      for (let i = 0; i < positions.length; i += 3) {
        wrl += `        ${positions[i].toFixed(2)} ${positions[i+1].toFixed(2)} ${positions[i+2].toFixed(2)},\n`;
      }
      wrl += '      ]\n';
      wrl += '    }\n';
      wrl += '    coordIndex [\n';
      
      // Грани (рёбра)
      for (let i = 0; i < indices.length; i += 3) {
        wrl += `      ${indices[i]}, ${indices[i+1]}, ${indices[i+2]}, -1,\n`;
      }
      wrl += '    ]\n';
      wrl += '  }\n';
      wrl += '}\n';
      
      const blob = new Blob([wrl], { type: 'model/vrml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ore_body_${new Date().toISOString().slice(0,19)}.wrl`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('[EXPORT] Каркас сохранён в формате WRL для Datamine Viewer');
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
  let showGangue = true;
  let showOreShell = true;
  let showHolesVis = true;

  const toggleGangueBtn = document.getElementById('toggleGangue');
  if (toggleGangueBtn) {
    toggleGangueBtn.addEventListener('click', function() {
      showGangue = !showGangue;
      this.classList.toggle('active', showGangue);
      const blocksGrp = window.blocksGrp;
      if (blocksGrp) {
        let gangueCount = 0;
        blocksGrp.children.forEach(child => {
          if (child.isMesh && child.renderOrder === 0) {
            child.visible = showGangue;
            gangueCount++;
          }
        });
        console.log(`[VIS] Пустая порода ${showGangue ? 'показана' : 'скрыта'}, найдено ${gangueCount} блоков породы`);
      }
    });
    console.log('[EVENTS] Кнопка toggleGangue найдена');
  } else {
    console.warn('[EVENTS] Кнопка toggleGangue не найдена');
  }

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

    const focusBtn = document.getElementById('focusOnOreBody');
  if (focusBtn) {
    focusBtn.addEventListener('click', () => {
      const vertices = window.currentWireframeVertices;
      if (!vertices || !vertices.length) {
        alert('Сначала загрузите каркас рудного тела (OBJ файл)');
        return;
      }
      
      // Вычисляем центр и размеры каркаса
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      
      vertices.forEach(v => {
        minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
        minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
        minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
      });
      
      // Масштабируем как в визуализации
      const scale = 1.3;
      const scaleY = 1.4;
      const posY = -8;
      
      const centerX = (minX + maxX) / 2 * scale;
      const centerZ = (minZ + maxZ) / 2 * scale;
      const centerY = (minY + maxY) / 2 * scaleY + posY;
      
      // Вычисляем оптимальное расстояние для камеры
      const sizeX = (maxX - minX) * scale;
      const sizeZ = (maxZ - minZ) * scale;
      const maxSize = Math.max(sizeX, sizeZ, 30);
      const distance = maxSize * 1.2;
      
      const camera = window.camera;
      const controls = window.controls;
      if (camera && controls) {
        // Позиционируем камеру под углом 45°
        camera.position.set(centerX + distance * 0.7, centerY + distance * 0.5, centerZ + distance * 0.7);
        controls.target.set(centerX, centerY, centerZ);
        controls.update();
      }
      console.log(`[VIS] Фокус на рудном теле: центр (${centerX.toFixed(1)}, ${centerY.toFixed(1)}, ${centerZ.toFixed(1)}), дистанция ${distance.toFixed(1)}`);
    });
    console.log('[EVENTS] Кнопка фокуса найдена');
  } else {
    console.warn('[EVENTS] Кнопка фокуса не найдена');
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
