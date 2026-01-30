// Peri Hokeyi - Offline Mode (vs AI)

// Firebase Config (for leaderboard only)
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
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();
} catch (e) {
    console.warn('Firebase initialization failed:', e);
}
const CONFIG = {
    winScore: 4,  // vs AI
    puckSpeed: 28,
    puckRadius: 18,
    paddleRadius: 40,
    aiSpeed: 5,
    aiReactionDelay: 100,
    friction: 0.99,
    wallBounce: 0.9,
    paddleBounce: 1.15,
    characters: [
        { id: 1, img: '../assets/1.jpg', color: '#ff6b9d', name: 'Luna' },
        { id: 2, img: '../assets/2.jpg', color: '#6bb3ff', name: 'Fiora' },
        { id: 3, img: '../assets/3.jpg', color: '#ffd93d', name: 'Zephyra' },
        { id: 4, img: '../assets/4.jpg', color: '#6bffb8', name: 'Ember' },
        { id: 5, img: '../assets/5.jpg', color: '#ffb86b', name: 'Aqua' },
        { id: 6, img: '../assets/6.jpg', color: '#b86bff', name: 'Glimmer' }
    ]
};
let playerNickname = '';

let gameState = {
    isPlaying: false,
    waitingForHit: false,
    goalScoring: false,
    playerScore: 0,
    aiScore: 0,
    startTime: 0,
    elapsedTime: 0,
    selectedChar: null,
    aiChar: null,
    idleStartTime: 0,
    lastScorer: null
};

let puck = { x: 0, y: 0, vx: 0, vy: 0 };
let playerPaddle = { x: 0, y: 0, vx: 0, vy: 0 };
let aiPaddle = { x: 0, y: 0, vx: 0, vy: 0 };
let rinkRect = null;
let animationId = null;
let timerInterval = null;
let username = '';
let stuckTimer = 0;
let lastPuckPos = { x: 0, y: 0 };

const $ = id => document.getElementById(id);
function initNicknameInput() {
    const input = $('nicknameInput');
    const btn = $('nicknameBtn');

    input.addEventListener('input', () => {
        const valid = input.value.trim().length >= 2;
        btn.disabled = !valid;
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !btn.disabled) {
            confirmNickname();
        }
    });

    btn.onclick = confirmNickname;
}

function confirmNickname() {
    playerNickname = $('nicknameInput').value.trim();

    // Save to localStorage for other games
    localStorage.setItem('manifriends_username', playerNickname);

    // Hide nickname, show character select
    $('nicknameOverlay').classList.remove('active');
    $('charSelect').style.display = 'flex';
    gameState.selectedChar = null;
    gameState.aiChar = null;
    updateCharSelectUI();
}

function updateCharSelectUI() {
    // Offline mode: select both characters
    if (!gameState.selectedChar) {
        $('charSelectSubtitle').textContent = '🎮 Kendi perini seç!';
    } else if (!gameState.aiChar) {
        $('charSelectSubtitle').textContent = '🤖 Şimdi rakip periyi seç!';
    } else {
        $('charSelectSubtitle').textContent = '✅ Hazırsın!';
    }
    $('startBtn').disabled = !(gameState.selectedChar && gameState.aiChar);
    $('startBtn').textContent = 'Başla! 🎮';
    document.querySelectorAll('.char-option').forEach(el => {
        const charId = parseInt(el.dataset.id);
        el.classList.remove('selected', 'opponent-selected');

        if (gameState.selectedChar && charId === gameState.selectedChar.id) {
            el.classList.add('selected');
        }
        if (gameState.aiChar && charId === gameState.aiChar.id) {
            el.classList.add('opponent-selected');
        }
    });
}
function initCharacterSelect() {
    const grid = $('charGrid');

    CONFIG.characters.forEach(char => {
        const div = document.createElement('div');
        div.className = 'char-option';
        div.dataset.id = char.id;
        div.innerHTML = `
            <img src="${char.img}" alt="${char.name}">
            <span class="char-name">${char.name}</span>
        `;
        div.onclick = () => selectCharacter(char);
        grid.appendChild(div);
    });
}

function selectCharacter(char) {
    // Offline mode: two character selection
    // If clicking on already selected player character, deselect it
    if (gameState.selectedChar && char.id === gameState.selectedChar.id) {
        gameState.selectedChar = null;
        gameState.aiChar = null;
        updateCharSelectUI();
        return;
    }

    // If clicking on already selected opponent character, deselect it
    if (gameState.aiChar && char.id === gameState.aiChar.id) {
        gameState.aiChar = null;
        updateCharSelectUI();
        return;
    }

    // If no player selected yet, select as player
    if (!gameState.selectedChar) {
        gameState.selectedChar = char;
    } else {
        // Player already selected, this is opponent selection
        gameState.aiChar = char;
    }
    updateCharSelectUI();
}

