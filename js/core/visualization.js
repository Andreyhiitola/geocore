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
    for (let y = 0; y <= h.depth; y += 2) {
      points.push(new THREE.Vector3(h.x, -y * 0.5, h.z));
    }
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

function gradeToColor(grade, maxGrade) {
  const t = Math.min(grade / Math.max(maxGrade, 0.1), 1);
  const stops = [
    { t: 0.0, r: 0x00, g: 0x40, b: 0xff },
    { t: 0.25, r: 0x00, g: 0xaa, b: 0xff },
    { t: 0.5, r: 0xff, g: 0xdd, b: 0x00 },
    { t: 0.75, r: 0xff, g: 0x88, b: 0x00 },
    { t: 1.0, r: 0xff, g: 0x22, b: 0x00 }
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

function isPointInsideWireframe(x, y, z, vertices) {
  if (!vertices || !vertices.length) return true;
  const scale = 1.3;
  const posY = -8;
  const sx = x / scale;
  const sy = (y - posY) / 1.4;
  const sz = z / scale;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  vertices.forEach(v => {
    minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
    minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
  });
  const margin = 2.0;
  return sx >= minX - margin && sx <= maxX + margin && 
         sy >= minY - margin && sy <= maxY + margin && 
         sz >= minZ - margin && sz <= maxZ + margin;
}

export function visualizeBlocks(blocks) {
  clearGroup(blocksGrp);
  if (!blocks.length) return;
  
  const maxGrade = Math.max(...blocks.map(b => b.grade), 0.1);
  
  if (typeof renderer !== 'undefined') renderer.sortObjects = true;
  
  // Размер блока уменьшаем на 0.8, чтобы был зазор между блоками
  const blockSize = 3.8;
  const geo = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(blockSize, blockSize, blockSize));
  
  let oreCount = 0;
  
  blocks.forEach(b => {
    const inside = currentWireframeVertices ? 
      isPointInsideWireframe(b.x, b.y, b.z, currentWireframeVertices) : true;
    
    if (inside && b.grade > 0.1) {
      const color = gradeToColor(b.grade, maxGrade);
      // Прозрачность рудных блоков: 0.45 (видно сквозь них)
      const opacity = 0.45;
      
      const mat = new THREE.MeshStandardMaterial({ 
        color, 
        transparent: true, 
        opacity: opacity,
        emissive: b.grade > maxGrade * 0.7 ? 0x331100 : 0,
        emissiveIntensity: 0.3
      });
      const box = new THREE.Mesh(geo, mat);
      box.position.set(b.x, b.y, b.z);
      box.renderOrder = 2;
      blocksGrp.add(box);
      
      // Тонкие рёбра для контура
      const wireColor = b.grade > maxGrade * 0.7 ? 0xff8866 : 0x88aaff;
      const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: wireColor, transparent: true, opacity: 0.35 }));
      wire.position.copy(box.position);
      wire.renderOrder = 3;
      blocksGrp.add(wire);
      
      oreCount++;
    }
    // Порода вообще не отображается
  });
  
  console.log(`[3D] Визуализировано блоков руды: ${oreCount} из ${blocks.length}`);
}

export function visualizeOreFromVertices(vertices, faces, holes = null) {
  clearGroup(oreGrp);
  if (!vertices.length || !faces.length) return;
  
  currentWireframeVertices = vertices;
  currentWireframeFaces = faces;
  
  const avgGrade = holes ? calculateAverageGrade(holes) : 3.0;
  const color = getColorByGrade(avgGrade);
  
  console.log(`[OBJ] Каркас загружен: ${vertices.length} вершин, ${faces.length} граней`);
  console.log(`      Среднее содержание: ${avgGrade.toFixed(2)} → цвет: ${color.toString(16)}`);
  
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(vertices.flat());
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(faces.flatMap(f => f.v));
  geometry.computeVertexNormals();

  const shell = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ 
    color, side: THREE.DoubleSide, transparent: true, opacity: 0.05, emissive: avgGrade > 5 ? 0x331100 : 0
  }));
  shell.scale.set(1.3, 1.4, 1.3);
  shell.position.y = -8;
  oreGrp.add(shell);
  oreShellMeshes.push(shell);

  const wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ 
    color: 0xc9a84c, wireframe: true, transparent: true, opacity: 0.65 
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
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xc9a84c, wireframe: true, transparent: true, opacity: 0.65 }));
  wire.scale.copy(shell.scale);
  wire.position.copy(shell.position);
  oreGrp.add(wire);
}

export function drawCoalSeams() {
  clearGroup(oreGrp);
  const mat = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  [-12.5, -19].forEach(y => {
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat);
    seam.rotation.x = -Math.PI / 2;
    seam.position.y = y;
    oreGrp.add(seam);
    oreShellMeshes.push(seam);
  });
  const edgesGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(60, 60));
  const edgesMat = new THREE.LineBasicMaterial({ color: 0xc9a84c });
  [-12.5, -19].forEach(y => {
    const wire = new THREE.LineSegments(edgesGeo, edgesMat);
    wire.rotation.x = -Math.PI / 2;
    wire.position.y = y;
    oreGrp.add(wire);
  });
}

export function setOreShellVisibility(visible) {
  if (oreShellMeshes && oreShellMeshes.length) {
    oreShellMeshes.forEach(mesh => { if (mesh && mesh.isMesh) mesh.visible = visible; });
    console.log(`[VIS] Оболочка рудного тела ${visible ? 'показана' : 'скрыта'}`);
  }
}
