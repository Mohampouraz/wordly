// ======================================================================
//                              script.js
//              نسخه کامل و نهایی با تمامی عملکردها (Final Version)
// ======================================================================

// ======================================================================
// ۱. متغیرهای Global
// ======================================================================
let currentUser = null;

// Standard Game Variables
let currentGame = null;
let gameTimer = null;
let timeLeft = 0;
let isCreator = false;
let gameStateInterval = null;
let connectionInterval = null;
let hintsUsed = 0; 

// Competitive Mode Variables
let currentCompetitiveMatch = null;
let competitiveTimer = null;
let competitiveTimeLeft = 120; // 2 minutes per word
let competitiveWords = [];
let currentWordIndex = 0;
let competitiveScores = { player1: 0, player2: 0 };
let competitiveMatchInterval = null;
let isCompetitiveMatchActive = false;
let competitiveMatchId = null;
let isPlayer1InCompetitive = false;
let playerCompetitiveStats = null;


// ======================================================================
// ۲. توابع کمکی (Utilities)
// ======================================================================

// تابع تبدیل اعداد به فارسی
function toPersianNumber(number) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    if (isNaN(number) || number === null) return '-'; 
    return number.toString().replace(/\d/g, digit => persianDigits[parseInt(digit)]);
}

// تابع فرمت زمان (MM:SS)
function formatTime(seconds) {
    if (seconds === null || isNaN(seconds)) return '--:--';
    seconds = Math.max(0, seconds);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// نمایش زمان لحظه‌ای
function updateLiveClock() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    document.getElementById('liveClock').innerText = toPersianNumber(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
}


// ======================================================================
// ۳. مدیریت تب‌ها (Tab Management)
// ======================================================================

function openTab(tabName) {
    document.querySelectorAll('.tab-content-minimal').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-button-minimal').forEach(el => el.classList.remove('active'));

    document.getElementById(tabName).classList.add('active');
    document.querySelector(`.tab-button-minimal[onclick="openTab('${tabName}')"]`).classList.add('active');

    if (tabName === 'active-games') {
        loadActiveGames();
    } else if (tabName === 'competitive-mode') {
        loadCompetitiveStats();
        loadLeaderboard();
        loadOnlinePlayersCount();
        if (competitiveMatchId) {
            checkCompetitiveMatchStatus(); 
        } else {
             updateCompetitiveModeUI('ready');
        }
    }
}


// ======================================================================
// ۴. مدیریت بازی‌های استاندارد (Standard Games Logic)
// ======================================================================

// تابع بارگذاری بازی‌های فعال
async function loadActiveGames() {
    const gamesList = document.getElementById('gamesList');
    gamesList.innerHTML = `<div class="loading-minimal"><i class="fas fa-spinner fa-spin"></i><span>در حال بارگذاری بازی‌ها...</span></div>`;

    try {
        const response = await fetch('/api/games/active');
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        
        const result = await response.json();

        if (result.success && result.games) {
            displayActiveGames(result.games);
        } else {
            gamesList.innerHTML = `<div class="error-minimal"><i class="fas fa-exclamation-circle"></i><span>خطا در بارگذاری: ${result.error || 'پاسخ سرور ناموفق'}</span></div>`;
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری بازی‌های فعال:', error);
        gamesList.innerHTML = `<div class="error-minimal"><i class="fas fa-exclamation-triangle"></i><span>خطا در برقراری ارتباط.</span></div>`;
    }
}

// تابع نمایش بازی‌ها
function displayActiveGames(games) {
    const gamesList = document.getElementById('gamesList');
    gamesList.innerHTML = ''; 

    if (games.length === 0) {
        gamesList.innerHTML = '<div class="info-minimal">هیچ بازی فعالی وجود ندارد. اولین بازی را بسازید!</div>';
        return;
    }

    games.forEach(game => {
        const gameDiv = document.createElement('div');
        gameDiv.className = 'game-card-minimal';
        
        let statusText = game.is_started ? 'در حال انجام' : (game.players_count > 1 ? 'آماده شروع' : 'منتظر بازیکن دوم');
        let statusClass = game.is_started ? 'status-active' : (game.players_count > 1 ? 'status-ready' : 'status-waiting');
        
        const timeValue = game.is_started ? game.remaining_time : game.time_limit;
        const timeLabel = game.is_started ? 'باقی‌مانده' : 'محدودیت';
        const timeInfo = timeValue !== null 
            ? `<span class="game-time">🕒 ${timeLabel}: ${toPersianNumber(formatTime(timeValue))}</span>`
            : '';

        gameDiv.innerHTML = `
            <div class="card-header-minimal">
                <span class="game-id">ID: <code>${game.game_id}</code></span>
                <span class="${statusClass}">${statusText}</span>
            </div>
            <div class="card-body-minimal">
                <p><b>سازنده:</b> ${game.creator_name}</p>
                <p><b>دسته:</b> ${game.category}</p>
                <p><b>بازیکنان:</b> ${toPersianNumber(game.players_count)}/2 نفر</p>
                ${timeInfo}
            </div>
            ${game.players_count < 2 ? `<button class="minimal-button minimal-button-primary" onclick="joinGame('${game.game_id}')">
                <i class="fas fa-sign-in-alt"></i> پیوستن
            </button>` : `<button class="minimal-button minimal-button-secondary" disabled>پر شده</button>`}
        `;
        gamesList.appendChild(gameDiv);
    });
}

// تابع ایجاد بازی جدید
async function createGame() {
    if (!currentUser) return alert('لطفاً ابتدا اجازه دسترسی به تلگرام را بدهید.');
    
    const category = document.getElementById('createGameCategory').value;
    const timeLimit = parseInt(document.getElementById('createGameTime').value) * 60; 

    try {
        const response = await fetch('/api/games/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id, player_name: currentUser.full_name, category: category, time_limit: timeLimit })
        });
        
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            isCreator = true;
            closeCreateGameModal(); 
            fetchGameDetails(result.game_id); 
            openGameModal();
        } else {
            alert(`خطا در ایجاد بازی: ${result.error || 'خطای نامشخص'}`);
        }
    } catch (error) {
        console.error('❌ خطا در ایجاد بازی:', error);
        alert('خطا در برقراری ارتباط با سرور برای ایجاد بازی.');
    }
}

