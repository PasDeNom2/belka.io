import { createClient } from '@supabase/supabase-js';
import { loginWithGoogle, setupAuthListener } from './firebase.js';

// Supabase Setup
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Game State
const state = {
    me: null,
    players: new Map(), // id -> player data
    pixels: new Map(),  // id -> pixel data
    lastSync: 0
};

// Canvas Setup
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

// UI Elements
const loginContainer = document.getElementById('login-container');
const loginBtn = document.getElementById('login-btn');
const gameUi = document.getElementById('game-ui');
const scoreEl = document.getElementById('score');
const leaderboardList = document.getElementById('leaderboard-list');

// Input state
const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
};
const mouse = { x: width / 2, y: height / 2 };

// Event Listeners for Input
window.addEventListener('keydown', e => { if (keys.hasOwnProperty(e.key)) keys[e.key] = true; });
window.addEventListener('keyup', e => { if (keys.hasOwnProperty(e.key)) keys[e.key] = false; });
canvas.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// Helper: Random Color
const randomColor = () => `hsl(${Math.random() * 360}, 80%, 60%)`;

// Movement & Logic variables
const speedMultiplier = 150; // Base speed
const syncInterval = 100; // ms between Supabase syncs (Tick rate: 10Hz)

// Initialize Player
async function initPlayer(user) {
    state.me = {
        id: user.uid,
        name: user.displayName || 'Player',
        x: Math.random() * 2000 - 1000,
        y: Math.random() * 2000 - 1000,
        size: 10,
        color: randomColor(),
        targetX: 0,
        targetY: 0
    };
    state.me.targetX = state.me.x;
    state.me.targetY = state.me.y;

    // Insert or update in Supabase
    await supabase.from('players').upsert({
        id: state.me.id,
        name: state.me.name,
        x: state.me.x,
        y: state.me.y,
        size: state.me.size,
        color: state.me.color,
        updated_at: new Date().toISOString()
    });

    loginContainer.style.display = 'none';
    gameUi.style.display = 'block';

    setupRealtime();
    requestAnimationFrame(gameLoop);
}

