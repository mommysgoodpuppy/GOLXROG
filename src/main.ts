import "./style.css";
import * as THREE from "three";
// import { ARButton } from 'three/examples/jsm/webxr/ARButton.js'; // Removed
// import { initGOL, animateGOL } from './GOLSimulation'; // Old GOL
import {
  animate as animateSimpleGOL,
  getRootObject as getSimpleGOLRoot,
  init as initSimpleGOL,
  setBoundingBoxVisibility,
} from "./SimpleGOL"; // New Simple GOL

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

const DEBUG_VISUALS = true;
type ControllerDebugBoard = {
  group: THREE.Group;
  buttonMeshes: THREE.Mesh[];
  axisIndicators: Array<{ mesh: THREE.Mesh; extent: number }>;
};
let xrSession: XRSession | null = null;
let vrButton: HTMLButtonElement;
let arButton: HTMLButtonElement;
let currentSessionType: "immersive-vr" | "immersive-ar" | null = null;
let projectionLayersDisabled = false;
let savedProjectionLayerFactory:
  | ((
    this: XRWebGLBinding,
    init?: XRProjectionLayerInit,
  ) => XRProjectionLayer)
  | undefined;
let debugHelperGroup: THREE.Group | null = null;
const controllerDebugBoards: ControllerDebugBoard[] = [];
const golAnchorPosition = new THREE.Vector3(0, 1.5, -0.5);
const VR_ANCHOR = new THREE.Vector3(0, 1.2, -0.5);
const AR_ANCHOR = new THREE.Vector3(0, -0.2, -0.5);
let golDebugOccluder: THREE.Mesh | null = null;
const BASE_CLEAR_COLOR = new THREE.Color(0x000000);
const VR_CLEAR_ALPHA = 1;
const AR_CLEAR_ALPHA = 0;

async function initAsync() {
  await init();
  animate();
}

initAsync();

function disableProjectionLayerSupport() {
  if (typeof window === "undefined") {
    return;
  }

  const globalWindow = window as typeof window & {
    XRWebGLBinding?: {
      prototype?: Record<string, unknown> & {
        createProjectionLayer?: typeof savedProjectionLayerFactory;
      };
    };
  };
  const bindingPrototype = globalWindow.XRWebGLBinding?.prototype;

  if (!bindingPrototype || projectionLayersDisabled) {
    projectionLayersDisabled = true;
    return;
  }

  if ("createProjectionLayer" in bindingPrototype) {
    savedProjectionLayerFactory = bindingPrototype.createProjectionLayer;
    try {
      delete bindingPrototype.createProjectionLayer;
      console.warn("Disabled XR projection layers; using XRWebGLLayer instead.");
    } catch (error) {
      console.warn("Failed to disable XR projection layers:", error);
    }
  }

  projectionLayersDisabled = true;
}

function enableProjectionLayerSupport() {
  if (typeof window === "undefined" || !projectionLayersDisabled) {
    return;
  }

  const globalWindow = window as typeof window & {
    XRWebGLBinding?: {
      prototype?: Record<string, unknown> & {
        createProjectionLayer?: typeof savedProjectionLayerFactory;
      };
    };
  };
  const bindingPrototype = globalWindow.XRWebGLBinding?.prototype;

  if (bindingPrototype && savedProjectionLayerFactory) {
    try {
      bindingPrototype.createProjectionLayer = savedProjectionLayerFactory;
    } catch (error) {
      console.warn("Failed to re-enable XR projection layers:", error);
    }
  }

  projectionLayersDisabled = false;
}

