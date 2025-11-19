// script.js
const socket = io();
const tg = window.Telegram.WebApp;

tg.ready();
tg.expand();

let userId = tg.initDataUnsafe.user.id;
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

socket.on('connect', () => {
    socket.emit('joinGame', { userId });
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