// تابع پیوستن به بازی
async function joinGame(gameId) {
    if (!currentUser) return alert('لطفاً ابتدا اجازه دسترسی به تلگرام را بدهید.');

    try {
        const response = await fetch(`/api/games/${gameId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id, player_name: currentUser.full_name })
        });
        
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            isCreator = (result.game.creator_id === currentUser.telegram_id);
            fetchGameDetails(gameId); 
            openGameModal();
        } else {
            alert(`خطا در پیوستن: ${result.error || 'خطای نامشخص'}`);
        }

    } catch (error) {
        console.error('❌ خطا در پیوستن به بازی:', error);
        alert('خطا در برقراری ارتباط با سرور.');
    }
}

// تابع شروع بازی (فقط سازنده)
async function startGame() {
    if (!currentGame || !isCreator || currentGame.players_count < 2 || currentGame.is_started) return;
    
    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id })
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentGame = result.game_state;
            startGameLoop();
            updateGameStateUI();
        } else {
            alert(`خطا در شروع بازی: ${result.error || 'خطای نامشخص'}`);
        }

    } catch (error) {
        console.error('❌ خطا در شروع بازی:', error);
        alert('خطا در برقراری ارتباط.');
    }
}

// تابع لود جزئیات بازی
async function fetchGameDetails(gameId) {
    if (!currentUser) return;
    
    try {
        const response = await fetch(`/api/games/${gameId}`);
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        
        const result = await response.json();

        if (result.success && result.game) {
            currentGame = result.game;
            // فرض می‌کنیم سرور hints_used را برمی‌گرداند
            hintsUsed = currentGame.hints_used || 0; 
            startConnectionReporting();
            
            if (currentGame.is_started && !currentGame.completed) {
                startGameLoop(); 
                timeLeft = currentGame.remaining_time || currentGame.time_limit;
            } else if (currentGame.completed) {
                 clearInterval(gameStateInterval);
                 clearInterval(gameTimer);
                 stopConnectionReporting();
                 showGameResults(currentGame);
                 return;
            }
            
            updateGameStateUI();
        } else {
             console.error('خطا در دریافت جزئیات بازی:', result.error);
             alert(`خطا: ${result.error || 'بازی یافت نشد.'}`);
             closeGameModal();
        }
    } catch (error) {
        console.error('❌ خطا در لود جزئیات بازی:', error);
        document.getElementById('gameContent').innerHTML = `<div class="error-minimal">خطا در برقراری ارتباط.</div>`;
    }
}

// تابع شروع لوپ نظارت بر بازی استاندارد
function startGameLoop() {
    clearInterval(gameTimer);
    clearInterval(gameStateInterval);
    
    gameTimer = setInterval(updateGameTimer, 1000);
    gameStateInterval = setInterval(() => {
        if (currentGame && !currentGame.completed) {
            fetchGameDetails(currentGame.game_id);
        }
    }, 5000);
}

// تابع به‌روزرسانی تایمر بازی استاندارد
function updateGameTimer() {
    if (!currentGame || currentGame.completed || !currentGame.is_started) {
        clearInterval(gameTimer);
        return;
    }

    if (timeLeft > 0) {
        timeLeft--;
    } else {
        clearInterval(gameTimer);
        if (!currentGame.completed) {
            alert('زمان بازی به پایان رسید!');
            completeGame(currentGame.game_id); 
        }
        return;
    }
    
    document.getElementById('gameTimeRemaining').innerText = toPersianNumber(formatTime(timeLeft));
}

// تابع ارسال حدس (بازی استاندارد)
async function submitGuess() {
    const guessInput = document.getElementById('guessInput');
    const letter = guessInput.value.trim().toUpperCase();
    guessInput.value = '';

    if (!letter || letter.length !== 1 || !currentGame || currentGame.completed || !currentGame.is_started) {
        showGuessFeedback(false, 'حدس نامعتبر یا بازی شروع نشده است.');
        return;
    }
    
    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/guess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id, letter: letter })
        });
        
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            currentGame = { ...currentGame, ...result.game_state };
            updateGameStateUI();
            
            if (result.game_state.completed) {
                clearInterval(gameStateInterval);
                clearInterval(gameTimer);
                showGameResults(result.game_state);
            } else {
                showGuessFeedback(result.is_correct);
            }
        } else {
            showGuessFeedback(false, result.error);
        }

    } catch (error) {
        console.error('❌ خطا در ارسال حدس:', error);
        alert('خطا در برقراری ارتباط با سرور.');
    }
}

// تابع استفاده از راهنما (Hint)
async function useHint() {
    if (!currentGame || currentGame.completed || !currentGame.is_started) {
        return showGuessFeedback(false, 'بازی شروع نشده است.');
    }

    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id })
        });
        
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            currentGame = { ...currentGame, ...result.game_state };
            hintsUsed = result.game_state.hints_used || hintsUsed + 1;
            updateGameStateUI();
            showGuessFeedback(true, 'راهنما استفاده شد. یک حرف آشکار شد.');
        } else {
            showGuessFeedback(false, result.error || 'خطا در استفاده از راهنما.');
        }

    } catch (error) {
        console.error('❌ خطا در استفاده از راهنما:', error);
        alert('خطا در برقراری ارتباط با سرور.');
    }
}

// نمایش بازخورد حدس (بازی استاندارد)
function showGuessFeedback(isCorrect, error = null) {
    const feedbackEl = document.getElementById('gameFeedback');
    feedbackEl.innerHTML = '';
    
    if (error) {
        feedbackEl.innerHTML = `<span class="feedback-error">${error}</span>`;
        return;
    }
    
    const icon = isCorrect ? '✅' : '❌';
    const text = isCorrect ? `حدس صحیح!` : `حدس غلط!`;
    const className = isCorrect ? 'feedback-success' : 'feedback-fail';

    feedbackEl.innerHTML = `<span class="${className}">${icon} ${text}</span>`;
    setTimeout(() => { feedbackEl.innerHTML = ''; }, 2000);
}

// تابع به‌روزرسانی UI وضعیت بازی استاندارد
function updateGameStateUI() {
    if (!currentGame) return;
    
    const isPlayer1 = currentGame.player1_id === currentUser.telegram_id;
    const myScore = isPlayer1 ? currentGame.player1_score : currentGame.player2_score;
    const opponentScore = isPlayer1 ? currentGame.player2_score : currentGame.player1_score;
    const opponentName = isPlayer1 ? currentGame.player2_name : currentGame.player1_name;
    const myProgress = isPlayer1 ? currentGame.player1_progress : currentGame.player2_progress;
    const usedLetters = isPlayer1 ? currentGame.player1_used_letters : currentGame.player2_used_letters;
    const opponentProgress = isPlayer1 ? currentGame.player2_progress : currentGame.player1_progress;

    document.getElementById('gameIdDisplay').innerText = currentGame.game_id;
    document.getElementById('gameCategory').innerText = currentGame.category;
    document.getElementById('gameTimeRemaining').innerText = toPersianNumber(formatTime(timeLeft));
    
    document.getElementById('myScore').innerText = toPersianNumber(myScore);
    document.getElementById('opponentNameDisplay').innerText = opponentName || 'منتظر حریف...';
    document.getElementById('opponentScore').innerText = toPersianNumber(opponentScore);

    const wordDisplay = document.getElementById('gameCurrentWord');
    wordDisplay.innerHTML = myProgress ? myProgress.split('').map(l => `<span class="letter-minimal">${l}</span>`).join('') : 'درحال بارگذاری...';
    
    document.getElementById('gameUsedLetters').innerText = usedLetters.split(',').filter(Boolean).map(l => l.toUpperCase()).join(', ');
    
    const opponentProgressEl = document.getElementById('gameOpponentProgress');
    if (currentGame.players_count > 1) {
        opponentProgressEl.innerHTML = `پیشرفت حریف: ${opponentProgress.split('').map(l => `<span class="letter-minimal ${l === '_' ? 'empty' : 'guessed'}">${l}</span>`).join('')}`;
    } else {
         opponentProgressEl.innerHTML = 'بازی تک‌نفره یا منتظر حریف';
    }

    const startButton = document.getElementById('startGameButton');
    if (isCreator && currentGame.players_count === 2 && !currentGame.is_started) {
        startButton.style.display = 'block';
    } else {
        startButton.style.display = 'none';
    }
    
    // نمایش دکمه راهنما (مشروط بر اینکه بازی شروع شده باشد و تمام نشده باشد)
    const hintButton = document.getElementById('gameHintButton');
    if (currentGame.is_started && !currentGame.completed) {
        hintButton.style.display = 'block';
    } else {
        hintButton.style.display = 'none';
    }
}

// تابع اعلام اتمام بازی به سرور (در صورت اتمام زمان)
async function completeGame(gameId) {
    try {
        await fetch(`/api/games/${gameId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id, reason: 'timeout' })
        });
        fetchGameDetails(gameId); 
    } catch (error) {
        console.error('❌ خطا در اعلام اتمام بازی:', error);
    }
}