function setupDebugVisuals() {
  if (debugHelperGroup) {
    return;
  }

  debugHelperGroup = new THREE.Group();
  scene.add(debugHelperGroup);

  const axesHelper = new THREE.AxesHelper(0.5);
  debugHelperGroup.add(axesHelper);

   /*  const gridHelper = new THREE.GridHelper(
    4,
    20,
    new THREE.Color(0x00ffff),
    new THREE.Color(0x003355),
  );
  debugHelperGroup.add(gridHelper); */

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({
      color: 0x111133,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  debugHelperGroup.add(floor);

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(4, 2.5, 4),
    new THREE.MeshBasicMaterial({
      color: 0x224488,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    }),
  );
  room.position.y = 1.25;
  debugHelperGroup.add(room);

  const ambient = new THREE.AmbientLight(0x333366, 0.5);
  debugHelperGroup.add(ambient);

  controllerDebugBoards[0] = createControllerDebugBoard(0);
  controllerDebugBoards[1] = createControllerDebugBoard(1);

  updateSessionVisuals(currentSessionType);
}

function updateSessionVisuals(
  sessionType: "immersive-vr" | "immersive-ar" | null,
) {
  const isAR = sessionType === "immersive-ar";
  if (debugHelperGroup) {
    debugHelperGroup.visible = !isAR;
  }
  if (golDebugOccluder) {
    golDebugOccluder.visible = !isAR && renderer?.xr.isPresenting;
  }
  setBoundingBoxVisibility(true);
  if (sessionType === "immersive-ar") {
    golAnchorPosition.copy(AR_ANCHOR);
    renderer?.setClearColor(BASE_CLEAR_COLOR, AR_CLEAR_ALPHA);
  } else if (sessionType === "immersive-vr") {
    golAnchorPosition.copy(VR_ANCHOR);
    renderer?.setClearColor(BASE_CLEAR_COLOR, VR_CLEAR_ALPHA);
  }
  positionGOLRoot();
}

function positionGOLRoot() {
  const golRoot = getSimpleGOLRoot();
  if (!golRoot) return;

  golRoot.position.copy(golAnchorPosition);
  golRoot.updateMatrixWorld(true);

  if (golDebugOccluder) {
    golDebugOccluder.position.copy(golAnchorPosition);
  }
}

function createControllerDebugBoard(
  index: number,
): ControllerDebugBoard {
  const board = new THREE.Group();
  board.position.set(index === 0 ? -0.6 : 0.6, 1.05, -1);

  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.35),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    }),
  );
  panel.rotation.x = -Math.PI / 2;
  board.add(panel);

  const buttonMeshes: THREE.Mesh[] = [];
  const buttonGeometry = new THREE.BoxGeometry(0.04, 0.015, 0.04);

  for (let i = 0; i < 8; i++) {
    const material = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const button = new THREE.Mesh(buttonGeometry, material);
    const row = Math.floor(i / 4);
    const col = i % 4;
    button.position.set((col - 1.5) * 0.05, 0.02, -row * 0.05);
    board.add(button);
    buttonMeshes.push(button);
  }

  const axisIndicators: Array<{ mesh: THREE.Mesh; extent: number }> = [];
  for (let i = 0; i < 2; i++) {
    const axisGroup = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CircleGeometry(0.06, 32),
      new THREE.MeshBasicMaterial({
        color: 0x112244,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    base.rotation.x = -Math.PI / 2;
    axisGroup.add(base);

    const indicator = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 12, 6),
      new THREE.MeshBasicMaterial({ color: 0xffff00 }),
    );
    indicator.position.y = 0.01;
    axisGroup.add(indicator);

    axisGroup.position.set(i === 0 ? -0.2 : 0.2, 0.01, 0.1);
    board.add(axisGroup);
    axisIndicators.push({ mesh: indicator, extent: 0.04 });
  }

  debugHelperGroup?.add(board);

  return {
    group: board,
    buttonMeshes,
    axisIndicators,
  };
}

