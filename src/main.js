import { createClient } from '@supabase/supabase-js';
import { loginWithGoogle, setupAuthListener } from './firebase.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const WORLD_SIZE = 2000;
const INITIAL_MASS = 10;
const VIRUS_RADIUS = 35;
const FOOD_RADIUS = 5;

const state = { myCells: [], players: new Map(), pixels: new Map(), lastSync: 0 };

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let width, height;

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}
window.addEventListener('resize', resize);
resize();

const loginContainer = document.getElementById('login-container');
const loginBtn = document.getElementById('login-btn');
const gameUi = document.getElementById('game-ui');
const scoreEl = document.getElementById('score');
const leaderboardList = document.getElementById('leaderboard-list');

// New UI Elements
const rainbowCheckbox = document.getElementById('rainbow-text-checkbox');
const skinUrlInput = document.getElementById('skin-url');
const skinFileInput = document.getElementById('skin-file');
let loadedSkinData = null; // Holds base64 or URL

skinFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            loadedSkinData = event.target.result;
            skinUrlInput.value = "Image Loaded File";
        };
        reader.readAsDataURL(file);
    }
});

let selectedColor = null;
const colorPickerContainer = document.getElementById('color-picker-container');
const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ff9800', '#ff5722', '#795548'];

colors.forEach(c => {
    let div = document.createElement('div');
    div.className = 'color-swatch';
    div.style.backgroundColor = c;
    div.onclick = () => {
        document.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        selectedColor = c;
    };
    colorPickerContainer.appendChild(div);
});

// Select random color by default on the UI
const randomDefaultSwatches = document.querySelectorAll('.color-swatch');
if (randomDefaultSwatches.length > 0) {
    const randomPick = randomDefaultSwatches[Math.floor(Math.random() * randomDefaultSwatches.length)];
    randomPick.click();
}

const keys = { w: false, space: false };
const mouse = { x: width / 2, y: height / 2 };

window.addEventListener('keydown', e => {
    if (e.key === 'w' || e.key === 'W') {
        if (!keys.w) ejectMass();
        keys.w = true;
    }
    if (e.code === 'Space') {
        if (!keys.space) doPlayerSplit();
        keys.space = true;
    }
});
window.addEventListener('keyup', e => {
    if (e.key === 'w' || e.key === 'W') keys.w = false;
    if (e.code === 'Space') keys.space = false;
});
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });

window.addEventListener('beforeunload', () => {
    if (state.myCells.length > 0) {
        // Delete all my cells from DB on disconnect for dynamic leaderboard cleanup
        const ids = state.myCells.map(c => c.id);
        supabase.from('players').delete().in('id', ids).then();
    }
});

const randomColor = () => `hsl(${Math.floor(Math.random() * 360)}, 80%, 50%)`;