function handleStartButton() {

    if (gameState.selectedChar && gameState.aiChar) {
        startGame();
    }
}
function startGame() {
    gameState.isPlaying = true;
    gameState.playerScore = 0;
    gameState.aiScore = 0;
    gameState.startTime = Date.now();
    gameState.elapsedTime = 0;
    $('charSelect').style.display = 'none';
    $('playerAvatar').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    $('aiAvatar').innerHTML = `<img src="${gameState.aiChar.img}" alt="">`;
    $('playerPaddle').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    $('aiPaddle').innerHTML = `<img src="${gameState.aiChar.img}" alt="">`;
    $('playerLabel').textContent = playerNickname;
    $('aiLabel').textContent = gameState.aiChar?.name || 'AI';
    updateScoreDisplay();
    const rink = $('rink');
    rinkRect = rink.getBoundingClientRect();
    resetPositions();
    setupControls();
    startTimer();
    $('pauseBtn').style.display = 'block';
    window.addEventListener('resize', handleResize);

    gameLoop();
}

// Handle resize
function handleResize() {
    if (!gameState.isPlaying || !rinkRect) return;

    const rink = $('rink');
    const oldWidth = rinkRect.width;
    const oldHeight = rinkRect.height;

    rinkRect = rink.getBoundingClientRect();

    const scaleX = rinkRect.width / oldWidth;
    const scaleY = rinkRect.height / oldHeight;

    puck.x *= scaleX;
    puck.y *= scaleY;
    playerPaddle.x *= scaleX;
    playerPaddle.y *= scaleY;
    aiPaddle.x *= scaleX;
    aiPaddle.y *= scaleY;
    puck.x = Math.max(CONFIG.puckRadius, Math.min(rinkRect.width - CONFIG.puckRadius, puck.x));
    puck.y = Math.max(CONFIG.puckRadius, Math.min(rinkRect.height - CONFIG.puckRadius, puck.y));

    playerPaddle.x = Math.max(CONFIG.paddleRadius, Math.min(rinkRect.width - CONFIG.paddleRadius, playerPaddle.x));
    playerPaddle.y = Math.max(rinkRect.height / 2 + CONFIG.paddleRadius, Math.min(rinkRect.height - CONFIG.paddleRadius, playerPaddle.y));

    aiPaddle.x = Math.max(CONFIG.paddleRadius, Math.min(rinkRect.width - CONFIG.paddleRadius, aiPaddle.x));
    aiPaddle.y = Math.max(CONFIG.paddleRadius, Math.min(rinkRect.height / 2 - CONFIG.paddleRadius, aiPaddle.y));

    updatePuckPosition();
    updatePaddlePositions();
}

function resetPositions(lastScorer = null) {
    gameState.goalScoring = false;

    const rink = $('rink');
    rinkRect = rink.getBoundingClientRect();

    const centerX = rinkRect.width / 2;

    puck.x = centerX;
    puck.vx = 0;
    puck.vy = 0;

    if (lastScorer === 'player') {
        puck.y = rinkRect.height * 0.3;
    } else if (lastScorer === 'ai') {
        puck.y = rinkRect.height * 0.7;
    } else {
        puck.y = rinkRect.height / 2;
    }

    playerPaddle.x = centerX;
    playerPaddle.y = rinkRect.height - 80;

    aiPaddle.x = centerX;
    aiPaddle.y = 80;

    if (lastScorer) {
        gameState.waitingForHit = true;
        gameState.idleStartTime = Date.now();
        gameState.lastScorer = lastScorer;
    }

    updatePuckPosition();
    updatePaddlePositions();
}
function setupControls() {
    const rink = $('rink');

    const handleMove = (e) => {
        if (!gameState.isPlaying) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        rinkRect = rink.getBoundingClientRect();

        let x = touch.clientX - rinkRect.left;
        let y = touch.clientY - rinkRect.top;

        x = Math.max(CONFIG.paddleRadius, Math.min(rinkRect.width - CONFIG.paddleRadius - 8, x));
        y = Math.max(rinkRect.height / 2 + CONFIG.paddleRadius,
            Math.min(rinkRect.height - CONFIG.paddleRadius - 5, y));

        playerPaddle.vx = x - playerPaddle.x;
        playerPaddle.vy = y - playerPaddle.y;

        playerPaddle.x = x;
        playerPaddle.y = y;

        updatePaddlePositions();
    };

    rink.addEventListener('touchmove', handleMove, { passive: false });
    rink.addEventListener('mousemove', handleMove);
    rink.addEventListener('touchstart', handleMove, { passive: false });
}
function gameLoop() {
    if (!gameState.isPlaying) return;

    updatePuck();
    updateAI();
    checkCollisions();
    checkGoal();

    animationId = requestAnimationFrame(gameLoop);
}

