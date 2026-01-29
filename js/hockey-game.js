// Peri Hokeyi - Air Hockey Game
// ============================================

// Firebase Config
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

// ============================================
// GAME CONFIG
// ============================================
const CONFIG = {
    offlineWinScore: 4,  // vs AI
    onlineWinScore: 7,   // PvP
    puckSpeed: 28,       // Increased from 20
    puckRadius: 18,
    paddleRadius: 40,
    aiSpeed: 5,          // Reverted to 5
    aiReactionDelay: 100,
    friction: 0.99,
    wallBounce: 0.9,
    paddleBounce: 1.15,  // Slightly more bounce
    characters: [
        { id: 1, img: '../assets/1.png', color: '#ff6b9d' },
        { id: 2, img: '../assets/2.png', color: '#6bb3ff' },
        { id: 3, img: '../assets/3.png', color: '#ffd93d' },
        { id: 4, img: '../assets/4.png', color: '#6bffb8' },
        { id: 5, img: '../assets/5.png', color: '#ffb86b' },
        { id: 6, img: '../assets/6.png', color: '#b86bff' }
    ]
};

// ============================================
// GAME STATE
// ============================================
let gameMode = 'offline'; // 'offline' = vs AI, 'online' = PvP
let playerNickname = '';
let opponentNickname = '';

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
    idleStartTime: 0,  // Track when puck became idle after goal
    lastScorer: null   // 'player' or 'ai' - for idle puck direction
};

// Get current win score based on mode
function getWinScore() {
    return gameMode === 'offline' ? CONFIG.offlineWinScore : CONFIG.onlineWinScore;
}

let puck = { x: 0, y: 0, vx: 0, vy: 0 };
let playerPaddle = { x: 0, y: 0, vx: 0, vy: 0, lastX: 0, lastY: 0 };  // Added velocity tracking
let aiPaddle = { x: 0, y: 0, vx: 0, vy: 0, lastX: 0, lastY: 0 };      // Added velocity tracking
let rinkRect = null;
let animationId = null;
let timerInterval = null;
let username = '';
let stuckTimer = 0;
let lastPuckPos = { x: 0, y: 0 };

// ============================================
// ONLINE MULTIPLAYER STATE
// ============================================
let playerId = null;          // Unique player ID
let roomId = null;            // Current room ID
let isHost = false;           // Host controls puck physics
let roomRef = null;           // Firebase room reference
let onlineListeners = [];     // Active Firebase listeners

let onlineState = {
    connected: false,
    opponentConnected: false,
    opponentPaddle: { x: 0, y: 0 },
    opponentChar: null,
    opponentNick: ''
};

const $ = id => document.getElementById(id);

// ============================================
// MODE SELECTION & NICKNAME
// ============================================
function initModeSelect() {
    $('offlineBtn').onclick = () => selectMode('offline');
    $('onlineBtn').onclick = () => selectMode('online');

    // Start listening for active waiting rooms
    initActiveUsersListener();
}

function initActiveUsersListener() {
    if (!db) return;

    db.ref('hockey_matches/lobby').on('value', (snapshot) => {
        const players = snapshot.val();
        const count = players ? Object.keys(players).length : 0;
        const el = $('activeUsersCount');
        if (el) {
            el.textContent = count > 0 ? `${count} bekliyor` : '0 bekliyor';
        }
    });
}

function selectMode(mode) {
    gameMode = mode;

    // Get nickname from localStorage (set by Fairy Fusion game)
    const savedNickname = localStorage.getItem('manifriends_username');

    if (savedNickname && savedNickname.trim().length >= 2) {
        // Use saved nickname, skip nickname input
        playerNickname = savedNickname.trim();
        opponentNickname = '';

        // Go directly to character select
        $('modeSelect').style.display = 'none';
        $('charSelect').style.display = 'flex';

        // Reset selection state
        gameState.selectedChar = null;
        gameState.aiChar = null;
        updateCharSelectUI();
    } else {
        // No saved nickname, show nickname modal
        $('modeSelect').style.display = 'none';
        $('nicknameOverlay').classList.add('active');
        $('nicknameInput').focus();
    }
}

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
    opponentNickname = ''; // No nickname for opponent

    // Save to localStorage for other games
    localStorage.setItem('manifriends_username', playerNickname);

    // Hide nickname, show character select
    $('nicknameOverlay').classList.remove('active');
    $('charSelect').style.display = 'flex';

    // Reset selection state
    gameState.selectedChar = null;
    gameState.aiChar = null;
    updateCharSelectUI();
}

