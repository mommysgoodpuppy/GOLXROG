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
    handPositions: THREE.Vector3[];
    interactionRadius: number;
    lastUpdate: number;
    updateInterval: number;
    recentlyAdded: Record<number, Record<number, Record<number, number>>>;
    cellMemory: number;
    bias: number;
}

// State
const gameState: GameState = {
    size: 30,
    grid: null,
    nextGrid: null,
    instancedMesh: null,
    edgeInstancedMesh: null,
    maxInstances: 30 * 30 * 30,
    activeInstances: 0,
    handPositions: [new THREE.Vector3(), new THREE.Vector3()],
    interactionRadius: 0.02,
    lastUpdate: 0,
    updateInterval: 100,
    recentlyAdded: {},
    cellMemory: 700,
    bias: 0.59
};

let localScene: THREE.Scene;
let localRenderer: THREE.WebGLRenderer;

const createBoundingBox = (): THREE.Mesh => {
    const boxSize = gameState.size * 0.011;
    const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    const material = new THREE.MeshBasicMaterial({
        color: 0x000000, // Black, opaque as per snippet
        side: THREE.BackSide  // Only render inner faces
    });
    const boundingBox = new THREE.Mesh(geometry, material);
    return boundingBox;
};

// Initialize recentlyAdded structure
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

const geometry = new THREE.BoxGeometry(0.008, 0.008, 0.008);
const createCubeMaterials = () => {
    // Main white cube material with slight transparency 
    const mainMaterial = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 1
    });

    // Black edge material 
    const edgeMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.3
    });

    return [mainMaterial, edgeMaterial];
}; 

const handDebugMeshes = [
    new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 16, 8),
        new THREE.MeshBasicMaterial({ 
            transparent: true,
            opacity: 0.0 // Invisible as per snippet
        })
    ),
    new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 16, 8),
        new THREE.MeshBasicMaterial({ 
            transparent: true,
            opacity: 0.0 // Invisible as per snippet
        })
    )
];

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3(1, 1, 1);

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

const isNearCell = (cellX: number, cellY: number, cellZ: number, handPos: THREE.Vector3): boolean => {
    position.set(
        (cellX - gameState.size/2) * 0.011,
        (cellY - gameState.size/2) * 0.011,
        (cellZ - gameState.size/2) * 0.011
    );
    
    return position.distanceTo(handPos) < gameState.interactionRadius;
};

