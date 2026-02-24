import { createClient } from '@supabase/supabase-js';
import { loginWithGoogle, setupAuthListener } from './firebase.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const WORLD_SIZE = 4000;
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

const keys = { w: false };
const mouse = { x: width / 2, y: height / 2 };

window.addEventListener('keydown', e => {
    if (e.key === 'w' || e.key === 'W') {
        if (!keys.w) ejectMass();
        keys.w = true;
    }
});
window.addEventListener('keyup', e => { if (e.key === 'w' || e.key === 'W') keys.w = false; });
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });

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
    const cell = {
        id: user.uid, // Main cell uses UID
        owner_id: myOwnerId,
        name: user.displayName || 'Player',
        x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        size: INITIAL_MASS,
        color: randomColor(),
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

function isMyCell(id) {
    return state.myCells.some(c => c.id === id);
}

function setupRealtime() {
    supabase.from('pixels').select('*').then(({ data }) => {
        if (data) data.forEach(p => state.pixels.set(p.id, p));
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

    supabase.channel('game_room')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, payload => {
            const { eventType, new: newRec, old: oldRec } = payload;
            if (newRec && isMyCell(newRec.id)) return;
            if (eventType === 'INSERT' || eventType === 'UPDATE') {
                let player = state.players.get(newRec.id);
                if (!player) {
                    player = { ...newRec, targetX: newRec.x, targetY: newRec.y, targetSize: newRec.size, x: newRec.x, y: newRec.y, size: newRec.size };
                    state.players.set(newRec.id, player);
                } else {
                    player.targetX = newRec.x; player.targetY = newRec.y; player.targetSize = newRec.size;
                }
            } else if (eventType === 'DELETE') {
                state.players.delete(oldRec.id);
            }
            updateLeaderboard();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pixels' }, payload => {
            const { eventType, new: newRec, old: oldRec } = payload;
            if (eventType === 'INSERT') state.pixels.set(newRec.id, newRec);
            else if (eventType === 'DELETE') state.pixels.delete(oldRec.id);
        })
        .subscribe();
}

const syncInterval = 100;
async function syncPlayer() {
    const now = Date.now();
    if (now - state.lastSync > syncInterval && state.myCells.length > 0) {
        state.lastSync = now;

        // Sync all my cells
        const updates = state.myCells.map(c => ({
            id: c.id,
            name: c.name,
            x: c.x, y: c.y,
            size: c.size,
            color: c.color,
            updated_at: new Date().toISOString()
        }));

        supabase.from('players').upsert(updates).then();
    }
}

function ejectMass() {
    if (state.myCells.length === 0) return;

    // Eject from all cells > 20 mass
    state.myCells.forEach(cell => {
        if (cell.size > 20) {
            cell.size -= 5;

            const angle = getMouseAngle(cell);
            const id = generateUUID();
            const p = {
                id,
                x: cell.x + Math.cos(angle) * getRadius(cell.size),
                y: cell.y + Math.sin(angle) * getRadius(cell.size),
                color: cell.color,
                vx: Math.cos(angle) * 800, // Velocity for ejection
                vy: Math.sin(angle) * 800,
                isEjected: true // custom local flag
            };

            state.pixels.set(id, p);
            supabase.from('pixels').insert({ id: p.id, x: p.x, y: p.y, color: p.color }).then();
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

function splitCell(cell, maxSplits) {
    if (cell.size < 30 || state.myCells.length >= 16) return;

    const numSplits = Math.min(maxSplits, 16 - state.myCells.length);
    const massPerCell = cell.size / numSplits;
    cell.size = massPerCell;

    for (let i = 1; i < numSplits; i++) {
        const angle = Math.random() * Math.PI * 2;
        state.myCells.push({
            id: generateUUID(),
            owner_id: myOwnerId,
            name: cell.name,
            color: cell.color,
            size: massPerCell,
            x: cell.x,
            y: cell.y,
            vx: Math.cos(angle) * 600,
            vy: Math.sin(angle) * 600,
            targetX: cell.x, targetY: cell.y
        });
    }
}

function updateScore() {
    const totalMass = state.myCells.reduce((sum, c) => sum + c.size, 0);
    scoreEl.innerText = Math.floor(totalMass);
    if (state.myCells.length === 0) scoreEl.innerText = INITIAL_MASS;
}

function checkCollisions() {
    if (state.myCells.length === 0) return;

    for (let i = state.myCells.length - 1; i >= 0; i--) {
        let myCell = state.myCells[i];
        const myRadius = getRadius(myCell.size);

        // Food/Virus collisions
        for (const [id, p] of state.pixels.entries()) {
            const dx = p.x - myCell.x;
            const dy = p.y - myCell.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (p.color === 'virus') {
                if (dist < myRadius && myRadius > VIRUS_RADIUS * 1.1) {
                    // Splitting!
                    splitCell(myCell, 8); // explode into 8 parts
                    state.pixels.delete(id);
                    supabase.from('pixels').delete().eq('id', id).then();
                }
            } else {
                if (dist < myRadius) {
                    myCell.size += p.isEjected ? 5 : 1;
                    state.pixels.delete(id);
                    supabase.from('pixels').delete().eq('id', id).then();
                }
            }
        }

        // Enemy Collisions
        for (const [id, player] of state.players.entries()) {
            const dx = player.x - myCell.x;
            const dy = player.y - myCell.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const theirRadius = getRadius(player.size);

            if (dist < myRadius && myCell.size > player.size * 1.25) {
                myCell.size += player.size * 0.5;
                state.players.delete(id); // Optimistically remove
            } else if (dist < theirRadius && player.size > myCell.size * 1.25) {
                // I get eaten!
                state.myCells.splice(i, 1);
                supabase.from('players').delete().eq('id', myCell.id).then();
                // If last cell eaten, respawn
                if (state.myCells.length === 0) {
                    alert("You were eaten by " + player.name + "!");
                    initPlayer({ uid: generateUUID(), displayName: myCell.name }); // Re-init
                    return;
                }
                break; // cell is dead, break loop
            }
        }
    }

    // Cell merging (repel if same owner and recently split, otherwise merge)
    // For simplicity, just repel our own cells so they don't overlap totally
    for (let i = 0; i < state.myCells.length; i++) {
        for (let j = i + 1; j < state.myCells.length; j++) {
            let c1 = state.myCells[i];
            let c2 = state.myCells[j];
            const dx = c2.x - c1.x;
            const dy = c2.y - c1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = getRadius(c1.size) + getRadius(c2.size);

            if (dist < minDist && dist > 0) {
                // Repel force
                const overlap = minDist - dist;
                const fx = (dx / dist) * overlap * 0.1;
                const fy = (dy / dist) * overlap * 0.1;
                c1.x -= fx; c1.y -= fy;
                c2.x += fx; c2.y += fy;
            }
        }
    }
}

function updateLeaderboard() {
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

    // Move ejected pixels
    for (const [id, pixel] of state.pixels.entries()) {
        if (pixel.vx !== undefined) {
            pixel.x += pixel.vx * dt;
            pixel.y += pixel.vy * dt;
            pixel.vx *= 0.9; // friction
            pixel.vy *= 0.9;
            if (Math.abs(pixel.vx) < 10) delete pixel.vx;
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
            // Apply Physics (ejection/split velocity)
            if (myCell.vx !== undefined && (Math.abs(myCell.vx) > 10 || Math.abs(myCell.vy) > 10)) {
                myCell.x += myCell.vx * dt;
                myCell.y += myCell.vy * dt;
                myCell.vx *= 0.85; // Heavy friction
                myCell.vy *= 0.85;
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
        // Just throttle it heavily instead.
        if (Math.random() < 0.05) spawnEntitiesLocally();

        for (const player of state.players.values()) {
            player.x += (player.targetX - player.x) * 0.2;
            player.y += (player.targetY - player.y) * 0.2;
            player.size += (player.targetSize - player.size) * 0.1;
        }

        draw(cmX, cmY, totalMass);
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

    // Draw Pixels & Viruses
    for (const pixel of state.pixels.values()) {
        if (pixel.color === 'virus') {
            drawVirus(pixel);
        } else {
            ctx.beginPath();
            ctx.arc(pixel.x, pixel.y, FOOD_RADIUS, 0, Math.PI * 2);
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

function drawPlayer(player, isMe = false) {
    const r = getRadius(player.size);
    ctx.beginPath();
    ctx.arc(player.x, player.y, r, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();

    ctx.lineWidth = r * 0.05;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
    ctx.closePath();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.font = `bold ${Math.max(12, r * 0.4)}px 'Segoe UI'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.strokeText(player.name, player.x, player.y);
    ctx.fillText(player.name, player.x, player.y);
}

loginBtn.addEventListener('click', () => {
    loginWithGoogle().then(user => initPlayer(user));
});
setupAuthListener(user => {
    if (user && state.myCells.length === 0) initPlayer(user);
});

async function spawnEntitiesLocally() {
    if (state.pixels.size < 200 && Math.random() < 0.1) {
        const isVirus = Math.random() < 0.03; // 3% chance to spawn virus
        const id = generateUUID();

        const p = {
            id,
            x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
            y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
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