function setupXRButtons() {
  // Container for buttons
  const buttonContainer = document.createElement("div");
  buttonContainer.style.position = "absolute";
  buttonContainer.style.bottom = "20px";
  buttonContainer.style.left = "50%";
  buttonContainer.style.transform = "translateX(-50%)";
  buttonContainer.style.display = "flex";
  buttonContainer.style.gap = "10px";
  buttonContainer.style.zIndex = "999";

  // VR Button
  vrButton = document.createElement("button");
  vrButton.id = "vr-button";
  vrButton.textContent = "Enter VR";
  vrButton.style.padding = "12px 24px";
  vrButton.style.border = "1px solid #fff";
  vrButton.style.borderRadius = "4px";
  vrButton.style.background = "rgba(0, 0, 255, 0.5)";
  vrButton.style.color = "white";
  vrButton.style.font = "normal 18px sans-serif";
  vrButton.style.cursor = "pointer";

  vrButton.onmouseenter = () => {
    vrButton.style.background = "rgba(0, 0, 255, 0.7)";
  };
  vrButton.onmouseleave = () => {
    vrButton.style.background = "rgba(0, 0, 255, 0.5)";
  };

  vrButton.addEventListener("click", async () => {
    await handleXRButtonClick("immersive-vr");
  });

  // AR Button
  arButton = document.createElement("button");
  arButton.id = "ar-button";
  arButton.textContent = "Enter AR";
  arButton.style.padding = "12px 24px";
  arButton.style.border = "1px solid #fff";
  arButton.style.borderRadius = "4px";
  arButton.style.background = "rgba(0, 255, 0, 0.5)";
  arButton.style.color = "white";
  arButton.style.font = "normal 18px sans-serif";
  arButton.style.cursor = "pointer";

  arButton.onmouseenter = () => {
    arButton.style.background = "rgba(0, 255, 0, 0.7)";
  };
  arButton.onmouseleave = () => {
    arButton.style.background = "rgba(0, 255, 0, 0.5)";
  };

  arButton.addEventListener("click", async () => {
    await handleXRButtonClick("immersive-ar");
  });

  buttonContainer.appendChild(vrButton);
  buttonContainer.appendChild(arButton);
  document.body.appendChild(buttonContainer);

  // Check support for both modes
  checkXRSupport();
}

async function checkXRSupport() {
  if (navigator.xr) {
    // Check VR support
    try {
      const vrSupported = await navigator.xr.isSessionSupported("immersive-vr");
      if (!vrSupported) {
        vrButton.textContent = "VR Not Supported";
        vrButton.disabled = true;
        vrButton.style.opacity = "0.5";
        vrButton.style.cursor = "not-allowed";
      }
    } catch (error) {
      console.error("Error checking VR support:", error);
      vrButton.disabled = true;
      vrButton.style.opacity = "0.5";
    }

    // Check AR support
    try {
      const arSupported = await navigator.xr.isSessionSupported("immersive-ar");
      if (!arSupported) {
        arButton.textContent = "AR Not Supported";
        arButton.disabled = true;
        arButton.style.opacity = "0.5";
        arButton.style.cursor = "not-allowed";
      }
    } catch (error) {
      console.error("Error checking AR support:", error);
      arButton.disabled = true;
      arButton.style.opacity = "0.5";
    }
  } else {
    vrButton.textContent = "WebXR Not Available";
    vrButton.disabled = true;
    vrButton.style.opacity = "0.5";
    arButton.textContent = "WebXR Not Available";
    arButton.disabled = true;
    arButton.style.opacity = "0.5";
    console.warn("WebXR API not available");
  }
}

async function handleXRButtonClick(
  sessionType: "immersive-vr" | "immersive-ar",
) {
  const button = sessionType === "immersive-vr" ? vrButton : arButton;
  const otherButton = sessionType === "immersive-vr" ? arButton : vrButton;
  const modeName = sessionType === "immersive-vr" ? "VR" : "AR";

  if (xrSession) {
    try {
      await xrSession.end();
      // xrSession will be set to null by the 'end' event listener
    } catch (error) {
      console.error(`Error ending XR session:`, error);
      // Reset state even if end fails
      xrSession = null;
      currentSessionType = null;
      button.textContent = `Enter ${modeName}`;
      button.disabled = false;
      otherButton.disabled = false;
      otherButton.style.opacity = "1";
    }
  } else {
    if (navigator.xr) {
      try {
        const supported = await navigator.xr.isSessionSupported(sessionType);
        if (supported) {
          const session = await requestXRSession(sessionType);
          currentSessionType = sessionType;
          const sessionStarted = await onSessionStarted(session, sessionType);
          if (!sessionStarted) {
            try {
              await session.end();
            } catch {
              // Ignore cleanup errors
            }
            return;
          }

          // Disable the other button while in session
          otherButton.disabled = true;
          otherButton.style.opacity = "0.5";
        } else {
          button.textContent = `${modeName} Not Supported`;
          button.disabled = true;
          console.warn(`${sessionType} session not supported`);
        }
      } catch (error) {
        console.error(`Error requesting ${modeName} session:`, error);
        button.textContent = `${modeName} Failed`;
        button.disabled = true;
      }
    } else {
      button.textContent = "WebXR Not Available";
      button.disabled = true;
      console.warn("WebXR API not available");
    }
  }
}

