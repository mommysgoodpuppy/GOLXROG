// Game of Life with Truly Deferred Updates

// Add next update time tracking to state
const gameState = {
  size: 30,
  grid: null,
  nextGrid: null,
  instancedMesh: null,
  edgeInstancedMesh: null, // Added from a previous step for edge effect
  maxInstances: 30 * 30 * 30,
  activeInstances: 0,
  handPositions: [new THREE.Vector3(), new THREE.Vector3()],
  interactionRadius: 0.02,
  lastUpdate: 0, // This might be redundant with per-cell updates, but kept from previous
  updateInterval: 100, // Base interval for GOL logic check, individual cells defer
  recentlyAdded: {},
  cellMemory: 1000,
  transitionStart: 500,
  bias: 0.59,
  nextUpdateTime: {}, // Store next update timestamp for each cell
  baseUpdateInterval: 100, // Used for scheduling next cell update
  maxOffset: 50 // Random offset for next cell update
};

// Reusable objects (some were defined in previous steps, ensure they are here)
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3(1, 1, 1);

// Debug spheres for hands (kept from previous steps, opacity can be 0)
const handDebugMeshes = [
  new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 8),
      new THREE.MeshBasicMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.0
      })
  ),
  new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 8),
      new THREE.MeshBasicMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.0
      })
  )
];


// Initialize next update times for each cell
const initNextUpdateTimes = () => {
  const currentTime = Date.now();
  gameState.nextUpdateTime = {};
  for (let x = 0; x < gameState.size; x++) {
      gameState.nextUpdateTime[x] = {};
      for (let y = 0; y < gameState.size; y++) {
          gameState.nextUpdateTime[x][y] = {};
          for (let z = 0; z < gameState.size; z++) {
              // Randomize initial next update time
              gameState.nextUpdateTime[x][y][z] = currentTime + Math.random() * gameState.maxOffset;
          }
      }
  }
};

const initRecentlyAdded = () => {
  gameState.recentlyAdded = {};
  for(let x = 0; x < gameState.size; x++) {
      gameState.recentlyAdded[x] = {};
      for(let y = 0; y < gameState.size; y++) {
          gameState.recentlyAdded[x][y] = {};
          for(let z = 0; z < gameState.size; z++) {
              gameState.recentlyAdded[x][y][z] = 0;
          }
      }
  }
};

const createEmptyGrid = (size) => {
  const grid = {};
  for (let x = 0; x < size; x++) {
      grid[x] = {};
      for (let y = 0; y < size; y++) {
          grid[x][y] = {};
          for (let z = 0; z < size; z++) {
              grid[x][y][z] = 0;
          }
      }
  }
  return grid;
};

// Create bounding box for game area
const createBoundingBox = () => {
  const boxSize = gameState.size * 0.011; // Ensure this matches cell spacing
  const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
  const material = new THREE.MeshBasicMaterial({
      color: 0x000000, // Black box
      side: THREE.BackSide, // Only render inner faces
      transparent: true,
      opacity: 0.1 // Slight opacity for the box
  });
  const boundingBox = new THREE.Mesh(geometry, material);
  // Center the box if needed, assuming origin is center of GOL grid
  // boundingBox.position.set(0,0,0); // Adjust if GOL grid is not centered at origin
  return boundingBox;
};


const isNearCell = (cellX, cellY, cellZ, handPos) => {
  // Calculate world position of the cell center
  const cellWorldX = (cellX - gameState.size / 2) * 0.011;
  const cellWorldY = (cellY - gameState.size / 2) * 0.011;
  const cellWorldZ = (cellZ - gameState.size / 2) * 0.011;

  // Use a temporary vector for cell position to avoid creating new objects in a loop
  position.set(cellWorldX, cellWorldY, cellWorldZ);

  return position.distanceTo(handPos) < gameState.interactionRadius;
};

