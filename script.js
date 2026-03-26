// ============================================================
//  GeoCore Academy — script.js
//  Все зависимости: Three.js (importmap), OrbitControls
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

// ─── GLOBALS ────────────────────────────────────────────────
let scene, camera, renderer, controls;
let holesGrp, blocksGrp, oreGrp;
let currentHoles = [];
let currentBlocks = [];

// ─── TEMPLATE CONFIG ────────────────────────────────────────
const TEMPLATES = {
  gold:   { csv: 'data/gold_demo.csv',   obj: 'data/ore_body.obj', standard: 'JORC',  label: 'золото (Au)',  field: 'Au_gpt',  unit: 'г/т',  highCutoff: 5 },
  copper: { csv: 'data/copper_demo.csv', obj: 'data/ore_body.obj', standard: 'JORC',  label: 'медь (Cu)',   field: 'Cu_pct',  unit: '%',    highCutoff: 1 },
  coal:   { csv: 'data/coal_demo.csv',   obj: null,                standard: 'ГКЗ',   label: 'уголь',       field: 'Coal_m',  unit: 'м',    highCutoff: 3 },
};

// ─── ASYNC LOADERS ──────────────────────────────────────────
async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.text();
}

async function loadTemplate(type) {
  const cfg = TEMPLATES[type];
  if (!cfg) return;

  setStatus('csvStatus', '⏳ Загрузка…', 'var(--text-dim)');

  try {
    // 1. Load CSV
    const csvText = await fetchText(cfg.csv);
    const holes = parseCSV(csvText);
    if (!holes.length) throw new Error('CSV пустой или неверный формат');

    currentHoles = holes;
    visualizeHoles(holes);
    updateUI(holes, [], 'idw', getParam('cutoff'), cfg.standard);
    setRunReady(true);
    setStatus('csvStatus', `✓ ${cfg.label} — ${holes.length} скважин, ${holes.reduce((s,h)=>s+h.intervals.length,0)} интервалов`, '#7ee787');

    // 2. Load OBJ or draw built-in shape
    clearGroup(oreGrp);
    if (cfg.obj) {
      try {
        const objText = await fetchText(cfg.obj);
        const { vertices, faces } = parseOBJ(objText);
        if (vertices.length && faces.length) {
          visualizeOreFromVertices(vertices, faces);
          setStatus('objStatus', `✓ Каркас загружен: ${vertices.length} вершин, ${faces.length} граней`, '#7ee787');
        }
      } catch (e) {
        // OBJ fallback — draw ellipsoid
        drawEllipsoidOreBody();
        setStatus('objStatus', '⚠ OBJ не найден — использован автоматический каркас', 'var(--gold)');
      }
    } else {
      // Coal — draw seams
      drawCoalSeams();
      setStatus('objStatus', '✓ Угольные пласты отрисованы', '#7ee787');
    }

    // Scroll to sandbox
    document.getElementById('sandbox')?.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    setStatus('csvStatus', `❌ Ошибка загрузки: ${err.message}`, '#E87070');
    console.error(err);
  }
}

// ─── CSV PARSER ─────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n');
  const map = new Map();

  // Detect header
  const header = lines[0]?.toLowerCase() || '';
  const hasHeader = isNaN(+header.split(',')[1]);

  // Assign random positions so holes spread realistically
  const rng = mulberry32(42); // deterministic seed

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const p = lines[i].trim().split(',');
    if (p.length < 4) continue;
    const id = p[0].trim();
    const from = +p[1], to = +p[2], val = +p[3];
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
  return Array.from(map.values());
}

// Seeded RNG (Mulberry32) — deterministic hole positions per run
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── OBJ PARSER ─────────────────────────────────────────────
function parseOBJ(text) {
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
  return { vertices, faces };
}

// ─── HELPER ─────────────────────────────────────────────────
function setStatus(id, text, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}
function getParam(id) {
  return +(document.getElementById(id)?.value) || 0;
}
function setRunReady(yes) {
  const btn = document.getElementById('runBtn');
  const txt = document.getElementById('runBtnText');
  if (!btn || !txt) return;
  if (yes) {
    btn.className = 'run-btn ready';
    txt.textContent = '▶ Запустить построение блочной модели';
  } else {
    btn.className = 'run-btn';
    txt.textContent = '▶ Загрузите CSV для запуска';
  }
}

// ─── 3D INIT ────────────────────────────────────────────────
export function init3D() {
  const canvas = document.getElementById('c3d');
  if (!canvas) return;
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
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(15, 25, 8);
  scene.add(dl);
  scene.add(new THREE.PointLight(0x4466cc, 0.4, 0, 0).position.set(-8, 12, -14));
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
}

