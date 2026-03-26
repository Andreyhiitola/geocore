import { setStatus, calculateAverageGrade } from '../utils/helpers.js';
import { parseCSV } from './csvParser.js';
import { parseOBJ } from './objParser.js';
import { updateUI } from '../ui/stats.js';
import { setRunReady } from '../utils/helpers.js';
import { visualizeHoles, visualizeOreFromVertices, drawEllipsoidOreBody, drawCoalSeams, clearOreGrp } from '../core/visualization.js';

export const TEMPLATES = {
  gold: { 
    csv: 'data/gold_demo.csv', 
    obj: 'data/ore_body_gold.obj', 
    standard: 'JORC',  
    label: 'золото (Au)',  
    field: 'Au_gpt',  
    unit: 'г/т',  
    highCutoff: 5 
  },
  copper: { 
    csv: 'data/copper_demo.csv', 
    obj: 'data/ore_body_copper.obj', 
    standard: 'JORC',  
    label: 'медь (Cu)',   
    field: 'Cu_pct',  
    unit: '%',    
    highCutoff: 1 
  },
  coal: { 
    csv: 'data/coal_demo.csv',   
    obj: 'data/ore_body_coal.obj',                
    standard: 'ГКЗ',   
    label: 'уголь',       
    field: 'Coal_m',  
    unit: 'м',    
    highCutoff: 3 
  },
};

export let currentHoles = [];
export let currentBlocks = [];

export function setCurrentHoles(holes) { currentHoles = holes; }
export function setCurrentBlocks(blocks) { currentBlocks = blocks; }
export function getCurrentHoles() { return currentHoles; }
export function getCurrentBlocks() { return currentBlocks; }

export async function loadTemplate(type) {
  const cfg = TEMPLATES[type];
  if (!cfg) return;

  setStatus('csvStatus', '⏳ Загрузка…', 'var(--text-dim)');
  console.log(`[TEMPLATE] Загрузка шаблона: ${type}`);

  try {
    const resp = await fetch(cfg.csv, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${cfg.csv}`);
    const csvText = await resp.text();
    const holes = parseCSV(csvText);
    if (!holes.length) throw new Error('CSV пустой или неверный формат');

    currentHoles = holes;
    visualizeHoles(holes);
    updateUI(holes, [], 'idw', document.getElementById('cutoff')?.value || 1.0, cfg.standard);
    setRunReady(true);
    setStatus('csvStatus', `✓ ${cfg.label} — ${holes.length} скважин, ${holes.reduce((s,h)=>s+h.intervals.length,0)} интервалов`, '#7ee787');

    clearOreGrp();
    
    // Загружаем OBJ каркас
    try {
      const objResp = await fetch(cfg.obj, { cache: 'no-store' });
      if (!objResp.ok) throw new Error(`HTTP ${objResp.status}: ${cfg.obj}`);
      const objText = await objResp.text();
      const { vertices, faces } = parseOBJ(objText);
      if (vertices.length && faces.length) {
        visualizeOreFromVertices(vertices, faces, holes);
        setStatus('objStatus', `✓ Каркас загружен: ${vertices.length} вершин, ${faces.length} граней`, '#7ee787');
      } else {
        throw new Error('OBJ не содержит данных');
      }
    } catch (e) {
      console.warn('[OBJ] Ошибка загрузки, используем эллипсоид:', e);
      const avgGrade = calculateAverageGrade(holes);
      drawEllipsoidOreBody(avgGrade);
      setStatus('objStatus', '⚠ OBJ не найден — использован автоматический каркас', 'var(--gold)');
    }

    document.getElementById('sandbox')?.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error('[TEMPLATE] Ошибка:', err);
    setStatus('csvStatus', `❌ Ошибка загрузки: ${err.message}`, '#E87070');
  }
}
