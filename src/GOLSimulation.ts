import * as THREE from 'three';

// Define the structure of our game state
interface GameState {
    size: number;
    grid: Record<number, Record<number, Record<number, number>>> | null;
    nextGrid: Record<number, Record<number, Record<number, number>>> | null;
    instancedMesh: THREE.InstancedMesh | null;
    edgeInstancedMesh: THREE.InstancedMesh | null; 
    maxInstances: number;
    activeInstances: number;
    handPositions: THREE.Vector3[]; // World positions of active hands/controllers
    interactionRadius: number;
    lastUpdate: number;
    updateInterval: number; 
    recentlyAdded: Record<number, Record<number, Record<number, number>>>;
    cellMemory: number;
    transitionStart: number;
    bias: number;
    nextUpdateTime: Record<number, Record<number, Record<number, number>>>;
    baseUpdateInterval: number;
    maxOffset: number;
    // Keep a reference to the scene for internal use
    sceneRef?: THREE.Scene;
}

// Initialize game state
const gameState: GameState = {
    size: 30,
    grid: null,
    nextGrid: null,
    instancedMesh: null,
    edgeInstancedMesh: null,
    maxInstances: 30 * 30 * 30,
    activeInstances: 0,
    handPositions: [new THREE.Vector3(), new THREE.Vector3()],
    interactionRadius: 0.025, // Slightly increased from 0.02 for easier interaction
    lastUpdate: 0,
    updateInterval: 100,
    recentlyAdded: {},
    cellMemory: 1000,
    transitionStart: 500,
    bias: 0.59,
    nextUpdateTime: {},
    baseUpdateInterval: 100,
    maxOffset: 50
};

// Reusable objects
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scaleVec = new THREE.Vector3(1, 1, 1); // Renamed from 'scale' to avoid conflict

const initNextUpdateTimes = () => {
    const currentTime = Date.now();
    gameState.nextUpdateTime = {};
    for (let x = 0; x < gameState.size; x++) {
        gameState.nextUpdateTime[x] = {};
        for (let y = 0; y < gameState.size; y++) {
            gameState.nextUpdateTime[x][y] = {};
            for (let z = 0; z < gameState.size; z++) {
                gameState.nextUpdateTime[x][y][z] = currentTime + Math.random() * gameState.maxOffset;
            }
        }
    }
};

const initRecentlyAdded = () => {
    gameState.recentlyAdded = {};
    for (let x = 0; x < gameState.size; x++) {
        gameState.recentlyAdded[x] = {};
        for (let y = 0; y < gameState.size; y++) {
            gameState.recentlyAdded[x][y] = {};
            for (let z = 0; z < gameState.size; z++) {
                gameState.recentlyAdded[x][y][z] = 0;
            }
        }
    }
};

const createEmptyGrid = (size: number): Record<number, Record<number, Record<number, number>>> => {
    const grid: Record<number, Record<number, Record<number, number>>> = {};
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

const createBoundingBox = (): THREE.Mesh => {
    const boxSize = gameState.size * 0.011;
    const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    const material = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.05 // As per memory 5176d8b4-9309-4790-a1a8-a6b2781a4ddb
    });
    const boundingBox = new THREE.Mesh(geometry, material);
    return boundingBox;
};

const isNearCell = (cellX: number, cellY: number, cellZ: number, handPos: THREE.Vector3): boolean => {
    const cellWorldX = (cellX - gameState.size / 2) * 0.011;
    const cellWorldY = (cellY - gameState.size / 2) * 0.011;
    const cellWorldZ = (cellZ - gameState.size / 2) * 0.011;
    position.set(cellWorldX, cellWorldY, cellWorldZ);
    return position.distanceTo(handPos) < gameState.interactionRadius;
};

