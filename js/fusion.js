// ManiFriends - Premium Web Game with Firebase Leaderboard
// FIREBASE CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyBCcdSfQmPNsRHEi03k_iUcPQbNZbPHaJw",
    authDomain: "manifriends-a091a.firebaseapp.com",
    databaseURL: "https://manifriends-a091a-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "manifriends-a091a",
    storageBucket: "manifriends-a091a.firebasestorage.app",
    messagingSenderId: "692995414185",
    appId: "1:692995414185:web:2cff9c1cf3e1acc75671b8"
};

// Initialize Firebase
let db = null;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
} catch (e) {
    console.warn('Firebase initialization failed:', e);
}

// GAME CONFIG
const CONFIG = {
    levels: [
        { name: '1', radius: 26, color: '#ff6b9d', img: '../assets/1.png' },
        { name: '2', radius: 38, color: '#6bb3ff', img: '../assets/2.png' },
        { name: '3', radius: 50, color: '#ffd93d', img: '../assets/3.png' },
        { name: '4', radius: 62, color: '#6bffb8', img: '../assets/4.png' },
        { name: '5', radius: 74, color: '#ffb86b', img: '../assets/5.png' },
        { name: '6', radius: 86, color: '#b86bff', img: '../assets/6.png' }
    ],
    spawnLevels: [0, 1, 2],
    gravity: 1.8,
    dangerY: 45,
    settleTime: 1000,
    dropCooldown: 350
};

let engine, runner, balls = [], score = 0, gameOver = false, canDrop = true;
let currentLevel = 0, nextLevel = 0;
let canvas, ctx, jarInner;
let lastDropTime = 0;
let imagesLoaded = 0;
let currentUsername = '';
let personalBest = 0;
const images = {};

const $ = id => document.getElementById(id);

// FIREBASE / LEADERBOARD FUNCTIONS

// Save score to Firebase
async function saveScore(username, newScore) {
    if (!db || !username) return;

    try {
        const userRef = db.ref('leaderboard/' + sanitizeUsername(username));
        const snapshot = await userRef.once('value');
        const existingData = snapshot.val();

        // Only save if it's a new high score for this user
        if (!existingData || newScore > existingData.score) {
            await userRef.set({
                name: username,
                score: newScore,
                timestamp: Date.now()
            });
            return true; // New high score!
        }
        return false;
    } catch (e) {
        console.error('Error saving score:', e);
        return false;
    }
}

// Sanitize username for Firebase key
function sanitizeUsername(name) {
    return name.replace(/[.#$\/\[\]]/g, '_').toLowerCase();
}

// Load top 10 scores
async function loadLeaderboard() {
    if (!db) {
        return [];
    }

    try {
        const snapshot = await db.ref('leaderboard')
            .orderByChild('score')
            .limitToLast(10)
            .once('value');

        const scores = [];
        snapshot.forEach(child => {
            scores.push(child.val());
        });

        // Sort descending
        return scores.sort((a, b) => b.score - a.score);
    } catch (e) {
        console.error('Error loading leaderboard:', e);
        return [];
    }
}

// Get user's personal best
async function getPersonalBest(username) {
    if (!db || !username) return 0;

    try {
        const snapshot = await db.ref('leaderboard/' + sanitizeUsername(username)).once('value');
        const data = snapshot.val();
        return data ? data.score : 0;
    } catch (e) {
        return 0;
    }
}

// Display leaderboard
async function displayLeaderboard() {
    const list = $('leaderboardList');
    list.innerHTML = '<li class="no-scores">Yükleniyor...</li>';

    const scores = await loadLeaderboard();

    if (scores.length === 0) {
        list.innerHTML = '<li class="no-scores">Henüz skor yok. İlk sen ol! 🎮</li>';
        return;
    }

    list.innerHTML = scores.map((entry, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const isCurrentUser = entry.name.toLowerCase() === currentUsername.toLowerCase();
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;

        return `
            <li class="leaderboard-item ${isCurrentUser ? 'current-user' : ''}">
                <span class="rank ${rankClass}">${medal}</span>
                <span class="player-name">${entry.name}</span>
                <span class="player-score">${entry.score}</span>
            </li>
        `;
    }).join('');
}

// USERNAME HANDLING

function setupUsernameModal() {
    const modal = $('usernameModal');
    const input = $('usernameInput');
    const btn = $('startGameBtn');

    // Check if username exists in localStorage
    const savedUsername = localStorage.getItem('manifriends_username');
    if (savedUsername) {
        currentUsername = savedUsername;
        modal.classList.add('hidden');
        startGame();
        return;
    }

    // Enable button when input has value
    input.addEventListener('input', () => {
        const value = input.value.trim();
        btn.disabled = value.length < 2;
    });

    // Handle Enter key
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !btn.disabled) {
            submitUsername();
        }
    });

    btn.addEventListener('click', submitUsername);
}