// تابع نمایش نتایج بازی استاندارد
function showGameResults(game) {
    const resultsContent = document.getElementById('gameContent');
    
    let message = 'بازی به پایان رسید.';
    let winner = 'نامشخص';
    let icon = '🤷‍♂️';
    
    if (game.winner_id) {
        if (game.winner_id === currentUser.telegram_id) {
            message = 'تبریک! شما برنده شدید!';
            winner = 'شما';
            icon = '🏆';
        } else {
             message = 'متأسفیم، شما باختید.';
             winner = game.winner_name || 'حریف';
             icon = '😔';
        }
    } else if (game.completed) {
         message = 'نتیجه مساوی یا پایان زمان.';
         winner = 'مساوی';
         icon = '🤝';
    }
    
    resultsContent.innerHTML = `
        <div class="result-card-minimal">
            <h3>${icon} ${message}</h3>
            <p><b>برنده:</b> ${winner}</p>
            <p><b>امتیاز شما:</b> ${toPersianNumber(game.player1_id === currentUser.telegram_id ? game.player1_score : game.player2_score)}</p>
            <p><b>امتیاز حریف:</b> ${toPersianNumber(game.player1_id === currentUser.telegram_id ? game.player2_score : game.player1_score)}</p>
            <p><b>کلمه:</b> ${game.word}</p>
        </div>
        <button class="minimal-button minimal-button-secondary" onclick="closeGameModal()">بازگشت</button>
    `;
    
    clearInterval(gameStateInterval);
    clearInterval(gameTimer);
    stopConnectionReporting();
}