function updatePuck() {
    puck.vx *= CONFIG.friction;
    puck.vy *= CONFIG.friction;

    puck.x += puck.vx;
    puck.y += puck.vy;
    if (puck.x - CONFIG.puckRadius < 0) {
        puck.x = CONFIG.puckRadius;
        puck.vx = -puck.vx * CONFIG.wallBounce;
        playSound('wall');
    } else if (puck.x + CONFIG.puckRadius > rinkRect.width) {
        puck.x = rinkRect.width - CONFIG.puckRadius;
        puck.vx = -puck.vx * CONFIG.wallBounce;
        playSound('wall');
    }

    // Wall collisions (top/bottom - except goal area)
    const goalWidth = 130;
    const goalLeft = rinkRect.width / 2 - goalWidth / 2;
    const goalRight = rinkRect.width / 2 + goalWidth / 2;
    const goalDepth = 35;
    if (puck.y - CONFIG.puckRadius < 0) {
        if (puck.x < goalLeft || puck.x > goalRight) {
            puck.y = CONFIG.puckRadius;
            puck.vy = -puck.vy * CONFIG.wallBounce;
        } else {
            if (puck.x < goalLeft + CONFIG.puckRadius) {
                puck.x = goalLeft + CONFIG.puckRadius;
                puck.vx = Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            if (puck.x > goalRight - CONFIG.puckRadius) {
                puck.x = goalRight - CONFIG.puckRadius;
                puck.vx = -Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            if (puck.y < -goalDepth + CONFIG.puckRadius) {
                puck.y = -goalDepth + CONFIG.puckRadius;
                puck.vy = Math.abs(puck.vy) * CONFIG.wallBounce;
            }
        }
    }
    if (puck.y + CONFIG.puckRadius > rinkRect.height) {
        if (puck.x < goalLeft || puck.x > goalRight) {
            puck.y = rinkRect.height - CONFIG.puckRadius;
            puck.vy = -puck.vy * CONFIG.wallBounce;
        } else {
            if (puck.x < goalLeft + CONFIG.puckRadius) {
                puck.x = goalLeft + CONFIG.puckRadius;
                puck.vx = Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            if (puck.x > goalRight - CONFIG.puckRadius) {
                puck.x = goalRight - CONFIG.puckRadius;
                puck.vx = -Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            if (puck.y > rinkRect.height + goalDepth - CONFIG.puckRadius) {
                puck.y = rinkRect.height + goalDepth - CONFIG.puckRadius;
                puck.vy = -Math.abs(puck.vy) * CONFIG.wallBounce;
            }
        }
    }

    updatePuckPosition();
}

function updateAI() {
    if (gameState.waitingForHit && puck.y > rinkRect.height / 2) return;

    const centerX = rinkRect.width / 2;
    const aiHalfHeight = rinkRect.height / 2;
    const puckInAIHalf = puck.y < aiHalfHeight;
    const puckSpeed = Math.hypot(puck.vx, puck.vy);

    const minY = CONFIG.paddleRadius + 5;
    const maxY = aiHalfHeight - CONFIG.paddleRadius - 5;
    const minX = CONFIG.paddleRadius + 5;
    const maxX = rinkRect.width - CONFIG.paddleRadius - 5;

    const homeX = centerX;
    const homeY = 85;

    let targetX = homeX;
    let targetY = homeY;
    let speed = CONFIG.aiSpeed;
    const puckMoved = Math.hypot(puck.x - lastPuckPos.x, puck.y - lastPuckPos.y);
    lastPuckPos.x = puck.x;
    lastPuckPos.y = puck.y;

    if (puckInAIHalf && puckMoved < 2 && puckSpeed < 3) {
        stuckTimer++;
    } else {
        stuckTimer = 0;
    }

    const isStuck = stuckTimer > 45;
    const distToPuck = Math.hypot(puck.x - aiPaddle.x, puck.y - aiPaddle.y);
    const aiAbovePuck = aiPaddle.y < puck.y - 5;

    if (isStuck && puckInAIHalf) {
        const randomAngle = (stuckTimer % 90) * (Math.PI / 45);
        targetX = puck.x + Math.cos(randomAngle) * 60;
        targetY = puck.y - 30 + Math.sin(randomAngle) * 40;
        speed = CONFIG.aiSpeed * 2.5;

    } else if (puckInAIHalf && puckSpeed < 3) {
        if (!aiAbovePuck || distToPuck > CONFIG.paddleRadius + CONFIG.puckRadius + 50) {
            targetX = puck.x;
            targetY = Math.max(minY, puck.y - CONFIG.paddleRadius - 20);
            speed = CONFIG.aiSpeed * 1.5;
        } else {
            targetX = puck.x;
            targetY = puck.y + CONFIG.paddleRadius;
            speed = CONFIG.aiSpeed * 2.0;
        }

    } else if (puckInAIHalf && puckSpeed >= 3) {
        const px = puck.x + puck.vx * 8;
        const py = puck.y + puck.vy * 8;
        targetX = px;
        targetY = Math.max(minY, py - CONFIG.paddleRadius * 0.5);
        speed = CONFIG.aiSpeed * 1.5;

    } else if (puck.vy < -4) {
        targetX = puck.x + puck.vx * 15;
        targetY = homeY;
        speed = CONFIG.aiSpeed * 1.2;

    } else {
        targetX = homeX + (puck.x - centerX) * 0.3;
        targetY = homeY;
        speed = CONFIG.aiSpeed * 0.6;
    }

    targetX = Math.max(minX, Math.min(maxX, targetX));
    targetY = Math.max(minY, Math.min(maxY, targetY));

    const dx = targetX - aiPaddle.x;
    const dy = targetY - aiPaddle.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 1) {
        const moveX = (dx / dist) * Math.min(speed, dist);
        const moveY = (dy / dist) * Math.min(speed, dist);
        aiPaddle.vx = moveX;
        aiPaddle.vy = moveY;

        aiPaddle.x += moveX;
        aiPaddle.y += moveY;
    } else {
        aiPaddle.vx = 0;
        aiPaddle.vy = 0;
    }

    aiPaddle.x = Math.max(minX, Math.min(maxX, aiPaddle.x));
    aiPaddle.y = Math.max(minY, Math.min(maxY, aiPaddle.y));

    updatePaddlePositions();
}

function checkCollisions() {
    const playerDist = Math.hypot(puck.x - playerPaddle.x, puck.y - playerPaddle.y);
    if (playerDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(playerPaddle);
    }

    const aiDist = Math.hypot(puck.x - aiPaddle.x, puck.y - aiPaddle.y);
    if (aiDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(aiPaddle);
    }
}

function handlePaddleCollision(paddle) {
    playSound('hit');

    if (gameState.waitingForHit) {
        gameState.waitingForHit = false;
        gameState.idleStartTime = 0;
    }

    const angle = Math.atan2(puck.y - paddle.y, puck.x - paddle.x);
    const paddleSpeed = Math.hypot(paddle.vx || 0, paddle.vy || 0);
    const puckSpeed = Math.hypot(puck.vx, puck.vy);

    const momentumTransfer = 0.7;
    const puckRetention = 0.3;
    let newSpeed = (paddleSpeed * momentumTransfer) + (puckSpeed * puckRetention);

    const paddleAngle = Math.atan2(paddle.vy || 0, paddle.vx || 0);
    const angleDiff = Math.abs(angle - paddleAngle);
    newSpeed += Math.max(0, paddleSpeed * Math.cos(angleDiff) * 0.5);

    const minSpeed = CONFIG.puckSpeed * 0.5;
    const maxSpeed = CONFIG.puckSpeed * 1.5;
    newSpeed = Math.max(minSpeed, Math.min(maxSpeed, newSpeed));

    puck.vx = Math.cos(angle) * newSpeed;
    puck.vy = Math.sin(angle) * newSpeed;

    if (paddleSpeed > 2) {
        puck.vx += (paddle.vx || 0) * 0.3;
        puck.vy += (paddle.vy || 0) * 0.3;
    }

    const dist = CONFIG.puckRadius + CONFIG.paddleRadius + 2;
    puck.x = paddle.x + Math.cos(angle) * dist;
    puck.y = paddle.y + Math.sin(angle) * dist;
}

function checkGoal() {
    if (gameState.goalScoring) return;

    const goalWidth = 130;
    const goalLeft = rinkRect.width / 2 - goalWidth / 2;
    const goalRight = rinkRect.width / 2 + goalWidth / 2;

    // AI goal (top) - Player scores
    if (puck.y < 0 && puck.x >= goalLeft && puck.x <= goalRight) {
        gameState.goalScoring = true;
        puck.y = -15;
        puck.vx = 0;
        puck.vy = 0;
        updatePuckPosition();
        scoreGoal('player');
    }
    if (puck.y > rinkRect.height && puck.x >= goalLeft && puck.x <= goalRight) {
        gameState.goalScoring = true;
        puck.y = rinkRect.height + 15;
        puck.vx = 0;
        puck.vy = 0;
        updatePuckPosition();
        scoreGoal('ai');
    }
}

function scoreGoal(scorer) {
    playSound(scorer === 'player' ? 'goal' : 'goalAgainst');

    if (scorer === 'player') {
        gameState.playerScore++;
    } else {
        gameState.aiScore++;
    }

    updateScoreDisplay();

    $('rink').classList.add('goal-scored');
    setTimeout(() => $('rink').classList.remove('goal-scored'), 900);

    if (gameState.playerScore >= CONFIG.winScore || gameState.aiScore >= CONFIG.winScore) {
        endGame();
    } else {
        setTimeout(() => resetPositions(scorer), 500);
    }
}

// UI UPDATES
function updatePuckPosition() {
    const puckEl = $('puck');
    puckEl.style.left = puck.x + 'px';
    puckEl.style.top = puck.y + 'px';
}

function updatePaddlePositions() {
    const playerEl = $('playerPaddle');
    const aiEl = $('aiPaddle');
    const playerLabelEl = $('playerLabel');
    const aiLabelEl = $('aiLabel');

    playerEl.style.left = playerPaddle.x + 'px';
    playerEl.style.top = playerPaddle.y + 'px';

    aiEl.style.left = aiPaddle.x + 'px';
    aiEl.style.top = aiPaddle.y + 'px';

    if (playerLabelEl) {
        playerLabelEl.style.left = playerPaddle.x + 'px';
        playerLabelEl.style.top = (playerPaddle.y + 50) + 'px';
    }
    if (aiLabelEl) {
        aiLabelEl.style.left = aiPaddle.x + 'px';
        aiLabelEl.style.top = (aiPaddle.y + 50) + 'px';
    }
}

function updateScoreDisplay() {
    $('playerScore').textContent = gameState.playerScore;
    $('aiScore').textContent = gameState.aiScore;
}

function startTimer() {
    timerInterval = setInterval(() => {
        if (!gameState.isPlaying) return;
        gameState.elapsedTime = Date.now() - gameState.startTime;
        $('timer').textContent = formatTime(gameState.elapsedTime);
    }, 100);
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
async function endGame() {
    gameState.isPlaying = false;
    cancelAnimationFrame(animationId);
    clearInterval(timerInterval);

    const playerWon = gameState.playerScore >= CONFIG.winScore;
    playSound(playerWon ? 'win' : 'lose');
    const time = formatTime(gameState.elapsedTime);

    $('modalTitle').textContent = playerWon ? '🎉 Kazandın!' : '😔 Kaybettin';
    $('modalSubtitle').textContent = playerWon ? 'Muhteşem oynadın!' : 'Tekrar dene!';
    $('modalTime').textContent = time;

    $('gameOverModal').classList.add('active');

    // Save to leaderboard if player LOST
    if (!playerWon) {
        await saveToLeaderboard(gameState.elapsedTime);
    }
}
async function saveToLeaderboard(timeMs) {
    if (!db) return;

    const name = username || localStorage.getItem('manifriends_username') || 'Anonim';

    try {
        const ref = db.ref('hockey-fastest-losers').push();
        await ref.set({
            name: name,
            time: timeMs,
            timestamp: Date.now()
        });
    } catch (e) {
        console.error('Error saving to leaderboard:', e);
    }
}

async function loadLeaderboard() {
    if (!db) return [];

    try {
        const snapshot = await db.ref('hockey-fastest-losers')
            .orderByChild('time')
            .limitToFirst(10)
            .once('value');

        const scores = [];
        snapshot.forEach(child => {
            scores.push(child.val());
        });

        return scores;
    } catch (e) {
        console.error('Error loading leaderboard:', e);
        return [];
    }
}

async function displayLeaderboard() {
    const list = $('leaderboardList');
    list.innerHTML = '<li class="no-scores">Yükleniyor...</li>';

    const scores = await loadLeaderboard();

    if (scores.length === 0) {
        list.innerHTML = '<li class="no-scores">Henüz kaybeden yok. İlk sen ol! 💀</li>';
        return;
    }

    list.innerHTML = scores.map((entry, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;

        return `
            <li class="leaderboard-item">
                <span class="rank ${rankClass}">${medal}</span>
                <span class="lb-player-name">${entry.name}</span>
                <span class="lb-time">${formatTime(entry.time)}</span>
            </li>
        `;
    }).join('');
}
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

    if (type === 'hit') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        osc.start(t);
        osc.stop(t + 0.08);
    } else if (type === 'wall') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.05);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        osc.start(t);
        osc.stop(t + 0.05);
    } else if (type === 'goal') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.1);
        osc.frequency.setValueAtTime(784, t + 0.2);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
        osc.start(t);
        osc.stop(t + 0.35);
    } else if (type === 'goalAgainst') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.3);
    } else if (type === 'win') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.15);
        osc.frequency.setValueAtTime(784, t + 0.3);
        osc.frequency.setValueAtTime(1047, t + 0.45);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
        osc.start(t);
        osc.stop(t + 0.6);
    } else if (type === 'lose') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.5);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
    }
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    if (soundEnabled) {
        playSound('hit');
    }
}

