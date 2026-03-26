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

export function visualizeBlocks(blocks) {
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
    opacity: 0.2,
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
    opacity: 0.2,
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

// Функция для управления видимостью полупрозрачной оболочки
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