// ======================================================================
// ۵. مدیریت حالت رقابتی (Competitive Logic)
// ======================================================================

// تابع شروع مسابقه سریع
async function startQuickMatch() {
    if (!currentUser) return alert('لطفاً ابتدا اجازه دسترسی به تلگرام را بدهید.');
    
    updateCompetitiveModeUI('searching');
    
    try {
        const response = await fetch('/api/competitive/quick-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id, player_name: currentUser.full_name })
        });

        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            competitiveMatchId = result.match_id;
            isPlayer1InCompetitive = result.is_player1;
            
            if (result.matched || result.reconnected) {
                if (result.words && result.words.length > 0) {
                     startCompetitiveGame(result); 
                } else {
                     checkCompetitiveMatchStatus(true); 
                }
            } else {
                document.getElementById('competitiveOpponentName').innerText = result.category || 'درحال جستجو';
                updateCompetitiveModeUI('waiting');
                if (!competitiveMatchInterval) {
                     competitiveMatchInterval = setInterval(checkCompetitiveMatchStatus, 5000); 
                }
            }
        } else {
            alert(`خطا در شروع مسابقه: ${result.error || 'پاسخ سرور ناموفق'}`);
            updateCompetitiveModeUI('ready');
        }

    } catch (error) {
        console.error('❌ خطا در برقراری ارتباط برای مسابقه رقابتی:', error);
        updateCompetitiveModeUI('ready', `خطا در برقراری ارتباط. ${error.message || 'لطفاً اتصال اینترنت خود را بررسی کنید.'}`);
        clearInterval(competitiveMatchInterval);
        competitiveMatchInterval = null;
    }
}

// تابع چک کردن وضعیت مسابقه
async function checkCompetitiveMatchStatus(forceStart = false) {
    if (!competitiveMatchId || (isCompetitiveMatchActive && !forceStart)) return;
    
    try {
        const response = await fetch(`/api/competitive/match/${competitiveMatchId}`);
        const result = await response.json();

        if (result.success && result.match) {
            const match = result.match;
            
            if (match.status === 'active' && match.words && match.words.length > 0) {
                clearInterval(competitiveMatchInterval);
                startCompetitiveGame({ 
                    matched: true, 
                    opponent_name: match.player1_id === currentUser.telegram_id ? match.player2_name : match.player1_name,
                    category: match.category,
                    words: match.words,
                    match_id: competitiveMatchId,
                    is_player1: match.player1_id === currentUser.telegram_id,
                    player1_id: match.player1_id,
                    player2_id: match.player2_id
                });
            } else if (match.status === 'completed' || match.status === 'expired' || match.status === 'cancelled') {
                 alert('مسابقه منقضی یا لغو شد.');
                 clearInterval(competitiveMatchInterval);
                 competitiveMatchInterval = null;
                 updateCompetitiveModeUI('ready');
            } else if (match.status === 'waiting') {
                updateCompetitiveModeUI('waiting');
                document.getElementById('competitiveOpponentName').innerText = match.category || 'درحال جستجو';
            }
        }
    } catch (error) {
        console.error('❌ خطا در چک کردن وضعیت مسابقه:', error);
    }
}

// تابع شروع بازی رقابتی
function startCompetitiveGame(matchData) {
    clearInterval(competitiveMatchInterval);
    competitiveMatchInterval = null;
    
    if (!matchData.words || matchData.words.length === 0) {
        alert('خطا: کلمات بازی دریافت نشدند.');
        updateCompetitiveModeUI('ready');
        return;
    }

    isCompetitiveMatchActive = true;
    competitiveWords = matchData.words;
    currentWordIndex = 0;
    
    competitiveMatchId = matchData.match_id;
    isPlayer1InCompetitive = matchData.is_player1;
    currentCompetitiveMatch = matchData; 
    
    competitiveScores = { player1: 0, player2: 0 };
    competitiveTimeLeft = 120; 
    
    const opponentName = matchData.opponent_name || (isPlayer1InCompetitive ? 'حریف (بازیکن ۲)' : 'حریف (بازیکن ۱)');
    document.getElementById('competitiveOpponentNameActive').innerText = opponentName;
    document.getElementById('competitivePlayerName').innerText = currentUser.full_name || 'شما';
    
    updateCompetitiveModeUI('active');
    
    displayCompetitiveWord();
    startCompetitiveTimer();
    startConnectionReporting();
    
    if (!competitiveMatchInterval) {
         competitiveMatchInterval = setInterval(updateCompetitiveProgress, 5000); 
    }
}