function updateSoundButton() {
    const btn = document.getElementById('soundBtn');
    if (btn) {
        btn.textContent = soundEnabled ? '🔊' : '🔇';
        btn.title = soundEnabled ? 'Sesi Kapat' : 'Sesi Aç';
    }
}

function initSoundButton() {
    const btn = document.getElementById('soundBtn');
    if (btn) {
        btn.onclick = toggleSound;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'm' || e.key === 'M') {
            toggleSound();
        }
    });
}
let isPaused = false;

function pauseGame() {
    if (!gameState.isPlaying) return;

    isPaused = true;
    gameState.isPlaying = false;
    cancelAnimationFrame(animationId);
    clearInterval(timerInterval);

    $('pauseMenu')?.classList.add('active');
}

function resumeGame() {
    if (!isPaused) return;

    isPaused = false;
    gameState.isPlaying = true;

    $('pauseMenu')?.classList.remove('active');

    startTimer();
    gameLoop();
}

function quitGame() {
    isPaused = false;
    gameState.isPlaying = false;
    cancelAnimationFrame(animationId);
    clearInterval(timerInterval);

    $('pauseMenu')?.classList.remove('active');
    $('pauseBtn').style.display = 'none';
    $('charSelect').style.display = 'flex';
    gameState.selectedChar = null;
    gameState.aiChar = null;
    updateCharSelectUI();
}