async function requestXRSession(
  sessionType: "immersive-vr" | "immersive-ar",
) {
  const configs: XRSessionInit[] = sessionType === "immersive-ar"
    ? [
      { requiredFeatures: ["hit-test"], optionalFeatures: ["layers"] },
      { requiredFeatures: ["hit-test"] },
    ]
    : [
      { optionalFeatures: ["local-floor", "bounded-floor"] },
      { optionalFeatures: ["local-floor"] },
      {},
    ];

  let lastError: unknown = null;

  for (const config of configs) {
    try {
      return await navigator.xr.requestSession(sessionType, config);
    } catch (error) {
      lastError = error;
      const isNotSupported = error instanceof DOMException &&
        error.name === "NotSupportedError";
      if (!isNotSupported) {
        throw error;
      }
      console.warn(
        `Session config not supported (${JSON.stringify(config)}), trying fallback...`,
      );
    }
  }

  throw lastError ?? new Error("Unknown error requesting XR session");
}

async function onSessionStarted(
  session: XRSession,
  sessionType: "immersive-vr" | "immersive-ar",
): Promise<boolean> {
  xrSession = session;
  const modeName = sessionType === "immersive-vr" ? "VR" : "AR";
  const button = sessionType === "immersive-vr" ? vrButton : arButton;
  button.textContent = `Exit ${modeName}`;
  button.disabled = false;

  session.addEventListener("end", onSessionEnded);

  try {
    if (sessionType === "immersive-vr") {
      disableProjectionLayerSupport();
    } else {
      enableProjectionLayerSupport();
    }

    // Set appropriate reference space based on session type
    if (sessionType === "immersive-vr") {
      // For VR, try local-floor first, fallback to local
      try {
        renderer.xr.setReferenceSpaceType("local-floor");
      } catch {
        renderer.xr.setReferenceSpaceType("local");
      }
    } else {
      // For AR, use local reference space
      renderer.xr.setReferenceSpaceType("local");
    }
    await renderer.xr.setSession(session);
    updateSessionVisuals(sessionType);
    return true;
  } catch (error) {
    console.error("Error setting renderer XR session:", error);
    session.removeEventListener("end", onSessionEnded);
    xrSession = null;
    currentSessionType = null;
    button.textContent = `Enter ${modeName}`;
    button.disabled = false;
    return false;
  }
}

function onSessionEnded() {
  if (xrSession) {
    xrSession.removeEventListener("end", onSessionEnded);
    xrSession = null;
  }

  const modeName = currentSessionType === "immersive-vr" ? "VR" : "AR";
  const button = currentSessionType === "immersive-vr" ? vrButton : arButton;
  const otherButton = currentSessionType === "immersive-vr"
    ? arButton
    : vrButton;

  button.textContent = `Enter ${modeName}`;
  button.disabled = false;

  // Re-enable the other button
  otherButton.disabled = false;
  otherButton.style.opacity = "1";

  currentSessionType = null;
  updateSessionVisuals(null);
}