// نمایش کلمه جاری رقابتی
async function displayCompetitiveWord() {
    if (!isCompetitiveMatchActive) return;
    
    const currentWord = competitiveWords[currentWordIndex];
    if (!currentWord) {
        completeCompetitiveMatch();
        return;
    }

    document.getElementById('competitiveWordIndex').innerText = toPersianNumber(currentWordIndex + 1);
    document.getElementById('competitiveTotalWords').innerText = toPersianNumber(competitiveWords.length);
    document.getElementById('competitiveTimeLeft').innerText = toPersianNumber(formatTime(competitiveTimeLeft));
    
    document.getElementById('competitiveCurrentWord').innerHTML = `<span class="loading-minimal">درحال بارگذاری وضعیت کلمه...</span>`;
    
    const wordStatus = await fetchCompetitiveWordStatus(competitiveMatchId, currentWordIndex);
    
    if (wordStatus) {
        const p1Progress = wordStatus.player1_progress || '_'.repeat(currentWord.length);
        const p2Progress = wordStatus.player2_progress || '_'.repeat(currentWord.length);
        const myUsedLetters = wordStatus[isPlayer1InCompetitive ? 'player1_used_letters' : 'player2_used_letters'] || '';
        
        const myProgress = isPlayer1InCompetitive ? p1Progress : p2Progress;

        document.getElementById('competitiveCurrentWord').innerHTML = myProgress.split('').map(l => `<span class="letter-minimal">${l}</span>`).join('');
        document.getElementById('competitiveProgressP1').innerHTML = p1Progress.split('').map(l => `<span class="letter-minimal ${l === '_' ? 'empty' : 'guessed'}">${l}</span>`).join('');
        document.getElementById('competitiveProgressP2').innerHTML = p2Progress.split('').map(l => `<span class="letter-minimal ${l === '_' ? 'empty' : 'guessed'}">${l}</span>`).join('');
        document.getElementById('competitiveUsedLetters').innerText = myUsedLetters.split(',').filter(Boolean).map(l => l.toUpperCase()).join(', ');
    }
}

// تابع دریافت وضعیت کلمه از سرور
async function fetchCompetitiveWordStatus(matchId, wordIndex) {
    try {
        const response = await fetch(`/api/competitive/match/${matchId}/word-status?index=${wordIndex}`);
        if (!response.ok) return null;
        const result = await response.json();
        if (result.success && result.word_data) {
             return result.word_data;
        }
        return null;
    } catch (error) {
         console.error('❌ خطا در دریافت وضعیت کلمه رقابتی:', error);
         return null;
    }
}

// شروع تایمر رقابتی
function startCompetitiveTimer() {
    clearInterval(competitiveTimer);
    
    const timeDisplay = document.getElementById('competitiveTimeLeft');
    timeDisplay.innerText = toPersianNumber(formatTime(competitiveTimeLeft));
    
    competitiveTimer = setInterval(() => {
        competitiveTimeLeft--;

        if (competitiveTimeLeft <= 0) {
            clearInterval(competitiveTimer);
            handleCompetitiveTimeout();
            return;
        }

        timeDisplay.innerText = toPersianNumber(formatTime(competitiveTimeLeft));

    }, 1000);
}

// ارسال حدس در حالت رقابتی
async function submitCompetitiveGuess() {
    const guessInput = document.getElementById('competitiveGuessInput');
    const letter = guessInput.value.trim().toUpperCase();
    guessInput.value = '';

    if (!letter || letter.length !== 1 || !isCompetitiveMatchActive) return;

    try {
        const timeRemaining = competitiveTimeLeft;
        
        const response = await fetch(`/api/competitive/match/${competitiveMatchId}/guess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id, letter: letter, word_index: currentWordIndex, time_remaining: timeRemaining })
        });

        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            competitiveScores.player1 = result.player1_score;
            competitiveScores.player2 = result.player2_score;
            document.getElementById('competitiveScoreP1').innerText = toPersianNumber(result.player1_score);
            document.getElementById('competitiveScoreP2').innerText = toPersianNumber(result.player2_score);
            
            const myProgressId = isPlayer1InCompetitive ? 'competitiveProgressP1' : 'competitiveProgressP2';
            document.getElementById('competitiveCurrentWord').innerHTML = result.word_progress.split('').map(l => `<span class="letter-minimal">${l}</span>`).join('');
            document.getElementById(myProgressId).innerHTML = result.word_progress.split('').map(l => `<span class="letter-minimal ${result.word_progress.length === currentCompetitiveMatch.words[currentWordIndex].length ? 'guessed' : ''}">${l}</span>`).join('');
            document.getElementById('competitiveUsedLetters').innerText = result.used_letters.map(l => l.toUpperCase()).join(', ');
            
            showCompetitiveFeedback(result.is_correct, result.score_change); 

            if (result.word_completed) {
                clearInterval(competitiveTimer);
                setTimeout(() => nextCompetitiveWord(), 2000); 
            }

        } else {
             showCompetitiveFeedback(false, 0, result.error);
        }

    } catch (error) {
        console.error('❌ خطا در ارسال حدس رقابتی:', error);
        alert('خطا در برقراری ارتباط با سرور. لطفا دوباره سعی کنید.');
    }
}

// نمایش بازخورد حدس
function showCompetitiveFeedback(isCorrect, score, error = null) {
    const feedbackEl = document.getElementById('competitiveFeedback');
    feedbackEl.innerHTML = '';
    
    if (error) {
        feedbackEl.innerHTML = `<span class="feedback-error">${error}</span>`;
        return;
    }
    
    const icon = isCorrect ? '✅' : '❌';
    const text = isCorrect ? `صحیح! +${toPersianNumber(score)} امتیاز` : `غلط! ${score === 0 ? '' : toPersianNumber(score) + ' امتیاز'}`;
    const className = isCorrect ? 'feedback-success' : 'feedback-fail';

    feedbackEl.innerHTML = `<span class="${className}">${icon} ${text}</span>`;
    
    setTimeout(() => { feedbackEl.innerHTML = ''; }, 2000);
}

// رفتن به کلمه بعدی
function nextCompetitiveWord() {
    currentWordIndex++;
    competitiveTimeLeft = 120; 

    if (currentWordIndex < competitiveWords.length) {
        displayCompetitiveWord();
        startCompetitiveTimer();
    } else {
        completeCompetitiveMatch();
    }
}

// مدیریت اتمام زمان
async function handleCompetitiveTimeout() {
    try {
        await fetch(`/api/competitive/match/${competitiveMatchId}/timeout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id, word_index: currentWordIndex })
        });
    } catch (error) {
        console.error('❌ خطا در اعلام تایم‌اوت:', error);
    }
    nextCompetitiveWord();
}