// Mass -> Radius calculation (Area is proportional to Mass)
function getRadius(mass) {
    return Math.sqrt(mass) * 8;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const myOwnerId = generateUUID(); // Unique session ID to identify my pieces

async function initPlayer(user) {
    const skinData = skinUrlInput.value && skinUrlInput.value !== "Image Loaded File" ? skinUrlInput.value : loadedSkinData;

    const cell = {
        id: generateUUID(), // Unique ID per spawn so players using the same SSO account don't overwrite each other
        owner_id: myOwnerId,
        name: user.displayName || 'Player',
        x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        size: INITIAL_MASS,
        displaySize: INITIAL_MASS, // For fluid animation
        color: selectedColor || randomColor(),
        skin: skinData || null, // Custom Image URL/Base64
        rainbow: rainbowCheckbox.checked, // Rainbow Text Flag
        targetX: 0, targetY: 0,
        vx: 0, vy: 0 // Velocity for split/eject physics
    };
    cell.targetX = cell.x;
    cell.targetY = cell.y;

    state.myCells.push(cell);

    // initial sync
    await syncPlayer();

    loginContainer.style.display = 'none';
    gameUi.style.display = 'block';

    setupRealtime();
    requestAnimationFrame(gameLoop);
}

// --- Additional UI Elements ---
const deathScreen = document.getElementById('death-screen');
const deathStats = document.getElementById('death-stats');
const respawnBtn = document.getElementById('respawn-btn');

function resetGameUI() {
    deathScreen.style.display = 'none';
    gameUi.style.display = 'none';
    loginContainer.style.display = 'block';

    // reset local player state cleanly
    state.myCells = [];
    scoreEl.innerText = '0';
}

respawnBtn.addEventListener('click', resetGameUI);

function isMyCell(id) {
    return state.myCells.some(c => c.id === id);
}

let gameRoomChannel = null;
let isRealtimeConnected = false;

function setupRealtime() {
    supabase.from('pixels').select('*').then(({ data }) => {
        if (data) {
            data.forEach(p => {
                if (p.color && p.color.endsWith('|e')) {
                    p.isEjected = true;
                    p.color = p.color.slice(0, -2);
                }
                state.pixels.set(p.id, p);
            });
        }
    });

    supabase.from('players').select('*').then(({ data }) => {
        if (data) {
            data.forEach(p => {
                if (!isMyCell(p.id)) {
                    p.targetX = p.x; p.targetY = p.y; p.targetSize = p.size;
                    state.players.set(p.id, p);
                }
            });
        }
    });

    gameRoomChannel = supabase.channel('game_room', {
        config: {
            broadcast: { ack: false } // Essential to enable efficient client-to-client WebSockets without DB persistence
        }
    });

    gameRoomChannel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, payload => {
            const { eventType, new: newRec, old: oldRec } = payload;
            if (newRec && isMyCell(newRec.id)) return;
            // Only care about INSERT and DELETE from DB now (movements handled by broadcast)
            if (eventType === 'INSERT') {
                let player = state.players.get(newRec.id);
                if (!player) {
                    player = {
                        ...newRec,
                        targetX: newRec.x, targetY: newRec.y,
                        targetSize: newRec.size,
                        x: newRec.x, y: newRec.y,
                        size: newRec.size,
                        lastUpdate: Date.now(),
                        skin: newRec.skin || null,
                        rainbow: newRec.rainbow || false
                    };
                    state.players.set(newRec.id, player);
                }
            } else if (eventType === 'DELETE') {
                state.players.delete(oldRec.id);
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pixels' }, payload => {
            const { eventType, new: newRec, old: oldRec } = payload;
            if (eventType === 'INSERT') {
                if (newRec.color && newRec.color.endsWith('|e')) {
                    newRec.isEjected = true;
                    newRec.color = newRec.color.slice(0, -2);
                }
                if (!state.pixels.has(newRec.id)) state.pixels.set(newRec.id, newRec);
            }
            else if (eventType === 'DELETE') state.pixels.delete(oldRec.id);
        })
        .on('broadcast', { event: 'pos' }, payload => {
            // High-frequency low-latency positional updates (No DB touch)
            const updates = payload.payload.updates;
            if (!updates) return;
            updates.forEach(u => {
                if (isMyCell(u.id)) return;
                let player = state.players.get(u.id);
                if (!player) {
                    player = { ...u, targetX: u.x, targetY: u.y, targetSize: u.size, lastUpdate: Date.now(), x: u.x, y: u.y };
                    state.players.set(u.id, player);
                } else {
                    player.targetX = u.x; player.targetY = u.y; player.targetSize = u.size;
                    // Update cosmetics if they changed recently
                    if (u.name) player.name = u.name;
                    if (u.color) player.color = u.color;
                    player.skin = u.skin || player.skin;
                    player.rainbow = u.rainbow !== undefined ? u.rainbow : player.rainbow;
                    player.lastUpdate = Date.now();
                }
            });
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                isRealtimeConnected = true;
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                isRealtimeConnected = false;
            }
        });

    // Global garbage collector: automatically delete completely inactive ghost players from DB
    setInterval(() => {
        const staleTime = new Date(Date.now() - 15000).toISOString();
        supabase.from('players').delete().lt('updated_at', staleTime).then();
    }, 15000);
}

const syncInterval = 50; // Super fast 20 FPS Broadcast Sync
let lastDbUpsert = 0;

