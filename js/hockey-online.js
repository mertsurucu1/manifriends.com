
const firebaseConfig = {
    apiKey: "AIzaSyBCcdSfQmPNsRHEi03k_iUcPQbNZbPHaJw",
    authDomain: "manifriends-a091a.firebaseapp.com",
    databaseURL: "https://manifriends-a091a-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "manifriends-a091a",
    storageBucket: "manifriends-a091a.firebasestorage.app",
    messagingSenderId: "692995414185",
    appId: "1:692995414185:web:2cff9c1cf3e1acc75671b8"
};
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
    winScore: 7,
    puckSpeed: 28,
    puckRadius: 18,
    paddleRadius: 40,
    friction: 0.99,
    wallBounce: 0.9,
    paddleBounce: 1.15,
    characters: [
        { id: 1, img: '../assets/1.jpg', color: '#ff6b9d' },
        { id: 2, img: '../assets/2.jpg', color: '#6bb3ff' },
        { id: 3, img: '../assets/3.jpg', color: '#ffd93d' },
        { id: 4, img: '../assets/4.jpg', color: '#6bffb8' },
        { id: 5, img: '../assets/5.jpg', color: '#ffb86b' },
        { id: 6, img: '../assets/6.jpg', color: '#b86bff' }
    ]
};
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
let playerId = null;
let roomId = null;
let isHost = false;
let roomRef = null;
let onlineListeners = [];

let onlineState = {
    connected: false,
    opponentConnected: false,
    opponentPaddle: { x: 0, y: 0 },
    opponentChar: null,
    opponentNick: ''
};
let lastPaddleSync = 0;
let puckTarget = { x: 0, y: 0, vx: 0, vy: 0 };
let lastPuckUpdate = 0;
let currentPing = 0;
let pingInterval = null;
const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let peerConnection = null;
let dataChannel = null;
let webrtcConnected = false;

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(STUN_SERVERS);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && roomRef) {
            const path = isHost ? 'host/ice' : 'client/ice';
            roomRef.child(path).push(event.candidate.toJSON());
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('WebRTC Connection State:', peerConnection.connectionState);
        updateConnectionStatus();

        if (peerConnection.connectionState === 'connected') {
            webrtcConnected = true;
            updateConnectionStatus();
        } else if (peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed') {
            webrtcConnected = false;
            handleOpponentDisconnect();
        }
    };

    // Host creates data channel, client receives it
    if (isHost) {
        dataChannel = peerConnection.createDataChannel('gameData', {
            ordered: false,
            maxRetransmits: 0
        });
        setupDataChannel();
    } else {
        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel();
        };
    }

    return peerConnection;
}

function setupDataChannel() {
    dataChannel.onopen = () => {
        console.log('DataChannel opened!');
        webrtcConnected = true;
        updateConnectionStatus();
    };

    dataChannel.onclose = () => {
        console.log('DataChannel closed');
        webrtcConnected = false;
    };

    dataChannel.onmessage = (event) => {
        handleWebRTCMessage(JSON.parse(event.data));
    };
}

// Send data via WebRTC DataChannel
function sendGameData(data) {
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(data));
    }
}

// Handle incoming WebRTC messages
function handleWebRTCMessage(data) {
    if (!gameState.isPlaying) return;

    switch (data.type) {
        case 'paddle':

            onlineState.opponentPaddle.x = data.x;
            onlineState.opponentPaddle.y = data.y;
            break;

        case 'puck':

            if (!isHost && rinkRect) {
                puckTarget.x = data.x;
                puckTarget.y = rinkRect.height - data.y;
                puck.vx = data.vx;
                puck.vy = -data.vy;
            }
            break;

        case 'score':

            if (!isHost) {
                const prevPlayerScore = gameState.playerScore;
                const prevAiScore = gameState.aiScore;

                gameState.playerScore = data.client;
                gameState.aiScore = data.host;

                if (data.client > prevPlayerScore) playSound('goal');
                if (data.host > prevAiScore) playSound('goalAgainst');

                updateScoreDisplay();

                if (gameState.playerScore >= CONFIG.winScore || gameState.aiScore >= CONFIG.winScore) {
                    endGame();
                }
            }
            break;

        case 'reset':

            if (!isHost) {
                resetOnlinePositions();
            }
            break;

        case 'ping':

            sendGameData({ type: 'pong', timestamp: data.timestamp });
            break;

        case 'pong':

            const rtt = Date.now() - data.timestamp;
            currentPing = rtt;
            updatePingDisplayWebRTC();
            break;
    }
}

