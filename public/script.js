// public/script.js
const socket = io();
const tg = window.Telegram.WebApp;

tg.ready();
tg.expand();

let userId = null;
let fullname = '';
let currentWord = '';
let displayedWord = '';
let hintsUsed = 0;
let maxHints = 0;
let timeLeft = 0;
let timerInterval;
let score = 0;
let opponentScore = 0;
let wordsLeft = 10;
let gameId = null;

// Function to open tabs
function openTab(tabName) {
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');

    const btns = document.querySelectorAll('.tab-btn');
    btns.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
}

// Gregorian to Jalali converter
function toJalali(gy, gm, gd) {
    let jy, jm, jd;
    let g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    jy = (gy <= 1600) ? 0 : 979;
    gy -= (gy <= 1600) ? 621 : 1600;
    let gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = (365 * gy) + (parseInt((gy2 + 3) / 4)) - (parseInt((gy2 + 99) / 100)) + (parseInt((gy2 + 399) / 400)) - 80 + gd + g_d_m[gm - 1];
    jy += 33 * (parseInt(days / 12053));
    days %= 12053;
    jy += 4 * (parseInt(days / 1461));
    days %= 1461;
    jy += parseInt((days - 1) / 365);
    if (days > 365) days = (days - 1) % 365;
    jm = (days < 186) ? 1 + parseInt(days / 31) : 7 + parseInt((days - 186) / 30);
    jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
    return [jy, jm, jd];
}

function getJalaliDate() {
    const now = new Date();
    const [jy, jm, jd] = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    return `تاریخ: ${jd}/${jm}/${jy} - زمان: ${hours}:${minutes}:${seconds}`;
}

// Update date time every second
setInterval(() => {
    document.getElementById('current-date-time').textContent = getJalaliDate();
}, 1000);

// Authenticate with server
if (tg.initDataUnsafe.user) {
    fullname = `${tg.initDataUnsafe.user.first_name} ${tg.initDataUnsafe.user.last_name || ''}`.trim();
    userId = tg.initDataUnsafe.user.id;
    document.getElementById('user-fullname').textContent = `نام کامل: ${fullname}`;
    document.getElementById('current-date-time').textContent = getJalaliDate();

    // Send initData to server for validation
    socket.emit('authenticate', { initData: tg.initData });
} else {
    alert('Unable to get user info from Telegram.');
}

socket.on('authSuccess', (data) => {
    userId = data.userId;
    // Proceed with joining game or other actions
    socket.emit('joinGame', { userId });
});

socket.on('authFailed', () => {
    alert('Authentication failed. Please try again.');
});

document.getElementById('guess-btn').addEventListener('click', () => {
    const guess = document.getElementById('guess-input').value.toLowerCase();
    if (guess && gameId) {
        socket.emit('guess', { gameId, userId, guess });
        document.getElementById('guess-input').value = '';
    }
});

document.getElementById('hint-btn').addEventListener('click', () => {
    if (hintsUsed < maxHints && gameId) {
        socket.emit('hint', { gameId, userId });
    }
});

document.getElementById('add-word-btn').addEventListener('click', () => {
    const category = document.getElementById('category-select').value;
    const word = document.getElementById('new-word').value.trim();
    const level = parseInt(document.getElementById('new-level').value);
    if (word && level >= 1 && level <= 5) {
        socket.emit('addWord', { category, word: word.toLowerCase(), level, addedBy: userId });
        document.getElementById('new-word').value = '';
        document.getElementById('new-level').value = '';
        alert('کلمه با موفقیت اضافه شد!');
    }
});

socket.on('gameStarted', (data) => {
    gameId = data.gameId;
    document.getElementById('game-status').textContent = 'بازی شروع شد!';
    nextWord(data.word, data.time, data.maxHints);
});

socket.on('updateWord', (data) => {
    displayedWord = data.displayed;
    document.getElementById('word-display').textContent = displayedWord;
    if (data.hint) {
        hintsUsed++;
        score -= 50;
        updateScores();
    }
    if (!displayedWord.includes('_')) {
        clearInterval(timerInterval);
        socket.emit('wordCompleted', { gameId, userId, timeUsed: data.timeUsed });
    }
});

socket.on('timeUpdate', (time) => {
    timeLeft = time;
    document.getElementById('time-left').textContent = timeLeft;
    if (timeLeft <= 0) {
        score -= 100;
        updateScores();
        socket.emit('timeUp', { gameId, userId });
    }
});

socket.on('opponentScoreUpdate', (oppScore) => {
    opponentScore = oppScore;
    updateScores();
});

socket.on('nextWord', (data) => {
    wordsLeft--;
    document.getElementById('words-left').textContent = `کلمات باقی‌مانده: ${wordsLeft}`;
    nextWord(data.word, data.time, data.maxHints);
});

socket.on('gameOver', (data) => {
    clearInterval(timerInterval);
    document.getElementById('end-game').style.display = 'block';
    if (data.winner === userId) {
        document.getElementById('winner-msg').textContent = 'شما برنده شدید!';
    } else if (data.winner === 'tie') {
        document.getElementById('winner-msg').textContent = 'مساوی شد!';
    } else {
        document.getElementById('winner-msg').textContent = 'شما باختید!';
    }
});

function nextWord(word, time, maxH) {
    currentWord = word.toLowerCase();
    displayedWord = currentWord.replace(/[^ ]/g, '_').replace(/ /g, ' ');
    document.getElementById('word-display').textContent = displayedWord;
    hintsUsed = 0;
    maxHints = maxH;
    timeLeft = time;
    document.getElementById('time-left').textContent = timeLeft;
    timerInterval = setInterval(() => {
        timeLeft--;
        document.getElementById('time-left').textContent = timeLeft;
        socket.emit('timeTick', { gameId, userId });
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
        }
    }, 1000);
}

function updateScores() {
    document.getElementById('your-score').textContent = score;
    document.getElementById('opp-score').textContent = opponentScore;
}