async function syncPlayer() {
    const now = Date.now();
    updateLeaderboard();

    if (now - state.lastSync > syncInterval && state.myCells.length > 0) {
        state.lastSync = now;

        const updates = state.myCells.map(c => ({
            id: c.id,
            name: c.name,
            x: c.x, y: c.y,
            size: c.size,
            color: c.color,
            skin: c.skin,
            rainbow: c.rainbow,
            updated_at: new Date().toISOString()
        }));

        // Send High-frequency Positional Update (Peer-to-Peer feeling via WebSocket)
        if (gameRoomChannel && isRealtimeConnected) {
            gameRoomChannel.send({
                type: 'broadcast',
                event: 'pos',
                payload: { updates }
            }).catch(err => {
                // Ignore silent drops on ultra-fast UDP-like sends
            });
        }

        // Throttle Heavy Database Upserts (For Persistence & Late joiners) to once every 2 seconds
        if (now - lastDbUpsert > 2000) {
            lastDbUpsert = now;
            supabase.from('players').upsert(updates).then();
        }
    }
}

function ejectMass() {
    if (state.myCells.length === 0) return;

    // Eject from all cells > 20 mass (lowered for easier feeding)
    state.myCells.forEach(cell => {
        if (cell.size > 20) {
            cell.size -= 5; // Lose 5 mass

            const angle = getMouseAngle(cell);
            const id = generateUUID();
            const dbColor = cell.color + '|e';
            const p = {
                id,
                x: cell.x + Math.cos(angle) * getRadius(cell.size),
                y: cell.y + Math.sin(angle) * getRadius(cell.size),
                color: cell.color,
                vx: Math.cos(angle) * 800, // Smoother initial speed
                vy: Math.sin(angle) * 800,
                isEjected: true, // custom local flag
                owner_id: cell.owner_id // Note who ejected it to prevent immediate self-eating if needed
            };

            state.pixels.set(id, p);
            supabase.from('pixels').insert({ id: p.id, x: p.x, y: p.y, color: dbColor }).then();
            updateScore();
        }
    });
}

function getMouseAngle(cell) {
    // get center of mass
    const centerX = width / 2;
    const centerY = height / 2;
    return Math.atan2(mouse.y - centerY, mouse.x - centerX);
}

function doPlayerSplit() {
    if (state.myCells.length === 0) return;

    // Create a copy of the array so we don't mutate while iterating
    const currentCells = [...state.myCells];

    currentCells.forEach(cell => {
        // Agar.io rules: lowered to 20 mass to split into two
        if (cell.size > 20 && state.myCells.length < 16) {
            const halfMass = cell.size / 2;
            cell.size = halfMass;
            // Reset merge timer for parent cell
            cell.createdAt = Date.now();

            const angle = getMouseAngle(cell);
            const r_offset = getRadius(halfMass) * 0.5;

            state.myCells.push({
                id: generateUUID(),
                owner_id: myOwnerId,
                name: cell.name,
                color: cell.color,
                size: halfMass,
                displaySize: halfMass,
                x: cell.x + Math.cos(angle) * r_offset,
                y: cell.y + Math.sin(angle) * r_offset,
                vx: Math.cos(angle) * 400, // closer shoot forward
                vy: Math.sin(angle) * 400,
                targetX: cell.x, targetY: cell.y,
                createdAt: Date.now() // Track creation time for merging
            });
        }
    });
    updateScore();
}

function splitCell(cell, maxSplits) {
    if (cell.size < 35 || state.myCells.length >= 16) return false;

    const numSplits = Math.min(maxSplits, 16 - state.myCells.length);
    const massPerCell = cell.size / numSplits;
    cell.size = massPerCell;
    cell.createdAt = Date.now();
    const r_offset = getRadius(cell.size) * 0.5;

    for (let i = 1; i < numSplits; i++) {
        const angle = Math.random() * Math.PI * 2;
        state.myCells.push({
            id: generateUUID(),
            owner_id: myOwnerId,
            name: cell.name,
            color: cell.color,
            skin: cell.skin,
            rainbow: cell.rainbow,
            size: massPerCell,
            displaySize: massPerCell,
            x: cell.x + Math.cos(angle) * r_offset,
            y: cell.y + Math.sin(angle) * r_offset,
            vx: Math.cos(angle) * 300,
            vy: Math.sin(angle) * 300,
            targetX: cell.x, targetY: cell.y,
            createdAt: Date.now()
        });
    }
    return true;
}

