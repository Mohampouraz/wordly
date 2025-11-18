// متغیرهای global
let currentUser = null;
let currentGame = null;
let gameTimer = null;
let timeLeft = 0;
let hintsUsed = 0;
let gameStartTime = null;
let isCreator = false;
let gameStateInterval = null;
let connectionInterval = null;
let gameExpired = false;

// Competitive Mode Variables
let currentCompetitiveMatch = null;
let competitiveTimer = null;
let competitiveTimeLeft = 120;
let competitiveWords = [];
let currentWordIndex = 0;
let competitiveHintsUsed = 0;
let competitiveScores = { player1: 0, player2: 0 };
let competitiveStats = {
    player1: { correct: 0, wrong: 0, time: 0 },
    player2: { correct: 0, wrong: 0, time: 0 }
};
let competitiveMatchInterval = null;
let isCompetitiveMatchActive = false;
let competitiveMatchId = null;

// تابع تبدیل اعداد به فارسی
function toPersianNumber(number) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return number.toString().replace(/\d/g, digit => persianDigits[parseInt(digit)]);
}

// تابع مدیریت تب‌ها
function openTab(tabName) {
    const tabContents = document.getElementsByClassName('tab-content-minimal');
    for (let tab of tabContents) {
        tab.classList.remove('active');
    }

    const tabButtons = document.getElementsByClassName('tab-minimal');
    for (let button of tabButtons) {
        button.classList.remove('active');
    }

    document.getElementById(tabName).classList.add('active');
    event.currentTarget.classList.add('active');

    if (tabName === 'active-games') {
        loadActiveGames();
    }
    
    if (tabName === 'game-history') {
        loadGameHistory();
    }
    
    if (tabName === 'competitive-mode') {
        loadCompetitiveStats();
        loadOnlinePlayersCount();
        loadWaitingMatches();
        loadLeaderboard();
    }
}

// تابع اصلی دریافت اطلاعات کاربر
async function getUserData() {
    let userData = null;

    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const tgUser = tg.initDataUnsafe.user;
            
            userData = {
                telegram_id: tgUser.id,
                full_name: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim(),
                username: tgUser.username || 'ندارد',
                language_code: tgUser.language_code || 'fa',
                data_source: 'telegram_web_app'
            };
            
            tg.ready();
            tg.expand();
            tg.setHeaderColor('#667eea');
            tg.setBackgroundColor('#667eea');
        }
    }

    if (!userData) {
        const urlParams = new URLSearchParams(window.location.search);
        const tgid = urlParams.get('tgid');
        
        if (tgid) {
            userData = {
                telegram_id: parseInt(tgid),
                data_source: 'url_parameter'
            };
        }
    }

    if (!userData) {
        userData = {
            telegram_id: 123456789,
            full_name: 'کاربر تست',
            username: 'test_user',
            data_source: 'test_data'
        };
    }

    if (userData.telegram_id) {
        try {
            const serverUser = await fetchUserFromServer(userData.telegram_id);
            if (serverUser) {
                userData = {
                    ...userData,
                    ...serverUser
                };
            }
        } catch (error) {
            console.error('❌ خطا در دریافت از سرور:', error);
        }
    }
    
    return userData;
}

// تابع دریافت اطلاعات از سرور
async function fetchUserFromServer(telegramId) {
    try {
        const response = await fetch(`/api/user/${telegramId}`);
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.error('💥 خطا در ارتباط با سرور:', error);
        return null;
    }
}

// تابع بارگذاری اطلاعات کاربر
async function loadUserData() {
    try {
        const userData = await getUserData();
        
        if (userData) {
            currentUser = userData;
            updateUserInterface(userData);
            loadStats();
            
            if (userData.data_source === 'telegram_web_app') {
                showNotification(`خوش آمدید ${userData.full_name}! 🎉`, 'success');
            }
        }
    } catch (error) {
        console.error('💥 خطا در بارگذاری اطلاعات کاربر:', error);
    }
}

