// ============================================================
//  GeoCore Academy — script.js
//  Версия: 3.1 (фикс обрезания)
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

// ========== 1. КОНФИГУРАЦИЯ ==========
const TEMPLATES = {
  gold: { 
    csv: 'data/gold_demo.csv', 
    obj: 'data/ore_body.obj', 
    standard: 'JORC',  
    label: 'золото (Au)',  
    field: 'Au_gpt',  
    unit: 'г/т',  
    highCutoff: 5 
  },
  copper: { 
    csv: 'data/copper_demo.csv', 
    obj: 'data/ore_body.obj', 
    standard: 'JORC',  
    label: 'медь (Cu)',   
    field: 'Cu_pct',  
    unit: '%',    
    highCutoff: 1 
  },
  coal: { 
    csv: 'data/coal_demo.csv',   
    obj: null,                
    standard: 'ГКЗ',   
    label: 'уголь',       
    field: 'Coal_m',  
    unit: 'м',    
    highCutoff: 3 
  },
};

// ========== 2. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let scene, camera, renderer, controls;
let holesGrp, blocksGrp, oreGrp;
let currentHoles = [];
let currentBlocks = [];

// ========== 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function setStatus(id, text, color) {
  const el = document.getElementById(id);
  if (el) { 
    el.textContent = text; 
    el.style.color = color; 
    console.log(`[STATUS] ${id}: ${text}`);
  }
}

function getParam(id) {
  return +(document.getElementById(id)?.value) || 0;
}

function setRunReady(yes) {
  const btn = document.getElementById('runBtn');
  const txt = document.getElementById('runBtnText');
  if (!btn) return;
  if (yes) {
    btn.className = 'run-btn ready';
    if (txt) txt.textContent = '▶ Запустить построение блочной модели';
    console.log('[BUTTON] Готов к запуску');
  } else {
    btn.className = 'run-btn';
    if (txt) txt.textContent = '▶ Загрузите CSV для запуска';
    console.log('[BUTTON] Ожидание данных');
  }
}

function clearGroup(g) {
  if (!g) return;
  while (g.children.length) g.remove(g.children[0]);
}

function copyToClipboard(text) {
  console.log('[COPY] Попытка скопировать текст, длина:', text.length);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('[COPY] Успешно через Clipboard API');
    }).catch(err => {
      console.warn('[COPY] Clipboard API failed:', err);
      fallbackCopy(text);
    });
  } else {
    console.log('[COPY] Clipboard API не доступен, используем fallback');
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    console.log('[COPY] Успешно через execCommand');
    alert('Скрипт скопирован в буфер обмена');
  } catch (err) {
    console.error('[COPY] Fallback failed:', err);
    alert('Не удалось скопировать текст. Выделите его вручную.');
  }
  document.body.removeChild(textarea);
}

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ========== 4. ПАРСИНГ CSV ==========
function parseCSV(text) {
  console.log('[CSV] Начало парсинга, длина текста:', text.length);
  const lines = text.split('\n');
  const map = new Map();
  const header = lines[0]?.toLowerCase() || '';
  const hasHeader = isNaN(+header.split(',')[1]);
  const rng = mulberry32(42);

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 4) continue;
    
    const id = parts[0].trim();
    const from = +parts[1];
    const to = +parts[2];
    const val = +parts[3];
    
    if (isNaN(from) || isNaN(to) || isNaN(val)) continue;

    if (!map.has(id)) {
      map.set(id, {
        id,
        x: (rng() - 0.5) * 40,
        z: (rng() - 0.5) * 40,
        depth: 0,
        intervals: []
      });
    }
    const h = map.get(id);
    h.intervals.push([from, to, val]);
    if (to > h.depth) h.depth = to;
  }
  
  const holes = Array.from(map.values());
  console.log(`[CSV] Парсинг завершён: ${holes.length} скважин, интервалов: ${holes.reduce((s,h)=>s+h.intervals.length,0)}`);
  return holes;
}