// تابع به‌روزرسانی وضعیت حریف (پولینگ)
async function updateCompetitiveProgress() {
    if (!isCompetitiveMatchActive) return;
    
    try {
        const response = await fetch(`/api/competitive/match/${competitiveMatchId}`);
        const result = await response.json();
        
        if (result.success && result.match) {
            const match = result.match;
            
            document.getElementById('competitiveScoreP1').innerText = toPersianNumber(match.player1_score);
            document.getElementById('competitiveScoreP2').innerText = toPersianNumber(match.player2_score);
            
            if (match.status === 'completed' && match.completed_at) {
                clearInterval(competitiveTimer);
                showCompetitiveResults({ winner_id: match.winner_id, player1_score: match.player1_score, player2_score: match.player2_score });
                return;
            }
            
            const wordStatus = await fetchCompetitiveWordStatus(competitiveMatchId, currentWordIndex);
            
            if (wordStatus) {
                const player1Progress = wordStatus.player1_progress || '_'.repeat(competitiveWords[currentWordIndex].length);
                const player2Progress = wordStatus.player2_progress || '_'.repeat(competitiveWords[currentWordIndex].length);
                
                document.getElementById('competitiveProgressP1').innerHTML = player1Progress.split('').map(l => `<span class="letter-minimal ${l === '_' ? 'empty' : 'guessed'}">${l}</span>`).join('');
                document.getElementById('competitiveProgressP2').innerHTML = player2Progress.split('').map(l => `<span class="letter-minimal ${l === '_' ? 'empty' : 'guessed'}">${l}</span>`).join('');
            }
        }
    } catch (error) {
        console.error('❌ خطا در به‌روزرسانی پیشرفت رقابتی:', error);
    }
}

// اتمام مسابقه رقابتی
async function completeCompetitiveMatch() {
    isCompetitiveMatchActive = false;
    clearInterval(competitiveTimer);
    clearInterval(competitiveMatchInterval);
    
    try {
        const response = await fetch(`/api/competitive/match/${competitiveMatchId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id })
        });
        
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            showCompetitiveResults(result.results);
            loadCompetitiveStats(); 
        } else {
             alert(`خطا در اتمام بازی: ${result.error || 'خطای نامشخص'}`);
             updateCompetitiveModeUI('ready');
        }

    } catch (error) {
        console.error('❌ خطا در اتمام بازی رقابتی:', error);
        alert('خطا در برقراری ارتباط نهایی با سرور.');
        updateCompetitiveModeUI('ready');
    }
}

// ترک مسابقه
async function leaveCompetitiveMatch() {
    if (!competitiveMatchId) return;

    clearInterval(competitiveTimer);
    clearInterval(competitiveMatchInterval);
    competitiveTimer = null;
    competitiveMatchInterval = null;
    
    try {
        await fetch(`/api/competitive/match/${competitiveMatchId}/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id })
        });
    } catch (error) {
        console.error('❌ خطا در ترک مسابقه:', error);
    }
    
    competitiveMatchId = null;
    isCompetitiveMatchActive = false;
    updateCompetitiveModeUI('ready');
}

// نمایش نتایج نهایی
function showCompetitiveResults(results) {
    const p1Score = results.player1_score || 0;
    const p2Score = results.player2_score || 0;
    
    const myScore = isPlayer1InCompetitive ? p1Score : p2Score;
    const opponentScore = isPlayer1InCompetitive ? p2Score : p1Score;

    const winnerId = results.winner_id;
    let winnerName;
    let winnerIcon;

    if (winnerId === currentUser.telegram_id) {
        winnerName = 'شما (برنده!)';
        winnerIcon = '🏆';
    } else if (winnerId === null) {
        winnerName = 'مساوی';
        winnerIcon = '🤝';
    } else {
        winnerName = currentCompetitiveMatch?.opponent_name || 'حریف (بازنده)';
        winnerIcon = '😔';
    }
        
    document.getElementById('resultsMatchId').innerText = competitiveMatchId;
    document.getElementById('resultsWinner').innerHTML = `${winnerIcon} برنده: <b>${winnerName}</b>`;
    document.getElementById('resultsScoreP1').innerText = toPersianNumber(myScore);
    document.getElementById('resultsScoreP2').innerText = toPersianNumber(opponentScore);
    
    openResultsModal();
    competitiveMatchId = null;
    updateCompetitiveModeUI('ready');
}