function initPauseButtons() {
    $('pauseBtn').onclick = pauseGame;
    $('resumeBtn').onclick = resumeGame;
    $('quitBtn').onclick = quitGame;
}
function init() {
    username = localStorage.getItem('manifriends_username') || '';
    playerNickname = username;
    const savedNickname = localStorage.getItem('manifriends_username');
    if (savedNickname && savedNickname.trim().length >= 2) {
        playerNickname = savedNickname.trim();
        $('charSelect').style.display = 'flex';
    } else {
        $('nicknameOverlay').classList.add('active');
        $('nicknameInput').focus();
    }

    initNicknameInput();
    initCharacterSelect();

    $('startBtn').onclick = handleStartButton;
    $('playAgainBtn').onclick = () => {
        $('gameOverModal').classList.remove('active');
        gameState.selectedChar = null;
        gameState.aiChar = null;
        $('startBtn').disabled = true;
        document.querySelectorAll('.char-option').forEach(el => {
            el.classList.remove('selected', 'opponent-selected');
        });
        $('charSelect').style.display = 'flex';
        updateCharSelectUI();
    };
    $('homeBtn').onclick = () => {
        window.location.href = '/';
    };
    $('leaderboardBtn').onclick = () => {
        $('leaderboardModal').classList.add('active');
        displayLeaderboard();
    };

    $('closeLeaderboard').onclick = () => {
        $('leaderboardModal').classList.remove('active');
    };

    $('leaderboardModal').onclick = (e) => {
        if (e.target === $('leaderboardModal')) {
            $('leaderboardModal').classList.remove('active');
        }
    };
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        initSoundButton();
        initPauseButtons();
    });
} else {
    init();
    initSoundButton();
    initPauseButtons();
}