const addCellsNearHand = () => {
  let needsUpdate = false;
  const currentTime = Date.now();

  for (let handIndex = 0; handIndex < gameState.handPositions.length; handIndex++) {
      const handPos = gameState.handPositions[handIndex];
      // Check if this hand is active (e.g., controller is present)
      // For simplicity, we assume if handPos is updated, it's active.
      // A more robust check might involve checking if the controller object exists.

      for (let x = 0; x < gameState.size; x++) {
          for (let y = 0; y < gameState.size; y++) {
              for (let z = 0; z < gameState.size; z++) {
                  if (gameState.grid[x][y][z] === 0) {
                      if (isNearCell(x, y, z, handPos)) {
                          gameState.grid[x][y][z] = 1; // Directly modify current grid
                          gameState.nextGrid[x][y][z] = 1; // Also set in nextGrid to avoid immediate GOL processing
                          gameState.recentlyAdded[x][y][z] = currentTime;
                          // Ensure it gets an update time for GOL rules later
                          gameState.nextUpdateTime[x][y][z] = currentTime + gameState.cellMemory + Math.random() * gameState.maxOffset;
                          needsUpdate = true;
                      }
                  }
              }
          }
      }
  }


  if (needsUpdate) {
      updateInstancedMesh();
  }
};

const countNeighbors = (x, y, z) => {
  let count = 0;
  for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;

              const nx = x + dx;
              const ny = y + dy;
              const nz = z + dz;

              // Check if neighbor is within bounds (no wrapping)
              if (nx >= 0 && nx < gameState.size &&
                  ny >= 0 && ny < gameState.size &&
                  nz >= 0 && nz < gameState.size) {
                  count += gameState.grid[nx][ny][nz];
              }
          }
      }
  }
  return count;
};

// Modified update function with true deferred updates
const updateGrid = () => {
  const currentTime = Date.now();
  let visualChangeOccurred = false; // Tracks if any cell visually changed state

  const biasMultiplier = (gameState.bias - 0.5) * 2;
  const survivalBias = Math.max(0, Math.min(0.9, biasMultiplier * 0.4));
  const birthBias = Math.max(0, Math.min(0.9, biasMultiplier * 0.4));

  // Operate on a copy for consistent neighbor counting within a tick
  for (let x = 0; x < gameState.size; x++) {
      for (let y = 0; y < gameState.size; y++) {
          for (let z = 0; z < gameState.size; z++) {
              gameState.nextGrid[x][y][z] = gameState.grid[x][y][z];
          }
      }
  }

  for (let x = 0; x < gameState.size; x++) {
      for (let y = 0; y < gameState.size; y++) {
          for (let z = 0; z < gameState.size; z++) {
              if (currentTime < gameState.nextUpdateTime[x][y][z]) {
                  continue; // Skip if not time to update this cell
              }

              // Schedule next update with new random offset
              gameState.nextUpdateTime[x][y][z] = currentTime + gameState.baseUpdateInterval +
                  Math.random() * gameState.maxOffset;

              const neighbors = countNeighbors(x, y, z); // Counts neighbors from gameState.grid
              const currentState = gameState.grid[x][y][z];
              const lastAddedTime = gameState.recentlyAdded[x][y][z];
              const timeSinceAdded = currentTime - lastAddedTime;

              let nextState = currentState;

              // Gradual transition for hand-placed cells
              if (timeSinceAdded < gameState.transitionStart) { // Full protection
                  nextState = 1;
              } else if (timeSinceAdded < gameState.cellMemory) { // Gradual transition
                  const transitionProgress = (timeSinceAdded - gameState.transitionStart) /
                      (gameState.cellMemory - gameState.transitionStart);
                  if (Math.random() > transitionProgress * 0.8) { // Higher chance of survival during transition
                      nextState = 1;
                  } else { // Start applying GOL rules
                      if (currentState === 1) {
                          if (neighbors === 4) {
                              nextState = (Math.random() > (0.1 - survivalBias)) ? 1 : 0;
                          } else if (neighbors === 3 || neighbors === 5) {
                              nextState = (Math.random() > (0.4 - survivalBias)) ? 1 : 0;
                          } else { // Over/Underpopulation
                              nextState = (Math.random() > (0.99 - survivalBias)) ? 1 : 0;
                          }
                      } else { // Birth
                          if (neighbors === 4) {
                              nextState = (Math.random() > (0.7 - birthBias)) ? 1 : 0;
                          } else if (neighbors === 3) {
                              nextState = (Math.random() > (0.95 - birthBias / 2)) ? 1 : 0;
                          } else {
                              nextState = 0;
                          }
                      }
                  }
              } else { // Normal GOL rules after transition
                  if (currentState === 1) { // Survival
                      if (neighbors === 4) {
                          nextState = (Math.random() > (0.1 - survivalBias)) ? 1 : 0;
                      } else if (neighbors === 3 || neighbors === 5) {
                          nextState = (Math.random() > (0.4 - survivalBias)) ? 1 : 0;
                      } else { // Over/Underpopulation
                          nextState = (Math.random() > (0.99 - survivalBias)) ? 1 : 0;
                      }
                  } else { // Birth
                      if (neighbors === 4) {
                          nextState = (Math.random() > (0.7 - birthBias)) ? 1 : 0;
                      } else if (neighbors === 3) {
                          nextState = (Math.random() > (0.95 - birthBias / 2)) ? 1 : 0;
                      } else {
                          nextState = 0;
                      }
                  }
              }
              
              // Random death chance (only if it's alive)
              if (nextState === 1 && currentTime - lastAddedTime >= gameState.cellMemory) { // Don't randomly kill protected cells
                  if (Math.random() > (0.95 + survivalBias)) {
                      nextState = 0;
                  }
              }

              if (gameState.nextGrid[x][y][z] !== nextState) {
                  gameState.nextGrid[x][y][z] = nextState;
                  visualChangeOccurred = true;
              }
          }
      }
  }

  // Swap grids
  const temp = gameState.grid;
  gameState.grid = gameState.nextGrid;
  gameState.nextGrid = temp;

  if (visualChangeOccurred) {
      updateInstancedMesh();
  }
};