// WebRTC Signaling via Firebase
async function startWebRTCAsHost() {
    createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await roomRef.child('offer').set({
        type: offer.type,
        sdp: offer.sdp
    });
    roomRef.child('answer').on('value', async (snapshot) => {
        const answer = snapshot.val();
        if (answer && peerConnection.signalingState === 'have-local-offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });
    roomRef.child('client/ice').on('child_added', async (snapshot) => {
        const candidate = snapshot.val();
        if (candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });
}

async function startWebRTCAsClient() {
    createPeerConnection();
    roomRef.child('offer').on('value', async (snapshot) => {
        const offer = snapshot.val();
        if (offer && peerConnection.signalingState === 'stable') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            await roomRef.child('answer').set({
                type: answer.type,
                sdp: answer.sdp
            });
        }
    });
    roomRef.child('host/ice').on('child_added', async (snapshot) => {
        const candidate = snapshot.val();
        if (candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });
}

function updateConnectionStatus() {
    const indicator = $('pingIndicator');
    if (!indicator) return;

    if (webrtcConnected) {
        indicator.textContent = '🟢 P2P';
        indicator.style.color = '#4CAF50';
    } else {
        indicator.textContent = '🔴 Bağlanıyor...';
        indicator.style.color = '#f44336';
    }
}

function cleanupWebRTC() {
    stopWebRTCPing();
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    webrtcConnected = false;
}

// WebRTC Ping measurement
function startWebRTCPing() {
    pingInterval = setInterval(() => {
        if (webrtcConnected && gameState.isPlaying) {
            sendGameData({ type: 'ping', timestamp: Date.now() });
        }
    }, 2000);
}

function stopWebRTCPing() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

function updatePingDisplayWebRTC() {
    const indicator = $('pingIndicator');
    if (!indicator) return;

    if (currentPing < 50) {
        indicator.textContent = `🟢 ${currentPing}ms`;
        indicator.style.color = '#4CAF50';
    } else if (currentPing < 100) {
        indicator.textContent = `🟡 ${currentPing}ms`;
        indicator.style.color = '#FFEB3B';
    } else if (currentPing < 200) {
        indicator.textContent = `🟠 ${currentPing}ms`;
        indicator.style.color = '#FF9800';
    } else {
        indicator.textContent = `🔴 ${currentPing}ms`;
        indicator.style.color = '#f44336';
    }
}
// ============================================

// ============================================

const $ = id => document.getElementById(id);
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
    opponentNickname = '';

    localStorage.setItem('manifriends_username', playerNickname);

    $('nicknameOverlay').classList.remove('active');
    $('charSelect').style.display = 'flex';

    gameState.selectedChar = null;
    gameState.aiChar = null;
    updateCharSelectUI();
}

function updateCharSelectUI() {
    // Online mode: only select your own character
    if (!gameState.selectedChar) {
        $('charSelectSubtitle').textContent = '🎮 Perini seç!';
    } else {
        $('charSelectSubtitle').textContent = '✅ Hazırsın!';
    }
    $('startBtn').disabled = !gameState.selectedChar;
    $('startBtn').textContent = 'Rakip Bul 🌐';

    document.querySelectorAll('.char-option').forEach(el => {
        const charId = parseInt(el.dataset.id);
        el.classList.remove('selected', 'opponent-selected');

        if (gameState.selectedChar && charId === gameState.selectedChar.id) {
            el.classList.add('selected');
        }
    });
}
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
    // Online mode: toggle single character selection
    if (gameState.selectedChar && char.id === gameState.selectedChar.id) {
        gameState.selectedChar = null;
    } else {
        gameState.selectedChar = char;
    }
    updateCharSelectUI();
}

async function handleStartButton() {

    await startMatchmaking();
}
async function startMatchmaking() {
    $('charSelect').style.display = 'none';
    $('onlineLobby')?.classList.add('active');
    const myAvatarEl = $('myProfileAvatar');
    if (myAvatarEl && gameState.selectedChar) {
        myAvatarEl.innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    }
    const myNameEl = $('myProfileName');
    if (myNameEl) {
        myNameEl.textContent = playerNickname || 'Ben';
    }

    playerId = generatePlayerId();

    if (!db) {
        alert('Firebase bağlantısı yok!');
        return;
    }
    const lobbyRef = db.ref(`hockey_matches/lobby/${playerId}`);
    await lobbyRef.set({
        id: playerId,
        nickname: playerNickname,
        charId: gameState.selectedChar?.id || 1,
        charImg: gameState.selectedChar?.img || '',
        status: 'waiting',
        timestamp: Date.now()
    });

    lobbyRef.onDisconnect().remove();

    setupLobbyListener();
    $('lobbyAiBtn').onclick = () => {

        exitLobby();
        window.location.href = '/hockey/offline';
    };

    $('lobbyCancelBtn').onclick = () => {
        exitLobby();
        $('onlineLobby').classList.remove('active');
        $('charSelect').style.display = 'flex';
        gameState.selectedChar = null;
        updateCharSelectUI();
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

    setupChallengeListener();
}
let challengeTimer = null;
let challengeTimeoutId = null;
let currentChallengeData = null;

function setupChallengeListener() {
    db.ref(`hockey_matches/challenges/${playerId}`).on('value', async (snapshot) => {
        const challenge = snapshot.val();
        if (challenge && challenge.status === 'pending') {
            showIncomingChallenge(challenge);
        } else if (challenge && challenge.status === 'accepted') {
            currentChallengeData = null;
            clearChallengeTimer();
            $('challengeWaitingModal').classList.remove('active');
            await db.ref(`hockey_matches/challenges/${playerId}`).remove();
        } else if (challenge && challenge.status === 'declined') {
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

    $('challengeAcceptBtn').onclick = () => acceptChallenge(challenge);
    $('challengeDeclineBtn').onclick = () => declineChallenge(challenge);
}

async function challengePlayer(targetPlayerId) {
    if (!db) return;

    const targetSnap = await db.ref(`hockey_matches/lobby/${targetPlayerId}`).once('value');
    const targetPlayer = targetSnap.val();
    if (!targetPlayer) {
        alert('Bu oyuncu artık mevcut değil!');
        return;
    }
    roomId = 'room_' + Date.now();
    isHost = true;
    roomRef = db.ref(`hockey_matches/rooms/${roomId}`);

    await roomRef.set({
        host: {
            id: playerId,
            nickname: playerNickname,
            charId: gameState.selectedChar?.id || 1,
            charImg: gameState.selectedChar?.img || '',
            paddle: { x: 0, y: 0 },
            connected: true
        },
        client: null,
        puck: { x: 0, y: 0, vx: 0, vy: 0 },
        scores: { host: 0, client: 0 },
        state: 'waiting',
        createdAt: Date.now()
    });
    await db.ref(`hockey_matches/challenges/${targetPlayerId}`).set({
        challengerId: playerId,
        challengerNick: playerNickname,
        challengerChar: gameState.selectedChar?.id || 1,
        challengerImg: gameState.selectedChar?.img || '',
        roomId: roomId,
        status: 'pending'
    });
    await db.ref(`hockey_matches/lobby/${playerId}/status`).set('busy');
    await db.ref(`hockey_matches/lobby/${targetPlayerId}/status`).set('busy');
    onlineState.opponentNick = targetPlayer.nickname;
    onlineState.opponentChar = CONFIG.characters.find(c => c.id === targetPlayer.charId);
    gameState.aiChar = onlineState.opponentChar;
    opponentNickname = targetPlayer.nickname;
    currentChallengeData = { targetPlayerId, targetPlayer };
    $('challengeWaitingName').textContent = targetPlayer.nickname;
    $('challengeWaitingModal').classList.add('active');

    startChallengeTimer(10, targetPlayerId);

    $('challengeCancelBtn').onclick = () => cancelChallenge(targetPlayerId);

    setupRoomListeners();
    startWebRTCAsHost();
}

function startChallengeTimer(seconds, targetPlayerId) {
    let remaining = seconds;
    const timerText = $('timerText');
    const timerProgress = $('timerProgress');
    const circumference = 2 * Math.PI * 45;

    timerText.textContent = remaining;
    timerProgress.style.strokeDasharray = circumference;
    timerProgress.style.strokeDashoffset = 0;

    challengeTimer = setInterval(() => {
        remaining--;
        timerText.textContent = remaining;

        const offset = circumference * (1 - remaining / seconds);
        timerProgress.style.strokeDashoffset = offset;

        if (remaining <= 0) {
            clearChallengeTimer();
            cancelChallenge(targetPlayerId, true);
        }
    }, 1000);

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

    if (targetPlayerId) {
        await db.ref(`hockey_matches/challenges/${targetPlayerId}`).remove();
    }
    if (roomRef) {
        await roomRef.remove();
    }

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

    roomId = challenge.roomId;
    isHost = false;
    roomRef = db.ref(`hockey_matches/rooms/${roomId}`);

    onlineState.opponentNick = challenge.challengerNick;
    onlineState.opponentChar = CONFIG.characters.find(c => c.id === challenge.challengerChar);
    gameState.aiChar = onlineState.opponentChar;
    opponentNickname = challenge.challengerNick;

    await roomRef.child('client').set({
        id: playerId,
        nickname: playerNickname,
        charId: gameState.selectedChar?.id || 1,
        charImg: gameState.selectedChar?.img || '',
        paddle: { x: 0, y: 0 },
        connected: true
    });

    await db.ref(`hockey_matches/challenges/${challenge.challengerId}`).set({
        status: 'accepted',
        roomId: roomId
    });

    await db.ref(`hockey_matches/lobby/${playerId}`).remove();
    await db.ref(`hockey_matches/challenges/${playerId}`).remove();

    await roomRef.child('state').set('playing');

    $('onlineLobby').classList.remove('active');

    setupRoomListeners();
    startWebRTCAsClient();
}

async function declineChallenge(challenge) {
    $('incomingChallengeModal').classList.remove('active');

    await db.ref(`hockey_matches/challenges/${challenge.challengerId}`).set({
        status: 'declined'
    });

    await db.ref(`hockey_matches/lobby/${playerId}/status`).set('waiting');
    await db.ref(`hockey_matches/lobby/${challenge.challengerId}/status`).set('waiting');

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

function generatePlayerId() {
    return 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}
function setupRoomListeners() {
    if (!roomRef) return;

    const stateListener = roomRef.child('state').on('value', (snapshot) => {
        const state = snapshot.val();
        if (state === 'playing' && !gameState.isPlaying) {
            startOnlineGame();
        } else if (state === 'ended') {
            cleanupOnlineGame();
        }
    });
    onlineListeners.push({ ref: roomRef.child('state'), event: 'value', callback: stateListener });

    const opponentPath = isHost ? 'client' : 'host';

    // Listen for opponent paddle position
    const paddleListener = roomRef.child(`${opponentPath}/paddle`).on('value', (snapshot) => {
        const paddle = snapshot.val();
        if (paddle) {
            onlineState.opponentPaddle = paddle;
        }
    });
    onlineListeners.push({ ref: roomRef.child(`${opponentPath}/paddle`), event: 'value', callback: paddleListener });

    // Listen for opponent connection/disconnection (separate from paddle for efficiency)
    const opponentConnectedListener = roomRef.child(`${opponentPath}/connected`).on('value', (snapshot) => {
        const connected = snapshot.val();
        if (connected === false && onlineState.opponentConnected && gameState.isPlaying) {
            onlineState.opponentConnected = false;
            handleOpponentDisconnect();
        }
    });
    onlineListeners.push({ ref: roomRef.child(`${opponentPath}/connected`), event: 'value', callback: opponentConnectedListener });

    // Get opponent info once (not continuous listening)
    roomRef.child(opponentPath).once('value', (snapshot) => {
        const opponent = snapshot.val();
        if (opponent) {
            onlineState.opponentConnected = true;
            onlineState.opponentNick = opponent.nickname || '';
            onlineState.opponentChar = CONFIG.characters.find(c => c.id === opponent.charId);
            opponentNickname = onlineState.opponentNick;
        }
    });
    if (!isHost) {
        const puckListener = roomRef.child('puck').on('value', (snapshot) => {
            const puckData = snapshot.val();
            if (puckData && gameState.isPlaying && rinkRect) {
                // Store target state (mirrored for client perspective)
                puckTarget.x = puckData.x;
                puckTarget.y = rinkRect.height - puckData.y;
                puck.vx = puckData.vx;
                puck.vy = -puckData.vy;

                lastPuckUpdate = Date.now();
            }
        });
        onlineListeners.push({ ref: roomRef.child('puck'), event: 'value', callback: puckListener });
    }

    // Score sync - host sends, client receives
    const scoreListener = roomRef.child('scores').on('value', (snapshot) => {
        const scores = snapshot.val();
        if (scores && !isHost && gameState.isPlaying) {
            const newPlayerScore = scores.client; // Client's score is stored as 'client'
            const newAiScore = scores.host;
            if (newPlayerScore > gameState.playerScore) {
                playSound('goal');
            } else if (newAiScore > gameState.aiScore) {
                playSound('goalAgainst');
            }

            gameState.playerScore = newPlayerScore;
            gameState.aiScore = newAiScore;
            updateScoreDisplay();
            if (gameState.playerScore >= CONFIG.winScore || gameState.aiScore >= CONFIG.winScore) {
                endGame();
            }
        }
    });
    onlineListeners.push({ ref: roomRef.child('scores'), event: 'value', callback: scoreListener });
}
async function startOnlineGame() {
    if (onlineState.opponentChar) {
        gameState.aiChar = onlineState.opponentChar;
    }

    opponentNickname = onlineState.opponentNick;

    gameState.playerScore = 0;
    gameState.aiScore = 0;

    clearChallengeTimer();
    $('challengeWaitingModal')?.classList.remove('active');
    $('incomingChallengeModal')?.classList.remove('active');
    $('onlineLobby')?.classList.remove('active');
    $('charSelect').style.display = 'none';
    $('playerAvatar').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    $('aiAvatar').innerHTML = `<img src="${gameState.aiChar?.img || gameState.selectedChar.img}" alt="">`;
    $('playerPaddle').innerHTML = `<img src="${gameState.selectedChar.img}" alt="">`;
    $('aiPaddle').innerHTML = `<img src="${gameState.aiChar?.img || gameState.selectedChar.img}" alt="">`;
    $('playerLabel').textContent = playerNickname;
    $('aiLabel').textContent = opponentNickname;

    updateScoreDisplay();

    const rink = $('rink');
    rinkRect = rink.getBoundingClientRect();

    resetOnlinePositions();
    updatePuckPosition();
    updatePaddlePositions();

    await showCountdown();

    gameState.isPlaying = true;
    gameState.startTime = Date.now();
    gameState.elapsedTime = 0;

    setupControls();
    startTimer();
    startWebRTCPing(); // Use WebRTC ping instead of Firebase
    onlineGameLoop();
}
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

        numberEl.style.animation = 'none';
        numberEl.offsetHeight;
        numberEl.style.animation = 'countdownPop 0.8s ease-out';

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    overlay.classList.remove('active');
}

function resetOnlinePositions() {
    const centerX = rinkRect.width / 2;
    const bottomY = rinkRect.height - CONFIG.paddleRadius - 20;
    const topY = CONFIG.paddleRadius + 20;

    playerPaddle.x = centerX;
    playerPaddle.y = bottomY;
    aiPaddle.x = centerX;
    aiPaddle.y = topY;

    puck.x = centerX;
    puck.y = rinkRect.height / 2;
    puck.vx = 0;
    puck.vy = 0;

    updatePaddlePositions();
    updatePuckPosition();
}

function onlineGameLoop() {
    if (!gameState.isPlaying) return;

    // Send paddle position via WebRTC (fast, no throttling needed)
    syncPaddlePositionWebRTC();

    // Smoothly interpolate opponent paddle position
    if (onlineState.opponentPaddle.x !== undefined && rinkRect) {
        const targetX = onlineState.opponentPaddle.x * rinkRect.width;
        const targetY = (1 - onlineState.opponentPaddle.y) * rinkRect.height;

        // Smooth interpolation for opponent paddle
        aiPaddle.x += (targetX - aiPaddle.x) * 0.5;
        aiPaddle.y += (targetY - aiPaddle.y) * 0.5;
    }
    if (isHost) {
        // Idle check - auto-start puck after 5 seconds
        if (gameState.waitingForHit && gameState.idleStartTime > 0) {
            const idleTime = Date.now() - gameState.idleStartTime;
            if (idleTime >= 5000) {
                gameState.waitingForHit = false;
                gameState.idleStartTime = 0;

                if (gameState.lastScorer === 'player') {
                    puck.vy = -3;
                } else {
                    puck.vy = 3;
                }
                puck.vx = (Math.random() - 0.5) * 2;
            }
        }

        updatePuck();
        checkOnlineCollisions();
        checkGoal();
        syncPuckStateWebRTC();
    } else {

        puck.x += puck.vx;
        puck.y += puck.vy;

        // Bounce off walls locally for visual smoothness
        if (puck.x <= CONFIG.puckRadius || puck.x >= rinkRect.width - CONFIG.puckRadius) {
            puck.vx *= -1;
            puck.x = Math.max(CONFIG.puckRadius, Math.min(rinkRect.width - CONFIG.puckRadius, puck.x));
        }
        if (puck.y <= CONFIG.puckRadius || puck.y >= rinkRect.height - CONFIG.puckRadius) {
            puck.vy *= -1;
            puck.y = Math.max(CONFIG.puckRadius, Math.min(rinkRect.height - CONFIG.puckRadius, puck.y));
        }

        // Smoothly correct toward host state
        const distToTarget = Math.hypot(puckTarget.x - puck.x, puckTarget.y - puck.y);

        // Near goals or big difference: snap instantly
        const nearGoal = puck.y < 60 || puck.y > rinkRect.height - 60;
        if (nearGoal || distToTarget > 50) {
            puck.x = puckTarget.x;
            puck.y = puckTarget.y;
        } else {
            const correctionStrength = 0.6;
            puck.x += (puckTarget.x - puck.x) * correctionStrength;
            puck.y += (puckTarget.y - puck.y) * correctionStrength;
        }
    }

    updatePuckPosition();
    updatePaddlePositions();

    animationId = requestAnimationFrame(onlineGameLoop);
}
function syncPaddlePositionWebRTC() {
    if (!gameState.isPlaying || !rinkRect) return;

    // Send at ~30fps for paddle (every other frame is fine)
    const now = Date.now();
    if (now - lastPaddleSync < 33) return; // ~30fps
    lastPaddleSync = now;

    const normalizedX = playerPaddle.x / rinkRect.width;
    const normalizedY = playerPaddle.y / rinkRect.height;

    sendGameData({
        type: 'paddle',
        x: normalizedX,
        y: normalizedY
    });
}

function syncPuckStateWebRTC() {
    if (!isHost || !gameState.isPlaying) return;

    // Send puck state every frame via WebRTC (it's fast enough)
    sendGameData({
        type: 'puck',
        x: puck.x,
        y: puck.y,
        vx: puck.vx,
        vy: puck.vy
    });
}

function checkOnlineCollisions() {
    const playerDist = Math.hypot(puck.x - playerPaddle.x, puck.y - playerPaddle.y);
    if (playerDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(playerPaddle);
    }

    const opponentDist = Math.hypot(puck.x - aiPaddle.x, puck.y - aiPaddle.y);
    if (opponentDist < CONFIG.puckRadius + CONFIG.paddleRadius) {
        handlePaddleCollision(aiPaddle);
    }
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

    // Player goal (bottom) - Opponent scores
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
    // Only host should call this function
    if (!isHost) return;

    playSound(scorer === 'player' ? 'goal' : 'goalAgainst');

    if (scorer === 'player') {
        gameState.playerScore++;
    } else {
        gameState.aiScore++;
    }

    updateScoreDisplay();
    sendGameData({
        type: 'score',
        host: gameState.playerScore,
        client: gameState.aiScore
    });

    $('rink').classList.add('goal-scored');
    setTimeout(() => $('rink').classList.remove('goal-scored'), 900);

    if (gameState.playerScore >= CONFIG.winScore || gameState.aiScore >= CONFIG.winScore) {
        endGame();
    } else {
        setTimeout(() => {
            resetOnlinePositionsAfterGoal(scorer);

            sendGameData({ type: 'reset' });
        }, 500);
    }
}

function resetOnlinePositionsAfterGoal(lastScorer) {
    gameState.goalScoring = false;

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

    if (lastScorer) {
        gameState.waitingForHit = true;
        gameState.idleStartTime = Date.now();
        gameState.lastScorer = lastScorer;
    }

    updatePuckPosition();
    syncPuckState();
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

    cleanupOnlineGame();
}

function cleanupOnlineGame() {
    stopWebRTCPing();
    cleanupWebRTC();

    onlineListeners.forEach(({ ref, event, callback }) => {
        ref.off(event, callback);
    });
    onlineListeners = [];

    // Set connected to false so opponent knows we left
    if (roomRef) {
        const myPath = isHost ? 'host' : 'client';
        roomRef.child(`${myPath}/connected`).set(false);

        if (isHost) {
            roomRef.child('state').set('ended');
        }
    }

    roomRef = null;
    roomId = null;
    isHost = false;
    onlineState.connected = false;
    onlineState.opponentConnected = false;
}
function handleOpponentDisconnect() {
    if (!gameState.isPlaying) return;

    gameState.isPlaying = false;
    cancelAnimationFrame(animationId);
    clearInterval(timerInterval);

    // Play win sound - opponent left means you win!
    playSound('win');

    // Update disconnect modal to show victory
    const disconnectTitle = document.querySelector('.disconnect-title');
    const disconnectDesc = document.querySelector('.disconnect-desc');
    const disconnectIcon = document.querySelector('.disconnect-icon');

    if (disconnectIcon) disconnectIcon.textContent = '🎉';
    if (disconnectTitle) disconnectTitle.textContent = 'Tebrikler! Kazandın!';
    if (disconnectDesc) disconnectDesc.textContent = 'Rakibin oyunu terk etti.';

    $('disconnectModal')?.classList.add('active');

    // Auto return to lobby after 3 seconds
    setTimeout(() => {
        returnToLobby();
    }, 3000);
}

function returnToLobby() {
    $('disconnectModal')?.classList.remove('active');
    $('gameOverModal')?.classList.remove('active');
    cleanupOnlineGame();
    gameState.playerScore = 0;
    gameState.aiScore = 0;
    gameState.selectedChar = null;
    gameState.aiChar = null;
    $('charSelect').style.display = 'flex';
    updateCharSelectUI();
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
function init() {
    username = localStorage.getItem('manifriends_username') || '';
    playerNickname = username;

    initActiveUsersListener();

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
    $('disconnectLobbyBtn').onclick = returnToLobby;
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        initSoundButton();
    });
} else {
    init();
    initSoundButton();
}