// به‌روزرسانی UI حالت رقابتی
function updateCompetitiveModeUI(state, message = '') {
    const readyContent = document.getElementById('competitiveReadyContent');
    const waitingContent = document.getElementById('competitiveWaitingContent');
    const activeContent = document.getElementById('competitiveActiveContent');
    const statusMessage = document.getElementById('competitiveStatusMessage');
    const startButton = document.getElementById('startQuickMatchButton');
    
    readyContent.style.display = 'none';
    waitingContent.style.display = 'none';
    activeContent.style.display = 'none';
    statusMessage.innerHTML = '';
    startButton.disabled = false;
    
    switch (state) {
        case 'ready':
            readyContent.style.display = 'block';
            if (message) {
                 statusMessage.innerHTML = `<div class="error-minimal"><i class="fas fa-exclamation-triangle"></i> ${message}</div>`;
            }
            break;
        case 'searching':
            waitingContent.style.display = 'block';
            document.getElementById('waitingMessage').innerText = 'در حال جستجوی حریف...';
            document.getElementById('competitiveOpponentName').innerText = 'درحال جستجو';
            startButton.disabled = true;
            break;
        case 'waiting':
            waitingContent.style.display = 'block';
            document.getElementById('waitingMessage').innerText = 'منتظر پیوستن حریف...';
            startButton.disabled = true;
            break;
        case 'active':
            activeContent.style.display = 'block';
            document.getElementById('competitivePlayerName').innerText = currentUser.full_name || 'شما';
            document.getElementById('competitiveScoreP1').innerText = toPersianNumber(competitiveScores.player1);
            document.getElementById('competitiveScoreP2').innerText = toPersianNumber(competitiveScores.player2);
            break;
    }
}

// لود آمار رقابتی کاربر
async function loadCompetitiveStats() {
     if (!currentUser) return;
     
     const statsCard = document.getElementById('competitiveStatsCard');
     statsCard.innerHTML = `<div class="loading-minimal"><i class="fas fa-spinner fa-spin"></i><span>در حال بارگذاری آمار...</span></div>`;

     try {
        const response = await fetch(`/api/user/${currentUser.telegram_id}/competitive-stats`);
        const result = await response.json();

        if (response.ok && result.success) {
            playerCompetitiveStats = result.stats;
            statsCard.innerHTML = `
                <div class="stats-item-minimal"><b>امتیاز لیگ:</b><span>${toPersianNumber(playerCompetitiveStats.competitive_score || 0)}</span></div>
                <div class="stats-item-minimal"><b>رتبه:</b><span>${toPersianNumber(playerCompetitiveStats.league_rank || 'N/A')}</span></div>
                <div class="stats-item-minimal"><b>بردها:</b><span>${toPersianNumber(playerCompetitiveStats.competitive_wins || 0)}</span></div>
                <div class="stats-item-minimal"><b>بازی‌ها:</b><span>${toPersianNumber(playerCompetitiveStats.competitive_games || 0)}</span></div>
            `;
        } else {
             statsCard.innerHTML = `<div class="info-minimal">خطا در بارگذاری آمار رقابتی.</div>`;
        }
     } catch (error) {
         console.error('❌ خطا در لود آمار رقابتی:', error);
         statsCard.innerHTML = `<div class="info-minimal">خطا در ارتباط.</div>`;
     }
}

// لود جدول امتیازات
async function loadLeaderboard() {
    const leaderboardList = document.getElementById('leaderboardList');
    leaderboardList.innerHTML = `<div class="loading-minimal"><i class="fas fa-spinner fa-spin"></i><span>در حال بارگذاری لیدربورد...</span></div>`;
    
    try {
        const response = await fetch('/api/competitive/leaderboard');
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        leaderboardList.innerHTML = '';
        if (result.success && result.users && result.users.length > 0) {
            result.users.forEach((user, index) => {
                const rank = index + 1;
                const listItem = document.createElement('li');
                listItem.className = 'leaderboard-item-minimal';
                if (user.telegram_id === currentUser?.telegram_id) listItem.classList.add('is-user');
                
                listItem.innerHTML = `
                    <span class="rank">${toPersianNumber(rank)}</span>
                    <span class="name">${user.full_name}</span>
                    <span class="score">${toPersianNumber(user.score)} امتیاز</span>
                `;
                leaderboardList.appendChild(listItem);
            });
        } else {
             leaderboardList.innerHTML = `<div class="info-minimal">اطلاعات لیدربورد موجود نیست.</div>`;
        }
    } catch (error) {
        console.error('❌ خطا در لود لیدربورد:', error);
        leaderboardList.innerHTML = `<div class="error-minimal">خطا در برقراری ارتباط با سرور لیدربورد.</div>`;
    }
}

// لود تعداد بازیکنان آنلاین
async function loadOnlinePlayersCount() {
    const onlineCountEl = document.getElementById('onlinePlayersCount');
    
    try {
        const response = await fetch('/api/players/online-count');
        if (!response.ok) throw new Error(`Server responded with status: ${response.status}`);
        const result = await response.json();

        if (result.success) {
            onlineCountEl.innerText = toPersianNumber(result.count);
        } else {
             onlineCountEl.innerText = '--';
        }
    } catch (error) {
         onlineCountEl.innerText = '?';
    }
}


// ======================================================================
// ۶. مدیریت اتصال و Modal Handlers
// ======================================================================