const updateInstancedMesh = () => {
  let instanceCount = 0;
  let edgeInstanceCount = 0;
  const currentTime = Date.now();

  for (let x = 0; x < gameState.size; x++) {
      for (let y = 0; y < gameState.size; y++) {
          for (let z = 0; z < gameState.size; z++) {
              if (gameState.grid[x][y][z] === 1) {
                  position.set(
                      (x - gameState.size / 2) * 0.011,
                      (y - gameState.size / 2) * 0.011,
                      (z - gameState.size / 2) * 0.011
                  );

                  // Optional: Scale cells based on how recently they were added
                  const timeSinceAdded = currentTime - gameState.recentlyAdded[x][y][z];
                  let scaleFactor = 1.0;
                   if (timeSinceAdded < gameState.transitionStart) {
                      scaleFactor = 1.1; // Slightly larger during full protection
                  } else if (timeSinceAdded < gameState.cellMemory) {
                      const transitionProgress = (timeSinceAdded - gameState.transitionStart) /
                                                 (gameState.cellMemory - gameState.transitionStart);
                      scaleFactor = 1.1 - (transitionProgress * 0.1); // Shrink back to normal
                  }

                  scale.set(scaleFactor, scaleFactor, scaleFactor);
                  matrix.compose(position, quaternion, scale);
                  gameState.instancedMesh.setMatrixAt(instanceCount, matrix);
                  
                  // For edge mesh, use same position but original scale
                  if (gameState.edgeInstancedMesh) {
                      scale.set(1,1,1); // Reset scale for edge
                      matrix.compose(position, quaternion, scale);
                      gameState.edgeInstancedMesh.setMatrixAt(edgeInstanceCount, matrix);
                      edgeInstanceCount++;
                  }
                  instanceCount++;
              }
          }
      }
  }

  gameState.instancedMesh.count = instanceCount;
  gameState.instancedMesh.instanceMatrix.needsUpdate = true;
  gameState.activeInstances = instanceCount;

  if (gameState.edgeInstancedMesh) {
      gameState.edgeInstancedMesh.count = edgeInstanceCount;
      gameState.edgeInstancedMesh.instanceMatrix.needsUpdate = true;
  }
};


// Create materials with edge effect
const createCubeMaterials = () => {
  // Main white cube material with slight transparency
  const mainMaterial = new THREE.MeshBasicMaterial({
      color: 0xFFFFFF, // Start with white, click will change
      // transparent: true, // Make opaque if edge is used
      // opacity: 0.9
  });

  // Black edge material
  const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3 // Adjust for desired edge visibility
  });

  return [mainMaterial, edgeMaterial];
};