// ─── SCENE HELPERS ──────────────────────────────────────────
function clearGroup(g) {
  while (g.children.length) g.remove(g.children[0]);
}

function visualizeHoles(holes) {
  clearGroup(holesGrp);
  const COLORS = [0x3a6ea5, 0x4a7eb5, 0x5a8ec5, 0x6a9ed5];
  holes.forEach((h, i) => {
    const pts = [];
    for (let y = 0; y <= h.depth; y += 2) pts.push(new THREE.Vector3(h.x, -y * 0.5, h.z));
    holesGrp.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: COLORS[i % 4] })
    ));
    h.intervals.forEach(([from, to, val]) => {
      if (val > 5) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 8, 8),
          new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0x331100 })
        );
        marker.position.set(h.x, -(from + to) / 2 * 0.5, h.z);
        holesGrp.add(marker);
      }
    });
  });
}

function visualizeBlocks(blocks) {
  clearGroup(blocksGrp);
  if (!blocks.length) return;
  const geo = new THREE.BoxGeometry(4.4, 4.4, 4.4);
  blocks.forEach(b => {
    const color = b.grade > 6 ? 0xff5522 : b.grade > 3 ? 0xffaa66 : b.grade > 1 ? 0x6a9aca : 0x2a5a8a;
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, emissive: b.grade > 7 ? 0x331100 : 0 });
    const box = new THREE.Mesh(geo, mat);
    box.position.set(b.x, b.y, b.z);
    blocksGrp.add(box);
    if (b.category) {
      const edgeColor = b.category === 'Measured' ? 0x7ee787 : b.category === 'Indicated' ? 0xffaa66 : 0xff8844;
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edgeColor }));
      wire.position.copy(box.position);
      blocksGrp.add(wire);
    }
  });
}

function visualizeOreFromVertices(vertices, faces) {
  clearGroup(oreGrp);
  const geometry = new THREE.BufferGeometry();
  const pos = new Float32Array(vertices.flat());
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(faces.flatMap(f => f.v));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: 0xc9a84c, side: THREE.DoubleSide, transparent: true, opacity: 0.15 }));
  mesh.scale.set(1.3, 1.4, 1.3);
  mesh.position.y = -8;
  oreGrp.add(mesh);

  const wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xc9a84c, wireframe: true, transparent: true, opacity: 0.35 }));
  wire.scale.copy(mesh.scale);
  wire.position.copy(mesh.position);
  oreGrp.add(wire);
}

function drawEllipsoidOreBody() {
  clearGroup(oreGrp);
  const geo = new THREE.SphereGeometry(1, 48, 48);
  const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xc9a84c, side: THREE.DoubleSide, transparent: true, opacity: 0.15 }));
  mesh.scale.set(22, 18, 22);
  mesh.position.y = -8;
  oreGrp.add(mesh);
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc9a84c, wireframe: true, transparent: true, opacity: 0.35 }));
  wire.scale.copy(mesh.scale);
  wire.position.copy(mesh.position);
  oreGrp.add(wire);
}

function drawCoalSeams() {
  clearGroup(oreGrp);
  const mat = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  [-12.5, -19].forEach(y => {
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(55, 55), mat);
    seam.rotation.x = -Math.PI / 2;
    seam.position.y = y;
    oreGrp.add(seam);
  });
}

// ─── BLOCK MODEL ────────────────────────────────────────────
function interpolateBlocks(holes, blockSize, method, cutoff) {
  const blocks = [], range = 50;
  const steps = Math.floor(range * 2 / blockSize);
  for (let ix = 0; ix <= steps; ix++)
    for (let iz = 0; iz <= steps; iz++)
      for (let iy = 0; iy <= 8; iy++) {
        const bx = -range + ix * blockSize;
        const bz = -range + iz * blockSize;
        const by = -5 - iy * blockSize;
        let grade = 0, wSum = 0;
        holes.forEach(h => h.intervals.forEach(([from, to, val]) => {
          const yd = -(from + to) / 2 * 0.5;
          const d = Math.hypot(bx - h.x, bz - h.z, by - yd);
          if (method === 'nn') {
            if (d < 0.5) grade = val;
          } else if (method === 'idw') {
            const w = 1 / Math.max(0.1, d) ** 2; wSum += w; grade += val * w;
          } else {
            const rangeV = 25, sill = 2, nug = 0.2;
            const g = d >= rangeV ? sill + nug : nug + sill * (1.5 * d / rangeV - 0.5 * (d / rangeV) ** 3);
            const w = 1 / (g + 0.01); wSum += w; grade += val * w;
          }
        }));
        if (method !== 'nn' && wSum > 0) grade /= wSum;
        if (grade > cutoff * 0.2) blocks.push({ x: bx, y: by, z: bz, grade });
      }
  return blocks;
}