// تابع به‌روزرسانی رابط کاربری
function updateUserInterface(userData) {
    document.getElementById('userId').textContent = toPersianNumber(userData.telegram_id);
    document.getElementById('fullName').textContent = userData.full_name || '---';
    document.getElementById('username').textContent = userData.username || '---';
    document.getElementById('userName').textContent = userData.full_name || 'کاربر';

    document.getElementById('totalGames').textContent = toPersianNumber(userData.total_games || 0);
    document.getElementById('wins').textContent = toPersianNumber(userData.wins || 0);
    document.getElementById('userScore').textContent = toPersianNumber(userData.game_score || 0);
    
    const winRate = userData.total_games > 0 ? Math.round((userData.wins / userData.total_games) * 100) : 0;
    document.getElementById('winRate').textContent = toPersianNumber(winRate) + '٪';
}

// Load Competitive Stats
async function loadCompetitiveStats() {
    if (!currentUser) return;
    
    try {
        const response = await fetch(`/api/user/${currentUser.telegram_id}/competitive-stats`);
        if (response.ok) {
            const stats = await response.json();
            
            document.getElementById('competitiveWins').textContent = toPersianNumber(stats.competitive_wins || 0);
            document.getElementById('competitiveScore').textContent = toPersianNumber(stats.competitive_score || 0);
            document.getElementById('leagueRank').textContent = stats.league_rank ? toPersianNumber(stats.league_rank) : '--';
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری آمار مسابقه‌ای:', error);
    }
}

// Load Online Players Count
async function loadOnlinePlayersCount() {
    try {
        const response = await fetch('/api/competitive/online-players');
        if (response.ok) {
            const data = await response.json();
            document.getElementById('onlinePlayers').textContent = toPersianNumber(data.count || 0);
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری تعداد بازیکنان آنلاین:', error);
    }
}

// Load Waiting Matches
async function loadWaitingMatches() {
    try {
        const response = await fetch('/api/competitive/waiting-matches');
        if (response.ok) {
            const data = await response.json();
            document.getElementById('waitingMatches').textContent = toPersianNumber(data.count || 0);
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری مسابقات منتظر:', error);
    }
}

// Load Leaderboard
async function loadLeaderboard() {
    try {
        const response = await fetch('/api/competitive/leaderboard?limit=5');
        if (response.ok) {
            const data = await response.json();
            displayLeaderboardPreview(data.players);
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری رتبه‌بندی:', error);
    }
}

// Display Leaderboard Preview
function displayLeaderboardPreview(players) {
    const container = document.getElementById('leaderboardPreview');
    
    if (!players || players.length === 0) {
        container.innerHTML = `
            <div class="empty-state-minimal">
                <i class="fas fa-trophy"></i>
                <p>هنوز رتبه‌ای ثبت نشده است</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = players.map((player, index) => `
        <div class="leaderboard-item">
            <div class="leaderboard-rank ${index < 3 ? 'top-' + (index + 1) : ''}">
                ${toPersianNumber(index + 1)}
            </div>
            <div class="leaderboard-player">
                <div class="leaderboard-avatar">
                    <i class="fas fa-user"></i>
                </div>
                <div class="leaderboard-info">
                    <div class="leaderboard-name">${player.full_name}</div>
                    <div class="leaderboard-score">${toPersianNumber(player.competitive_score)} امتیاز</div>
                </div>
            </div>
        </div>
    `).join('') + `
        <div class="leaderboard-more" onclick="openFullLeaderboard()">
            مشاهده رتبه‌بندی کامل
        </div>
    `;
}

// Start Quick Match - کاملاً بازنویسی شده
async function startQuickMatch() {
    if (!currentUser) {
        showNotification('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود', 'error');
        return;
    }
    
    try {
        showNotification('در حال پیدا کردن حریف...', 'info');
        
        const response = await fetch('/api/competitive/quick-match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id,
                player_name: currentUser.full_name
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            competitiveMatchId = result.match_id;
            openCompetitiveModal();
            startCompetitiveMatchPolling();
            
            if (result.matched) {
                showNotification(`حریف پیدا شد! ${result.opponent_name}`, 'success');
                console.log(`🤝 Match started with opponent: ${result.opponent_name}`);
            } else {
                showNotification('در انتظار حریف...', 'info');
                console.log('⏳ Waiting for opponent...');
            }
        } else {
            showNotification(result.error || 'خطا در پیدا کردن حریف', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در شروع مسابقه سریع:', error);
        showNotification('خطا در برقراری ارتباط', 'error');
    }
}

// Open Competitive Modal
function openCompetitiveModal() {
    document.getElementById('competitiveModal').style.display = 'flex';
    document.getElementById('player1Name').textContent = currentUser.full_name;
    document.getElementById('player1Score').textContent = '۰ امتیاز';
    
    // Reset competitive state
    competitiveWords = [];
    currentWordIndex = 0;
    competitiveHintsUsed = 0;
    competitiveScores = { player1: 0, player2: 0 };
    competitiveStats = {
        player1: { correct: 0, wrong: 0, time: 0 },
        player2: { correct: 0, wrong: 0, time: 0 }
    };
    
    updateCompetitiveUI();
}

// Close Competitive Modal
function closeCompetitiveModal() {
    document.getElementById('competitiveModal').style.display = 'none';
    stopCompetitiveTimer();
    stopCompetitiveMatchPolling();
    
    if (competitiveMatchId) {
        leaveCompetitiveMatch();
    }
}

// Start Competitive Match Polling - کاملاً بازنویسی شده
function startCompetitiveMatchPolling() {
    if (competitiveMatchInterval) {
        clearInterval(competitiveMatchInterval);
    }
    
    competitiveMatchInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/competitive/match/${competitiveMatchId}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const result = await response.json();
            
            if (result.success) {
                console.log('🔄 Match polling update:', result.match.status);
                updateCompetitiveMatchState(result.match);
            } else {
                console.error('Error in match polling:', result.error);
            }
        } catch (error) {
            console.error('❌ خطا در به‌روزرسانی وضعیت مسابقه:', error);
        }
    }, 2000); // کاهش فاصله پولینگ به 2 ثانیه
}

// Stop Competitive Match Polling
function stopCompetitiveMatchPolling() {
    if (competitiveMatchInterval) {
        clearInterval(competitiveMatchInterval);
        competitiveMatchInterval = null;
    }
}

// Update Competitive Match State - کاملاً بازنویسی شده
function updateCompetitiveMatchState(match) {
    console.log('🔄 Updating match state:', match);
    
    // Update opponent info
    if (match.player2_id && match.player2_id !== currentUser.telegram_id) {
        document.getElementById('player2Name').textContent = match.player2_name || 'حریف';
        document.getElementById('player2Score').textContent = toPersianNumber(match.player2_score) + ' امتیاز';
        document.getElementById('player2Status').innerHTML = '<i class="fas fa-circle online"></i>';
    } else if (!match.player2_id) {
        document.getElementById('player2Name').textContent = 'در انتظار حریف...';
        document.getElementById('player2Score').textContent = '۰ امتیاز';
        document.getElementById('player2Status').innerHTML = '<i class="fas fa-clock waiting"></i>';
    }
    
    // Update scores
    if (match.player1_id === currentUser.telegram_id) {
        competitiveScores.player1 = match.player1_score || 0;
        competitiveScores.player2 = match.player2_score || 0;
    } else {
        competitiveScores.player1 = match.player2_score || 0;
        competitiveScores.player2 = match.player1_score || 0;
    }
    
    document.getElementById('player1Score').textContent = toPersianNumber(competitiveScores.player1) + ' امتیاز';
    document.getElementById('player2Score').textContent = toPersianNumber(competitiveScores.player2) + ' امتیاز';
    
    // Update stats
    updateCompetitiveStatsBars();
    
    // Update UI based on match status
    updateCompetitiveUIStatus(match.status);
    
    // Start match if both players are ready and status is active
    if (match.status === 'active' && !isCompetitiveMatchActive) {
        console.log('🚀 Starting competitive match with words:', match.words);
        startCompetitiveMatch(match);
    }
    
    // End match if completed
    if (match.status === 'completed') {
        console.log('🏁 Match completed');
        endCompetitiveMatch(match);
    }
}

// Update Competitive UI Status - تابع جدید
function updateCompetitiveUIStatus(status) {
    const titleElement = document.getElementById('competitiveModalTitle');
    const waitingElement = document.getElementById('competitiveWaiting');
    const gameElement = document.getElementById('competitiveGame');
    
    switch (status) {
        case 'waiting':
            titleElement.textContent = 'در انتظار حریف...';
            waitingElement.style.display = 'block';
            gameElement.style.display = 'none';
            break;
        case 'active':
            titleElement.textContent = 'مسابقه در حال انجام!';
            waitingElement.style.display = 'none';
            gameElement.style.display = 'block';
            break;
        case 'completed':
            titleElement.textContent = 'مسابقه به پایان رسید';
            waitingElement.style.display = 'none';
            gameElement.style.display = 'block';
            break;
        default:
            titleElement.textContent = 'مسابقه';
            waitingElement.style.display = 'block';
            gameElement.style.display = 'none';
    }
}

// Start Competitive Match - کاملاً بازنویسی شده
function startCompetitiveMatch(match) {
    console.log('🚀 Starting competitive match');
    isCompetitiveMatchActive = true;
    competitiveWords = match.words || [];
    currentWordIndex = 0;
    
    document.getElementById('matchCategory').textContent = match.category || 'عمومی';
    document.getElementById('totalWords').textContent = toPersianNumber(competitiveWords.length);
    
    // Enable game UI
    updateCompetitiveUIStatus('active');
    
    // Start the first word
    startCompetitiveWord();
}

// Start Competitive Word
function startCompetitiveWord() {
    if (currentWordIndex >= competitiveWords.length) {
        completeCompetitiveMatch();
        return;
    }
    
    const currentWord = competitiveWords[currentWordIndex];
    competitiveTimeLeft = 120;
    
    document.getElementById('currentWordNumber').textContent = toPersianNumber(currentWordIndex + 1);
    displayCompetitiveWordProgress(currentWord);
    startCompetitiveTimer();
    
    // Enable input
    document.getElementById('competitiveGuessInput').disabled = false;
    document.getElementById('competitiveGuessBtn').disabled = false;
    document.getElementById('competitiveHintBtn').disabled = false;
    document.getElementById('skipWordBtn').disabled = false;
    
    // Reset hints for this word
    competitiveHintsUsed = 0;
    document.getElementById('competitiveHintCount').textContent = toPersianNumber(3);
    
    // Clear used letters
    document.getElementById('competitiveUsedLetters').innerHTML = '';
    
    console.log(`🔤 Starting word ${currentWordIndex + 1}: ${currentWord}`);
}

// Display Competitive Word Progress
function displayCompetitiveWordProgress(word) {
    const display = document.getElementById('competitiveWordDisplay');
    display.innerHTML = '';
    
    for (let i = 0; i < word.length; i++) {
        const letterElement = document.createElement('div');
        letterElement.className = 'letter-minimal';
        letterElement.textContent = '_';
        letterElement.dataset.index = i;
        display.appendChild(letterElement);
    }
    
    // Update progress bar
    const progress = ((currentWordIndex) / competitiveWords.length) * 100;
    document.getElementById('wordProgressBar').style.width = progress + '%';
}

// Start Competitive Timer
function startCompetitiveTimer() {
    stopCompetitiveTimer();
    
    updateCompetitiveTimerDisplay();
    
    competitiveTimer = setInterval(() => {
        competitiveTimeLeft--;
        updateCompetitiveTimerDisplay();
        
        if (competitiveTimeLeft <= 0) {
            skipCompetitiveWord();
        }
    }, 1000);
}

// Stop Competitive Timer
function stopCompetitiveTimer() {
    if (competitiveTimer) {
        clearInterval(competitiveTimer);
        competitiveTimer = null;
    }
}

// Update Competitive Timer Display
function updateCompetitiveTimerDisplay() {
    const minutes = Math.floor(competitiveTimeLeft / 60);
    const seconds = competitiveTimeLeft % 60;
    const timerText = `${toPersianNumber(minutes)}:${toPersianNumber(seconds.toString().padStart(2, '0'))}`;
    
    document.getElementById('matchTimer').textContent = timerText;
    
    if (competitiveTimeLeft < 30) {
        document.getElementById('matchTimer').style.color = '#ef4444';
        document.getElementById('matchTimer').style.fontWeight = 'bold';
    } else if (competitiveTimeLeft < 60) {
        document.getElementById('matchTimer').style.color = '#f59e0b';
    } else {
        document.getElementById('matchTimer').style.color = 'var(--gray-700)';
    }
}

// Submit Competitive Guess
async function submitCompetitiveGuess() {
    const input = document.getElementById('competitiveGuessInput');
    const letter = input.value.trim().toUpperCase();
    
    if (!letter || letter.length !== 1) {
        showNotification('لطفاً فقط یک حرف وارد کنید', 'warning');
        return;
    }

    const persianLetters = 'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
    if (!persianLetters.includes(letter)) {
        showNotification('لطفاً فقط حروف فارسی وارد کنید', 'warning');
        input.value = '';
        return;
    }

    await guessCompetitiveLetter(letter);
    input.value = '';
    input.focus();
}

// Guess Competitive Letter
async function guessCompetitiveLetter(letter) {
    if (!isCompetitiveMatchActive || !competitiveMatchId) {
        showNotification('مسابقه فعال نیست', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/competitive/match/${competitiveMatchId}/guess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id,
                letter: letter,
                word_index: currentWordIndex,
                time_remaining: competitiveTimeLeft
            })
        });
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        const result = await response.json();
        
        if (result.success) {
            updateCompetitiveWordProgress(result.word_progress);
            updateCompetitiveUsedLetters(result.used_letters);
            
            if (result.is_correct) {
                competitiveStats.player1.correct++;
                showNotification(`حرف "${letter}" صحیح است! +${toPersianNumber(result.score)} امتیاز`, 'success');
            } else {
                competitiveStats.player1.wrong++;
                showNotification(`حرف "${letter}" غلط است!`, 'error');
            }
            
            // Update score
            competitiveScores.player1 += result.score;
            document.getElementById('player1Score').textContent = toPersianNumber(competitiveScores.player1) + ' امتیاز';
            
            updateCompetitiveStatsBars();
            
            // Check if word is completed
            if (result.word_completed) {
                showNotification(`کلمه کامل شد! +${toPersianNumber(result.bonus_score)} امتیاز`, 'success');
                setTimeout(() => {
                    currentWordIndex++;
                    if (currentWordIndex < competitiveWords.length) {
                        startCompetitiveWord();
                    } else {
                        completeCompetitiveMatch();
                    }
                }, 1500);
            }
        } else {
            showNotification(result.error || 'خطا در پردازش حدس', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در ارسال حدس مسابقه:', error);
        showNotification('خطا در ارسال حدس', 'error');
    }
}

// Update Competitive Word Progress
function updateCompetitiveWordProgress(wordProgress) {
    const display = document.getElementById('competitiveWordDisplay');
    const letters = display.children;
    
    for (let i = 0; i < wordProgress.length; i++) {
        if (wordProgress[i] !== '_' && wordProgress[i] !== ' ') {
            letters[i].textContent = wordProgress[i];
            letters[i].classList.add('revealed');
            letters[i].style.animation = 'letterReveal 0.5s ease';
        }
    }
}

// Update Competitive Used Letters
function updateCompetitiveUsedLetters(usedLetters) {
    const container = document.getElementById('competitiveUsedLetters');
    if (!usedLetters || usedLetters.length === 0) return;
    
    container.innerHTML = '';
    
    usedLetters.forEach(letter => {
        const letterElement = document.createElement('div');
        letterElement.className = 'letter-used';
        letterElement.textContent = letter;
        container.appendChild(letterElement);
    });
}

// Update Competitive Stats Bars
function updateCompetitiveStatsBars() {
    // Player 1 stats
    const player1Total = competitiveStats.player1.correct + competitiveStats.player1.wrong;
    const player1CorrectPercent = player1Total > 0 ? (competitiveStats.player1.correct / player1Total) * 100 : 0;
    const player1WrongPercent = player1Total > 0 ? (competitiveStats.player1.wrong / player1Total) * 100 : 0;
    
    document.getElementById('player1CorrectBar').style.width = player1CorrectPercent + '%';
    document.getElementById('player1WrongBar').style.width = player1WrongPercent + '%';
    document.getElementById('player1Correct').textContent = toPersianNumber(competitiveStats.player1.correct);
    document.getElementById('player1Wrong').textContent = toPersianNumber(competitiveStats.player1.wrong);
    
    // Player 2 stats
    const player2Total = competitiveStats.player2.correct + competitiveStats.player2.wrong;
    const player2CorrectPercent = player2Total > 0 ? (competitiveStats.player2.correct / player2Total) * 100 : 0;
    const player2WrongPercent = player2Total > 0 ? (competitiveStats.player2.wrong / player2Total) * 100 : 0;
    
    document.getElementById('player2CorrectBar').style.width = player2CorrectPercent + '%';
    document.getElementById('player2WrongBar').style.width = player2WrongPercent + '%';
    document.getElementById('player2Correct').textContent = toPersianNumber(competitiveStats.player2.correct);
    document.getElementById('player2Wrong').textContent = toPersianNumber(competitiveStats.player2.wrong);
}

// Use Competitive Hint
function useCompetitiveHint() {
    if (competitiveHintsUsed >= 3 || !isCompetitiveMatchActive) return;
    
    competitiveHintsUsed++;
    document.getElementById('competitiveHintCount').textContent = toPersianNumber(3 - competitiveHintsUsed);
    
    // Deduct points for using hint
    competitiveScores.player1 = Math.max(0, competitiveScores.player1 - 20);
    document.getElementById('player1Score').textContent = toPersianNumber(competitiveScores.player1) + ' امتیاز';
    
    // Simple hint implementation - reveal a random letter
    const currentWord = competitiveWords[currentWordIndex];
    const hiddenLetters = [];
    const display = document.getElementById('competitiveWordDisplay');
    
    for (let i = 0; i < currentWord.length; i++) {
        if (display.children[i].textContent === '_') {
            hiddenLetters.push(i);
        }
    }
    
    if (hiddenLetters.length > 0) {
        const randomIndex = hiddenLetters[Math.floor(Math.random() * hiddenLetters.length)];
        const letter = currentWord[randomIndex];
        
        display.children[randomIndex].textContent = letter;
        display.children[randomIndex].classList.add('revealed');
        display.children[randomIndex].style.animation = 'letterReveal 0.5s ease';
        
        showNotification(`راهنمایی: حرف "${letter}" را پیدا کردید! (۲۰- امتیاز)`, 'warning');
    }
    
    if (competitiveHintsUsed >= 3) {
        document.getElementById('competitiveHintBtn').disabled = true;
    }
}

// Skip Competitive Word
function skipCompetitiveWord() {
    if (!isCompetitiveMatchActive) return;
    
    showNotification('کلمه رد شد!', 'info');
    currentWordIndex++;
    
    if (currentWordIndex < competitiveWords.length) {
        startCompetitiveWord();
    } else {
        completeCompetitiveMatch();
    }
}

// Complete Competitive Match
async function completeCompetitiveMatch() {
    isCompetitiveMatchActive = false;
    stopCompetitiveTimer();
    
    try {
        const response = await fetch(`/api/competitive/match/${competitiveMatchId}/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id,
                final_score: competitiveScores.player1,
                stats: competitiveStats.player1
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('مسابقه با موفقیت به پایان رسید!', 'success');
            setTimeout(() => {
                showCompetitiveResults(result.results);
            }, 1000);
        }
    } catch (error) {
        console.error('❌ خطا در تکمیل مسابقه:', error);
        // Show results anyway
        showCompetitiveResults({
            winner_id: competitiveScores.player1 > competitiveScores.player2 ? currentUser.telegram_id : null,
            player1_score: competitiveScores.player1,
            player2_score: competitiveScores.player2,
            player1_name: currentUser.full_name,
            player2_name: 'حریف',
            correct_words: competitiveStats.player1.correct,
            average_time: 60,
            earned_points: competitiveScores.player1
        });
    }
}

// End Competitive Match
function endCompetitiveMatch(match) {
    isCompetitiveMatchActive = false;
    stopCompetitiveTimer();
    showCompetitiveResults(match.final_results || {
        winner_id: match.winner_id,
        player1_score: match.player1_score,
        player2_score: match.player2_score,
        player1_name: match.player1_name,
        player2_name: match.player2_name,
        correct_words: 0,
        average_time: 0,
        earned_points: 0
    });
}

// Show Competitive Results
function showCompetitiveResults(results) {
    closeCompetitiveModal();
    
    if (!results) {
        results = {
            winner_id: null,
            player1_score: 0,
            player2_score: 0,
            player1_name: currentUser.full_name,
            player2_name: 'حریف',
            correct_words: 0,
            average_time: 0,
            earned_points: 0
        };
    }
    
    // Determine winner
    const isWinner = results.winner_id === currentUser.telegram_id;
    
    // Update results UI
    document.getElementById('resultsTitle').textContent = isWinner ? 'شما برنده شدید! 🏆' : 'مسابقه به پایان رسید';
    document.getElementById('resultsHeader').className = isWinner ? 'results-header winner' : 'results-header';
    
    document.getElementById('finalPlayer1Name').textContent = results.player1_name || currentUser.full_name;
    document.getElementById('finalPlayer1Score').textContent = toPersianNumber(results.player1_score || 0);
    
    document.getElementById('finalPlayer2Name').textContent = results.player2_name || 'حریف';
    document.getElementById('finalPlayer2Score').textContent = toPersianNumber(results.player2_score || 0);
    
    if (isWinner) {
        document.getElementById('finalPlayer1').classList.add('winner');
        document.getElementById('finalPlayer1Badge').textContent = 'برنده';
        document.getElementById('finalPlayer2Badge').textContent = 'بازنده';
    } else {
        document.getElementById('finalPlayer2').classList.add('winner');
        document.getElementById('finalPlayer1Badge').textContent = 'بازنده';
        document.getElementById('finalPlayer2Badge').textContent = 'برنده';
    }
    
    document.getElementById('resultsCorrectWords').textContent = 
        `${toPersianNumber(results.correct_words || 0)}/${toPersianNumber(competitiveWords.length)}`;
    document.getElementById('resultsAvgTime').textContent = 
        `${toPersianNumber(Math.round(results.average_time || 0))} ثانیه`;
    document.getElementById('resultsEarnedPoints').textContent = 
        `+${toPersianNumber(results.earned_points || 0)}`;
    
    // Show results modal
    document.getElementById('competitiveResultsModal').style.display = 'flex';
}

// Leave Competitive Match
async function leaveCompetitiveMatch() {
    try {
        await fetch(`/api/competitive/match/${competitiveMatchId}/leave`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id
            })
        });
    } catch (error) {
        console.error('❌ خطا در ترک مسابقه:', error);
    }
}