function updateCharSelectUI() {
    // Update subtitle based on mode and selection state
    if (gameMode === 'online') {
        // Online mode: only select your own character
        if (!gameState.selectedChar) {
            $('charSelectSubtitle').textContent = '🎮 Perini seç!';
        } else {
            $('charSelectSubtitle').textContent = '✅ Hazırsın!';
        }
        $('startBtn').disabled = !gameState.selectedChar;
        $('startBtn').textContent = 'Rakip Bul 🌐';
    } else {
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
    }

    // Update selection highlights
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

// ============================================
// CHARACTER SELECTION
// ============================================
function initCharacterSelect() {
    const grid = $('charGrid');

    CONFIG.characters.forEach(char => {
        const div = document.createElement('div');
        div.className = 'char-option';
        div.dataset.id = char.id;
        div.innerHTML = `<img src="${char.img}" alt="Character ${char.id}">`;
        div.onclick = () => selectCharacter(char);
        grid.appendChild(div);
    });
}

function selectCharacter(char) {
    if (gameMode === 'online') {
        // Online mode: toggle single character selection
        if (gameState.selectedChar && char.id === gameState.selectedChar.id) {
            gameState.selectedChar = null;
        } else {
            gameState.selectedChar = char;
        }
        updateCharSelectUI();
        return;
    }

    // Offline mode: two character selection
    // If clicking on already selected player character, deselect it
    if (gameState.selectedChar && char.id === gameState.selectedChar.id) {
        gameState.selectedChar = null;
        gameState.aiChar = null; // Also clear opponent
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

async function handleStartButton() {
    if (gameMode === 'online') {
        // Start matchmaking
        await startMatchmaking();
    } else {
        // Offline: start game directly (no countdown)
        // Both characters must be selected
        if (gameState.selectedChar && gameState.aiChar) {
            startGame();
        }
    }
}

function getRandomAICharacter() {
    const available = CONFIG.characters.filter(c => c.id !== gameState.selectedChar?.id);
    return available[Math.floor(Math.random() * available.length)];
}

// ============================================
// GAME INITIALIZATION
// ============================================
async function startGameWithCountdown() {
    const overlay = $('countdownOverlay');
    const numberEl = $('countdownNumber');

    overlay.classList.add('active');

    const sequence = ['3', '2', '1', 'BAŞLA!'];

    for (let i = 0; i < sequence.length; i++) {
        numberEl.textContent = sequence[i];
        numberEl.className = 'countdown-number';

        if (sequence[i] === 'BAŞLA!') {
            numberEl.classList.add('basla');
        }

        // Trigger animation by removing and re-adding
        numberEl.style.animation = 'none';
        numberEl.offsetHeight; // Force reflow
        numberEl.style.animation = 'countdownPop 0.8s ease-out';

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    overlay.classList.remove('active');
    startGame();
}

function startGame() {
    // aiChar is already selected in two-phase character selection
    gameState.isPlaying = true;
    gameState.playerScore = 0;
    gameState.aiScore = 0;
    gameState.startTime = Date.now();
    gameState.elapsedTime = 0;

    // Hide character select
    $('charSelect').style.display = 'none';

    // Set avatars
    $('playerAvatar').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    $('aiAvatar').innerHTML = `<img src="${gameState.aiChar.img}" alt="">`;
    $('playerPaddle').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    $('aiPaddle').innerHTML = `<img src="${gameState.aiChar.img}" alt="">`;

    // Set player labels (nicknames under characters)
    $('playerLabel').textContent = playerNickname;
    $('aiLabel').textContent = opponentNickname;

    // Update scores
    updateScoreDisplay();

    // Get rink dimensions
    const rink = $('rink');
    rinkRect = rink.getBoundingClientRect();

    // Initialize positions
    resetPositions();

    // Start game loop
    setupControls();
    startTimer();

    // Show pause button for offline mode only
    if (gameMode === 'offline') {
        $('pauseBtn').style.display = 'block';
    }

    // Handle window resize - keep positions normalized
    window.addEventListener('resize', handleResize);

    gameLoop();
}

// Handle resize to keep game elements in bounds
function handleResize() {
    if (!gameState.isPlaying || !rinkRect) return;

    const rink = $('rink');
    const oldWidth = rinkRect.width;
    const oldHeight = rinkRect.height;

    // Get new dimensions
    rinkRect = rink.getBoundingClientRect();

    // Scale positions to new dimensions
    const scaleX = rinkRect.width / oldWidth;
    const scaleY = rinkRect.height / oldHeight;

    puck.x *= scaleX;
    puck.y *= scaleY;
    playerPaddle.x *= scaleX;
    playerPaddle.y *= scaleY;
    aiPaddle.x *= scaleX;
    aiPaddle.y *= scaleY;

    // Clamp positions to bounds
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
    // Reset goal scoring flag
    gameState.goalScoring = false;

    const rink = $('rink');
    rinkRect = rink.getBoundingClientRect();

    const centerX = rinkRect.width / 2;

    // Reset puck - starts in front of whoever just got scored on (stationary)
    puck.x = centerX;
    puck.vx = 0;
    puck.vy = 0;

    if (lastScorer === 'player') {
        // Player scored, puck starts in AI's half (top) - AI must hit first
        puck.y = rinkRect.height * 0.3;
    } else if (lastScorer === 'ai') {
        // AI scored, puck starts in player's half (bottom) - player must hit first
        puck.y = rinkRect.height * 0.7;
    } else {
        // Initial start
        puck.y = rinkRect.height / 2;
    }

    // Reset paddles - positioned in front of their goals
    playerPaddle.x = centerX;
    playerPaddle.y = rinkRect.height - 80;

    aiPaddle.x = centerX;
    aiPaddle.y = 80;

    // Set waiting state if after a goal
    if (lastScorer) {
        gameState.waitingForHit = true;
        gameState.idleStartTime = Date.now();  // Start 5 second countdown
        gameState.lastScorer = lastScorer;     // Remember who scored
    }

    updatePuckPosition();
    updatePaddlePositions();
}

// ============================================
// CONTROLS
// ============================================
function setupControls() {
    const rink = $('rink');

    const handleMove = (e) => {
        if (!gameState.isPlaying) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        rinkRect = rink.getBoundingClientRect();

        let x = touch.clientX - rinkRect.left;
        let y = touch.clientY - rinkRect.top;

        // Clamp to rink bounds
        // With box-sizing: border-box, paddle visual radius = CONFIG.paddleRadius exactly
        // Extra padding on right side to prevent overflow
        x = Math.max(CONFIG.paddleRadius, Math.min(rinkRect.width - CONFIG.paddleRadius - 8, x));
        // Player can only move in bottom half
        y = Math.max(rinkRect.height / 2 + CONFIG.paddleRadius,
            Math.min(rinkRect.height - CONFIG.paddleRadius - 5, y));

        // Calculate paddle velocity (for realistic physics)
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

// ============================================
// GAME LOOP
// ============================================
function gameLoop() {
    if (!gameState.isPlaying) return;

    updatePuck();
    updateAI();
    checkCollisions();
    checkGoal();

    animationId = requestAnimationFrame(gameLoop);
}

function updatePuck() {
    // Apply friction
    puck.vx *= CONFIG.friction;
    puck.vy *= CONFIG.friction;

    // Update position
    puck.x += puck.vx;
    puck.y += puck.vy;

    // Wall collisions (left/right)
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
    const goalDepth = 35; // Match visual goal height

    // Top wall collision
    if (puck.y - CONFIG.puckRadius < 0) {
        if (puck.x < goalLeft || puck.x > goalRight) {
            // Hit top wall outside goal
            puck.y = CONFIG.puckRadius;
            puck.vy = -puck.vy * CONFIG.wallBounce;
        } else {
            // Inside goal area - check inner walls
            // Left inner wall of goal
            if (puck.x < goalLeft + CONFIG.puckRadius) {
                puck.x = goalLeft + CONFIG.puckRadius;
                puck.vx = Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            // Right inner wall of goal
            if (puck.x > goalRight - CONFIG.puckRadius) {
                puck.x = goalRight - CONFIG.puckRadius;
                puck.vx = -Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            // Back wall of goal
            if (puck.y < -goalDepth + CONFIG.puckRadius) {
                puck.y = -goalDepth + CONFIG.puckRadius;
                puck.vy = Math.abs(puck.vy) * CONFIG.wallBounce;
            }
        }
    }

    // Bottom wall collision
    if (puck.y + CONFIG.puckRadius > rinkRect.height) {
        if (puck.x < goalLeft || puck.x > goalRight) {
            // Hit bottom wall outside goal
            puck.y = rinkRect.height - CONFIG.puckRadius;
            puck.vy = -puck.vy * CONFIG.wallBounce;
        } else {
            // Inside goal area - check inner walls
            // Left inner wall of goal
            if (puck.x < goalLeft + CONFIG.puckRadius) {
                puck.x = goalLeft + CONFIG.puckRadius;
                puck.vx = Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            // Right inner wall of goal
            if (puck.x > goalRight - CONFIG.puckRadius) {
                puck.x = goalRight - CONFIG.puckRadius;
                puck.vx = -Math.abs(puck.vx) * CONFIG.wallBounce;
            }
            // Back wall of goal
            if (puck.y > rinkRect.height + goalDepth - CONFIG.puckRadius) {
                puck.y = rinkRect.height + goalDepth - CONFIG.puckRadius;
                puck.vy = -Math.abs(puck.vy) * CONFIG.wallBounce;
            }
        }
    }

    updatePuckPosition();
}

function updateAI() {
    // Don't move AI if waiting for player to hit (puck in player's half)
    if (gameState.waitingForHit && puck.y > rinkRect.height / 2) return;

    const centerX = rinkRect.width / 2;
    const aiHalfHeight = rinkRect.height / 2;
    const puckInAIHalf = puck.y < aiHalfHeight;
    const puckSpeed = Math.hypot(puck.vx, puck.vy);

    // AI movement boundaries
    const minY = CONFIG.paddleRadius + 5;
    const maxY = aiHalfHeight - CONFIG.paddleRadius - 5;
    const minX = CONFIG.paddleRadius + 5;
    const maxX = rinkRect.width - CONFIG.paddleRadius - 5;

    const homeX = centerX;
    const homeY = 85;

    let targetX = homeX;
    let targetY = homeY;
    let speed = CONFIG.aiSpeed;

    // ========================================
    // STUCK DETECTION - If puck hasn't moved much, increment timer
    // ========================================
    const puckMoved = Math.hypot(puck.x - lastPuckPos.x, puck.y - lastPuckPos.y);
    lastPuckPos.x = puck.x;
    lastPuckPos.y = puck.y;

    if (puckInAIHalf && puckMoved < 2 && puckSpeed < 3) {
        stuckTimer++;
    } else {
        stuckTimer = 0;
    }

    // ========================================
    // FORCE RESCUE - Puck stuck too long, charge at it!
    // ========================================
    const isStuck = stuckTimer > 45; // ~0.75 seconds at 60fps
    const distToPuck = Math.hypot(puck.x - aiPaddle.x, puck.y - aiPaddle.y);
    const aiAbovePuck = aiPaddle.y < puck.y - 5; // AI is above puck

    if (isStuck && puckInAIHalf) {
        // EMERGENCY: Wiggle in circle pattern to break deadlock
        const randomAngle = (stuckTimer % 90) * (Math.PI / 45);
        // Orbit around puck position, biased toward pushing down
        targetX = puck.x + Math.cos(randomAngle) * 60;
        targetY = puck.y - 30 + Math.sin(randomAngle) * 40; // Bias above puck
        speed = CONFIG.aiSpeed * 2.5;

    } else if (puckInAIHalf && puckSpeed < 3) {
        // ===== SLOW PUCK: Two-phase approach =====
        // Phase 1: Get ABOVE the puck (between puck and AI's goal)
        // Phase 2: Push DOWN toward player's goal

        if (!aiAbovePuck || distToPuck > CONFIG.paddleRadius + CONFIG.puckRadius + 50) {
            // Phase 1: Position above puck
            targetX = puck.x;
            targetY = Math.max(minY, puck.y - CONFIG.paddleRadius - 20);
            speed = CONFIG.aiSpeed * 1.5;
        } else {
            // Phase 2: We're above - now push DOWN
            targetX = puck.x;
            targetY = puck.y + CONFIG.paddleRadius; // Go through the puck
            speed = CONFIG.aiSpeed * 2.0;
        }

    } else if (puckInAIHalf && puckSpeed >= 3) {
        // ===== MOVING PUCK: Intercept but stay above =====
        const px = puck.x + puck.vx * 8;
        const py = puck.y + puck.vy * 8;

        // Try to intercept from above
        targetX = px;
        targetY = Math.max(minY, py - CONFIG.paddleRadius * 0.5);
        speed = CONFIG.aiSpeed * 1.5;

    } else if (puck.vy < -4) {
        // ===== INCOMING: Prepare to block =====
        targetX = puck.x + puck.vx * 15;
        targetY = homeY;
        speed = CONFIG.aiSpeed * 1.2;

    } else {
        // ===== IDLE: Stay near home, track puck X =====
        targetX = homeX + (puck.x - centerX) * 0.3;
        targetY = homeY;
        speed = CONFIG.aiSpeed * 0.6;
    }

    // ========================================
    // CLAMP & MOVE
    // ========================================
    targetX = Math.max(minX, Math.min(maxX, targetX));
    targetY = Math.max(minY, Math.min(maxY, targetY));

    const dx = targetX - aiPaddle.x;
    const dy = targetY - aiPaddle.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 1) {
        const moveX = (dx / dist) * Math.min(speed, dist);
        const moveY = (dy / dist) * Math.min(speed, dist);

        // Track velocity for realistic collision physics
        aiPaddle.vx = moveX;
        aiPaddle.vy = moveY;

        aiPaddle.x += moveX;
        aiPaddle.y += moveY;
    } else {
        aiPaddle.vx = 0;
        aiPaddle.vy = 0;
    }

    // Final clamp
    aiPaddle.x = Math.max(minX, Math.min(maxX, aiPaddle.x));
    aiPaddle.y = Math.max(minY, Math.min(maxY, aiPaddle.y));

    updatePaddlePositions();
}

function checkCollisions() {
    // Player paddle collision
    const playerDist = Math.hypot(puck.x - playerPaddle.x, puck.y - playerPaddle.y);
    if (playerDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(playerPaddle);
    }

    // AI paddle collision
    const aiDist = Math.hypot(puck.x - aiPaddle.x, puck.y - aiPaddle.y);
    if (aiDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(aiPaddle);
    }
}

function handlePaddleCollision(paddle) {
    // Play hit sound
    playSound('hit');

    // Clear waiting state when puck is hit
    if (gameState.waitingForHit) {
        gameState.waitingForHit = false;
        gameState.idleStartTime = 0;
    }

    // === REALISTIC PHYSICS ===
    // Calculate collision angle (from paddle center to puck)
    const angle = Math.atan2(puck.y - paddle.y, puck.x - paddle.x);

    // Get paddle velocity magnitude
    const paddleSpeed = Math.hypot(paddle.vx || 0, paddle.vy || 0);

    // Get puck incoming speed
    const puckSpeed = Math.hypot(puck.vx, puck.vy);

    // Momentum transfer: faster paddle = harder hit
    // Base speed + paddle contribution + puck contribution
    const momentumTransfer = 0.7;  // How much paddle speed transfers to puck
    const puckRetention = 0.3;     // How much of puck's speed is retained

    // Calculate new speed based on paddle movement and puck's incoming speed
    let newSpeed = (paddleSpeed * momentumTransfer) + (puckSpeed * puckRetention);

    // Add paddle velocity direction influence
    // If paddle is moving toward the puck, add extra power
    const paddleAngle = Math.atan2(paddle.vy || 0, paddle.vx || 0);
    const angleDiff = Math.abs(angle - paddleAngle);
    const directionalBonus = paddleSpeed * Math.cos(angleDiff) * 0.5;
    newSpeed += Math.max(0, directionalBonus);

    // Apply limits
    const minSpeed = CONFIG.puckSpeed * 0.5;   // Minimum speed
    const maxSpeed = CONFIG.puckSpeed * 1.5;   // Maximum speed cap
    newSpeed = Math.max(minSpeed, Math.min(maxSpeed, newSpeed));

    // Set puck velocity in collision direction
    puck.vx = Math.cos(angle) * newSpeed;
    puck.vy = Math.sin(angle) * newSpeed;

    // Add slight paddle velocity influence on direction
    if (paddleSpeed > 2) {
        puck.vx += (paddle.vx || 0) * 0.3;
        puck.vy += (paddle.vy || 0) * 0.3;
    }

    // Push puck outside paddle to prevent multiple collisions
    const dist = CONFIG.puckRadius + CONFIG.paddleRadius + 2;
    puck.x = paddle.x + Math.cos(angle) * dist;
    puck.y = paddle.y + Math.sin(angle) * dist;
}

function checkGoal() {
    // Prevent scoring multiple times for the same goal
    if (gameState.goalScoring) return;

    const goalWidth = 130;
    const goalLeft = rinkRect.width / 2 - goalWidth / 2;
    const goalRight = rinkRect.width / 2 + goalWidth / 2;

    // AI goal (top) - Player scores when puck crosses line
    if (puck.y < 0 && puck.x >= goalLeft && puck.x <= goalRight) {
        gameState.goalScoring = true; // Prevent multiple triggers
        puck.y = -15; // Stop inside goal, visible
        puck.vx = 0;
        puck.vy = 0;
        updatePuckPosition();
        scoreGoal('player');
    }

    // Player goal (bottom) - AI scores when puck crosses line
    if (puck.y > rinkRect.height && puck.x >= goalLeft && puck.x <= goalRight) {
        gameState.goalScoring = true; // Prevent multiple triggers
        puck.y = rinkRect.height + 15; // Stop inside goal, visible
        puck.vx = 0;
        puck.vy = 0;
        updatePuckPosition();
        scoreGoal('ai');
    }
}

function scoreGoal(scorer) {
    // Play appropriate sound
    playSound(scorer === 'player' ? 'goal' : 'goalAgainst');

    if (scorer === 'player') {
        gameState.playerScore++;
    } else {
        gameState.aiScore++;
    }

    updateScoreDisplay();

    // Flash effect
    $('rink').classList.add('goal-scored');
    setTimeout(() => $('rink').classList.remove('goal-scored'), 900);

    // Check for win
    if (gameState.playerScore >= getWinScore() || gameState.aiScore >= getWinScore()) {
        endGame();
    } else {
        // Reset puck after short delay - pass who scored
        setTimeout(() => resetPositions(scorer), 500);
    }
}

// ============================================
// UI UPDATES
// ============================================
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

    // Position labels below paddles
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

// ============================================
// GAME END
// ============================================
async function endGame() {
    gameState.isPlaying = false;
    cancelAnimationFrame(animationId);
    clearInterval(timerInterval);

    const playerWon = gameState.playerScore >= getWinScore();
    playSound(playerWon ? 'win' : 'lose');
    const time = formatTime(gameState.elapsedTime);

    $('modalTitle').textContent = playerWon ? '🎉 Kazandın!' : '😔 Kaybettin';
    $('modalSubtitle').textContent = playerWon ? 'Muhteşem oynadın!' : 'Tekrar dene!';
    $('modalTime').textContent = time;

    $('gameOverModal').classList.add('active');

    // Save to leaderboard if player LOST (fastest losers!)
    if (!playerWon) {
        await saveToLeaderboard(gameState.elapsedTime);
    }
}

// ============================================
// LEADERBOARD - EN HIZLI KAYBEDENLER
// ============================================
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

// ============================================
// INITIALIZATION
// ============================================
function init() {
    username = localStorage.getItem('manifriends_username') || '';

    // Initialize mode and nickname flows
    initModeSelect();
    initNicknameInput();
    initCharacterSelect();

    // Start button - uses handleStartButton for two-phase selection
    $('startBtn').onclick = handleStartButton;

    // Play again - restart from mode selection
    $('playAgainBtn').onclick = () => {
        $('gameOverModal').classList.remove('active');

        // Reset state for new game
        gameState.selectedChar = null;
        gameState.aiChar = null;
        $('startBtn').disabled = true;
        $('startBtn').textContent = 'Başla! 🎮';
        document.querySelectorAll('.char-option').forEach(el => {
            el.classList.remove('selected', 'opponent-selected');
        });
        $('nicknameInput').value = '';
        $('nicknameBtn').disabled = true;

        // Show mode selection
        $('modeSelect').style.display = 'flex';
    };

    // Home button
    $('homeBtn').onclick = () => {
        window.location.href = '../index.html';
    };

    // Leaderboard
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

    // Resize handler removed - game dimensions stay fixed
}

// ============================================
// SOUND SYSTEM
// ============================================
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
        // Paddle hits puck - short pop sound
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        osc.start(t);
        osc.stop(t + 0.08);
    } else if (type === 'wall') {
        // Puck hits wall - thud sound
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.05);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        osc.start(t);
        osc.stop(t + 0.05);
    } else if (type === 'goal') {
        // Goal scored - happy ascending sound
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.1);
        osc.frequency.setValueAtTime(784, t + 0.2);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
        osc.start(t);
        osc.stop(t + 0.35);
    } else if (type === 'goalAgainst') {
        // Goal against - sad descending sound
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.3);
    } else if (type === 'win') {
        // Win game - victory fanfare
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
        // Lose game - sad sound
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

    // M key to toggle sound
    document.addEventListener('keydown', (e) => {
        if (e.key === 'm' || e.key === 'M') {
            toggleSound();
        }
    });
}

// ============================================
// ONLINE MULTIPLAYER
// ============================================
async function startMatchmaking() {
    // Show lobby instead of waiting modal
    $('charSelect').style.display = 'none';
    $('onlineLobby')?.classList.add('active');

    // Populate my profile in lobby
    const myAvatarEl = $('myProfileAvatar');
    if (myAvatarEl && gameState.selectedChar) {
        myAvatarEl.innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    }
    const myNameEl = $('myProfileName');
    if (myNameEl) {
        myNameEl.textContent = playerNickname || 'Ben';
    }

    // Register self in lobby
    playerId = generatePlayerId();

    if (!db) {
        alert('Firebase bağlantısı yok!');
        return;
    }

    // Add self to waiting lobby
    const lobbyRef = db.ref(`hockey_matches/lobby/${playerId}`);
    await lobbyRef.set({
        id: playerId,
        nickname: playerNickname,
        charId: gameState.selectedChar?.id || 1,
        charImg: gameState.selectedChar?.img || '',
        status: 'waiting',  // 'waiting' = can be challenged, 'busy' = in challenge/game
        timestamp: Date.now()
    });

    // Remove self when disconnecting
    lobbyRef.onDisconnect().remove();

    // Listen for lobby updates
    setupLobbyListener();

    // Setup button handlers
    $('lobbyAiBtn').onclick = () => {
        exitLobby();
        gameMode = 'offline';
        // Go to character select for AI opponent
        $('onlineLobby').classList.remove('active');
        $('charSelect').style.display = 'flex';
        gameState.aiChar = null;
        updateCharSelectUI();
    };

    $('lobbyCancelBtn').onclick = () => {
        exitLobby();
        $('onlineLobby').classList.remove('active');
        $('modeSelect').style.display = 'flex';
    };
}

function setupLobbyListener() {
    if (!db) return;

    db.ref('hockey_matches/lobby').on('value', (snapshot) => {
        const players = snapshot.val();
        const listEl = $('lobbyPlayersList');
        const countEl = $('lobbyCount');
        if (!listEl) return;

        const playerArray = players ? Object.values(players).filter(p => p.id !== playerId) : [];

        // Update count badge
        if (countEl) {
            countEl.textContent = playerArray.length;
        }

        if (playerArray.length === 0) {
            listEl.innerHTML = `
                <div class="lobby-empty">
                    <div class="lobby-empty-icon">🔍</div>
                    <div>Başka oyuncu bekleniyor...</div>
                    <div class="lobby-empty-spinner"></div>
                </div>
            `;
            return;
        }

        // Build player cards
        let html = '';
        playerArray.forEach(player => {
            const isBusy = player.status === 'busy';
            const statusText = isBusy ? 'Oyunda' : 'Bekliyor';
            const statusClass = isBusy ? 'busy' : 'waiting';
            const cardClass = isBusy ? 'lobby-player-card disabled' : 'lobby-player-card';
            const onclick = isBusy ? '' : `onclick="challengePlayer('${player.id}')"`;

            html += `
                <div class="${cardClass}" ${onclick}>
                    <div class="lobby-player-avatar">
                        <img src="${player.charImg}" alt="">
                    </div>
                    <div class="lobby-player-info">
                        <div class="lobby-player-name">${player.nickname}</div>
                        <div class="lobby-player-status ${statusClass}">${statusText}</div>
                    </div>
                    ${isBusy ? '' : '<button class="lobby-play-btn">Oyna!</button>'}
                </div>
            `;
        });

        listEl.innerHTML = html;
    });

    // Listen for challenges
    setupChallengeListener();
}

let challengeTimer = null;
let challengeTimeoutId = null;
let currentChallengeData = null;

function setupChallengeListener() {
    db.ref(`hockey_matches/challenges/${playerId}`).on('value', async (snapshot) => {
        const challenge = snapshot.val();
        if (challenge && challenge.status === 'pending') {
            // Someone challenged us - show incoming challenge modal
            showIncomingChallenge(challenge);
        } else if (challenge && challenge.status === 'accepted') {
            // Our challenge was accepted - both go to game
            currentChallengeData = null;
            clearChallengeTimer();
            $('challengeWaitingModal').classList.remove('active');
            await db.ref(`hockey_matches/challenges/${playerId}`).remove();
        } else if (challenge && challenge.status === 'declined') {
            // Challenge was declined
            clearChallengeTimer();
            currentChallengeData = null;
            $('challengeWaitingModal').classList.remove('active');
            await db.ref(`hockey_matches/challenges/${playerId}`).remove();
            alert('Rakip meydan okumayı reddetti.');
        }
    });
}

function showIncomingChallenge(challenge) {
    currentChallengeData = challenge;
    $('incomingChallengeName').textContent = challenge.challengerNick;
    $('incomingChallengeModal').classList.add('active');

    // Setup accept/decline buttons
    $('challengeAcceptBtn').onclick = () => acceptChallenge(challenge);
    $('challengeDeclineBtn').onclick = () => declineChallenge(challenge);
}

async function challengePlayer(targetPlayerId) {
    if (!db) return;

    // Get target player info
    const targetSnap = await db.ref(`hockey_matches/lobby/${targetPlayerId}`).once('value');
    const targetPlayer = targetSnap.val();
    if (!targetPlayer) {
        alert('Bu oyuncu artık mevcut değil!');
        return;
    }

    // Create room as host
    roomId = 'room_' + Date.now();
    isHost = true;
    roomRef = db.ref(`hockey_matches/rooms/${roomId}`);

    await roomRef.set({
        host: {
            id: playerId,
            nickname: playerNickname,
            charId: gameState.selectedChar?.id || 1,
            charImg: gameState.selectedChar?.img || '',
            paddle: { x: 0, y: 0 }
        },
        client: null,
        puck: { x: 0, y: 0, vx: 0, vy: 0 },
        scores: { host: 0, client: 0 },
        state: 'waiting',
        createdAt: Date.now()
    });

    // Send challenge to target (pending status)
    await db.ref(`hockey_matches/challenges/${targetPlayerId}`).set({
        challengerId: playerId,
        challengerNick: playerNickname,
        challengerChar: gameState.selectedChar?.id || 1,
        challengerImg: gameState.selectedChar?.img || '',
        roomId: roomId,
        status: 'pending'
    });

    // Mark both players as busy in lobby
    await db.ref(`hockey_matches/lobby/${playerId}/status`).set('busy');
    await db.ref(`hockey_matches/lobby/${targetPlayerId}/status`).set('busy');

    // Store target info
    onlineState.opponentNick = targetPlayer.nickname;
    onlineState.opponentChar = CONFIG.characters.find(c => c.id === targetPlayer.charId);
    gameState.aiChar = onlineState.opponentChar;
    opponentNickname = targetPlayer.nickname;
    currentChallengeData = { targetPlayerId, targetPlayer };

    // Show waiting modal with timer
    $('challengeWaitingName').textContent = targetPlayer.nickname;
    $('challengeWaitingModal').classList.add('active');

    // Start 10 second countdown
    startChallengeTimer(10, targetPlayerId);

    // Setup cancel button
    $('challengeCancelBtn').onclick = () => cancelChallenge(targetPlayerId);

    // Listen for room state changes (when opponent accepts)
    setupRoomListeners();
}

function startChallengeTimer(seconds, targetPlayerId) {
    let remaining = seconds;
    const timerText = $('timerText');
    const timerProgress = $('timerProgress');
    const circumference = 2 * Math.PI * 45; // r=45

    timerText.textContent = remaining;
    timerProgress.style.strokeDasharray = circumference;
    timerProgress.style.strokeDashoffset = 0;

    challengeTimer = setInterval(() => {
        remaining--;
        timerText.textContent = remaining;

        // Update circle progress
        const offset = circumference * (1 - remaining / seconds);
        timerProgress.style.strokeDashoffset = offset;

        if (remaining <= 0) {
            clearChallengeTimer();
            cancelChallenge(targetPlayerId, true); // timeout
        }
    }, 1000);

    // Also set a timeout as backup
    challengeTimeoutId = setTimeout(() => {
        cancelChallenge(targetPlayerId, true);
    }, seconds * 1000 + 500);
}

function clearChallengeTimer() {
    if (challengeTimer) {
        clearInterval(challengeTimer);
        challengeTimer = null;
    }
    if (challengeTimeoutId) {
        clearTimeout(challengeTimeoutId);
        challengeTimeoutId = null;
    }
}

async function cancelChallenge(targetPlayerId, isTimeout = false) {
    clearChallengeTimer();
    $('challengeWaitingModal').classList.remove('active');

    // Remove challenge and room
    if (targetPlayerId) {
        await db.ref(`hockey_matches/challenges/${targetPlayerId}`).remove();
    }
    if (roomRef) {
        await roomRef.remove();
    }

    // Reset lobby status for both players
    await db.ref(`hockey_matches/lobby/${playerId}/status`).set('waiting');
    if (targetPlayerId) {
        await db.ref(`hockey_matches/lobby/${targetPlayerId}/status`).set('waiting');
    }

    roomRef = null;
    roomId = null;
    isHost = false;
    currentChallengeData = null;

    if (isTimeout) {
        alert('Rakip zamanında yanıt vermedi.');
    }
}

async function acceptChallenge(challenge) {
    $('incomingChallengeModal').classList.remove('active');

    // Join the challenger's room
    roomId = challenge.roomId;
    isHost = false;
    roomRef = db.ref(`hockey_matches/rooms/${roomId}`);

    // Set opponent info
    onlineState.opponentNick = challenge.challengerNick;
    onlineState.opponentChar = CONFIG.characters.find(c => c.id === challenge.challengerChar);
    gameState.aiChar = onlineState.opponentChar;
    opponentNickname = challenge.challengerNick;

    // Add self as client
    await roomRef.child('client').set({
        id: playerId,
        nickname: playerNickname,
        charId: gameState.selectedChar?.id || 1,
        charImg: gameState.selectedChar?.img || '',
        paddle: { x: 0, y: 0 }
    });

    // Notify challenger that we accepted
    await db.ref(`hockey_matches/challenges/${challenge.challengerId}`).set({
        status: 'accepted',
        roomId: roomId
    });

    // Remove self from lobby and clear our challenge
    await db.ref(`hockey_matches/lobby/${playerId}`).remove();
    await db.ref(`hockey_matches/challenges/${playerId}`).remove();

    // Set state to playing
    await roomRef.child('state').set('playing');

    // Hide lobby
    $('onlineLobby').classList.remove('active');

    // Setup listeners
    setupRoomListeners();
}

async function declineChallenge(challenge) {
    $('incomingChallengeModal').classList.remove('active');

    // Notify challenger that we declined
    await db.ref(`hockey_matches/challenges/${challenge.challengerId}`).set({
        status: 'declined'
    });

    // Reset lobby status for both players
    await db.ref(`hockey_matches/lobby/${playerId}/status`).set('waiting');
    await db.ref(`hockey_matches/lobby/${challenge.challengerId}/status`).set('waiting');

    // Clear our challenge data
    await db.ref(`hockey_matches/challenges/${playerId}`).remove();
    currentChallengeData = null;
}

function exitLobby() {
    if (db && playerId) {
        db.ref(`hockey_matches/lobby/${playerId}`).remove();
        db.ref(`hockey_matches/challenges/${playerId}`).remove();
        db.ref('hockey_matches/lobby').off();
        db.ref(`hockey_matches/challenges/${playerId}`).off();
    }
}

function cancelMatchmaking() {
    // Cleanup any waiting room
    if (roomRef && isHost) {
        roomRef.remove();
        db.ref(`hockey_matches/waiting/${roomId}`).remove();
    }
    cleanupOnlineGame();

    // Hide waiting modal, show mode selection
    $('onlineWaiting')?.classList.remove('active');
    $('modeSelect').style.display = 'flex';

    // Reset state
    gameState.selectedChar = null;
    gameState.aiChar = null;
}

function generatePlayerId() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function findOrCreateRoom() {
    if (!db) {
        alert('Firebase bağlantısı yok!');
        return null;
    }

    playerId = generatePlayerId();

    // Look for waiting rooms
    const waitingRef = db.ref('hockey_matches/waiting');
    const snapshot = await waitingRef.once('value');
    const waitingRooms = snapshot.val();

    if (waitingRooms) {
        // Join first available room
        const roomIds = Object.keys(waitingRooms);
        if (roomIds.length > 0) {
            roomId = roomIds[0];
            isHost = false;
            return joinRoom(roomId);
        }
    }

    // No waiting rooms, create new one
    roomId = 'room_' + Date.now();
    isHost = true;

    roomRef = db.ref(`hockey_matches/rooms/${roomId}`);

    // Create room as host
    await roomRef.set({
        host: {
            id: playerId,
            nickname: playerNickname,
            charId: gameState.selectedChar?.id || 1,
            paddle: { x: 0, y: 0 }
        },
        client: null,
        puck: { x: 0, y: 0, vx: 0, vy: 0 },
        scores: { host: 0, client: 0 },
        state: 'waiting',
        createdAt: Date.now()
    });

    // Add to waiting list
    await db.ref(`hockey_matches/waiting/${roomId}`).set(true);

    return roomId;
}

async function joinRoom(roomIdToJoin) {
    roomRef = db.ref(`hockey_matches/rooms/${roomIdToJoin}`);

    // Update room with client info
    await roomRef.child('client').set({
        id: playerId,
        nickname: playerNickname,
        charId: gameState.selectedChar?.id || 1,
        paddle: { x: 0, y: 0 }
    });

    // Remove from waiting list
    await db.ref(`hockey_matches/waiting/${roomIdToJoin}`).remove();

    // Set state to playing
    await roomRef.child('state').set('playing');

    return roomIdToJoin;
}

function setupRoomListeners() {
    if (!roomRef) return;

    // Listen for game state changes
    const stateListener = roomRef.child('state').on('value', (snapshot) => {
        const state = snapshot.val();
        if (state === 'playing' && !gameState.isPlaying) {
            // Both players ready, start game
            startOnlineGame();
        } else if (state === 'ended') {
            // Game ended by other player
            cleanupOnlineGame();
        }
    });
    onlineListeners.push({ ref: roomRef.child('state'), event: 'value', callback: stateListener });

    // Listen for opponent paddle
    const opponentPath = isHost ? 'client' : 'host';
    const paddleListener = roomRef.child(`${opponentPath}/paddle`).on('value', (snapshot) => {
        const paddle = snapshot.val();
        if (paddle) {
            onlineState.opponentPaddle = paddle;
        }
    });
    onlineListeners.push({ ref: roomRef.child(`${opponentPath}/paddle`), event: 'value', callback: paddleListener });

    // Listen for opponent connection and disconnect
    const opponentListener = roomRef.child(opponentPath).on('value', (snapshot) => {
        const opponent = snapshot.val();
        if (opponent) {
            onlineState.opponentConnected = true;
            onlineState.opponentNick = opponent.nickname || '';
            onlineState.opponentChar = CONFIG.characters.find(c => c.id === opponent.charId);
            opponentNickname = onlineState.opponentNick;
        } else if (onlineState.opponentConnected && gameState.isPlaying) {
            // Opponent disconnected during game
            onlineState.opponentConnected = false;
            handleOpponentDisconnect();
        }
    });
    onlineListeners.push({ ref: roomRef.child(opponentPath), event: 'value', callback: opponentListener });

    // If client, listen for puck updates from host
    if (!isHost) {
        const puckListener = roomRef.child('puck').on('value', (snapshot) => {
            const puckData = snapshot.val();
            if (puckData && gameState.isPlaying && rinkRect) {
                // Mirror puck position and velocity for client view
                puck.x = puckData.x;
                puck.y = rinkRect.height - puckData.y; // Mirror Y
                puck.vx = puckData.vx;
                puck.vy = -puckData.vy; // Invert Y velocity
            }
        });
        onlineListeners.push({ ref: roomRef.child('puck'), event: 'value', callback: puckListener });
    }

    // Listen for score updates (and play sounds)
    let prevPlayerScore = 0;
    let prevAiScore = 0;
    const scoreListener = roomRef.child('scores').on('value', (snapshot) => {
        const scores = snapshot.val();
        if (scores) {
            const newPlayerScore = isHost ? scores.host : scores.client;
            const newAiScore = isHost ? scores.client : scores.host;

            // Play sounds based on score changes (only on client, host already played via scoreGoal)
            if (!isHost && gameState.isPlaying) {
                if (newPlayerScore > prevPlayerScore) {
                    // I scored!
                    playSound('goal');
                } else if (newAiScore > prevAiScore) {
                    // Opponent scored
                    playSound('goalAgainst');
                }
            }

            prevPlayerScore = newPlayerScore;
            prevAiScore = newAiScore;

            gameState.playerScore = newPlayerScore;
            gameState.aiScore = newAiScore;
            updateScoreDisplay();
        }
    });
    onlineListeners.push({ ref: roomRef.child('scores'), event: 'value', callback: scoreListener });
}

// Mirror Y coordinate for client to flip perspective
function mirrorY(y) {
    return rinkRect.height - y;
}

function resetOnlinePositions() {
    const centerX = rinkRect.width / 2;
    const bottomY = rinkRect.height - CONFIG.paddleRadius - 20;
    const topY = CONFIG.paddleRadius + 20;

    // Host plays at bottom, client plays at top (in host's coordinate system)
    // But each player sees themselves at bottom of their screen
    if (isHost) {
        playerPaddle.x = centerX;
        playerPaddle.y = bottomY;
        aiPaddle.x = centerX;
        aiPaddle.y = topY;
    } else {
        // Client: we control top (in host coords), but see ourselves at bottom
        // So we set playerPaddle to where we want to render (bottom)
        playerPaddle.x = centerX;
        playerPaddle.y = bottomY;
        aiPaddle.x = centerX;
        aiPaddle.y = topY;
    }

    // Puck at center
    puck.x = centerX;
    puck.y = rinkRect.height / 2;
    puck.vx = 0;
    puck.vy = 0;

    updatePaddlePositions();
    updatePuckPosition();
}

function syncPaddlePosition() {
    if (!roomRef || !gameState.isPlaying || !rinkRect) return;

    const path = isHost ? 'host/paddle' : 'client/paddle';

    // Send normalized coordinates (0-1 range) for cross-device compatibility
    // Client also mirrors Y so host can use directly
    let normalizedX = playerPaddle.x / rinkRect.width;
    let normalizedY = playerPaddle.y / rinkRect.height;

    // Client: mirror Y (bottom becomes top in host coords)
    if (!isHost) {
        normalizedY = 1 - normalizedY;
    }

    roomRef.child(path).set({
        x: normalizedX,
        y: normalizedY
    });
}

function syncPuckState() {
    if (!roomRef || !isHost || !gameState.isPlaying) return;

    roomRef.child('puck').set({
        x: puck.x,
        y: puck.y,
        vx: puck.vx,
        vy: puck.vy
    });
}

function syncScores() {
    if (!roomRef || !isHost) return;

    roomRef.child('scores').set({
        host: isHost ? gameState.playerScore : gameState.aiScore,
        client: isHost ? gameState.aiScore : gameState.playerScore
    });
}

async function startOnlineGame() {
    // Get opponent character
    if (onlineState.opponentChar) {
        gameState.aiChar = onlineState.opponentChar;
    }

    // Set nicknames for labels
    opponentNickname = onlineState.opponentNick;

    // Setup game but DON'T start yet - show board first
    gameState.playerScore = 0;
    gameState.aiScore = 0;

    // Clear challenge timer if still running
    clearChallengeTimer();

    // Hide ALL modals and screens
    $('challengeWaitingModal')?.classList.remove('active');
    $('incomingChallengeModal')?.classList.remove('active');
    $('onlineLobby')?.classList.remove('active');
    $('onlineWaiting')?.classList.remove('active');
    $('charSelect').style.display = 'none';

    // Setup avatars and labels
    if (isHost) {
        $('playerAvatar').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
        $('aiAvatar').innerHTML = `<img src="${gameState.aiChar?.img || gameState.selectedChar.img}" alt="">`;
        $('playerPaddle').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
        $('aiPaddle').innerHTML = `<img src="${gameState.aiChar?.img || gameState.selectedChar.img}" alt="">`;
        $('playerLabel').textContent = playerNickname;
        $('aiLabel').textContent = opponentNickname;
    } else {
        // Client: swap so player sees their character at bottom
        $('playerAvatar').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
        $('aiAvatar').innerHTML = `<img src="${gameState.aiChar?.img || gameState.selectedChar.img}" alt="">`;
        $('playerPaddle').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
        $('aiPaddle').innerHTML = `<img src="${gameState.aiChar?.img || gameState.selectedChar.img}" alt="">`;
        $('playerLabel').textContent = playerNickname;
        $('aiLabel').textContent = opponentNickname;
    }

    updateScoreDisplay();

    const rink = $('rink');
    rinkRect = rink.getBoundingClientRect();

    // Reset positions - show board frozen
    resetOnlinePositions();
    updatePuckPosition();
    updatePaddlePositions();

    // NOW show countdown
    await showCountdown();

    // AFTER countdown, activate the game
    gameState.isPlaying = true;
    gameState.startTime = Date.now();
    gameState.elapsedTime = 0;

    setupControls();
    startTimer();
    onlineGameLoop();
}

// Countdown display function
async function showCountdown() {
    const overlay = $('countdownOverlay');
    const numberEl = $('countdownNumber');

    overlay.classList.add('active');

    const sequence = ['3', '2', '1', 'BAŞLA!'];

    for (let i = 0; i < sequence.length; i++) {
        numberEl.textContent = sequence[i];
        numberEl.className = 'countdown-number';

        if (sequence[i] === 'BAŞLA!') {
            numberEl.classList.add('basla');
        }

        // Trigger animation
        numberEl.style.animation = 'none';
        numberEl.offsetHeight;
        numberEl.style.animation = 'countdownPop 0.8s ease-out';

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    overlay.classList.remove('active');
}

function onlineGameLoop() {
    if (!gameState.isPlaying) return;

    // Always sync our paddle position first
    syncPaddlePosition();

    // Update opponent paddle position BEFORE collision check
    // Convert normalized coords (0-1) to local pixels
    if (onlineState.opponentPaddle.x !== undefined && rinkRect) {
        // Convert normalized to local pixels
        const opponentX = onlineState.opponentPaddle.x * rinkRect.width;
        let opponentY = onlineState.opponentPaddle.y * rinkRect.height;

        // For client: mirror Y for display (host's top shows as our top)
        if (!isHost) {
            opponentY = rinkRect.height - opponentY;
        }

        aiPaddle.x = opponentX;
        aiPaddle.y = opponentY;
    }

    // Host controls puck physics - AFTER paddle positions are updated
    if (isHost) {
        // Check for 5 second idle after goal - auto-move puck toward opponent
        if (gameState.waitingForHit && gameState.idleStartTime > 0) {
            const idleTime = Date.now() - gameState.idleStartTime;
            if (idleTime >= 5000) {
                // Start moving puck slowly
                gameState.waitingForHit = false;
                gameState.idleStartTime = 0;

                // Move toward the goal of the scorer
                if (gameState.lastScorer === 'player') {
                    // Host scored, puck moves toward opponent (up)
                    puck.vy = -3;
                } else {
                    // Opponent scored, puck moves toward host (down)
                    puck.vy = 3;
                }
                puck.vx = (Math.random() - 0.5) * 2;
            }
        }

        updatePuck();
        checkOnlineCollisions();
        checkGoal();
        syncPuckState();
    }

    updatePuckPosition();
    updatePaddlePositions();

    animationId = requestAnimationFrame(onlineGameLoop);
}

function checkOnlineCollisions() {
    // Player paddle collision
    const playerDist = Math.hypot(puck.x - playerPaddle.x, puck.y - playerPaddle.y);
    if (playerDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(playerPaddle);
    }

    // Opponent paddle collision
    const opponentDist = Math.hypot(puck.x - aiPaddle.x, puck.y - aiPaddle.y);
    if (opponentDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(aiPaddle);
    }
}

function cleanupOnlineGame() {
    // Remove all listeners
    onlineListeners.forEach(({ ref, event, callback }) => {
        ref.off(event, callback);
    });
    onlineListeners = [];

    // Clear room reference
    if (roomRef && isHost) {
        roomRef.child('state').set('ended');
    }

    roomRef = null;
    roomId = null;
    isHost = false;
    onlineState.connected = false;
    onlineState.opponentConnected = false;
}

// ============================================
// PAUSE MENU (OFFLINE ONLY)
// ============================================
let isPaused = false;

function pauseGame() {
    if (!gameState.isPlaying || gameMode !== 'offline') return;

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

    // Resume timer and game loop
    startTimer();
    gameLoop();
}

function quitGame() {
    isPaused = false;
    gameState.isPlaying = false;
    cancelAnimationFrame(animationId);
    clearInterval(timerInterval);

    // Hide pause menu
    $('pauseMenu')?.classList.remove('active');
    $('pauseBtn').style.display = 'none';

    // Clean up online if needed
    if (gameMode === 'online') {
        cleanupOnlineGame();
    }

    // Return to mode select
    $('modeSelect').style.display = 'flex';
}

// ============================================
// OPPONENT DISCONNECT HANDLING (ONLINE)
// ============================================
function handleOpponentDisconnect() {
    if (!gameState.isPlaying || gameMode !== 'online') return;

    // Stop the game
    gameState.isPlaying = false;
    cancelAnimationFrame(animationId);
    clearInterval(timerInterval);

    // Show disconnect modal
    $('disconnectModal')?.classList.add('active');
}

function returnToLobby() {
    $('disconnectModal')?.classList.remove('active');

    // Cleanup
    cleanupOnlineGame();

    // Go back to lobby
    gameMode = 'online';
    startMatchmaking();
}

function initPauseButtons() {
    // Pause button click
    $('pauseBtn').onclick = pauseGame;

    // Resume button
    $('resumeBtn').onclick = resumeGame;

    // Quit button
    $('quitBtn').onclick = quitGame;

    // Disconnect modal - return to lobby
    $('disconnectLobbyBtn').onclick = returnToLobby;
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