// ========== 5. ПАРСИНГ OBJ ==========
function parseOBJ(text) {
  console.log('[OBJ] Начало парсинга');
  const vertices = [], faces = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/).map(Number);
      vertices.push([x, y, z]);
    } else if (line.startsWith('f ')) {
      const parts = line.slice(2).split(/\s+/);
      const idx = parts.map(p => parseInt(p.split('/')[0]) - 1).filter(n => !isNaN(n));
      if (idx.length >= 3) {
        for (let i = 0; i < idx.length - 2; i++) {
          faces.push({ v: [idx[0], idx[i + 1], idx[i + 2]] });
        }
      }
    }
  }
  console.log(`[OBJ] Парсинг завершён: ${vertices.length} вершин, ${faces.length} граней`);
  return { vertices, faces };
}

// ========== 6. РАСЧЁТ СРЕДНЕГО СОДЕРЖАНИЯ ==========
function calculateAverageGrade(holes) {
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

// ========== 7. ЦВЕТНАЯ ВИЗУАЛИЗАЦИЯ РУДНОГО ТЕЛА ==========
function getColorByGrade(grade) {
  if (grade > 6) return 0xff5522;
  if (grade > 3) return 0xffaa66;
  return 0x6a9aca;
}

function visualizeOreFromVertices(vertices, faces, holes = null) {
  clearGroup(oreGrp);
  if (!vertices.length || !faces.length) return;
  
  const avgGrade = holes ? calculateAverageGrade(holes) : 3.0;
  const color = getColorByGrade(avgGrade);
  
  console.log(`[OBJ] Визуализация каркаса, среднее содержание: ${avgGrade.toFixed(2)}, цвет: ${color.toString(16)}`);
  
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vertices.flat());
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(faces.flatMap(f => f.v));
  geometry.computeVertexNormals();

  const shellMaterial = new THREE.MeshPhongMaterial({ 
    color: color,
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.25,
    emissive: avgGrade > 5 ? 0x331100 : 0x000000
  });
  const shell = new THREE.Mesh(geometry, shellMaterial);
  shell.scale.set(1.3, 1.4, 1.3);
  shell.position.y = -8;
  oreGrp.add(shell);

  const wireframeMat = new THREE.MeshBasicMaterial({ 
    color: 0xc9a84c, 
    wireframe: true, 
    transparent: true, 
    opacity: 0.45 
  });
  const wireframe = new THREE.Mesh(geometry, wireframeMat);
  wireframe.scale.copy(shell.scale);
  wireframe.position.copy(shell.position);
  oreGrp.add(wireframe);
}

function drawEllipsoidOreBody(avgGrade = 3.0) {
  clearGroup(oreGrp);
  const color = getColorByGrade(avgGrade);
  
  const geo = new THREE.SphereGeometry(1, 48, 48);
  const shell = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ 
    color: color, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.25,
    emissive: avgGrade > 5 ? 0x331100 : 0x000000
  }));
  shell.scale.set(22, 18, 22);
  shell.position.y = -8;
  oreGrp.add(shell);
  
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ 
    color: 0xc9a84c, 
    wireframe: true, 
    transparent: true, 
    opacity: 0.45 
  }));
  wire.scale.copy(shell.scale);
  wire.position.copy(shell.position);
  oreGrp.add(wire);
}

function drawCoalSeams() {
  clearGroup(oreGrp);
  
  const upperMat = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  const upperSeam = new THREE.Mesh(new THREE.PlaneGeometry(55, 55), upperMat);
  upperSeam.rotation.x = -Math.PI / 2;
  upperSeam.position.y = -12.5;
  oreGrp.add(upperSeam);
  
  const lowerMat = new THREE.MeshPhongMaterial({ color: 0x3a3a3a, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  const lowerSeam = new THREE.Mesh(new THREE.PlaneGeometry(55, 55), lowerMat);
  lowerSeam.rotation.x = -Math.PI / 2;
  lowerSeam.position.y = -19;
  oreGrp.add(lowerSeam);
  
  const edgesGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(55, 55));
  const edgesMat = new THREE.LineBasicMaterial({ color: 0xc9a84c });
  
  const upperWire = new THREE.LineSegments(edgesGeo, edgesMat);
  upperWire.rotation.x = -Math.PI / 2;
  upperWire.position.y = -12.5;
  oreGrp.add(upperWire);
  
  const lowerWire = new THREE.LineSegments(edgesGeo, edgesMat);
  lowerWire.rotation.x = -Math.PI / 2;
  lowerWire.position.y = -19;
  oreGrp.add(lowerWire);
}

// ========== 8. ЗАГРУЗКА ШАБЛОНОВ ==========
async function loadTemplate(type) {
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
    updateUI(holes, [], 'idw', getParam('cutoff'), cfg.standard);
    setRunReady(true);
    setStatus('csvStatus', `✓ ${cfg.label} — ${holes.length} скважин, ${holes.reduce((s,h)=>s+h.intervals.length,0)} интервалов`, '#7ee787');

    clearGroup(oreGrp);
    if (cfg.obj) {
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
    } else {
      drawCoalSeams();
      setStatus('objStatus', '✓ Угольные пласты отрисованы', '#7ee787');
    }

    document.getElementById('sandbox')?.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error('[TEMPLATE] Ошибка:', err);
    setStatus('csvStatus', `❌ Ошибка загрузки: ${err.message}`, '#E87070');
  }
}