const addCellsNearHand = () => {
    if (!gameState.grid) return;
    let needsUpdate = false;
    const currentTime = Date.now();
    
    for(let x = 0; x < gameState.size; x++) {
        for(let y = 0; y < gameState.size; y++) {
            for(let z = 0; z < gameState.size; z++) {
                if (gameState.grid[x][y][z] === 0) {
                    // Check both hand positions (updated in animate)
                    if (isNearCell(x, y, z, gameState.handPositions[0]) || 
                        isNearCell(x, y, z, gameState.handPositions[1])) {
                        gameState.grid[x][y][z] = 1;
                        gameState.recentlyAdded[x][y][z] = currentTime;
                        needsUpdate = true;
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
    for(let dx = -1; dx <= 1; dx++) {
        for(let dy = -1; dy <= 1; dy++) {
            for(let dz = -1; dz <= 1; dz++) {
                if(dx === 0 && dy === 0 && dz === 0) continue;
                
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
    
    const biasMultiplier = (gameState.bias - 0.5) * 2; // -1 to 1
    const survivalBias = Math.max(0, Math.min(0.9, biasMultiplier * 0.4));
    const birthBias = Math.max(0, Math.min(0.9, biasMultiplier * 0.4));
    
    for(let x = 0; x < gameState.size; x++) {
        for(let y = 0; y < gameState.size; y++) {
            for(let z = 0; z < gameState.size; z++) {
                const neighbors = countNeighbors(x, y, z);
                const currentState = gameState.grid[x][y][z];
                const lastAddedTime = gameState.recentlyAdded[x][y][z];
                
                if (currentTime - lastAddedTime < gameState.cellMemory) {
                    gameState.nextGrid[x][y][z] = 1;
                    continue;
                }

                if(currentState === 1) {
                    if (neighbors === 4) {
                        gameState.nextGrid[x][y][z] = (Math.random() > (0.1 - survivalBias)) ? 1 : 0;
                    } else if (neighbors === 3 || neighbors === 5) {
                        gameState.nextGrid[x][y][z] = (Math.random() > (0.4 - survivalBias)) ? 1 : 0;
                    } else if (neighbors > 5) {
                        gameState.nextGrid[x][y][z] = (Math.random() > (0.99 - survivalBias)) ? 1 : 0;
                    } else {
                        gameState.nextGrid[x][y][z] = (Math.random() > (0.99 - survivalBias)) ? 1 : 0;
                    }
                } else {
                    if (neighbors === 4) {
                        gameState.nextGrid[x][y][z] = (Math.random() > (0.7 - birthBias)) ? 1 : 0;
                    } else if (neighbors === 3) {
                        gameState.nextGrid[x][y][z] = (Math.random() > (0.95 - birthBias/2)) ? 1 : 0;
                    } else {
                        gameState.nextGrid[x][y][z] = 0;
                    }
                }

                if (gameState.nextGrid[x][y][z] === 1) {
                    if (Math.random() > (0.95 + survivalBias)) {
                        gameState.nextGrid[x][y][z] = 0;
                    }
                }
            }
        }
    }

    [gameState.grid, gameState.nextGrid] = [gameState.nextGrid, gameState.grid];
    updateInstancedMesh();
};

const updateInstancedMesh = () => {
    if (!gameState.instancedMesh || !gameState.grid) return;
    let instanceCount = 0;
    
    for(let x = 0; x < gameState.size; x++) {
        for(let y = 0; y < gameState.size; y++) {
            for(let z = 0; z < gameState.size; z++) {
                if(gameState.grid[x][y][z] === 1) {
                    position.set(
                        (x - gameState.size/2) * 0.011,
                        (y - gameState.size/2) * 0.011,
                        (z - gameState.size/2) * 0.011
                    );
                    matrix.compose(position, quaternion, scale);
                    gameState.instancedMesh.setMatrixAt(instanceCount, matrix);
                    if (gameState.edgeInstancedMesh) {
                        gameState.edgeInstancedMesh.setMatrixAt(instanceCount, matrix); // Also update edge mesh
                    }
                    instanceCount++;
                }
            }
        }
    }
    
    gameState.instancedMesh.count = instanceCount;
    gameState.instancedMesh.instanceMatrix.needsUpdate = true;
    if (gameState.edgeInstancedMesh) {
        gameState.edgeInstancedMesh.count = instanceCount;
        gameState.edgeInstancedMesh.instanceMatrix.needsUpdate = true;
    }
    gameState.activeInstances = instanceCount;
};

export const init = (scene: THREE.Scene, renderer: THREE.WebGLRenderer) => {
    localScene = scene;
    localRenderer = renderer;

    const cubeGeom = new THREE.BoxGeometry(0.008, 0.008, 0.008);
    const [mainMaterial, edgeMaterial] = createCubeMaterials();
    
    gameState.instancedMesh = new THREE.InstancedMesh(
        cubeGeom,
        mainMaterial,
        gameState.maxInstances
    );
    
    const edgeGeom = new THREE.BoxGeometry(0.0085, 0.0085, 0.0085);
    gameState.edgeInstancedMesh = new THREE.InstancedMesh(
        edgeGeom,
        edgeMaterial,
        gameState.maxInstances
    );
    
    gameState.grid = createEmptyGrid(gameState.size);
    gameState.nextGrid = createEmptyGrid(gameState.size);
    initRecentlyAdded();
    
    const boundingBox = createBoundingBox();
    localScene.add(boundingBox);
    
    localScene.add(gameState.instancedMesh);
    if (gameState.edgeInstancedMesh) localScene.add(gameState.edgeInstancedMesh);
    localScene.add(handDebugMeshes[0]);
    localScene.add(handDebugMeshes[1]);

    gameState.instancedMesh.count = 0;
    if (gameState.edgeInstancedMesh) gameState.edgeInstancedMesh.count = 0;

    localRenderer.domElement.addEventListener('click', () => {
        if (gameState.instancedMesh && gameState.instancedMesh.material instanceof THREE.MeshBasicMaterial) {
            const randColor = new THREE.Color().setHSL(Math.random(), 1, 0.9);
            gameState.instancedMesh.material.color = randColor;
        }
        
        gameState.bias = (gameState.bias + 0.25);
        if (gameState.bias > 1.25) gameState.bias = 0.25; 
        else if (gameState.bias < 0.25) gameState.bias = 0.25; // Ensure bias loops correctly and stays in range
        console.log("New Bias: ", gameState.bias.toFixed(2));
    });
};

export const animate = () => {
    const currentTime = Date.now();
    
    const controller0 = localRenderer.xr.getController(0);
    const controller1 = localRenderer.xr.getController(1);
    
    let handInteracted = false;
    if (controller0 && controller0.matrixWorld) { // Check matrixWorld as an indicator of presence
        gameState.handPositions[0].setFromMatrixPosition(controller0.matrixWorld);
        localScene.worldToLocal(gameState.handPositions[0]); // Convert to GOL local space if scene is offset
        
        handDebugMeshes[0].position.setFromMatrixPosition(controller0.matrixWorld);
        handDebugMeshes[0].updateMatrixWorld(true);
        handInteracted = true;
    } else {
        handDebugMeshes[0].position.set(0,-1000,0); // Move off-screen
    }
    
    if (controller1 && controller1.matrixWorld) {
        gameState.handPositions[1].setFromMatrixPosition(controller1.matrixWorld);
        localScene.worldToLocal(gameState.handPositions[1]);

        handDebugMeshes[1].position.setFromMatrixPosition(controller1.matrixWorld);
        handDebugMeshes[1].updateMatrixWorld(true);
        handInteracted = true;
    } else {
        handDebugMeshes[1].position.set(0,-1000,0); // Move off-screen
    }
    
    if (handInteracted) {
        addCellsNearHand();
    }

    if(currentTime - gameState.lastUpdate > gameState.updateInterval) {
        updateGrid();
        gameState.lastUpdate = currentTime;
    }
};
