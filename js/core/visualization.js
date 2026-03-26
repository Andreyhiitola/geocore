import { scene, holesGrp, blocksGrp, oreGrp } from './threeInit.js';
import { clearGroup, calculateAverageGrade } from '../utils/helpers.js';
import * as THREE from 'three';

export let oreShellMeshes = [];
export let currentWireframeVertices = null;
export let currentWireframeFaces = null;

export function clearOreGrp() { 
  clearGroup(oreGrp); 
  oreShellMeshes = [];
}

function getColorByGrade(grade) {
  if (grade > 6) return 0xff5522;
  if (grade > 3) return 0xffaa66;
  return 0x6a9aca;
}

export function visualizeHoles(holes) {
  clearGroup(holesGrp);
  const COLORS = [0x3a6ea5, 0x4a7eb5, 0x5a8ec5, 0x6a9ed5];
  holes.forEach((h, i) => {
    const points = [];
    for (let y = 0; y <= h.depth; y += 2) points.push(new THREE.Vector3(h.x, -y * 0.5, h.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: COLORS[i % 4] });
    holesGrp.add(new THREE.Line(geometry, material));
    h.intervals.forEach(([from, to, val]) => {
      if (val > 5) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.65, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffaa44, emissive: 0x552200, emissiveIntensity: 0.8 }));
        marker.position.set(h.x, -(from + to) / 2 * 0.5, h.z);
        holesGrp.add(marker);
      }
    });
  });
  console.log(`[3D] Визуализировано скважин: ${holes.length}`);
}

// Функция плавного градиента от синего (низкое) до красного (высокое)
function gradeToColor(grade, maxGrade) {
  const t = Math.min(grade / Math.max(maxGrade, 0.1), 1);
  
  // 5 опорных цветов для плавного перехода
  const stops = [
    { t: 0.0,  r: 0x10, g: 0x40, b: 0xaa }, // синий (низкое)
    { t: 0.25, r: 0x30, g: 0x80, b: 0xdd }, // голубой
    { t: 0.5,  r: 0xff, g: 0xdd, b: 0x00 }, // жёлтый
    { t: 0.75, r: 0xff, g: 0x88, b: 0x00 }, // оранжевый
    { t: 1.0,  r: 0xff, g: 0x22, b: 0x00 }, // красный (высокое)
  ];
  
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i+1].t) {
      lo = stops[i];
      hi = stops[i+1];
      break;
    }
  }
  
  const f = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t);
  const r = Math.round(lo.r + (hi.r - lo.r) * f);
  const g = Math.round(lo.g + (hi.g - lo.g) * f);
  const b = Math.round(lo.b + (hi.b - lo.b) * f);
  
  return (r << 16) | (g << 8) | b;
}

// Проверка, находится ли точка внутри каркаса рудного тела
function isPointInsideWireframe(x, y, z, vertices, faces) {
  if (!vertices || !vertices.length) return true;
  
  // Находим bounding box каркаса
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  vertices.forEach(v => {
    minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
    minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
  });
  
  // Масштабируем как в visualizeOreFromVertices
  const scale = 1.3;
  const posY = -8;
  
  const sx = x / scale;
  const sy = (y - posY) / 1.4;
  const sz = z / scale;
  
  return sx >= minX - 2 && sx <= maxX + 2 && 
         sy >= minY - 2 && sy <= maxY + 2 && 
         sz >= minZ - 2 && sz <= maxZ + 2;
}

export function visualizeBlocks(blocks) {
  clearGroup(blocksGrp);
  if (!blocks.length) return;
  
  const maxGrade = Math.max(...blocks.map(b => b.grade), 0.1);
  
  if (typeof renderer !== 'undefined') renderer.sortObjects = true;
  const geo = new THREE.BoxGeometry(4.3, 4.3, 4.3);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(4.3, 4.3, 4.3));
  
  let oreCount = 0;
  let lowCount = 0, midCount = 0, highCount = 0;
  
  blocks.forEach(b => {
    // Проверяем, находится ли блок внутри каркаса
    const inside = currentWireframeVertices ? 
      isPointInsideWireframe(b.x, b.y, b.z, currentWireframeVertices, currentWireframeFaces) : true;
    
    if (inside && b.grade > 0.1) {
      // Цвет блока зависит от содержания (градиент)
      const color = gradeToColor(b.grade, maxGrade);
      
      // Непрозрачность: чем выше содержание, тем плотнее блок
      const opacity = Math.min(0.4 + (b.grade / maxGrade) * 0.5, 0.9);
      
      const mat = new THREE.MeshStandardMaterial({ 
        color, 
        transparent: true, 
        opacity: opacity,
        emissive: b.grade > maxGrade * 0.7 ? 0x331100 : 0,
        emissiveIntensity: b.grade > maxGrade * 0.7 ? 0.3 : 0
      });
      const box = new THREE.Mesh(geo, mat);
      box.position.set(b.x, b.y, b.z);
      box.renderOrder = 2;
      blocksGrp.add(box);
      
      // Тонкие рёбра для контура блоков (как в Datamine)
      const wireColor = b.grade > maxGrade * 0.7 ? 0xff8866 : 0xcccccc;
      const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: 0.25 }));
      wire.position.copy(box.position);
      wire.renderOrder = 3;
      blocksGrp.add(wire);
      
      oreCount++;
      if (b.grade > maxGrade * 0.7) highCount++;
      else if (b.grade > maxGrade * 0.3) midCount++;
      else lowCount++;
    }
  });
  
  console.log(`[3D] Блоков внутри каркаса: ${oreCount}`);
  console.log(`     Высокое (>70%): ${highCount}, Среднее (30-70%): ${midCount}, Низкое (<30%): ${lowCount}`);
}