// ========== 9. 3D-ВИЗУАЛИЗАЦИЯ ==========
export function init3D() {
  console.log('[3D] Инициализация сцены');
  const canvas = document.getElementById('c3d');
  if (!canvas) {
    console.error('[3D] Canvas #c3d не найден');
    return;
  }
  const W = canvas.parentElement.clientWidth, H = 520;
  canvas.width = W; canvas.height = H;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a121c);
  scene.fog = new THREE.FogExp2(0x0a121c, 0.004);

  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 600);
  camera.position.set(50, 40, 55);
  camera.lookAt(0, -8, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  scene.add(new THREE.AmbientLight(0x304050, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(15, 25, 8);
  scene.add(dirLight);
  const pointLight = new THREE.PointLight(0x4466cc, 0.4);
  pointLight.position.set(-8, 12, -14);
  scene.add(pointLight);
  scene.add(new THREE.GridHelper(80, 20, 0x88aaff, 0x224466));

  holesGrp = new THREE.Group();
  blocksGrp = new THREE.Group();
  oreGrp = new THREE.Group();
  scene.add(holesGrp, blocksGrp, oreGrp);

  (function anim() {
    requestAnimationFrame(anim);
    controls.update();
    renderer.render(scene, camera);
  })();

  window.addEventListener('resize', () => {
    const w = canvas.parentElement.clientWidth;
    camera.aspect = w / H;
    camera.updateProjectionMatrix();
    renderer.setSize(w, H);
  });
  
  console.log('[3D] Инициализация завершена');
}

function visualizeHoles(holes) {
  clearGroup(holesGrp);
  const COLORS = [0x3a6ea5, 0x4a7eb5, 0x5a8ec5, 0x6a9ed5];
  
  holes.forEach((h, i) => {
    const points = [];
    for (let y = 0; y <= h.depth; y += 2) {
      points.push(new THREE.Vector3(h.x, -y * 0.5, h.z));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: COLORS[i % 4] });
    const line = new THREE.Line(geometry, material);
    holesGrp.add(line);
    
    h.intervals.forEach(([from, to, val]) => {
      if (val > 5) {
        const sphereGeo = new THREE.SphereGeometry(0.5, 8, 8);
        const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0x331100 });
        const marker = new THREE.Mesh(sphereGeo, sphereMat);
        marker.position.set(h.x, -(from + to) / 2 * 0.5, h.z);
        holesGrp.add(marker);
      }
    });
  });
  
  console.log(`[3D] Визуализировано скважин: ${holes.length}`);
}

function visualizeBlocks(blocks) {
  clearGroup(blocksGrp);
  if (!blocks.length) return;
  
  const geo = new THREE.BoxGeometry(4.4, 4.4, 4.4);
  blocks.forEach(b => {
    let color;
    if (b.grade > 6) color = 0xff5522;
    else if (b.grade > 3) color = 0xffaa66;
    else if (b.grade > 1) color = 0x6a9aca;
    else color = 0x2a5a8a;
    
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85 });
    const box = new THREE.Mesh(geo, mat);
    box.position.set(b.x, b.y, b.z);
    blocksGrp.add(box);
    
    if (b.category) {
      const edgeColor = b.category === 'Measured' ? 0x7ee787 : 
                        b.category === 'Indicated' ? 0xffaa66 : 0xff8844;
      const edgesGeo = new THREE.EdgesGeometry(geo);
      const edgesMat = new THREE.LineBasicMaterial({ color: edgeColor });
      const wire = new THREE.LineSegments(edgesGeo, edgesMat);
      wire.position.copy(box.position);
      blocksGrp.add(wire);
    }
  });
  
  console.log(`[3D] Визуализировано блоков: ${blocks.length}`);
}