// شروع گزارش‌دهی فعال بودن به سرور
function startConnectionReporting() {
    if (connectionInterval) return;

    const gameId = currentGame?.game_id || competitiveMatchId;
    if (!gameId || !currentUser) return;

    const reportConnection = async () => {
        try {
            await fetch(`/api/games/${gameId}/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_id: currentUser.telegram_id })
            });
        } catch (error) {
            console.error('❌ خطا در گزارش اتصال:', error);
        }
    };
    
    reportConnection(); 
    connectionInterval = setInterval(reportConnection, 10000); 
}

// توقف گزارش‌دهی و اعلام قطع اتصال
async function stopConnectionReporting() {
    clearInterval(connectionInterval);
    connectionInterval = null;
    
    const gameId = currentGame?.game_id || competitiveMatchId;
    if (!gameId || !currentUser) return;

    try {
        await fetch(`/api/games/${gameId}/disconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: currentUser.telegram_id })
        });
    } catch (error) {
        console.error('❌ خطا در گزارش قطع اتصال:', error);
    }
}

// تابع لود اطلاعات کاربر از Telegram Web App
async function loadUserData() {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
        const user = window.Telegram.WebApp.initDataUnsafe.user;
        currentUser = {
            telegram_id: user.id,
            full_name: `${user.first_name} ${user.last_name || ''}`.trim(),
            username: user.username,
            language_code: user.language_code
        };
        document.getElementById('playerName').innerText = currentUser.full_name;
        // اطلاع به TWA که برنامه آماده است
        window.Telegram.WebApp.ready(); 
        await fetch(`/api/user/${currentUser.telegram_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: currentUser.full_name }) });
        loadCompetitiveStats();
    } else {
        const testUserId = 123456789;
        currentUser = {
            telegram_id: testUserId,
            full_name: 'کاربر تستی',
            username: 'TestUser',
            language_code: 'fa'
        };
        document.getElementById('playerName').innerText = 'کاربر تستی';
        console.warn('⚠️ در محیط تلگرام نیستید. از کاربر تستی استفاده می‌شود.');
        loadCompetitiveStats();
    }
}

// مدیریت مودال‌ها
function openGameModal() { document.getElementById('gameModal').classList.add('active'); }
function closeGameModal() {
    document.getElementById('gameModal').classList.remove('active');
    clearInterval(gameTimer);
    clearInterval(gameStateInterval);
    stopConnectionReporting();
    currentGame = null;
    timeLeft = 0;
    loadActiveGames(); 
}
function openCompetitiveModal() { document.getElementById('competitiveModal').classList.add('active'); }
function closeCompetitiveModal() {
     if (isCompetitiveMatchActive) {
         if (!confirm('آیا مطمئن هستید که می‌خواهید مسابقه را ترک کنید؟ با این کار مسابقه را بازنده می‌شوید.')) return;
         leaveCompetitiveMatch();
    }
    document.getElementById('competitiveModal').classList.remove('active');
    updateCompetitiveModeUI('ready');
}
function openResultsModal() { document.getElementById('competitiveResultsModal').classList.add('active'); }
function closeResultsModal() { document.getElementById('competitiveResultsModal').classList.remove('active'); }
function openCreateGameModal() { document.getElementById('createGameModal').classList.add('active'); }
function closeCreateGameModal() { document.getElementById('createGameModal').classList.remove('active'); }


// ======================================================================
// ۷. مقداردهی اولیه (Initialization)
// ======================================================================

document.addEventListener('DOMContentLoaded', function() {
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    loadUserData();
    
    // تنظیم هندلرهای دکمه‌ها
    document.getElementById('createGameSubmitButton')?.addEventListener('click', createGame);
    document.getElementById('startGameButton')?.addEventListener('click', startGame);
    document.getElementById('gameGuessButton')?.addEventListener('click', submitGuess);
    document.getElementById('gameHintButton')?.addEventListener('click', useHint); 
    document.getElementById('startQuickMatchButton')?.addEventListener('click', startQuickMatch);
    document.getElementById('competitiveGuessButton')?.addEventListener('click', submitCompetitiveGuess);
    document.getElementById('competitiveLeaveButton')?.addEventListener('click', closeCompetitiveModal); 
    
    // لود اولیه بازی‌ها و آمار
    loadActiveGames();
    loadOnlinePlayersCount();
    
    // پولینگ برای به‌روزرسانی تب‌های فعال
    setInterval(() => {
        if (document.getElementById('active-games')?.classList.contains('active')) {
            loadActiveGames();
        }
        if (document.getElementById('competitive-mode')?.classList.contains('active')) {
            loadOnlinePlayersCount();
            loadLeaderboard();
        }
    }, 10000); 

});

// مدیریت بستن مودال‌ها با کلیک بیرون از آن‌ها
window.onclick = function(event) {
    const gameModal = document.getElementById('gameModal');
    const competitiveModal = document.getElementById('competitiveModal');
    const resultsModal = document.getElementById('competitiveResultsModal');
    const createModal = document.getElementById('createGameModal');
    
    if (event.target === gameModal) closeGameModal();
    if (event.target === competitiveModal) closeCompetitiveModal();
    if (event.target === resultsModal) closeResultsModal();
    if (event.target === createModal) closeCreateGameModal();
}

// مدیریت کلیدهای صفحه‌کلید
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeGameModal();
        closeCompetitiveModal();
        closeResultsModal();
        closeCreateGameModal();
    }
});

// مدیریت زمانی که کاربر صفحه را ترک می‌کند (برای اعلام قطع اتصال)
window.addEventListener('beforeunload', function() {
    stopConnectionReporting();
});

// مدیریت visibility change (برای توقف/شروع گزارش اتصال در صورت رفتن به تب دیگر یا مینی‌مایز کردن)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        stopConnectionReporting();
    } else if ((currentGame && !currentGame.completed) || isCompetitiveMatchActive) {
        startConnectionReporting();
    }
});