// Supabase Realtime Setup
function setupRealtime() {
    // Initial Fetch - Pixels
    supabase.from('pixels').select('*').then(({ data }) => {
        if (data) data.forEach(p => state.pixels.set(p.id, p));
    });

    // Initial Fetch - Players
    supabase.from('players').select('*').then(({ data }) => {
        if (data) {
            data.forEach(p => {
                if (p.id !== state.me.id) {
                    // Setup interpolation targets
                    p.targetX = p.x;
                    p.targetY = p.y;
                    p.targetSize = p.size;
                    state.players.set(p.id, p);
                }
            });
        }
    });

    // Realtime Subscription
    supabase.channel('game_room')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, payload => {
            const { eventType, new: newRec, old: oldRec } = payload;
            if (newRec && newRec.id === state.me.id) return; // Ignore own echoes

            if (eventType === 'INSERT' || eventType === 'UPDATE') {
                let player = state.players.get(newRec.id);
                if (!player) {
                    player = { ...newRec, targetX: newRec.x, targetY: newRec.y, targetSize: newRec.size, x: newRec.x, y: newRec.y, size: newRec.size };
                    state.players.set(newRec.id, player);
                } else {
                    // Update interpolation targets
                    player.targetX = newRec.x;
                    player.targetY = newRec.y;
                    player.targetSize = newRec.size;
                    player.updated_at = newRec.updated_at;
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

// Sync to Supabase
async function syncPlayer() {
    const now = Date.now();
    if (now - state.lastSync > syncInterval && state.me) {
        state.lastSync = now;
        supabase.from('players').upsert({
            id: state.me.id,
            name: state.me.name,
            x: state.me.x,
            y: state.me.y,
            size: state.me.size,
            color: state.me.color,
            updated_at: new Date().toISOString()
        }).then(); // Fire and forget for latency
    }
}

// Spawn pixel (only me, to distribute load, or serverless fn. Doing client auth for now)
async function spawnPixelLocally() {
    if (state.pixels.size < 100 && Math.random() < 0.05) {
        const p = {
            x: Math.random() * 4000 - 2000,
            y: Math.random() * 4000 - 2000,
            color: randomColor()
        };
        supabase.from('pixels').insert(p).then();
    }
}

// Eat detection
function checkCollisions() {
    // Pixels
    for (const [id, p] of state.pixels.entries()) {
        const dx = p.x - state.me.x;
        const dy = p.y - state.me.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < state.me.size) {
            state.me.size += 0.5;
            scoreEl.innerText = Math.floor(state.me.size);
            state.pixels.delete(id);
            supabase.from('pixels').delete().eq('id', id).then();
        }
    }

    // Other Players
    for (const [id, player] of state.players.entries()) {
        const dx = player.x - state.me.x;
        const dy = player.y - state.me.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If I eat them
        if (dist < state.me.size && state.me.size > player.size * 1.1) {
            state.me.size += player.size * 0.5;
            scoreEl.innerText = Math.floor(state.me.size);
            // Wait for them to delete themselves or handle it via server. For this demo, let's let them realize they're dead.
        }
        // If they eat me
        else if (dist < player.size && player.size > state.me.size * 1.1) {
            alert("You were eaten by " + player.name + "!");
            state.me.size = 10;
            state.me.x = Math.random() * 2000 - 1000;
            state.me.y = Math.random() * 2000 - 1000;
            scoreEl.innerText = 10;
        }
    }
}

function updateLeaderboard() {
    const all = Array.from(state.players.values());
    if (state.me) all.push(state.me);
    all.sort((a, b) => b.size - a.size);

    leaderboardList.innerHTML = all.slice(0, 10).map((p, i) =>
        `<li><span>${i + 1}. ${p.id === state.me?.id ? '<b>' + p.name + '</b>' : p.name}</span> <span>${Math.floor(p.size)}</span></li>`
    ).join('');
}

let lastTime = 0;
function gameLoop(timestamp) {
    const dt = (timestamp - lastTime) / 1000 || 0;
    lastTime = timestamp;

    if (state.me) {
        // Movement calculation
        let dx = 0, dy = 0;
        if (keys.w || keys.ArrowUp) dy -= 1;
        if (keys.s || keys.ArrowDown) dy += 1;
        if (keys.a || keys.ArrowLeft) dx -= 1;
        if (keys.d || keys.ArrowRight) dx += 1;

        // Mouse movement override if keys not pressed
        if (dx === 0 && dy === 0) {
            const targetDX = mouse.x - width / 2;
            const targetDY = mouse.y - height / 2;
            const dist = Math.sqrt(targetDX * targetDX + targetDY * targetDY);
            if (dist > 10) {
                dx = targetDX / dist;
                dy = targetDY / dist;
            }
        } else {
            // Normalize WASD
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
        }

        // Apply movement with speed inversely proportional to size
        const speed = speedMultiplier / Math.sqrt(state.me.size / 10);
        state.me.x += dx * speed * dt;
        state.me.y += dy * speed * dt;

        checkCollisions();
        syncPlayer();
        spawnPixelLocally();

        // Interpolate other players
        for (const player of state.players.values()) {
            player.x += (player.targetX - player.x) * 0.1;
            player.y += (player.targetY - player.y) * 0.1;
            player.size += (player.targetSize - player.size) * 0.1;
        }

        draw();
    }
    requestAnimationFrame(gameLoop);
}

// Rendering
function draw() {
    // Clear
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-color');
    ctx.fillRect(0, 0, width, height);

    if (!state.me) return;

    ctx.save();
    // Camera translation
    ctx.translate(width / 2 - state.me.x, height / 2 - state.me.y);

    // Draw Grid lines
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    const gridSize = 50;
    const currX = state.me.x - width / 2;
    const currY = state.me.y - height / 2;
    const startX = Math.floor(currX / gridSize) * gridSize;
    const startY = Math.floor(currY / gridSize) * gridSize;

    ctx.beginPath();
    for (let x = startX; x < currX + width; x += gridSize) {
        ctx.moveTo(x, currY);
        ctx.lineTo(x, currY + height);
    }
    for (let y = startY; y < currY + height; y += gridSize) {
        ctx.moveTo(currX, y);
        ctx.lineTo(currX + width, y);
    }
    ctx.stroke();

    // Draw Pixels
    for (const pixel of state.pixels.values()) {
        ctx.beginPath();
        ctx.arc(pixel.x, pixel.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = pixel.color;
        ctx.fill();
        ctx.closePath();
    }

    // Draw Other Players
    for (const player of state.players.values()) {
        drawPlayer(player);
    }

    // Draw Me
    drawPlayer(state.me, true);

    ctx.restore();
}

function drawPlayer(player, isMe = false) {
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.size, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    if (isMe) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    ctx.closePath();

    // Draw Name
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, player.x, player.y - player.size - 5);
}

// Auth setup
loginBtn.addEventListener('click', () => {
    loginWithGoogle().then(user => {
        initPlayer(user);
    });
});

setupAuthListener(user => {
    if (user && !state.me) {
        initPlayer(user);
    }
});
