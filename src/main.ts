import './style.css';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let cube: THREE.Mesh;

// Variables for controllers and spheres
let controller0: THREE.XRTargetRaySpace;
let controller1: THREE.XRTargetRaySpace;
let sphere0: THREE.Mesh;
let sphere1: THREE.Mesh;

init();
animate();

function init() {
  const container = document.createElement('div');
  document.body.appendChild(container);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.setClearAlpha(0);
  container.appendChild(renderer.domElement);

  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const material = new THREE.MeshNormalMaterial();
  cube = new THREE.Mesh(geometry, material);
  cube.position.set(0, 0, -1);
  scene.add(cube);

  document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

  // Setup controllers
  controller0 = renderer.xr.getController(0);
  scene.add(controller0); // Add to scene, might hold a ray model later

  controller1 = renderer.xr.getController(1);
  scene.add(controller1); // Add to scene

  // Create sphere geometry and material for visualization
  const sphereRadius = 0.03; // Small sphere
  // Material matching memory: opacity 0.5
  const sphereMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true });

  // Create sphere for controller 0
  sphere0 = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius, 16, 16), sphereMaterial);
  sphere0.visible = false; // Initially invisible
  scene.add(sphere0); // Add sphere directly to the scene

  // Create sphere for controller 1
  sphere1 = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius, 16, 16), sphereMaterial.clone()); // Clone material
  sphere1.visible = false; // Initially invisible
  scene.add(sphere1); // Add sphere directly to the scene

  // Light for Phong material
  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  // Event listeners for controller connection
  controller0.addEventListener('connected', (event) => {
    if (event.data && event.data.handedness) { // event.data is XRInputSource
      console.log(`Controller 0 connected: ${event.data.handedness}`);
      sphere0.visible = true;
    }
  });
  controller0.addEventListener('disconnected', () => {
    console.log('Controller 0 disconnected');
    sphere0.visible = false;
  });

  controller1.addEventListener('connected', (event) => {
    if (event.data && event.data.handedness) {
      console.log(`Controller 1 connected: ${event.data.handedness}`);
      sphere1.visible = true;
    }
  });
  controller1.addEventListener('disconnected', () => {
    console.log('Controller 1 disconnected');
    sphere1.visible = false;
  });

  window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function updateControllerSpheres() {
  if (sphere0 && sphere0.visible && controller0) {
    // controller0.matrixWorld already contains the world transform
    sphere0.position.setFromMatrixPosition(controller0.matrixWorld);
    sphere0.quaternion.setFromRotationMatrix(controller0.matrixWorld);
  }
  if (sphere1 && sphere1.visible && controller1) {
    sphere1.position.setFromMatrixPosition(controller1.matrixWorld);
    sphere1.quaternion.setFromRotationMatrix(controller1.matrixWorld);
  }
}

function render() {
  if (cube) {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
  }

  updateControllerSpheres(); // Manually update sphere positions

  renderer.render(scene, camera);
}