// ========== 10. БЛОЧНАЯ МОДЕЛЬ И ИНТЕРПОЛЯЦИЯ ==========
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

function updateUI(holes, blocks, method, cutoff, standard) {
  console.log('[UI] Обновление статистики');
  let ti = 0, tg = 0, hi = 0;
  const cfg = Object.values(TEMPLATES).find(c => c.standard === standard) || TEMPLATES.gold;
  
  holes.forEach(h => {
    ti += h.intervals.length;
    h.intervals.forEach(([,, v]) => { tg += v; if (v > cfg.highCutoff) hi++; });
  });
  const avgRaw = ti ? tg / ti : 0;

  let catLines = '';
  if (blocks.length) {
    const vol = 125, density = 2.7;
    const cats = { Measured: { t: 0, m: 0 }, Indicated: { t: 0, m: 0 }, Inferred: { t: 0, m: 0 } };
    blocks.forEach(b => {
      if (b.grade >= cutoff && cats[b.category]) {
        const ton = vol * density / 1e6;
        cats[b.category].t += ton;
        cats[b.category].m += ton * b.grade * 1e6 / 31.1035 / 1e3;
      }
    });
    const totalT = blocks.filter(b => b.grade >= cutoff).length * vol * density / 1e6;
    const avgG = blocks.filter(b => b.grade >= cutoff).reduce((s, b) => s + b.grade, 0) / (blocks.filter(b => b.grade >= cutoff).length || 1);
    const totalM = totalT * avgG * 1e6 / 31.1035 / 1e3;
    catLines = `
── ОЦЕНКА РЕСУРСОВ (${standard}) ──
Метод: ${method.toUpperCase()} | Блок: 5м | Cutoff: ${cutoff} ${cfg.unit}
Тоннаж (≥cutoff): ${totalT.toFixed(2)} Mt
Среднее (модель): ${avgG.toFixed(2)} ${cfg.unit}
Металл / объём: ${totalM.toFixed(0)} koz
Блоков: ${blocks.length}
Measured:  ${cats.Measured.t.toFixed(2)} Mt
Indicated: ${cats.Indicated.t.toFixed(2)} Mt
Inferred:  ${cats.Inferred.t.toFixed(2)} Mt`;
  }

  const statsDiv = document.getElementById('statsOut');
  if (statsDiv) {
    statsDiv.textContent = `Скважин: ${holes.length} | Интервалов: ${ti}
Среднее (${cfg.field}): ${avgRaw.toFixed(2)} ${cfg.unit}
Высокое (>${cfg.highCutoff}): ${hi} интервалов${catLines}`;
  }

  updateScriptOnly(holes, method, cutoff, standard);
}

function updateScriptOnly(holes, method, cutoff, standard) {
  const cfg = Object.values(TEMPLATES).find(c => c.standard === standard) || TEMPLATES.gold;
  const blockSize = getParam('blockSize') || 5;
  
  const script = `# ================================================
# АЛГОРИТМ ДЛЯ DATAMINE STUDIO RM
# ================================================
# Данные: ${holes.length} скважин, стандарт ${standard}
# Параметры: метод ${method.toUpperCase()}, блок ${blockSize}м, cutoff ${cutoff} ${cfg.unit}
# ================================================

ШАГ 1. ЗАГРУЗКА ДАННЫХ
  !SELDH "assay.csv" /CREATE=assay

ШАГ 2. КОМПОЗИТИРОВАНИЕ (единая длина пробы 2 м)
  !COMPDH /DATA=assay /FIELD=${cfg.field} /LENGTH=2 /CREATE=comp

ШАГ 3. СОЗДАНИЕ БЛОЧНОЙ МОДЕЛИ
  !BLKMOD /ORIGIN=(-50,-25,-25) /SIZE=(${blockSize},${blockSize},${blockSize}) /BLOCKS=(20,10,10) /CREATE=model

ШАГ 4. ИНТЕРПОЛЯЦИЯ (IDW)
  !ESTIMA /DATA=comp /FIELD=${cfg.field} /METHOD=IDW /POWER=2 /MAX=12 /MIN=3 /SEARCH=40 /MODEL=model /CREATE=model_est

ШАГ 5. ПОДСЧЁТ РЕСУРСОВ
  !TABGEN /MODEL=model_est /FILTER="${cfg.field} >= ${cutoff}" /FIELDS=${cfg.field},TONNES /DENSITY=2.7 /OUT=report.txt

ШАГ 6. ЭКСПОРТ
  !SAVE model_est /NAME="result_${method}_${blockSize}m.blockmodel"

# ================================================
# Для запуска скопируйте этот текст в файл script.mac
# и выполните в Datamine Studio RM
# ================================================`;
  
  const scriptDiv = document.getElementById('scriptOut');
  if (scriptDiv) scriptDiv.textContent = script;
  console.log('[UI] Алгоритм Datamine обновлён');
}