export function visualizeOreFromVertices(vertices, faces, holes = null) {
  clearGroup(oreGrp);
  if (!vertices.length || !faces.length) return;
  
  // Сохраняем для проверки блоков
  currentWireframeVertices = vertices;
  currentWireframeFaces = faces;
  
  const avgGrade = holes ? calculateAverageGrade(holes) : 3.0;
  const color = getColorByGrade(avgGrade);
  
  console.log(`[OBJ] Каркас загружен: ${vertices.length} вершин, ${faces.length} граней`);
  console.log(`      Среднее содержание: ${avgGrade.toFixed(2)} г/т → цвет: ${color.toString(16)}`);
  
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vertices.flat());
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(faces.flatMap(f => f.v));
  geometry.computeVertexNormals();

  // Едва заметная полупрозрачная оболочка (для ориентира)
  const shell = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ 
    color, side: THREE.DoubleSide, transparent: true, opacity: 0.05, emissive: avgGrade > 5 ? 0x331100 : 0
  }));
  shell.scale.set(1.3, 1.4, 1.3);
  shell.position.y = -8;
  oreGrp.add(shell);
  oreShellMeshes.push(shell);

  // Яркая золотистая каркасная сетка (граница рудного тела)
  const wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ 
    color: 0xc9a84c, wireframe: true, transparent: true, opacity: 0.85 
  }));
  wire.scale.copy(shell.scale);
  wire.position.copy(shell.position);
  oreGrp.add(wire);
}

export function drawEllipsoidOreBody(avgGrade = 3.0) {
  clearGroup(oreGrp);
  const color = getColorByGrade(avgGrade);
  const geo = new THREE.SphereGeometry(1, 56, 56);
  const shell = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.05, emissive: avgGrade > 5 ? 0x331100 : 0 }));
  shell.scale.set(22, 18, 22);
  shell.position.y = -8;
  oreGrp.add(shell);
  oreShellMeshes.push(shell);
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc9a84c, wireframe: true, transparent: true, opacity: 0.85 }));
  wire.scale.copy(shell.scale);
  wire.position.copy(shell.position);
  oreGrp.add(wire);
}

export function drawCoalSeams() {
  clearGroup(oreGrp);
  
  // Верхний пласт (глубина ~20-28 м) — мощность 5-8 м, ярче
  const upperMat = new THREE.MeshPhongMaterial({ 
    color: 0x5a5a5a, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.6,
    emissive: 0x221100
  });
  const upperSeam = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), upperMat);
  upperSeam.rotation.x = -Math.PI / 2;
  upperSeam.position.y = -14;  // центр пласта на глубине 14 м (реальная глубина 20-28 м)
  upperSeam.scale.set(1.2, 1.2, 1.2);
  oreGrp.add(upperSeam);
  oreShellMeshes.push(upperSeam);
  
  // Нижний пласт (глубина ~33-42 м) — мощность 5-8 м
  const lowerMat = new THREE.MeshPhongMaterial({ 
    color: 0x4a4a4a, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.6,
    emissive: 0x110800
  });
  const lowerSeam = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), lowerMat);
  lowerSeam.rotation.x = -Math.PI / 2;
  lowerSeam.position.y = -23;  // центр пласта на глубине 23 м (реальная глубина 33-42 м)
  lowerSeam.scale.set(1.2, 1.2, 1.2);
  oreGrp.add(lowerSeam);
  oreShellMeshes.push(lowerSeam);
  
  // Добавляем рёбра для лучшей видимости
  const edgesGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(60, 60));
  const edgesMat = new THREE.LineBasicMaterial({ color: 0xc9a84c });
  
  const upperWire = new THREE.LineSegments(edgesGeo, edgesMat);
  upperWire.rotation.x = -Math.PI / 2;
  upperWire.position.y = -14;
  upperWire.scale.set(1.2, 1.2, 1.2);
  oreGrp.add(upperWire);
  
  const lowerWire = new THREE.LineSegments(edgesGeo, edgesMat);
  lowerWire.rotation.x = -Math.PI / 2;
  lowerWire.position.y = -23;
  lowerWire.scale.set(1.2, 1.2, 1.2);
  oreGrp.add(lowerWire);
  
  console.log(`[3D] Угольные пласты отрисованы (мощность 5-8 м, два пласта)`);
}
export function setOreShellVisibility(visible) {
  if (oreShellMeshes && oreShellMeshes.length) {
    oreShellMeshes.forEach(mesh => { if (mesh && mesh.isMesh) mesh.visible = visible; });
    console.log(`[VIS] Оболочка рудного тела ${visible ? 'показана' : 'скрыта'}`);
  }
}