// Play Again Competitive
function playAgainCompetitive() {
    closeResultsModal();
    startQuickMatch();
}

// Share Competitive Results
function shareCompetitiveResults() {
    showNotification('نتایج با موفقیت کپی شد!', 'success');
    
    const resultsText = `نتایج مسابقه Wordly:
🏆 ${document.getElementById('finalPlayer1Name').textContent}: ${document.getElementById('finalPlayer1Score').textContent}
🎯 ${document.getElementById('finalPlayer2Name').textContent}: ${document.getElementById('finalPlayer2Score').textContent}
    
مسابقه دهید: ${window.location.href}`;
    
    navigator.clipboard.writeText(resultsText).catch(() => {
        // Fallback if clipboard API not available
    });
}

// Close Results Modal
function closeResultsModal() {
    document.getElementById('competitiveResultsModal').style.display = 'none';
}

// Update Competitive UI
function updateCompetitiveUI() {
    // Reset UI elements
    document.getElementById('competitiveWordDisplay').innerHTML = '';
    document.getElementById('competitiveUsedLetters').innerHTML = '';
    document.getElementById('wordProgressBar').style.width = '0%';
    document.getElementById('competitiveHintCount').textContent = toPersianNumber(3);
    
    // Disable input until match starts
    document.getElementById('competitiveGuessInput').disabled = true;
    document.getElementById('competitiveGuessBtn').disabled = true;
    document.getElementById('competitiveHintBtn').disabled = true;
    document.getElementById('skipWordBtn').disabled = true;
    
    // Reset stats bars
    updateCompetitiveStatsBars();
}