function classifyJORC(blocks, holes) {
  return blocks.map(b => {
    let minD = Infinity, cnt = 0;
    holes.forEach(h => h.intervals.forEach(([from, to]) => {
      const d = Math.hypot(b.x - h.x, b.z - h.z, b.y - -(from + to) / 2 * 0.5);
      if (d < minD) minD = d;
      if (d < 30) cnt++;
    }));
    const cat = minD < 15 && cnt >= 3 ? 'Measured'
              : minD < 25 && cnt >= 2 ? 'Indicated'
              : minD < 40 && cnt >= 1 ? 'Inferred'
              : 'Unclassified';
    return { ...b, category: cat };
  });
}

// ─── UI UPDATE ──────────────────────────────────────────────
function updateUI(holes, blocks, method, cutoff, standard) {
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

  document.getElementById('statsOut').textContent =
`Скважин: ${holes.length} | Интервалов: ${ti}
Среднее (${cfg.field}): ${avgRaw.toFixed(2)} ${cfg.unit}
Высокое (>${cfg.highCutoff}): ${hi} интервалов${catLines}`;

  document.getElementById('scriptOut').textContent =
`# Datamine Studio RM — шаблон скрипта
# Скважин: ${holes.length} | Стандарт: ${standard}
import dm
db = dm.load_database("assay.csv")
comp = dm.composite(db, length=2.0, field="${cfg.field}")
model = dm.create_block_model(
    origin=(-50,-25,-25), size=(5,5,5), blocks=(20,10,10)
)
model.estimate(
    method="${method}", data=comp, field="${cfg.field}",
    power=2, max_points=12
)
report = model.report(
    filter="${cfg.field} >= ${cutoff}",
    fields=["${cfg.field}", "TONNES"],
    density=2.7
)
print(report)
model.save("result_${method}.blockmodel")
print("Done!")`;
}

// ─── RUN MODEL ──────────────────────────────────────────────
function runModel() {
  const btn = document.getElementById('runBtn');
  if (!btn.classList.contains('ready') && !btn.classList.contains('done')) return;
  const blockSize = getParam('blockSize') || 5;
  const method = document.getElementById('methodSel')?.value || 'idw';
  const cutoff = getParam('cutoff') || 1.0;
  const standard = document.getElementById('stdSel')?.value || 'JORC';

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
    const raw = interpolateBlocks(currentHoles, blockSize, method, cutoff);
    const classified = classifyJORC(raw, currentHoles);
    currentBlocks = classified;
    visualizeBlocks(classified);
    updateUI(currentHoles, classified, method, cutoff, standard);
    btn.className = 'run-btn done';
    btn.innerHTML = `<div class="run-progress" style="width:100%;background:#2a5a2a"></div><span>✓ Модель построена · ${classified.length} блоков · Запустить снова</span>`;
  }, 1300);
}