const addCellsNearHand = (controllers: THREE.XRTargetRaySpace[], isSelecting: boolean[]) => {
    if (!gameState.grid || !gameState.nextGrid) return;
    let needsUpdate = false;
    const currentTime = Date.now();

    for (let i = 0; i < controllers.length; i++) {
        if (isSelecting[i] && controllers[i]) {
            // Update hand position from controller's world position
            controllers[i].getWorldPosition(gameState.handPositions[i]);
            const handPos = gameState.handPositions[i];

            for (let x = 0; x < gameState.size; x++) {
                for (let y = 0; y < gameState.size; y++) {
                    for (let z = 0; z < gameState.size; z++) {
                        if (gameState.grid[x][y][z] === 0) {
                            if (isNearCell(x, y, z, handPos)) {
                                gameState.grid[x][y][z] = 1;
                                gameState.nextGrid[x][y][z] = 1;
                                gameState.recentlyAdded[x][y][z] = currentTime;
                                gameState.nextUpdateTime[x][y][z] = currentTime + gameState.cellMemory + Math.random() * gameState.maxOffset;
                                needsUpdate = true;
                            }
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

const countNeighbors = (x: number, y: number, z: number): number => {
    if (!gameState.grid) return 0;
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                const nz = z + dz;
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

const updateGrid = () => {
    if (!gameState.grid || !gameState.nextGrid) return;
    const currentTime = Date.now();
    let visualChangeOccurred = false;

    const biasMultiplier = (gameState.bias - 0.5) * 2;
    const survivalBias = Math.max(0, Math.min(0.9, biasMultiplier * 0.4));
    const birthBias = Math.max(0, Math.min(0.9, biasMultiplier * 0.4));

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
                    continue;
                }
                gameState.nextUpdateTime[x][y][z] = currentTime + gameState.baseUpdateInterval + Math.random() * gameState.maxOffset;

                const neighbors = countNeighbors(x, y, z);
                const currentState = gameState.grid[x][y][z];
                const lastAddedTime = gameState.recentlyAdded[x][y][z];
                const timeSinceAdded = currentTime - lastAddedTime;
                let nextState = currentState;

                if (timeSinceAdded < gameState.transitionStart) {
                    nextState = 1;
                } else if (timeSinceAdded < gameState.cellMemory) {
                    const transitionProgress = (timeSinceAdded - gameState.transitionStart) / (gameState.cellMemory - gameState.transitionStart);
                    if (Math.random() > transitionProgress * 0.8) {
                        nextState = 1;
                    } else {
                        if (currentState === 1) {
                            if (neighbors === 4) nextState = (Math.random() > (0.1 - survivalBias)) ? 1 : 0;
                            else if (neighbors === 3 || neighbors === 5) nextState = (Math.random() > (0.4 - survivalBias)) ? 1 : 0;
                            else nextState = (Math.random() > (0.99 - survivalBias)) ? 1 : 0;
                        } else {
                            if (neighbors === 4) nextState = (Math.random() > (0.7 - birthBias)) ? 1 : 0;
                            else if (neighbors === 3) nextState = (Math.random() > (0.95 - birthBias / 2)) ? 1 : 0;
                            else nextState = 0;
                        }
                    }
                } else {
                    if (currentState === 1) {
                        if (neighbors === 4) nextState = (Math.random() > (0.1 - survivalBias)) ? 1 : 0;
                        else if (neighbors === 3 || neighbors === 5) nextState = (Math.random() > (0.4 - survivalBias)) ? 1 : 0;
                        else nextState = (Math.random() > (0.99 - survivalBias)) ? 1 : 0;
                    } else {
                        if (neighbors === 4) nextState = (Math.random() > (0.7 - birthBias)) ? 1 : 0;
                        else if (neighbors === 3) nextState = (Math.random() > (0.95 - birthBias / 2)) ? 1 : 0;
                        else nextState = 0;
                    }
                }
                
                if (nextState === 1 && currentTime - lastAddedTime >= gameState.cellMemory) {
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

    const temp = gameState.grid;
    gameState.grid = gameState.nextGrid;
    gameState.nextGrid = temp;

    if (visualChangeOccurred) {
        updateInstancedMesh();
    }
};

const updateInstancedMesh = () => {
    if (!gameState.instancedMesh || !gameState.grid) return;
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
                    const timeSinceAdded = currentTime - gameState.recentlyAdded[x][y][z];
                    let scaleFactor = 1.0;
                    if (timeSinceAdded < gameState.transitionStart) {
                        scaleFactor = 1.1;
                    } else if (timeSinceAdded < gameState.cellMemory) {
                        const transitionProgress = (timeSinceAdded - gameState.transitionStart) / (gameState.cellMemory - gameState.transitionStart);
                        scaleFactor = 1.1 - (transitionProgress * 0.1);
                    }
                    scaleVec.set(scaleFactor, scaleFactor, scaleFactor);
                    matrix.compose(position, quaternion, scaleVec);
                    gameState.instancedMesh.setMatrixAt(instanceCount, matrix);
                    
                    if (gameState.edgeInstancedMesh) {
                        scaleVec.set(1, 1, 1);
                        matrix.compose(position, quaternion, scaleVec);
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

const createCubeMaterials = () => {
    // Main white cube material with slight transparency 
    const mainMaterial = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.9
    });

    // Black edge material 
    const edgeMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.3
    });

    return [mainMaterial, edgeMaterial];
}; 

export const initGOL = (scene: THREE.Scene, renderer: THREE.WebGLRenderer) => {
    gameState.sceneRef = scene; // Store scene reference

    const cubeGeom = new THREE.BoxGeometry(0.008, 0.008, 0.008);
    const [mainMaterial, edgeMaterial] = createCubeMaterials();

    gameState.instancedMesh = new THREE.InstancedMesh(cubeGeom, mainMaterial, gameState.maxInstances);
    const edgeGeom = new THREE.BoxGeometry(0.0085, 0.0085, 0.0085);
    gameState.edgeInstancedMesh = new THREE.InstancedMesh(edgeGeom, edgeMaterial, gameState.maxInstances);

    gameState.grid = createEmptyGrid(gameState.size);
    gameState.nextGrid = createEmptyGrid(gameState.size);
    initNextUpdateTimes();
    initRecentlyAdded();

    const boundingBox = createBoundingBox();
    scene.add(boundingBox);

    scene.add(gameState.instancedMesh);
    if (gameState.edgeInstancedMesh) scene.add(gameState.edgeInstancedMesh);

    if (gameState.instancedMesh) gameState.instancedMesh.count = 0;
    if (gameState.edgeInstancedMesh) gameState.edgeInstancedMesh.count = 0;

    const clickHandler = () => {
        if (gameState.instancedMesh && gameState.instancedMesh.material instanceof THREE.MeshBasicMaterial) {
            gameState.instancedMesh.material.color.setHSL(Math.random(), 1, 0.9);
        }
        gameState.bias = parseFloat(((gameState.bias + 0.25 - 0.25) % 1.00 + 0.25).toFixed(2));
        console.log("New Bias: ", gameState.bias);
    };

    // Attach click listener to renderer's DOM element for wider compatibility
    renderer.domElement.addEventListener('click', clickHandler);
    // Note: In an XR session, 'click' on domElement might not be the primary interaction.
    // 'select' events on controllers are typically used.
    // This click handler is more for desktop testing or non-XR interaction.
};

export const animateGOL = (currentTime: number, controllers: THREE.XRTargetRaySpace[], isSelecting: boolean[]) => {
    addCellsNearHand(controllers, isSelecting);

    if (currentTime - gameState.lastUpdate > gameState.updateInterval) {
        updateGrid();
        gameState.lastUpdate = currentTime;
    }
};