function submitUsername() {
    const input = $('usernameInput');
    const username = input.value.trim();

    if (username.length >= 2) {
        currentUsername = username;
        localStorage.setItem('manifriends_username', username);
        $('usernameModal').classList.add('hidden');
        startGame();
    }
}

// LEADERBOARD UI

function setupLeaderboardUI() {
    const btn = $('leaderboardBtn');
    const modal = $('leaderboardModal');
    const closeBtn = $('closeLeaderboard');

    btn.addEventListener('click', () => {
        modal.classList.add('active');
        displayLeaderboard();
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
}

// IMAGE PRELOADING

function preloadImages() {
    return new Promise((resolve) => {
        const totalImages = CONFIG.levels.length;

        CONFIG.levels.forEach(l => {
            const img = new Image();
            img.onload = () => {
                imagesLoaded++;
                if (imagesLoaded === totalImages) {
                    resolve();
                }
            };
            img.onerror = () => {
                console.error(`Failed to load: ${l.img}`);
                imagesLoaded++;
                if (imagesLoaded === totalImages) {
                    resolve();
                }
            };
            img.src = l.img;
            images[l.name] = img;
        });
    });
}

// GAME INITIALIZATION

async function startGame() {
    // Show loading
    const loadingEl = document.createElement('div');
    loadingEl.id = 'loading';
    loadingEl.innerHTML = '<div style="text-align:center;color:white;font-size:18px;">Yükleniyor...</div>';
    loadingEl.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;';
    document.body.appendChild(loadingEl);

    // Preload images and get personal best
    await Promise.all([
        preloadImages(),
        (async () => {
            personalBest = await getPersonalBest(currentUsername);
        })()
    ]);

    loadingEl.remove();

    // Show pause button
    $('pauseBtn').classList.add('visible');

    initGame();
}

function initGame() {
    canvas = $('gameCanvas');
    jarInner = canvas.parentElement;

    // Set canvas size once on init - no resize
    const rect = jarInner.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx = canvas.getContext('2d');

    // Init Matter.js
    engine = Matter.Engine.create({
        gravity: { x: 0, y: CONFIG.gravity },
        positionIterations: 8,
        velocityIterations: 8
    });

    // Walls
    const w = canvas.width, h = canvas.height;
    const wallOptions = {
        isStatic: true,
        friction: 0.3,
        restitution: 0.2
    };
    const walls = [
        Matter.Bodies.rectangle(w / 2, h + 25, w, 50, wallOptions),
        Matter.Bodies.rectangle(-25, h / 2, 50, h, wallOptions),
        Matter.Bodies.rectangle(w + 25, h / 2, 50, h, wallOptions)
    ];
    Matter.Composite.add(engine.world, walls);

    // Collision
    Matter.Events.on(engine, 'collisionStart', onCollision);

    // Start physics - save runner for pause/resume
    runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);

    // Spawn
    nextLevel = randomLevel();
    spawnBall();
    updateLevelBar();

    // Input
    setupInput();

    // Buttons
    $('restartBtn').onclick = restart;

    // Render loop
    requestAnimationFrame(render);
}

// Main init - runs on page load
async function init() {
    setupUsernameModal();
    setupLeaderboardUI();
    addSoundButton();
}

function randomLevel() {
    return CONFIG.spawnLevels[Math.floor(Math.random() * CONFIG.spawnLevels.length)];
}

function spawnBall() {
    if (gameOver) return;

    currentLevel = nextLevel;
    nextLevel = randomLevel();

    const lvl = CONFIG.levels[currentLevel];
    const r = lvl.radius;
    const preview = $('previewBall');
    const arrow = $('dropArrow');

    preview.style.width = preview.style.height = r * 2 + 'px';
    preview.style.left = `calc(50% - ${r}px)`;
    preview.style.borderColor = lvl.color;
    preview.style.color = lvl.color;
    preview.innerHTML = `<img src="${lvl.img}" alt="">`;

    arrow.style.left = '50%';
    arrow.style.opacity = '1';

    const next = CONFIG.levels[nextLevel];
    const nextBall = $('nextBall');
    nextBall.style.borderColor = next.color;
    nextBall.style.color = next.color;
    nextBall.innerHTML = `<img src="${next.img}" alt="">`;

    canDrop = true;
}

function setupInput() {
    const wrapper = $('gameWrapper');

    const move = e => {
        if (!canDrop || gameOver) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        const rect = jarInner.getBoundingClientRect();
        const lvl = CONFIG.levels[currentLevel];

        let x = touch.clientX - rect.left;
        x = Math.max(lvl.radius + 8, Math.min(rect.width - lvl.radius - 8, x));

        $('previewBall').style.left = (x - lvl.radius) + 'px';
        $('dropArrow').style.left = x + 'px';
    };

    const drop = e => {
        if (!canDrop || gameOver) return;

        const now = Date.now();
        if (now - lastDropTime < CONFIG.dropCooldown) return;

        e.preventDefault();
        dropBall();
        lastDropTime = now;
    };

    wrapper.addEventListener('touchmove', move, { passive: false });
    wrapper.addEventListener('mousemove', move);
    wrapper.addEventListener('touchend', drop);
    wrapper.addEventListener('click', drop);
}

function dropBall() {
    canDrop = false;

    const lvl = CONFIG.levels[currentLevel];
    const preview = $('previewBall');
    const rect = jarInner.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();

    const x = previewRect.left - rect.left + lvl.radius;
    const y = lvl.radius + 8;

    const ball = Matter.Bodies.circle(x, y, lvl.radius, {
        restitution: 0.2,
        friction: 0.5,
        frictionAir: 0.01,
        density: 0.0015,
        label: 'ball',
        level: currentLevel,
        dropTime: Date.now()
    });

    Matter.Composite.add(engine.world, ball);
    balls.push(ball);

    preview.style.opacity = '0';
    $('dropArrow').style.opacity = '0';

    playSound('drop');

    setTimeout(() => {
        preview.style.opacity = '1';
        spawnBall();
    }, CONFIG.dropCooldown);
}

function onCollision(e) {
    e.pairs.forEach(({ bodyA, bodyB }) => {
        if (bodyA.label === 'ball' && bodyB.label === 'ball' &&
            bodyA.level === bodyB.level && !bodyA.merged && !bodyB.merged) {
            merge(bodyA, bodyB);
        }
    });
}

function merge(a, b) {
    a.merged = b.merged = true;

    const lvl = a.level;
    const next = lvl + 1;
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;

    Matter.Composite.remove(engine.world, [a, b]);
    balls = balls.filter(ball => ball !== a && ball !== b);

    // Update level bar immediately after removing merged balls
    updateLevelBar();

    const points = (lvl + 1) * 15;
    score += points;
    $('score').textContent = score;

    createParticles(mx, my, CONFIG.levels[lvl].color);
    playSound('merge');

    if (next < CONFIG.levels.length) {
        setTimeout(() => {
            const newLvl = CONFIG.levels[next];
            const ball = Matter.Bodies.circle(mx, my, newLvl.radius, {
                restitution: 0.2,
                friction: 0.5,
                frictionAir: 0.01,
                density: 0.0015,
                label: 'ball',
                level: next,
                dropTime: Date.now()
            });
            Matter.Composite.add(engine.world, ball);
            balls.push(ball);
            // Update level bar after new ball is added
            updateLevelBar();
        }, 50);
    } else {
        score += 200;
        $('score').textContent = score;
        createCelebration(mx, my);
    }
}

function updateLevelBar() {
    // Simple logic: check which fairy types are currently on the field
    // A ball is "on field" if it exists in the balls array, is not merged, and has a position
    const onField = new Set();

    for (const ball of balls) {
        // Only count balls that are not merged and still have position (in physics world)
        if (!ball.merged && ball.position && ball.position.x !== undefined) {
            onField.add(ball.level);
        }
    }

    const bar = $('levelBar');
    bar.innerHTML = CONFIG.levels.map((l, i) => {
        const isOnField = onField.has(i);
        return `
            <div class="level-dot ${isOnField ? 'unlocked' : ''}" style="border-color: ${isOnField ? l.color : 'rgba(255,255,255,0.2)'}">
                <img src="${l.img}" alt="">
            </div>
        `;
    }).join('');
}

function createParticles(x, y, color) {
    const jarRect = jarInner.getBoundingClientRect();

    for (let i = 0; i < 10; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const angle = (i / 10) * Math.PI * 2;
        const dist = 40 + Math.random() * 30;

        p.style.cssText = `
            left: ${jarRect.left + x}px;
            top: ${jarRect.top + y}px;
            width: 8px;
            height: 8px;
            background: ${color};
            box-shadow: 0 0 12px ${color};
            transition: all 0.35s ease-out;
        `;
        document.body.appendChild(p);

        requestAnimationFrame(() => {
            p.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;
            p.style.opacity = '0';
        });

        setTimeout(() => p.remove(), 350);
    }
}

function createCelebration(x, y) {
    const jarRect = jarInner.getBoundingClientRect();
    const emojis = ['🎉', '⭐', '✨', '🌟', '💫', '🎊'];

    for (let i = 0; i < 15; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        p.style.cssText = `
            left: ${jarRect.left + x}px;
            top: ${jarRect.top + y}px;
            font-size: 22px;
            transition: all 0.7s ease-out;
        `;
        document.body.appendChild(p);

        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 80;

        requestAnimationFrame(() => {
            p.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist - 50}px)`;
            p.style.opacity = '0';
        });

        setTimeout(() => p.remove(), 700);
    }
}

function render() {
    if (gameOver || isPaused) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    balls.forEach(ball => {
        if (ball.merged) return;

        const { x, y } = ball.position;
        const lvl = CONFIG.levels[ball.level];
        const r = lvl.radius;
        const img = images[lvl.name];

        ctx.save();
        ctx.shadowColor = lvl.color;
        ctx.shadowBlur = 15;

        ctx.beginPath();
        ctx.arc(x, y, r - 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
        } else {
            ctx.fillStyle = lvl.color;
            ctx.fill();
        }

        ctx.restore();

        ctx.beginPath();
        ctx.arc(x, y, r - 1, 0, Math.PI * 2);
        ctx.strokeStyle = lvl.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = lvl.color;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
    });

    checkGameOver();
    requestAnimationFrame(render);
}

function checkGameOver() {
    const now = Date.now();

    for (const ball of balls) {
        if (ball.merged || now - ball.dropTime < CONFIG.settleTime) continue;

        const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
        if (speed > 0.3) continue;

        if (ball.position.y < CONFIG.dangerY + CONFIG.levels[ball.level].radius) {
            endGame();
            return;
        }
    }
}

async function endGame() {
    gameOver = true;
    playSound('gameover');
    $('finalScore').textContent = score;

    // Check and save high score
    const isNewHighScore = await saveScore(currentUsername, score);
    const highScoreInfo = $('highScoreInfo');
    const highScoreText = $('highScoreText');

    if (isNewHighScore) {
        highScoreInfo.style.display = 'block';
        highScoreText.textContent = '🎉 Yeni Rekor! Tebrikler!';
        personalBest = score;
    } else if (score === personalBest && personalBest > 0) {
        highScoreInfo.style.display = 'block';
        highScoreText.textContent = `🏆 En iyi skorun: ${personalBest}`;
    } else if (personalBest > 0) {
        highScoreInfo.style.display = 'block';
        highScoreText.textContent = `🎯 En iyi skorun: ${personalBest}`;
    } else {
        highScoreInfo.style.display = 'none';
    }

    $('modal').classList.add('active');
}

function restart() {
    balls.forEach(b => Matter.Composite.remove(engine.world, b));
    balls = [];
    score = 0;
    gameOver = false;
    lastDropTime = 0;

    $('score').textContent = '0';
    $('modal').classList.remove('active');
    $('highScoreInfo').style.display = 'none';

    nextLevel = randomLevel();
    spawnBall();
    updateLevelBar();
    requestAnimationFrame(render);
}

// Audio
let audioCtx;
let soundEnabled = true;

function playSound(type) {
    if (!soundEnabled) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const t = audioCtx.currentTime;

    if (type === 'drop') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.1);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.1);
    } else if (type === 'merge') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.08);
        osc.frequency.setValueAtTime(784, t + 0.16);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.25);
    } else if (type === 'gameover') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.4);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.4);
    }
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    updateSoundButton();

    // Play a test sound when enabling
    if (soundEnabled) {
        playSound('drop');
    }
}

function updateSoundButton() {
    const btn = document.getElementById('soundBtn');
    if (btn) {
        btn.textContent = soundEnabled ? '🔊' : '🔇';
        btn.title = soundEnabled ? 'Sesi Kapat' : 'Sesi Aç';
    }
}

// Add sound button to the page
function addSoundButton() {
    const btn = document.createElement('button');
    btn.id = 'soundBtn';
    btn.className = 'leaderboard-btn';
    btn.style.cssText = 'left: 15px; right: auto;';
    btn.textContent = '🔊';
    btn.title = 'Sesi Kapat';
    btn.onclick = toggleSound;
    document.body.appendChild(btn);

    // Also allow 'M' key to toggle sound
    document.addEventListener('keydown', (e) => {
        if (e.key === 'm' || e.key === 'M') {
            toggleSound();
        }
    });
}

// PAUSE / QUIT SYSTEM
let isPaused = false;

function pauseGame() {
    if (gameOver || isPaused) return;

    isPaused = true;

    // Stop Matter.js engine
    if (runner) {
        Matter.Runner.stop(runner);
    }

    // Show pause modal
    $('pauseModal').classList.add('active');
}

function resumeGame() {
    if (!isPaused) return;

    isPaused = false;
    $('pauseModal').classList.remove('active');

    // Resume engine
    if (runner) {
        Matter.Runner.run(runner, engine);
    }

    // Continue render loop
    render();
}

async function quitGame() {
    isPaused = false;
    $('pauseModal').classList.remove('active');
    $('pauseBtn').classList.remove('visible');

    // Save current score to leaderboard if it qualifies
    if (score > 0 && currentUsername) {
        await saveScore(currentUsername, score);
    }

    // Stop engine
    if (runner) {
        Matter.Runner.stop(runner);
    }

    // Clear balls
    balls.forEach(b => Matter.Composite.remove(engine.world, b));
    balls = [];
    gameOver = true;

    // Go back to homepage
    window.location.href = '/';
}

function setupPauseUI() {
    // Pause button
    $('pauseBtn').addEventListener('click', pauseGame);

    // Resume button
    $('resumeBtn').addEventListener('click', resumeGame);

    // Quit button
    $('quitBtn').addEventListener('click', quitGame);

    // Home button (after game over)
    $('homeBtn').addEventListener('click', () => {
        window.location.href = '/';
    });
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        setupPauseUI();
    });
} else {
    init();
    setupPauseUI();
}