function updateScore() {
    const totalMass = state.myCells.reduce((sum, c) => sum + c.size, 0);
    scoreEl.innerText = Math.floor(totalMass);
    if (state.myCells.length === 0) scoreEl.innerText = INITIAL_MASS;
}

let pendingPixelDeletes = [];

function checkCollisions() {
    if (state.myCells.length === 0) return;

    for (let i = state.myCells.length - 1; i >= 0; i--) {
        let myCell = state.myCells[i];
        const myRadius = getRadius(myCell.size);

        // Food/Virus collisions
        for (const [id, p] of state.pixels.entries()) {
            const dx = p.x - myCell.x;
            const dy = p.y - myCell.y;
            const maxR = p.color === 'virus' ? VIRUS_RADIUS : (p.isEjected ? getRadius(5) : FOOD_RADIUS);

            // Fast AABB check before expensive Math.sqrt
            if (Math.abs(dx) > myRadius + maxR || Math.abs(dy) > myRadius + maxR) continue;

            const dist = Math.sqrt(dx * dx + dy * dy);

            if (p.color === 'virus') {
                if (dist < myRadius && myCell.size > 35) {
                    // Splitting!
                    if (splitCell(myCell, 8)) {
                        state.pixels.delete(id);
                        pendingPixelDeletes.push(id);
                    }
                }
            } else {
                // Normal food or ejected mass
                if (dist < myRadius) {
                    // Prevent instantly re-eating your own just-ejected mass while it's moving fast
                    if (p.isEjected && p.owner_id === myCell.owner_id && p.vx !== undefined && Math.abs(p.vx) > 50) {
                        continue;
                    }

                    // Ejected mass gives 5 mass, normal pixel gives 1
                    myCell.size += p.isEjected ? 5 : 1;
                    state.pixels.delete(id);
                    pendingPixelDeletes.push(id);
                }
            }
        }

        // Enemy Collisions
        for (const [id, player] of state.players.entries()) {
            const dx = player.x - myCell.x;
            const dy = player.y - myCell.y;
            const theirRadius = getRadius(player.size);

            if (Math.abs(dx) > myRadius + theirRadius || Math.abs(dy) > myRadius + theirRadius) continue;

            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < myRadius && myCell.size > player.size * 1.25) {
                myCell.size += player.size * 0.5;
                state.players.delete(id); // Optimistically remove
            } else if (dist < theirRadius && player.size > myCell.size * 1.25) {
                // I get eaten!
                const prevScore = scoreEl.innerText;
                state.myCells.splice(i, 1);
                supabase.from('players').delete().eq('id', myCell.id).then();
                // If last cell eaten, respawn UI
                if (state.myCells.length === 0) {
                    deathStats.innerText = `Killed by ${player.name} \n Final Mass: ${prevScore}`;
                    deathScreen.style.display = 'block';
                    // Clean memory
                    const ids = state.myCells.map(c => c.id);
                    if (ids.length > 0) supabase.from('players').delete().in('id', ids).then();
                    updateLeaderboard();
                    return;
                }
                break; // cell is dead, break loop
            }
        }
    }

    // Cell merging (repel if same owner and recently split, otherwise merge)
    for (let i = 0; i < state.myCells.length; i++) {
        for (let j = i + 1; j < state.myCells.length; j++) {
            let c1 = state.myCells[i];
            let c2 = state.myCells[j];
            let dx = c2.x - c1.x;
            let dy = c2.y - c1.y;
            let dist = Math.sqrt(dx * dx + dy * dy);

            // Prevent NaN explosions when exactly on top of each other
            if (dist === 0) {
                dx = (Math.random() - 0.5) * 0.1;
                dy = (Math.random() - 0.5) * 0.1;
                dist = Math.sqrt(dx * dx + dy * dy);
            }

            const r1 = getRadius(c1.size);
            const r2 = getRadius(c2.size);
            const minDist = r1 + r2;

            if (dist < minDist && dist > 0) {
                // If both cells are older than 20 seconds, they merge
                const canMerge = (Date.now() - (c1.createdAt || 0) > 20000) && (Date.now() - (c2.createdAt || 0) > 20000);

                if (canMerge) {
                    if (dist < Math.max(r1, r2) * 1.0) {
                        // Merge them (c1 absorbs c2)
                        c1.size += c2.size;
                        c1.displaySize += c2.displaySize; // Smooth merge visual
                        state.myCells.splice(j, 1);
                        j--; // adjust index after removal
                        continue;
                    } else {
                        // Attractive force to pull them together strongly
                        const pull = 6;
                        c1.x += (dx / dist) * pull;
                        c1.y += (dy / dist) * pull;
                        c2.x -= (dx / dist) * pull;
                        c2.y -= (dy / dist) * pull;
                    }
                } else {
                    // Repel force (can't merge yet)
                    const overlap = minDist - dist;
                    const fx = (dx / dist) * overlap * 0.1;
                    const fy = (dy / dist) * overlap * 0.1;
                    c1.x -= fx; c1.y -= fy;
                    c2.x += fx; c2.y += fy;
                }
            }
        }
    }
}

