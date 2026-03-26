import { getCurrentHoles, setCurrentBlocks } from '../data/templates.js';
import { visualizeBlocks } from './visualization.js';
import { updateUI } from '../ui/stats.js';
import { getParam } from '../utils/helpers.js';

// Определяем область модели по данным скважин
function getModelRange(holes) {
  if (!holes.length) return { 
    xMin: -50, xMax: 50, 
    zMin: -50, zMax: 50, 
    yMin: -45, yMax: -5,
    xSize: 100, zSize: 100, ySize: 40
  };
  
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  holes.forEach(h => {
    minX = Math.min(minX, h.x);
    maxX = Math.max(maxX, h.x);
    minZ = Math.min(minZ, h.z);
    maxZ = Math.max(maxZ, h.z);
    minY = Math.min(minY, -h.depth);
    maxY = Math.max(maxY, 0);
  });
  
  // Добавляем запас 20 метров по краям
  const margin = 20;
  return {
    xMin: minX - margin,
    xMax: maxX + margin,
    zMin: minZ - margin,
    zMax: maxZ + margin,
    yMin: minY - margin,
    yMax: maxY + margin,
    xSize: (maxX - minX) + margin * 2,
    zSize: (maxZ - minZ) + margin * 2,
    ySize: (maxY - minY) + margin * 2
  };
}

function interpolateBlocks(holes, blockSize, method, cutoff) {
  console.log(`[MODEL] Начало интерполяции: метод=${method}, блок=${blockSize}м, cutoff=${cutoff}`);
  
  // Динамическая область модели на основе данных скважин
  const range = getModelRange(holes);
  const stepsX = Math.floor(range.xSize / blockSize);
  const stepsZ = Math.floor(range.zSize / blockSize);
  const stepsY = Math.floor(range.ySize / blockSize);
  
  console.log(`[MODEL] Область модели: X ${range.xMin.toFixed(0)}..${range.xMax.toFixed(0)} (${range.xSize.toFixed(0)} м, шагов: ${stepsX})`);
  console.log(`[MODEL] Область модели: Z ${range.zMin.toFixed(0)}..${range.zMax.toFixed(0)} (${range.zSize.toFixed(0)} м, шагов: ${stepsZ})`);
  console.log(`[MODEL] Область модели: Y ${range.yMin.toFixed(0)}..${range.yMax.toFixed(0)} (${range.ySize.toFixed(0)} м, шагов: ${stepsY})`);
  
  const blocks = [];
  let processed = 0;
  const totalBlocks = (stepsX + 1) * (stepsZ + 1) * (stepsY + 1);
  
  for (let ix = 0; ix <= stepsX; ix++) {
    for (let iz = 0; iz <= stepsZ; iz++) {
      for (let iy = 0; iy <= stepsY; iy++) {
        const bx = range.xMin + ix * blockSize;
        const bz = range.zMin + iz * blockSize;
        const by = range.yMin + iy * blockSize;
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
        
        processed++;
        if (processed % 1000 === 0) {
          console.log(`[MODEL] Прогресс: ${Math.round(processed / totalBlocks * 100)}%`);
        }
      }
    }
  }
  
  console.log(`[MODEL] Интерполяция завершена: ${blocks.length} блоков из ${totalBlocks} возможных`);
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
    window.currentBlocks = classified;
    visualizeBlocks(classified);
    updateUI(holes, classified, method, cutoff, standard);
    
    btn.className = 'run-btn done';
    btn.innerHTML = `<div class="run-progress" style="width:100%;background:#2a5a2a"></div><span>✓ Модель построена · ${classified.length} блоков · Запустить снова</span>`;
    console.log('[MODEL] Построение завершено');
  }, 1300);
}