function runModel() {
  const btn = document.getElementById('runBtn');
  if (!btn.classList.contains('ready') && !btn.classList.contains('done')) return;
  
  const blockSize = getParam('blockSize') || 5;
  const method = document.getElementById('methodSel')?.value || 'idw';
  const cutoff = getParam('cutoff') || 1.0;
  const standard = document.getElementById('stdSel')?.value || 'JORC';
  
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
    const rawBlocks = interpolateBlocks(currentHoles, blockSize, method, cutoff);
    const classified = classifyJORC(rawBlocks, currentHoles);
    currentBlocks = classified;
    visualizeBlocks(classified);
    updateUI(currentHoles, classified, method, cutoff, standard);
    
    btn.className = 'run-btn done';
    btn.innerHTML = `<div class="run-progress" style="width:100%;background:#2a5a2a"></div><span>✓ Модель построена · ${classified.length} блоков · Запустить снова</span>`;
    console.log('[MODEL] Построение завершено');
  }, 1300);
}

// ========== 11. ВАРИОГРАММА ==========
function calculateVariogram(holes) {
  console.log('[VARIO] Расчёт вариограммы');
  const pts = [];
  holes.forEach(h => h.intervals.forEach(([from, to, val]) => {
    pts.push({ x: h.x, y: -(from + to) / 2 * 0.5, z: h.z, val });
  }));
  if (pts.length < 10) {
    console.warn('[VARIO] Недостаточно точек:', pts.length);
    return null;
  }

  const compute = (dir, maxD = 40, bins = 12) => {
    const step = maxD / bins;
    const bd = Array(bins).fill(0).map((_, i) => ({ dist: (i + 0.5) * step, sum: 0, cnt: 0 }));
    const norm = Math.hypot(dir.x, dir.y, dir.z);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, dz = pts[j].z - pts[i].z;
        const proj = Math.abs(dx * dir.x + dy * dir.y + dz * dir.z) / norm;
        if (proj > maxD) continue;
        const bi = Math.min(bins - 1, Math.floor(proj / step));
        bd[bi].sum += 0.5 * (pts[i].val - pts[j].val) ** 2;
        bd[bi].cnt++;
      }
    }
    return bd.filter(b => b.cnt > 3).map(b => ({ dist: b.dist, gamma: b.sum / b.cnt }));
  };
  
  return {
    strike: compute({ x: 1, y: 0, z: 0 }),
    dip:    compute({ x: 0, y: 1, z: 0 }),
    perp:   compute({ x: 0, y: 0, z: 1 })
  };
}

