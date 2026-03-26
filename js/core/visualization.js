import { scene, holesGrp, blocksGrp, oreGrp } from './threeInit.js';
import { clearGroup, calculateAverageGrade } from '../utils/helpers.js';
import * as THREE from 'three';

// Массив для хранения полупрозрачных оболочек
export let oreShellMeshes = [];

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
    const line = new THREE.Line(geometry, material);
    holesGrp.add(line);
    
    h.intervals.forEach(([from, to, val]) => {
      if (val > 5) {
        const sphereGeo = new THREE.SphereGeometry(0.65, 16, 16);
        const sphereMat = new THREE.MeshStandardMaterial({ color: 0xffaa44, emissive: 0x552200, emissiveIntensity: 0.8 });
        const marker = new THREE.Mesh(sphereGeo, sphereMat);
        marker.position.set(h.x, -(from + to) / 2 * 0.5, h.z);
        holesGrp.add(marker);
      }
    });
  });
  
  console.log(`[3D] Визуализировано скважин: ${holes.length}`);
}

export function visualizeBlocks(blocks) {
  clearGroup(blocksGrp);
  if (!blocks.length) return;
  
  const cutoff = document.getElementById('cutoff')?.value || 1.0;
  const oreThresh = cutoff;
  const maxGrade = blocks.reduce((m, b) => Math.max(m, b.grade), 0);

  if (typeof renderer !== 'undefined') renderer.sortObjects = true;
  const geo = new THREE.BoxGeometry(4.3, 4.3, 4.3);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(4.3, 4.3, 4.3));
  const sorted = [...blocks].sort((a, b) => a.grade - b.grade);

  sorted.forEach(b => {
    const isOre = b.grade >= oreThresh;
    
    // Для руды — яркие цвета от синего до красного
    // Для породы — серые оттенки от тёмно-серого до светло-серого
    let color, opacity, emissive;
    
    if (isOre) {
      // Руда: яркие цвета
      color = gradeToColor(b.grade, maxGrade);
      opacity = Math.min(0.35 + (b.grade / maxGrade) * 0.65, 1.0);
      emissive = b.grade > maxGrade * 0.7 ? 0x330800 : 0x000000;
    } else {
      // Порода: серые оттенки (чем выше содержание, тем светлее)
      const grayValue = Math.floor(40 + (b.grade / oreThresh) * 80);
      color = (grayValue << 16) | (grayValue << 8) | grayValue;
      opacity = 0.15;  // полупрозрачная порода
      emissive = 0x000000;
    }

    const mat = new THREE.MeshStandardMaterial({ 
      color, 
      emissive, 
      transparent: true, 
      opacity, 
      depthWrite: isOre 
    });
    const box = new THREE.Mesh(geo, mat);
    box.position.set(b.x, b.y, b.z);
    box.renderOrder = isOre ? 2 : 0;
    blocksGrp.add(box);

    // Рёбра только у рудных блоков
    if (isOre) {
      const catColor = !b.category ? 0x888888
                     : b.category === 'Measured' ? 0x7ee787
                     : b.category === 'Indicated' ? 0xffdd44
                     : 0xff9944;
      const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: catColor, transparent: true, opacity: 0.4 }));
      wire.position.copy(box.position);
      wire.renderOrder = 3;
      blocksGrp.add(wire);
    }
  });
  
  console.log(`[3D] Визуализировано блоков: ${blocks.length}`);
}
function gradeToColor(grade, maxGrade) {
  const t = Math.min(grade / Math.max(maxGrade, 1), 1);
  const stops = [
    { t: 0.0,  r: 0x10, g: 0x40, b: 0xaa },
    { t: 0.25, r: 0x20, g: 0x80, b: 0xdd },
    { t: 0.5,  r: 0xff, g: 0xdd, b: 0x00 },
    { t: 0.75, r: 0xff, g: 0x77, b: 0x00 },
    { t: 1.0,  r: 0xff, g: 0x11, b: 0x00 },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i+1].t) { lo = stops[i]; hi = stops[i+1]; break; }
  }
  const f = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t);
  const r = Math.round(lo.r + (hi.r - lo.r) * f);
  const g = Math.round(lo.g + (hi.g - lo.g) * f);
  const b = Math.round(lo.b + (hi.b - lo.b) * f);
  return (r << 16) | (g << 8) | b;
}

export function visualizeOreFromVertices(vertices, faces, holes = null) {
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
    opacity: 0.08,
    emissive: avgGrade > 5 ? 0x331100 : 0x000000
  });
  const shell = new THREE.Mesh(geometry, shellMaterial);
  shell.scale.set(1.3, 1.4, 1.3);
  shell.position.y = -8;
  oreGrp.add(shell);
  oreShellMeshes.push(shell);

  const wireframeMat = new THREE.MeshBasicMaterial({ 
    color: 0xc9a84c, 
    wireframe: true, 
    transparent: true, 
    opacity: 0.65 
  });
  const wireframe = new THREE.Mesh(geometry, wireframeMat);
  wireframe.scale.copy(shell.scale);
  wireframe.position.copy(shell.position);
  oreGrp.add(wireframe);
}

export function drawEllipsoidOreBody(avgGrade = 3.0) {
  clearGroup(oreGrp);
  const color = getColorByGrade(avgGrade);
  
  const geo = new THREE.SphereGeometry(1, 48, 48);
  const shell = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ 
    color: color, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.08,
    emissive: avgGrade > 5 ? 0x331100 : 0x000000
  }));
  shell.scale.set(22, 18, 22);
  shell.position.y = -8;
  oreGrp.add(shell);
  oreShellMeshes.push(shell);
  
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ 
    color: 0xc9a84c, 
    wireframe: true, 
    transparent: true, 
    opacity: 0.65 
  }));
  wire.scale.copy(shell.scale);
  wire.position.copy(shell.position);
  oreGrp.add(wire);
}

export function drawCoalSeams() {
  clearGroup(oreGrp);
  
  const upperMat = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  const upperSeam = new THREE.Mesh(new THREE.PlaneGeometry(55, 55), upperMat);
  upperSeam.rotation.x = -Math.PI / 2;
  upperSeam.position.y = -12.5;
  oreGrp.add(upperSeam);
  oreShellMeshes.push(upperSeam);
  
  const lowerMat = new THREE.MeshPhongMaterial({ color: 0x3a3a3a, side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
  const lowerSeam = new THREE.Mesh(new THREE.PlaneGeometry(55, 55), lowerMat);
  lowerSeam.rotation.x = -Math.PI / 2;
  lowerSeam.position.y = -19;
  oreGrp.add(lowerSeam);
  oreShellMeshes.push(lowerSeam);
  
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

export function setOreShellVisibility(visible) {
  if (oreShellMeshes && oreShellMeshes.length) {
    oreShellMeshes.forEach(mesh => {
      if (mesh && mesh.isMesh) {
        mesh.visible = visible;
      }
    });
    console.log(`[VIS] Оболочка рудного тела ${visible ? 'показана' : 'скрыта'}`);
  } else {
    console.warn('[VIS] oreShellMeshes пуст или не определен');
  }
}