async function init() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();
  if (DEBUG_VISUALS) {
    setupDebugVisuals();
  }
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20,
  );

  // Create canvas and get XR-compatible context
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    xrCompatible: true,
    antialias: true,
    alpha: true,
  });

  if (!context) {
    console.error("Failed to get WebGL2 context");
    return;
  }

  // Make context XR-compatible
  try {
    await context.makeXRCompatible();
  } catch (error) {
    console.error("Failed to make context XR compatible:", error);
  }

  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    context: context as WebGLRenderingContext,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(BASE_CLEAR_COLOR, VR_CLEAR_ALPHA);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  setupXRButtons(); // Use the new dual-mode buttons

  controller0 = renderer.xr.getController(0);
  scene.add(controller0);
  controller0.addEventListener("connected", (event) => {
    if (event.data && event.data.handedness) {
      console.log(`Controller 0 connected: ${event.data.handedness}`);
    }
    if (sphere0) {
      sphere0.visible = true;
    }
  });
  controller0.addEventListener("disconnected", () => {
    console.log("Controller 0 disconnected");
    if (sphere0) {
      sphere0.visible = false;
    }
  });

  controller1 = renderer.xr.getController(1);
  scene.add(controller1);
  controller1.addEventListener("connected", (event) => {
    if (event.data && event.data.handedness) {
      console.log(`Controller 1 connected: ${event.data.handedness}`);
    }
    if (sphere1) {
      sphere1.visible = true;
    }
  });
  controller1.addEventListener("disconnected", () => {
    console.log("Controller 1 disconnected");
    if (sphere1) {
      sphere1.visible = false;
    }
  });

  const sphereRadius = 0.03;
  const sphereMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.5,
  });

  sphere0 = new THREE.Mesh(
    new THREE.SphereGeometry(sphereRadius, 16, 16),
    sphereMaterial,
  );
  sphere0.visible = false;
  scene.add(sphere0);

  sphere1 = new THREE.Mesh(
    new THREE.SphereGeometry(sphereRadius, 16, 16),
    sphereMaterial.clone(),
  );
  sphere1.visible = false;
  scene.add(sphere1);

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

initSimpleGOL(scene, renderer); // Use new SimpleGOL init
  positionGOLRoot();
  setBoundingBoxVisibility(true);

  window.addEventListener("resize", onWindowResize, false);
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
  if (!renderer || !renderer.xr.isPresenting) {
    if (sphere0) sphere0.visible = false;
    if (sphere1) sphere1.visible = false;
    return;
  }

  if (sphere0 && controller0.visible) {
    sphere0.visible = true;
    sphere0.position.setFromMatrixPosition(controller0.matrixWorld);
    sphere0.quaternion.setFromRotationMatrix(controller0.matrixWorld);
  } else if (sphere0) {
    sphere0.visible = false;
  }
  if (sphere1 && controller1.visible) {
    sphere1.visible = true;
    sphere1.position.setFromMatrixPosition(controller1.matrixWorld);
    sphere1.quaternion.setFromRotationMatrix(controller1.matrixWorld);
  } else if (sphere1) {
    sphere1.visible = false;
  }
}

function updateDebugVisuals() {
  if (!DEBUG_VISUALS || !debugHelperGroup || !renderer) {
    return;
  }

  if (golDebugOccluder) {
    golDebugOccluder.visible = renderer.xr.isPresenting;
  }
  const isActive = renderer.xr.isPresenting;

  controllerDebugBoards.forEach((board, index) => {
    if (!board) return;

    if (!isActive) {
      board.group.visible = false;
      return;
    }

    const controller = renderer.xr.getController(index);
    const inputSource = controller?.userData?.inputSource as
      | XRInputSource
      | undefined;
    const gamepad = inputSource?.gamepad;
    if (!gamepad) {
      board.group.visible = false;
      return;
    }

    board.group.visible = true;

    board.buttonMeshes.forEach((mesh, buttonIndex) => {
      const button = gamepad.buttons[buttonIndex];
      if (!button) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (button.pressed) {
        material.color.setHex(0xff3366);
      } else if (button.touched) {
        material.color.setHex(0x33ffaa);
      } else {
        material.color.setHex(0x333333);
      }
      mesh.scale.y = 1 + button.value * 0.8;
    });

    board.axisIndicators.forEach((indicator, axisIndex) => {
      const baseIndex = axisIndex * 2;
      if (gamepad.axes.length <= baseIndex + 1) {
        indicator.mesh.visible = false;
        return;
      }
      indicator.mesh.visible = true;
      const axisX = THREE.MathUtils.clamp(gamepad.axes[baseIndex], -1, 1);
      const axisY = THREE.MathUtils.clamp(
        gamepad.axes[baseIndex + 1],
        -1,
        1,
      );
      indicator.mesh.position.x = axisX * indicator.extent;
      indicator.mesh.position.z = -axisY * indicator.extent;
    });
  });
}

function render() {
  updateControllerSpheres();
  updateDebugVisuals();
  animateSimpleGOL(); // SimpleGOL animate doesn't require arguments like the old one

  renderer.render(scene, camera);
}
