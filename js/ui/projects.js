import { getCurrentHoles, setCurrentHoles, getCurrentBlocks, TEMPLATES } from '../data/templates.js';
import { visualizeHoles } from '../core/visualization.js';
import { updateUI } from './stats.js';
import { setRunReady } from '../utils/helpers.js';

export function loadProjects() { 
  return JSON.parse(localStorage.getItem('geoProjects') || '[]'); 
}

export function saveProjects(p) { 
  localStorage.setItem('geoProjects', JSON.stringify(p)); 
}

export function renderProjects() {
  const grid = document.getElementById('projGrid');
  if (!grid) return;
  const proj = loadProjects();
  if (!proj.length) {
    grid.innerHTML = '<div class="no-proj">Нет сохранённых проектов.<br>Загрузите данные и нажмите «Сохранить проект».</div>';
    return;
  }
  grid.innerHTML = proj.map((p, i) => `
    <div class="proj-card" onclick="window.loadProject(${i})">
      <button class="proj-del" onclick="event.stopPropagation();window.deleteProject(${i})">✕</button>
      <div class="proj-name">${p.name}</div>
      <div class="proj-meta">${p.date} · ${p.holes} скв · ср. ${p.avgVal}</div>
      <div class="proj-tag">${p.standard}</div>
    </div>`).join('');
}

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