let lastLeaderboardUpdate = 0;

function updateLeaderboard() {
    const now = Date.now();
    if (now - lastLeaderboardUpdate < 500) return; // Throttle to 2 updates per second max
    lastLeaderboardUpdate = now;

    const allMap = new Map();
    // Group players by name to sum sizes for split players
    state.players.forEach(p => {
        allMap.set(p.name, (allMap.get(p.name) || 0) + p.size);
    });

    const myTotal = state.myCells.reduce((sum, c) => sum + c.size, 0);
    if (state.myCells.length > 0 && state.myCells[0]) {
        allMap.set(state.myCells[0].name, myTotal);
    }

    const all = Array.from(allMap.entries()).map(([name, size]) => ({ name, size }));
    all.sort((a, b) => b.size - a.size);

    const myName = state.myCells.length > 0 ? state.myCells[0].name : null;

    leaderboardList.innerHTML = all.slice(0, 10).map((p, i) =>
        `<li><span>${i + 1}. ${p.name === myName ? '<b>' + p.name + '</b>' : p.name}</span> <span>${Math.floor(p.size)}</span></li>`
    ).join('');
}

let lastTime = 0;
function gameLoop(timestamp) {
    const dt = (timestamp - lastTime) / 1000 || 0;
    lastTime = timestamp;

    // Move ejected pixels smoothly with time-based friction
    for (const [id, pixel] of state.pixels.entries()) {
        if (pixel.vx !== undefined) {
            pixel.x += pixel.vx * dt;
            pixel.y += pixel.vy * dt;
            const friction = Math.pow(0.005, dt); // Exp decay to 0.5% in 1 sec
            pixel.vx *= friction;
            pixel.vy *= friction;
            if (Math.abs(pixel.vx) < 5 && Math.abs(pixel.vy) < 5) delete pixel.vx;
        }
    }

    if (state.myCells.length > 0) {
        // Calculate center of mass
        let cmX = 0, cmY = 0, totalMass = 0;
        state.myCells.forEach(c => { cmX += c.x * c.size; cmY += c.y * c.size; totalMass += c.size; });
        cmX /= totalMass; cmY /= totalMass;

        const targetDX = mouse.x - width / 2;
        const targetDY = mouse.y - height / 2;
        const dist = Math.sqrt(targetDX * targetDX + targetDY * targetDY);

        state.myCells.forEach(myCell => {
            // Smooth size transitions (Fluid animation)
            myCell.displaySize = myCell.displaySize || myCell.size;
            myCell.displaySize += (myCell.size - myCell.displaySize) * 15 * dt;

            // Apply Physics (ejection/split velocity) with exponential friction
            if (myCell.vx !== undefined && (Math.abs(myCell.vx) > 5 || Math.abs(myCell.vy) > 5)) {
                myCell.x += myCell.vx * dt;
                myCell.y += myCell.vy * dt;
                const friction = Math.pow(0.01, dt); // Decay to 1% in 1 sec
                myCell.vx *= friction;
                myCell.vy *= friction;
            } else {
                // Normal mouse movement
                let dx = 0, dy = 0;
                if (dist > 10) {
                    dx = targetDX / dist;
                    dy = targetDY / dist;
                }

                const speed = 200 / Math.pow(myCell.size, 0.3);
                myCell.x += dx * speed * dt;
                myCell.y += dy * speed * dt;
            }

            // Bounds limit
            myCell.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, myCell.x));
            myCell.y = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, myCell.y));
        });

        checkCollisions();
        updateScore();
        syncPlayer();

        // Serverless mode: only the biggest player spawns food to save requests? 
        // We will spawn more locally. Max 500 pixels.
        if (Math.random() < 0.2) spawnEntitiesLocally();

        const now = Date.now();
        for (const [id, player] of state.players.entries()) {
            player.x += (player.targetX - player.x) * 10 * dt;
            player.y += (player.targetY - player.y) * 10 * dt;
            player.size += (player.targetSize - player.size) * 10 * dt;

            // Heartbeat cleanup locally
            if (player.lastUpdate && now - player.lastUpdate > 5000) {
                state.players.delete(id);
                // Automatic DB sweep for inactive players
                supabase.from('players').delete().eq('id', id).then();
            }
        }

        draw(cmX, cmY, totalMass);

        // Execute bulk UI deletions in a single POST request instead of 100 concurrent requests!
        if (pendingPixelDeletes.length > 0) {
            const batch = [...pendingPixelDeletes];
            pendingPixelDeletes = [];
            supabase.from('pixels').delete().in('id', batch).then();
        }
    }
    requestAnimationFrame(gameLoop);
}

