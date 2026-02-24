import { createClient } from '@supabase/supabase-js';
import { loginWithGoogle, setupAuthListener } from './firebase.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const WORLD_SIZE = 4000;
const INITIAL_MASS = 10;
const VIRUS_RADIUS = 35;
const FOOD_RADIUS = 5;

const state = { me: null, players: new Map(), pixels: new Map(), lastSync: 0 };

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

const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };
const mouse = { x: width / 2, y: height / 2 };

window.addEventListener('keydown', e => { if (keys.hasOwnProperty(e.key)) keys[e.key] = true; });
window.addEventListener('keyup', e => { if (keys.hasOwnProperty(e.key)) keys[e.key] = false; });
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });

const randomColor = () => `hsl(${Math.floor(Math.random() * 360)}, 80%, 50%)`;

// Mass -> Radius calculation (Area is proportional to Mass)
function getRadius(mass) {
    return Math.sqrt(mass) * 8;
}

async function initPlayer(user) {
    state.me = {
        id: user.uid,
        name: user.displayName || 'Player',
        x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
        size: INITIAL_MASS, // size means "mass"
        color: randomColor(),
        targetX: 0, targetY: 0
    };
    state.me.targetX = state.me.x;
    state.me.targetY = state.me.y;

    await supabase.from('players').upsert({
        id: state.me.id, name: state.me.name,
        x: state.me.x, y: state.me.y,
        size: state.me.size, color: state.me.color,
        updated_at: new Date().toISOString()
    });

    loginContainer.style.display = 'none';
    gameUi.style.display = 'block';

    setupRealtime();
    requestAnimationFrame(gameLoop);
}

function setupRealtime() {
    supabase.from('pixels').select('*').then(({ data }) => {
        if (data) data.forEach(p => state.pixels.set(p.id, p));
    });

    supabase.from('players').select('*').then(({ data }) => {
        if (data) {
            data.forEach(p => {
                if (p.id !== state.me.id) {
                    p.targetX = p.x; p.targetY = p.y; p.targetSize = p.size;
                    state.players.set(p.id, p);
                }
            });
        }
    });

    supabase.channel('game_room')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, payload => {
            const { eventType, new: newRec, old: oldRec } = payload;
            if (newRec && newRec.id === state.me.id) return;
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
    if (now - state.lastSync > syncInterval && state.me) {
        state.lastSync = now;
        supabase.from('players').upsert({
            id: state.me.id, name: state.me.name,
            x: state.me.x, y: state.me.y, size: state.me.size, color: state.me.color,
            updated_at: new Date().toISOString()
        }).then();
    }
}

async function spawnEntitiesLocally() {
    if (state.pixels.size < 200 && Math.random() < 0.1) {
        const isVirus = Math.random() < 0.05; // 5% chance to spawn virus
        const p = {
            x: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
            y: Math.random() * WORLD_SIZE - WORLD_SIZE / 2,
            color: isVirus ? 'virus' : randomColor()
        };
        supabase.from('pixels').insert(p).then();
    }
}

function checkCollisions() {
    const myRadius = getRadius(state.me.size);

    for (const [id, p] of state.pixels.entries()) {
        const dx = p.x - state.me.x;
        const dy = p.y - state.me.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (p.color === 'virus') {
            if (dist < myRadius && myRadius > VIRUS_RADIUS * 1.1) {
                // Explode on virus
                state.me.size = Math.max(INITIAL_MASS, state.me.size / 2);
                scoreEl.innerText = Math.floor(state.me.size);
                state.pixels.delete(id);
                supabase.from('pixels').delete().eq('id', id).then();
            }
        } else {
            if (dist < myRadius) {
                state.me.size += 1;
                scoreEl.innerText = Math.floor(state.me.size);
                state.pixels.delete(id);
                supabase.from('pixels').delete().eq('id', id).then();
            }
        }
    }

    for (const [id, player] of state.players.entries()) {
        const dx = player.x - state.me.x;
        const dy = player.y - state.me.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const theirRadius = getRadius(player.size);

        if (dist < myRadius && state.me.size > player.size * 1.25) {
            state.me.size += player.size * 0.5;
            scoreEl.innerText = Math.floor(state.me.size);
        } else if (dist < theirRadius && player.size > state.me.size * 1.25) {
            alert("You were eaten by " + player.name + "!");
            state.me.size = INITIAL_MASS;
            state.me.x = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
            state.me.y = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
            scoreEl.innerText = INITIAL_MASS;
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
        let dx = 0, dy = 0;
        if (keys.w || keys.ArrowUp) dy -= 1;
        if (keys.s || keys.ArrowDown) dy += 1;
        if (keys.a || keys.ArrowLeft) dx -= 1;
        if (keys.d || keys.ArrowRight) dx += 1;

        if (dx === 0 && dy === 0) {
            const targetDX = mouse.x - width / 2;
            const targetDY = mouse.y - height / 2;
            const dist = Math.sqrt(targetDX * targetDX + targetDY * targetDY);
            if (dist > 10) {
                dx = targetDX / dist;
                dy = targetDY / dist;
            }
        } else {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len; dy /= len;
        }

        const speed = 200 / Math.pow(state.me.size, 0.3); // Slower as you get bigger
        state.me.x += dx * speed * dt;
        state.me.y += dy * speed * dt;

        // Bounds limit
        state.me.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, state.me.x));
        state.me.y = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, state.me.y));

        checkCollisions();
        syncPlayer();
        spawnEntitiesLocally();

        for (const player of state.players.values()) {
            player.x += (player.targetX - player.x) * 0.2;
            player.y += (player.targetY - player.y) * 0.2;
            player.size += (player.targetSize - player.size) * 0.1;
        }

        draw();
    }
    requestAnimationFrame(gameLoop);
}

function draw() {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-color');
    ctx.fillRect(0, 0, width, height);
    if (!state.me) return;

    ctx.save();
    const myRadius = getRadius(state.me.size);
    const zoom = Math.min(1.5, 40 / myRadius); // Zoom out as player grows

    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-state.me.x, -state.me.y);

    // Grid
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    const gridSize = 50;
    const currX = state.me.x - (width / 2) / zoom;
    const currY = state.me.y - (height / 2) / zoom;
    const viewWidth = width / zoom;
    const viewHeight = height / zoom;
    const startX = Math.floor(currX / gridSize) * gridSize;
    const startY = Math.floor(currY / gridSize) * gridSize;

    ctx.beginPath();
    for (let x = startX; x < currX + viewWidth; x += gridSize) {
        ctx.moveTo(x, currY); ctx.lineTo(x, currY + viewHeight);
    }
    for (let y = startY; y < currY + viewHeight; y += gridSize) {
        ctx.moveTo(currX, y); ctx.lineTo(currX + viewWidth, y);
    }
    ctx.stroke();

    // Draw Pixels & Viruses
    for (const pixel of state.pixels.values()) {
        if (pixel.color === 'virus') {
            drawVirus(pixel);
        } else {
            ctx.beginPath();
            // Draw hexagon or circles for food; circle is fine
            ctx.arc(pixel.x, pixel.y, FOOD_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = pixel.color;
            ctx.fill();
            ctx.closePath();
        }
    }

    for (const player of state.players.values()) {
        drawPlayer(player);
    }
    drawPlayer(state.me, true);

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
    if (user && !state.me) initPlayer(user);
});
