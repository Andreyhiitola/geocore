import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

export let scene, camera, renderer, controls;
export let holesGrp, blocksGrp, oreGrp;

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
  scene.background = null;  // Прозрачный фон
  scene.fog = null;          // Убираем туман

  camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 600);
  camera.position.set(50, 40, 55);
  camera.lookAt(0, -8, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // Полностью прозрачный фон

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  // Освещение
  const ambientLight = new THREE.AmbientLight(0x404060, 0.8);
  scene.add(ambientLight);
  
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(15, 25, 8);
  scene.add(dirLight);
  
  const backLight = new THREE.DirectionalLight(0x88aaff, 0.6);
  backLight.position.set(-10, 5, -15);
  scene.add(backLight);
  
  const bottomLight = new THREE.DirectionalLight(0xffaa88, 0.4);
  bottomLight.position.set(0, -15, 0);
  scene.add(bottomLight);
  
  // Сетка (полупрозрачная)
  const gridHelper = new THREE.GridHelper(80, 20, 0x88aaff, 0x335588);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.25;
  scene.add(gridHelper);

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
  // Делаем переменные доступными глобально для отладки и кнопок
  window.scene = scene;
  window.camera = camera;
  window.controls = controls;
  window.holesGrp = holesGrp;
  window.blocksGrp = blocksGrp;
  window.oreGrp = oreGrp;
  console.log('[3D] Глобальные переменные установлены');
}