function draw(cmX, cmY, totalMass) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-color');
    ctx.fillRect(0, 0, width, height);
    if (state.myCells.length === 0) return;

    ctx.save();
    const maxRadius = getRadius(Math.max(...state.myCells.map(c => c.size)));
    const zoom = Math.min(1.5, 40 / maxRadius);

    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cmX, -cmY); // Camera follows center of mass

    // Grid
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    const gridSize = 50;
    const currX = cmX - (width / 2) / zoom;
    const currY = cmY - (height / 2) / zoom;
    const viewWidth = width / zoom;
    const viewHeight = height / zoom;
    const startX = Math.floor(currX / gridSize) * gridSize;
    const startY = Math.floor(currY / gridSize) * gridSize;

    ctx.beginPath();
    for (let x = startX; x < currX + viewWidth + gridSize; x += gridSize) {
        ctx.moveTo(x, currY); ctx.lineTo(x, currY + viewHeight + gridSize);
    }
    for (let y = startY; y < currY + viewHeight + gridSize; y += gridSize) {
        ctx.moveTo(currX, y); ctx.lineTo(currX + viewWidth + gridSize, y);
    }
    ctx.stroke();

    // Map Borders
    const minX = currX;
    const maxX = currX + viewWidth;
    const minY = currY;
    const maxY = currY + viewHeight;

    // Draw map outline
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ff5c77';
    ctx.strokeRect(-WORLD_SIZE, -WORLD_SIZE, WORLD_SIZE * 2, WORLD_SIZE * 2);

    // Draw Pixels & Viruses (with viewport culling)
    for (const pixel of state.pixels.values()) {
        const pR = pixel.color === 'virus' ? VIRUS_RADIUS : (pixel.isEjected ? getRadius(5) : FOOD_RADIUS);
        if (pixel.x < minX - pR || pixel.x > maxX + pR || pixel.y < minY - pR || pixel.y > maxY + pR) continue;

        if (pixel.color === 'virus') {
            drawVirus(pixel);
        } else {
            ctx.beginPath();
            ctx.arc(pixel.x, pixel.y, pR, 0, Math.PI * 2);
            ctx.fillStyle = pixel.color;
            ctx.fill();
            ctx.closePath();
        }
    }

    // Draw other players
    for (const player of state.players.values()) {
        drawPlayer(player);
    }

    // Draw my cells
    for (const myCell of state.myCells) {
        drawPlayer(myCell, true);
    }

    ctx.restore();
}

