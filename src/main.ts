import './style.css';
import * as THREE from 'three';
// import { ARButton } from 'three/examples/jsm/webxr/ARButton.js'; // Removed
import { initGOL, animateGOL } from './GOLSimulation'; // Import GOL functions

/* import { XRDevice, metaQuest3 } from 'iwer';

const xrDevice = new XRDevice(metaQuest3);
xrDevice.installRuntime(); */

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;

let controller0: THREE.XRTargetRaySpace;
let controller1: THREE.XRTargetRaySpace;
let sphere0: THREE.Mesh;
let sphere1: THREE.Mesh;

const controllerSelecting: boolean[] = [false, false];
let xrSession: XRSession | null = null;
let arButton: HTMLButtonElement;

init();
animate();

function setupManualARButton() {
  arButton = document.createElement('button');
  arButton.id = 'ar-button';
  arButton.textContent = 'Enter AR';
  arButton.style.position = 'absolute';
  arButton.style.bottom = '20px';
  arButton.style.left = '50%';
  arButton.style.transform = 'translateX(-50%)';
  arButton.style.padding = '12px 24px';
  arButton.style.border = '1px solid #fff';
  arButton.style.borderRadius = '4px';
  arButton.style.background = 'rgba(0, 0, 0, 0.5)';
  arButton.style.color = 'white';
  arButton.style.font = 'normal 18px sans-serif';
  arButton.style.zIndex = '999';
  arButton.style.cursor = 'pointer';

  arButton.onmouseenter = () => { arButton.style.background = 'rgba(0, 0, 0, 0.7)'; };
  arButton.onmouseleave = () => { arButton.style.background = 'rgba(0, 0, 0, 0.5)'; };

  arButton.addEventListener('click', async () => {
    if (xrSession) {
      try {
        await xrSession.end();
        // xrSession will be set to null by the 'end' event listener below
      } catch (error) {
        console.error('Error ending XR session:', error);
        // Reset button state even if end fails for some reason
        xrSession = null;
        arButton.textContent = 'Enter AR';
        arButton.disabled = false;
      }
    } else {
      if (navigator.xr) {
        try {
          const supported = await navigator.xr.isSessionSupported('immersive-ar');
          if (supported) {
            const session = await navigator.xr.requestSession('immersive-ar',
              { requiredFeatures: ['hit-test'] }
            );
            onSessionStarted(session);
          } else {
            arButton.textContent = 'AR Not Supported';
            arButton.disabled = true;
            console.warn('immersive-ar session not supported');
          }
        } catch (error) {
          console.error('Error requesting AR session:', error);
          arButton.textContent = 'AR Failed';
          arButton.disabled = true;
        }
      } else {
        arButton.textContent = 'WebXR Not Available';
        arButton.disabled = true;
        console.warn('WebXR API not available');
      }
    }
  });
  document.body.appendChild(arButton);
}

async function onSessionStarted(session: XRSession) {
  xrSession = session;
  arButton.textContent = 'Exit AR';
  arButton.disabled = false;

  session.addEventListener('end', onSessionEnded);

  try {
    // Explicitly set a reference space type suitable for AR before setting the session.
    // 'local' is generally good for placing objects in the user's environment.
    // If 'local' fails, 'viewer' could be another option.
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
  } catch (error) {
    console.error('Error setting renderer XR session:', error);
    // Clean up if setting session fails
    xrSession = null;
    arButton.textContent = 'Enter AR';
    arButton.disabled = false;
  }
}

function onSessionEnded() {
  if (xrSession) {
    xrSession.removeEventListener('end', onSessionEnded);
    xrSession = null;
  }
  arButton.textContent = 'Enter AR';
  arButton.disabled = false;
  // Important: Reset renderer's session as well
  // This is implicitly handled by Three.js when a session ends or is replaced,
  // but good to be aware of. If issues arise, one might need:
  // await renderer.xr.setSession(null);
}

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

  setupManualARButton(); // Use the manual button

  controller0 = renderer.xr.getController(0);
  scene.add(controller0);
  controller0.addEventListener('selectstart', () => { controllerSelecting[0] = true; });
  controller0.addEventListener('selectend', () => { controllerSelecting[0] = false; });
  controller0.addEventListener('connected', (event) => {
    if (event.data && event.data.handedness) {
      console.log(`Controller 0 connected: ${event.data.handedness}`);
      if(sphere0) sphere0.visible = true;
    }
  });
  controller0.addEventListener('disconnected', () => {
    console.log('Controller 0 disconnected');
    if(sphere0) sphere0.visible = false;
    controllerSelecting[0] = false;
  });

  controller1 = renderer.xr.getController(1);
  scene.add(controller1);
  controller1.addEventListener('selectstart', () => { controllerSelecting[1] = true; });
  controller1.addEventListener('selectend', () => { controllerSelecting[1] = false; });
  controller1.addEventListener('connected', (event) => {
    if (event.data && event.data.handedness) {
      console.log(`Controller 1 connected: ${event.data.handedness}`);
      if(sphere1) sphere1.visible = true;
    }
  });
  controller1.addEventListener('disconnected', () => {
    console.log('Controller 1 disconnected');
    if(sphere1) sphere1.visible = false;
    controllerSelecting[1] = false;
  });

  const sphereRadius = 0.03;
  const sphereMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true });

  sphere0 = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius, 16, 16), sphereMaterial);
  sphere0.visible = false;
  scene.add(sphere0);

  sphere1 = new THREE.Mesh(new THREE.SphereGeometry(sphereRadius, 16, 16), sphereMaterial.clone());
  sphere1.visible = false;
  scene.add(sphere1);

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  initGOL(scene, renderer);

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
    sphere0.position.setFromMatrixPosition(controller0.matrixWorld);
    sphere0.quaternion.setFromRotationMatrix(controller0.matrixWorld);
  }
  if (sphere1 && sphere1.visible && controller1) {
    sphere1.position.setFromMatrixPosition(controller1.matrixWorld);
    sphere1.quaternion.setFromRotationMatrix(controller1.matrixWorld);
  }
}

function render() {
  updateControllerSpheres();
  animateGOL(Date.now(), [controller0, controller1], controllerSelecting);
  renderer.render(scene, camera);
}