// ─── VARIOGRAM ──────────────────────────────────────────────
function calculateVariogram(holes) {
  const pts = [];
  holes.forEach(h => h.intervals.forEach(([from, to, val]) => {
    pts.push({ x: h.x, y: -(from + to) / 2 * 0.5, z: h.z, val });
  }));
  if (pts.length < 10) return null;

  const compute = (dir, maxD = 40, bins = 12) => {
    const step = maxD / bins;
    const bd = Array(bins).fill(0).map((_, i) => ({ dist: (i + 0.5) * step, sum: 0, cnt: 0 }));
    const norm = Math.hypot(dir.x, dir.y, dir.z);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y, dz = pts[j].z - pts[i].z;
      const proj = Math.abs(dx * dir.x + dy * dir.y + dz * dir.z) / norm;
      if (proj > maxD) continue;
      const bi = Math.min(bins - 1, Math.floor(proj / step));
      bd[bi].sum += 0.5 * (pts[i].val - pts[j].val) ** 2;
      bd[bi].cnt++;
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
  const W = canvas.clientWidth || 500, H = canvas.clientHeight || 300;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const all = [...(vg.strike || []), ...(vg.dip || []), ...(vg.perp || [])];
  if (!all.length) { ctx.fillStyle = '#9A9890'; ctx.font = '12px monospace'; ctx.fillText('Недостаточно данных', 20, 40); return; }
  let maxG = 0, maxD = 0;
  all.forEach(p => { maxG = Math.max(maxG, p.gamma); maxD = Math.max(maxD, p.dist); });
  maxG *= 1.1; maxD *= 1.05;

  // Axes
  ctx.strokeStyle = '#5C5B56'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, H - 40); ctx.lineTo(W - 20, H - 40); ctx.moveTo(40, H - 40); ctx.lineTo(40, 20); ctx.stroke();
  ctx.fillStyle = '#9A9890'; ctx.font = '10px monospace';
  ctx.fillText('Расстояние (м)', W / 2 - 40, H - 6);

  const series = [{ data: vg.strike, color: '#E87070', label: 'Простирание' }, { data: vg.dip, color: '#7ee787', label: 'Падение' }, { data: vg.perp, color: '#C9A84C', label: 'Поперечное' }];
  series.forEach(({ data, color, label }, si) => {
    ctx.fillStyle = color;
    ctx.fillRect(W - 110, 20 + si * 20, 10, 10);
    ctx.fillStyle = '#9A9890'; ctx.fillText(label, W - 97, 29 + si * 20);
    if (!data?.length) return;
    ctx.fillStyle = color;
    data.forEach(p => {
      const x = 40 + (p.dist / maxD) * (W - 60);
      const y = (H - 40) - (p.gamma / maxG) * (H - 80);
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 2 * Math.PI); ctx.fill();
    });
  });
  // Sill line
  const sill = all.reduce((s, p) => s + p.gamma, 0) / all.length;
  ctx.strokeStyle = 'rgba(201,168,76,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  const sy = (H - 40) - (sill / maxG) * (H - 80);
  ctx.beginPath(); ctx.moveTo(40, sy); ctx.lineTo(W - 20, sy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(201,168,76,.7)'; ctx.font = '9px monospace';
  ctx.fillText(`sill ≈ ${sill.toFixed(2)}`, W - 90, sy - 4);
}

// ─── PROJECTS ───────────────────────────────────────────────
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

// ─── CHAT (local simulation) ─────────────────────────────────
const CHAT_RESPONSES = [
  q => q.match(/вариограмм|variogram/)            && 'Вариограмма описывает пространственную корреляцию данных. Ключевые параметры: ранг (range), порог (sill), самородок (nugget). В Datamine используйте VARIO для построения экспериментальной вариограммы.',
  q => q.match(/jorc|jorc/)                        && 'JORC Code требует классификации ресурсов на Measured, Indicated, Inferred — на основе доверия к данным и геологической интерпретации.',
  q => q.match(/гкз/)                              && 'ГКЗ использует категории A, B, C1, C2. Для A и B нужна детальная сеть скважин и разведочных выработок.',
  q => q.match(/datamine|датамайн/)                && 'Datamine Studio RM — ведущее ПО для блочного моделирования. Основные модули: DRILLHOLE (скважины), ESTIMA (интерполяция), MODRES (подсчёт запасов).',
  q => q.match(/кригин|kriging/)                   && 'Ordinary Kriging (OK) — метод BLUE (Best Linear Unbiased Estimator). Учитывает вариограммную модель. Требует больше данных, чем IDW, но даёт минимальную дисперсию оценки.',
  q => q.match(/idw/)                              && 'IDW (Inverse Distance Weighting) — простой метод. Вес обратно пропорционален расстоянию в степени p. Быстрый старт, но не учитывает геостатистическую структуру.',
  q => q.match(/блоч|block model/)                 && 'Блочная модель — 3D-сетка блоков с атрибутами (содержание, плотность, категория). В Datamine создаётся командой MODBLD, заполняется ESTIMA/KRGING.',
  () => 'Для получения детальной консультации по вашему проекту — запишитесь к нашему эксперту. Используйте форму ниже или напишите в Telegram.',
];
function botReply(q) {
  const lower = q.toLowerCase();
  for (const fn of CHAT_RESPONSES) {
    const r = fn(lower);
    if (r) return r;
  }
  return CHAT_RESPONSES[CHAT_RESPONSES.length - 1]();
}