export const init = async () => {
  const cubeGeom = new THREE.BoxGeometry(0.008, 0.008, 0.008); // Main cube size
  const [mainMaterial, edgeMaterial] = createCubeMaterials();

  gameState.instancedMesh = new THREE.InstancedMesh(
      cubeGeom,
      mainMaterial, // Use mainMaterial here
      gameState.maxInstances
  );
  
  // Create edge mesh if desired
  const edgeGeom = new THREE.BoxGeometry(0.0085, 0.0085, 0.0085); // Slightly larger for outline
  gameState.edgeInstancedMesh = new THREE.InstancedMesh(
      edgeGeom,
      edgeMaterial, // Use edgeMaterial here
      gameState.maxInstances
  );

  gameState.grid = createEmptyGrid(gameState.size);
  gameState.nextGrid = createEmptyGrid(gameState.size);
  initNextUpdateTimes();
  initRecentlyAdded();

  const boundingBox = createBoundingBox();
  scene.add(boundingBox);

  scene.add(gameState.instancedMesh);
  scene.add(gameState.edgeInstancedMesh); // Add edge mesh to scene
  scene.add(handDebugMeshes[0]);
  scene.add(handDebugMeshes[1]);


  gameState.instancedMesh.count = 0;
  gameState.edgeInstancedMesh.count = 0;


  // Modified click handler to also adjust bias
  // Assuming 'scene' is a THREE.Scene object that can have event listeners,
  // or this needs to be adapted to your environment's input handling.
  // If 'scene' is not an EventDispatcher, this will error.
  // A common way is to add event listener to `renderer.domElement` or `window`.
  // For simplicity, kept as `scene.addEventListener`, replace if needed.
  const clickHandler = () => {
      const randColor = new THREE.Color().setHSL(Math.random(), 1, 0.9);
      if (gameState.instancedMesh && gameState.instancedMesh.material) {
          gameState.instancedMesh.material.color = randColor;
      }
      
      // Cycle between different bias values
      gameState.bias = parseFloat(((gameState.bias + 0.25 - 0.25) % 1.00 + 0.25).toFixed(2)); // 0.25, 0.5, 0.75, 1.0
       console.log("New Bias: ", gameState.bias);
  };

  // Check if scene is an EventDispatcher, otherwise use a global listener
  if (scene.addEventListener) {
       scene.addEventListener('click', clickHandler);
  } else {
      // Fallback or alternative input mechanism for your environment
      // e.g., window.addEventListener('click', clickHandler) if appropriate
      // or renderer.domElement.addEventListener('click', clickHandler)
      console.warn("Scene does not support addEventListener. Click to change color/bias might not work directly on scene.");
      // Example: renderer.domElement.addEventListener('click', clickHandler);
  }
};

export const animate = (deltaTime, frame) => {
  const currentTime = Date.now();

  // Update controller positions
  const controller0 = renderer.xr.getController(0);
  const controller1 = renderer.xr.getController(1);

  let handInteracted = false;

  if (controller0 && controller0.userData.isSelecting) { // Check if controller is active/selecting
      gameState.handPositions[0].copy(controller0.position).sub(scene.position);
      handDebugMeshes[0].position.copy(gameState.handPositions[0]);
      handDebugMeshes[0].updateMatrixWorld(true);
      handInteracted = true;
  } else {
      // Optionally hide or move away debug mesh if controller not active
      handDebugMeshes[0].position.set(0, -1000, 0); // Move far away
  }

  if (controller1 && controller1.userData.isSelecting) { // Check if controller is active/selecting
      gameState.handPositions[1].copy(controller1.position).sub(scene.position);
      handDebugMeshes[1].position.copy(gameState.handPositions[1]);
      handDebugMeshes[1].updateMatrixWorld(true);
      handInteracted = true;
  } else {
      handDebugMeshes[1].position.set(0, -1000, 0); // Move far away
  }

  if (handInteracted) {
      addCellsNearHand();
  }

  // Global GOL update check (individual cells update based on their own timers)
  // This `gameState.lastUpdate` and `gameState.updateInterval` drives the GOL logic pass.
  if (currentTime - gameState.lastUpdate > gameState.updateInterval) {
      updateGrid();
      gameState.lastUpdate = currentTime;
  }
};