// Open Create Competitive Modal
function openCreateCompetitiveModal() {
    showNotification('این قابلیت به زودی اضافه خواهد شد', 'info');
}

// Open Join Competitive Modal
function openJoinCompetitiveModal() {
    showNotification('این قابلیت به زودی اضافه خواهد شد', 'info');
}

// Open Full Leaderboard
function openFullLeaderboard() {
    showNotification('این قابلیت به زودی اضافه خواهد شد', 'info');
}

// تابع نمایش نوتیفیکیشن
function showNotification(message, type = 'info') {
    const existingNotifications = document.querySelectorAll('.custom-notification');
    existingNotifications.forEach(notification => {
        notification.remove();
    });

    const notification = document.createElement('div');
    notification.className = `custom-notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? 'linear-gradient(135deg, #10b981, #0da271)' : 
                     type === 'error' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 
                     type === 'warning' ? 'linear-gradient(135deg, #f59e0b, #eab308)' : 
                     'linear-gradient(135deg, #06b6d4, #0891b2)'};
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        font-family: Vazirmatn, sans-serif;
        max-width: 320px;
        animation: slideInRight 0.3s ease;
        font-size: 0.9rem;
        font-weight: 500;
    `;
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 
                           type === 'error' ? 'exclamation-circle' : 
                           type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// بقیه توابع موجود...

// مدیریت ارسال با Enter
document.addEventListener('DOMContentLoaded', function() {
    // Competitive mode Enter key support
    document.getElementById('competitiveGuessInput')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            submitCompetitiveGuess();
        }
    });
});

// بستن مودال با کلیک خارج از آن
window.onclick = function(event) {
    const competitiveModal = document.getElementById('competitiveModal');
    const resultsModal = document.getElementById('competitiveResultsModal');
    
    if (event.target === competitiveModal) closeCompetitiveModal();
    if (event.target === resultsModal) closeResultsModal();
}

// مدیریت کلیدهای صفحه‌کلید
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeCompetitiveModal();
        closeResultsModal();
    }
});

// مدیریت زمانی که کاربر صفحه را ترک می‌کند
window.addEventListener('beforeunload', function() {
    if (competitiveMatchId) {
        leaveCompetitiveMatch();
    }
});

// مقداردهی اولیه
document.addEventListener('DOMContentLoaded', function() {
    loadUserData();
    
    setInterval(() => {
        if (document.getElementById('competitive-mode').classList.contains('active')) {
            loadOnlinePlayersCount();
            loadWaitingMatches();
        }
    }, 5000);
});