// ─── EVENT WIRING ────────────────────────────────────────────
export function wireEvents() {
  // Template cards
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => loadTemplate(card.dataset.template));
  });

  // Manual CSV upload
  document.getElementById('csvIn')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const holes = parseCSV(ev.target.result);
      if (!holes.length) { setStatus('csvStatus', '❌ Ошибка формата', '#E87070'); return; }
      currentHoles = holes;
      visualizeHoles(holes);
      updateUI(holes, [], 'idw', getParam('cutoff'), document.getElementById('stdSel')?.value || 'JORC');
      setRunReady(true);
      setStatus('csvStatus', `✓ Загружено: ${holes.length} скважин`, '#7ee787');
    };
    r.readAsText(f);
  });

  // Manual OBJ upload
  document.getElementById('objIn')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const { vertices, faces } = parseOBJ(ev.target.result);
      if (vertices.length && faces.length) {
        visualizeOreFromVertices(vertices, faces);
        setStatus('objStatus', `✓ OBJ: ${vertices.length} вершин, ${faces.length} граней`, '#7ee787');
      } else {
        setStatus('objStatus', '❌ OBJ: нет данных', '#E87070');
      }
    };
    r.readAsText(f);
  });

  // Run button
  document.getElementById('runBtn')?.addEventListener('click', runModel);

  // Copy script
  document.getElementById('copyBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('scriptOut')?.textContent || '');
    const b = document.getElementById('copyBtn');
    b.textContent = '✓ Скопировано!';
    setTimeout(() => b.textContent = '📋 Копировать скрипт', 2000);
  });

  // Export
  document.getElementById('exportBtn')?.addEventListener('click', () => {
    if (!currentBlocks.length) { alert('Сначала постройте блочную модель'); return; }
    let csv = 'X,Y,Z,Grade,Category\n';
    currentBlocks.forEach(b => { csv += `${b.x},${b.y},${b.z},${b.grade.toFixed(3)},${b.category}\n`; });
    dlBlob(csv, 'blocks.csv', 'text/csv');
    const stats = document.getElementById('statsOut')?.textContent || '';
    dlBlob(`Отчёт GeoCore\nДата: ${new Date().toLocaleString('ru')}\n\n${stats}`, 'report.txt', 'text/plain');
  });

  function dlBlob(content, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
  }

  // Reset
  document.getElementById('resetDemoBtn')?.addEventListener('click', () => loadTemplate('gold'));

  // Save project
  document.getElementById('saveProjectBtn')?.addEventListener('click', () => {
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

  // Clear projects
  document.getElementById('clearAll')?.addEventListener('click', () => {
    if (confirm('Удалить все проекты?')) { saveProjects([]); renderProjects(); }
  });

  // Variogram
  document.getElementById('calcVariogramBtn')?.addEventListener('click', () => {
    if (!currentHoles.length) { alert('Загрузите данные'); return; }
    const vg = calculateVariogram(currentHoles);
    if (!vg) { alert('Недостаточно точек'); return; }
    const container = document.getElementById('variogramCanvas');
    if (container) container.style.display = 'block';
    drawVariogram(vg);
    const range = vg.strike?.at(-1)?.dist.toFixed(0) || '?';
    const statsDiv = document.getElementById('variogramStats');
    if (statsDiv) statsDiv.textContent = `Примерный ранг простирания: ~${range} м. Для подбора модели рекомендуется более плотная сеть скважин.`;
  });

  // Chat
  const chatSend = document.getElementById('chatSend');
  const chatInput = document.getElementById('chatInput');
  const chatMsgs = document.getElementById('chatMsgs');
  function addMsg(role, text) {
    const d = document.createElement('div'); d.className = `msg ${role}`;
    d.innerHTML = `<div class="msg-b">${text}</div><div class="msg-t">${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</div>`;
    chatMsgs?.appendChild(d);
    if (chatMsgs) chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }
  chatSend?.addEventListener('click', () => {
    const q = chatInput?.value.trim(); if (!q) return;
    if (chatInput) chatInput.value = '';
    addMsg('user', q);
    setTimeout(() => addMsg('bot', botReply(q)), 500);
  });
  chatInput?.addEventListener('keypress', e => { if (e.key === 'Enter') chatSend?.click(); });

  // Theme
  const themeBtn = document.getElementById('themeBtn');
  let dark = !localStorage.getItem('geocoreLight');
  function applyTheme() { document.body.classList.toggle('light', !dark); if (themeBtn) themeBtn.textContent = dark ? '🌙' : '☀️'; }
  applyTheme();
  themeBtn?.addEventListener('click', () => { dark = !dark; localStorage.setItem('geocoreLight', dark ? '' : '1'); applyTheme(); });

  // Scroll reveal
  const obs = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('vis'); }), { threshold: 0.08 });
  document.querySelectorAll('.rv,.stg').forEach(el => obs.observe(el));

  // Smooth nav
  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id && id !== '#') { e.preventDefault(); document.querySelector(id)?.scrollIntoView({ behavior: 'smooth' }); }
  }));

  // Auto-load gold on start
  loadTemplate('gold');
  renderProjects();
}