function drawVirus(v) {
    ctx.beginPath();
    const spikes = 20;
    for (let i = 0; i < spikes * 2; i++) {
        const r = (i % 2 === 0) ? VIRUS_RADIUS : VIRUS_RADIUS - 6;
        const a = (Math.PI / spikes) * i;
        const x = v.x + Math.cos(a) * r;
        const y = v.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#1cf216';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0fd60a';
    ctx.stroke();
}

// Cache for loaded images
const imageCache = new Map();

function getOrCreateImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const img = new Image();
    img.src = src;
    imageCache.set(src, img);
    return img;
}

function drawPlayer(player, isMe = false) {
    const renderSize = player.displaySize || player.size;
    const r = getRadius(renderSize);

    ctx.beginPath();
    ctx.arc(player.x, player.y, r, 0, Math.PI * 2);

    if (player.skin) {
        ctx.save();
        ctx.clip(); // Clip to circle
        const img = getOrCreateImage(player.skin);
        if (img.complete && img.naturalHeight !== 0) {
            ctx.drawImage(img, player.x - r, player.y - r, r * 2, r * 2);
        } else {
            ctx.fillStyle = player.color;
            ctx.fill();
        }
        ctx.restore();
    } else {
        ctx.fillStyle = player.color;
        ctx.fill();
    }

    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
    ctx.closePath();

    ctx.lineWidth = 3;
    ctx.font = `bold ${Math.max(12, r * 0.4)}px 'Outfit', 'Segoe UI'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (player.rainbow) {
        // Create Rainbow Gradient for Name
        const gradient = ctx.createLinearGradient(player.x - r, player.y, player.x + r, player.y);
        const hue = (Date.now() / 10) % 360; // Animated shifting gradient
        gradient.addColorStop(0, `hsl(${hue}, 100%, 60%)`);
        gradient.addColorStop(0.5, `hsl(${(hue + 60) % 360}, 100%, 60%)`);
        gradient.addColorStop(1, `hsl(${(hue + 120) % 360}, 100%, 60%)`);
        ctx.fillStyle = gradient;
        ctx.strokeStyle = '#ffffff'; // contrasting stroke
        ctx.lineWidth = 4;
        ctx.strokeText(player.name, player.x, player.y);
        ctx.fillText(player.name, player.x, player.y);

        ctx.strokeStyle = '#000000'; // outer stroke
        ctx.lineWidth = 1;
        ctx.strokeText(player.name, player.x, player.y);
    } else {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.strokeText(player.name, player.x, player.y);
        ctx.fillText(player.name, player.x, player.y);
    }
}

const guestBtn = document.getElementById('guest-btn');
const guestInput = document.getElementById('guest-name');

loginBtn.addEventListener('click', () => {
    loginWithGoogle().catch(err => console.error("SSO Login failed:", err));
});

guestBtn.addEventListener('click', () => {
    const name = guestInput.value.trim() || 'Invité' + Math.floor(Math.random() * 1000);
    const mockUser = {
        uid: generateUUID(),
        displayName: name
    };
    initPlayer(mockUser);
});

setupAuthListener(user => {
    if (user && state.myCells.length === 0) initPlayer(user);
});

async function spawnEntitiesLocally() {
    if (state.pixels.size < 500) {
        // Spawn 3 at a time for 20% frames to populate faster
        for (let i = 0; i < 3; i++) {
            const isVirus = Math.random() < 0.01; // 1% chance to spawn virus
            const id = generateUUID();

            const p = {
                id,
                x: Math.random() * (WORLD_SIZE * 2) - WORLD_SIZE,
                y: Math.random() * (WORLD_SIZE * 2) - WORLD_SIZE,
                color: isVirus ? 'virus' : randomColor()
            };

            // Add instantly to local state for 0 lag experience
            state.pixels.set(id, p);

            // Dispatch to Supabase asynchronously
            supabase.from('pixels').insert(p).then(({ error }) => {
                if (error) {
                    console.error("Supabase insert error for pixel:", error);
                }
            });
        }
    }
}
