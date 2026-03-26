import { getCurrentHoles, setCurrentBlocks } from '../data/templates.js';
import { visualizeBlocks } from './visualization.js';
import { updateUI } from '../ui/stats.js';
import { getParam } from '../utils/helpers.js';

function interpolateBlocks(holes, blockSize, method, cutoff) {
  console.log(`[MODEL] Начало интерполяции: метод=${method}, блок=${blockSize}м, cutoff=${cutoff}`);
  const blocks = [], range = 50;
  const steps = Math.floor(range * 2 / blockSize);
  
  for (let ix = 0; ix <= steps; ix++) {
    for (let iz = 0; iz <= steps; iz++) {
      for (let iy = 0; iy <= 8; iy++) {
        const bx = -range + ix * blockSize;
        const bz = -range + iz * blockSize;
        const by = -5 - iy * blockSize;
        let grade = 0, wSum = 0;
        
        holes.forEach(h => {
          h.intervals.forEach(([from, to, val]) => {
            const yd = -(from + to) / 2 * 0.5;
            const d = Math.hypot(bx - h.x, bz - h.z, by - yd);
            
            if (method === 'nn') {
              if (d < 0.5) grade = val;
            } else if (method === 'idw') {
              const w = 1 / Math.max(0.1, d) ** 2;
              wSum += w;
              grade += val * w;
            } else {
              const rangeV = 25, sill = 2, nug = 0.2;
              const gamma = d >= rangeV ? sill + nug : nug + sill * (1.5 * d / rangeV - 0.5 * (d / rangeV) ** 3);
              const w = 1 / (gamma + 0.01);
              wSum += w;
              grade += val * w;
            }
          });
        });
        
        if (method !== 'nn' && wSum > 0) grade /= wSum;
        if (grade > cutoff * 0.2) blocks.push({ x: bx, y: by, z: bz, grade });
      }
    }
  }
  
  console.log(`[MODEL] Интерполяция завершена: ${blocks.length} блоков`);
  return blocks;
}

function classifyJORC(blocks, holes) {
  console.log('[MODEL] Начало классификации');
  const classified = blocks.map(b => {
    let minDist = Infinity, holeCount = 0;
    holes.forEach(h => {
      h.intervals.forEach(([from, to]) => {
        const d = Math.hypot(b.x - h.x, b.z - h.z, b.y - -(from + to) / 2 * 0.5);
        if (d < minDist) minDist = d;
        if (d < 30) holeCount++;
      });
    });
    
    const cat = minDist < 15 && holeCount >= 3 ? 'Measured'
              : minDist < 25 && holeCount >= 2 ? 'Indicated'
              : minDist < 40 && holeCount >= 1 ? 'Inferred'
              : 'Unclassified';
    return { ...b, category: cat };
  });
  
  console.log('[MODEL] Классификация завершена');
  return classified;
}

export function runModel() {
  console.log("[MODEL] runModel ВЫЗВАНА!");
  const btn = document.getElementById('runBtn');
  if (!btn.classList.contains('ready') && !btn.classList.contains('done')) return;
  
  const blockSize = getParam('blockSize') || 5;
  const method = document.getElementById('methodSel')?.value || 'idw';
  const cutoff = getParam('cutoff') || 1.0;
  const standard = document.getElementById('stdSel')?.value || 'JORC';
  const holes = getCurrentHoles();
  
  console.log(`[MODEL] Запуск с параметрами: блок=${blockSize}, метод=${method}, cutoff=${cutoff}, стандарт=${standard}`);
  
  btn.className = 'run-btn running';
  btn.innerHTML = '<div class="run-progress" id="runProg"></div><span>⚙ Построение блочной модели…</span>';
  
  let pct = 0;
  const ticker = setInterval(() => {
    pct = Math.min(pct + Math.random() * 8, 90);
    const prog = document.getElementById('runProg');
    if (prog) prog.style.width = pct + '%';
  }, 80);
  
  setTimeout(() => {
    clearInterval(ticker);
    const rawBlocks = interpolateBlocks(holes, blockSize, method, cutoff);
    const classified = classifyJORC(rawBlocks, holes);
    setCurrentBlocks(classified);
    visualizeBlocks(classified);
    updateUI(holes, classified, method, cutoff, standard);
    
    btn.className = 'run-btn done';
    btn.innerHTML = `<div class="run-progress" style="width:100%;background:#2a5a2a"></div><span>✓ Модель построена · ${classified.length} блоков · Запустить снова</span>`;
    console.log('[MODEL] Построение завершено');
  }, 1300);
}