function drawVariogram(vg) {
  const canvas = document.getElementById('variogramPlot');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || 500, H = canvas.clientHeight || 260;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const all = [...(vg.strike || []), ...(vg.dip || []), ...(vg.perp || [])];
  if (!all.length) {
    ctx.fillStyle = '#9A9890';
    ctx.font = '12px monospace';
    ctx.fillText('Недостаточно данных', 20, 40);
    return;
  }
  
  let maxG = 0, maxD = 0;
  all.forEach(p => { maxG = Math.max(maxG, p.gamma); maxD = Math.max(maxD, p.dist); });
  maxG *= 1.1; maxD *= 1.05;

  ctx.strokeStyle = '#5C5B56';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, H - 40);
  ctx.lineTo(W - 20, H - 40);
  ctx.moveTo(40, H - 40);
  ctx.lineTo(40, 20);
  ctx.stroke();
  ctx.fillStyle = '#9A9890';
  ctx.font = '10px monospace';
  ctx.fillText('Расстояние (м)', W / 2 - 40, H - 6);

  const series = [
    { data: vg.strike, color: '#E87070', label: 'Простирание' },
    { data: vg.dip,    color: '#7ee787', label: 'Падение' },
    { data: vg.perp,   color: '#C9A84C', label: 'Поперечное' }
  ];
  
  series.forEach(({ data, color, label }, si) => {
    ctx.fillStyle = color;
    ctx.fillRect(W - 110, 20 + si * 20, 10, 10);
    ctx.fillStyle = '#9A9890';
    ctx.fillText(label, W - 97, 29 + si * 20);
    if (!data?.length) return;
    ctx.fillStyle = color;
    data.forEach(p => {
      const x = 40 + (p.dist / maxD) * (W - 60);
      const y = (H - 40) - (p.gamma / maxG) * (H - 80);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    });
  });
}

// ========== 12. ПРОЕКТЫ ==========
function loadProjects() { return JSON.parse(localStorage.getItem('geoProjects') || '[]'); }
function saveProjects(p) { localStorage.setItem('geoProjects', JSON.stringify(p)); }

function renderProjects() {
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
  currentHoles = p.holesData;
  visualizeHoles(currentHoles);
  updateUI(currentHoles, [], 'idw', 1.0, p.standard);
  setRunReady(true);
  document.getElementById('sandbox')?.scrollIntoView({ behavior: 'smooth' });
};

window.deleteProject = function(i) {
  const p = loadProjects(); p.splice(i, 1); saveProjects(p); renderProjects();
};

// ========== 13. ЭКСПОРТ ОТЧЁТА ==========
function exportReport() {
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
}

// ========== 14. ЧАТ ==========
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

function botReply(q) {
  const lower = q.toLowerCase();
  for (const fn of CHAT_RESPONSES) {
    const r = fn(lower);
    if (r) return r;
  }
  return CHAT_RESPONSES[CHAT_RESPONSES.length - 1]();
}

// ========== 15. НАСТРОЙКА СОБЫТИЙ ==========
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
        currentHoles = holes;
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
          visualizeOreFromVertices(vertices, faces, currentHoles);
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
  if (runBtn) runBtn.addEventListener('click', runModel);

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
  if (exportBtn) exportBtn.addEventListener('click', exportReport);

  // Сброс к золоту
  const resetBtn = document.getElementById('resetDemoBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => loadTemplate('gold'));

  // Сохранение проекта
  const saveBtn = document.getElementById('saveProjectBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (!currentHoles.length) { alert('Нет данных для сохранения'); return; }
      const name = prompt('Название проекта:', `Проект ${new Date().toLocaleDateString('ru')}`);
      if (!name) return;
      let ti = 0, tg = 0;
      currentHoles.forEach(h => { ti += h.intervals.length; h.intervals.forEach(([,, v]) => tg += v); });
      const avg = ti ? (tg / ti).toFixed(2) : '0';
      const proj = loadProjects();
      proj.unshift({ name, date: new Date().toLocaleDateString('ru'), holes: currentHoles.length, avgVal: avg, standard: document.getElementById('stdSel')?.value || 'JORC', holesData: currentHoles });
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
      if (!currentHoles.length) { alert('Загрузите данные'); return; }
      const vg = calculateVariogram(currentHoles);
      if (!vg) { alert('Недостаточно точек (минимум 10)'); return; }
      const container = document.getElementById('variogramCanvas');
      if (container) container.style.display = 'block';
      drawVariogram(vg);
      const statsDiv = document.getElementById('variogramStats');
      if (statsDiv) statsDiv.textContent = 'Экспериментальная вариограмма построена.';
    });
  }

  // Автоматическое обновление алгоритма при изменении параметров
  const paramFields = ['blockSize', 'methodSel', 'cutoff', 'stdSel'];
  paramFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        if (currentHoles.length > 0) {
          const method = document.getElementById('methodSel')?.value || 'idw';
          const cutoff = getParam('cutoff') || 1.0;
          const standard = document.getElementById('stdSel')?.value || 'JORC';
          updateScriptOnly(currentHoles, method, cutoff, standard);
          
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
