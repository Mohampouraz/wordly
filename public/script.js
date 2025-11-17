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

// Start Quick Match
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

// Start Competitive Match Polling
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
                updateCompetitiveMatchState(result.match);
            } else {
                console.error('Error in match polling:', result.error);
            }
        } catch (error) {
            console.error('❌ خطا در به‌روزرسانی وضعیت مسابقه:', error);
        }
    }, 3000);
}

// Stop Competitive Match Polling
function stopCompetitiveMatchPolling() {
    if (competitiveMatchInterval) {
        clearInterval(competitiveMatchInterval);
        competitiveMatchInterval = null;
    }
}

// Update Competitive Match State
function updateCompetitiveMatchState(match) {
    console.log('Updating match state:', match);
    
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
    
    // Start match if both players are ready and status is active
    if (match.status === 'active' && !isCompetitiveMatchActive) {
        console.log('Starting competitive match with words:', match.words);
        startCompetitiveMatch(match);
    }
    
    // End match if completed
    if (match.status === 'completed') {
        endCompetitiveMatch(match);
    }
    
    // Update UI based on match status
    updateCompetitiveUIStatus(match.status);
}

// Update Competitive UI Status
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
    }
}

// Start Competitive Match
function startCompetitiveMatch(match) {
    console.log('Starting competitive match');
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
    
    console.log(`Starting word ${currentWordIndex + 1}: ${currentWord}`);
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

// بقیه توابع موجود...

// تابع بارگذاری آمار
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        if (response.ok) {
            const stats = await response.json();
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// تابع بارگذاری بازی‌های فعال
async function loadActiveGames() {
    try {
        const response = await fetch('/api/games/active');
        const result = await response.json();

        if (result.success) {
            displayActiveGames(result.games);
        } else {
            document.getElementById('gamesList').innerHTML = '<div class="error">خطا در بارگذاری بازی‌ها</div>';
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری بازی‌های فعال:', error);
        document.getElementById('gamesList').innerHTML = '<div class="loading-minimal"><i class="fas fa-exclamation-triangle"></i><span>خطا در بارگذاری</span></div>';
    }
}

// تابع نمایش بازی‌های فعال
function displayActiveGames(games) {
    const gamesList = document.getElementById('gamesList');
    const activeGamesCount = document.getElementById('activeGamesCount');

    if (games.length === 0) {
        gamesList.innerHTML = `
            <div class="empty-state-minimal">
                <i class="fas fa-gamepad"></i>
                <h3>هیچ بازی فعالی وجود ندارد</h3>
                <p>اولین نفری باشید که بازی ایجاد می‌کند!</p>
            </div>
        `;
        activeGamesCount.textContent = '۰';
        return;
    }

    activeGamesCount.textContent = toPersianNumber(games.length);

    gamesList.innerHTML = games.map(game => {
        const timeRemaining = game.is_started && game.remaining_time ? formatTime(game.remaining_time) : 'در انتظار بازیکن';
        const statusBadge = game.is_started ? 
            '<span class="status-badge started">شروع شده</span>' : 
            '<span class="status-badge waiting">در انتظار</span>';
        
        return `
        <div class="game-item-minimal">
            <div class="game-header-minimal">
                <div class="game-code-minimal">${game.game_id}</div>
                <div class="game-category-minimal">${game.category}</div>
                ${statusBadge}
                ${game.creator_online ? '<div class="online-indicator" title="سازنده آنلاین"><i class="fas fa-circle"></i></div>' : ''}
            </div>
            <div class="game-info-minimal">
                <div class="info-row-compact">
                    <i class="fas fa-user"></i>
                    <span>سازنده: ${game.creator_name || 'ناشناس'}</span>
                </div>
                <div class="info-row-compact">
                    <i class="fas fa-users"></i>
                    <span>بازیکنان: ${toPersianNumber(game.players_count)} نفر</span>
                </div>
                <div class="info-row-compact">
                    <i class="fas fa-font"></i>
                    <span>طول کلمه: ${toPersianNumber(game.word_length)} حرف</span>
                </div>
                <div class="info-row-compact">
                    <i class="fas fa-clock"></i>
                    <span>وضعیت: ${timeRemaining}</span>
                </div>
            </div>
            <div class="game-actions-minimal">
                <button class="btn-success-minimal btn-small" onclick="joinExistingGame('${game.game_id}')">
                    <i class="fas fa-sign-in-alt"></i>
                    پیوستن
                </button>
            </div>
        </div>
        `;
    }).join('');
}

// تابع فرمت زمان
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${toPersianNumber(minutes)}:${toPersianNumber(secs.toString().padStart(2, '0'))}`;
}

// تابع ایجاد بازی جدید
async function createGame() {
    if (!currentUser) {
        showNotification('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود', 'error');
        return;
    }

    const word = document.getElementById('gameWord').value.trim();
    const category = document.getElementById('gameCategory').value;

    if (!word || word.length < 3 || word.length > 20) {
        showNotification('کلمه باید بین ۳ تا ۲۰ حرف باشد', 'error');
        return;
    }

    try {
        const response = await fetch('/api/games/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                creator_id: currentUser.telegram_id,
                word: word,
                category: category
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification(`بازی با موفقیت ایجاد شد! کد بازی: ${result.game_id}`, 'success');
            document.getElementById('gameWord').value = '';
            
            loadActiveGames();
            
        } else {
            showNotification('خطا در ایجاد بازی', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در ایجاد بازی:', error);
        showNotification('خطا در ایجاد بازی', 'error');
    }
}

// تابع پولینگ برای به‌روزرسانی وضعیت بازی
function startGameStatePolling(gameId) {
    if (gameStateInterval) {
        clearInterval(gameStateInterval);
    }
    
    gameStateInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/games/${gameId}`);
            const result = await response.json();
            
            if (result.success) {
                const gameData = result.game;
                
                if (currentGame) {
                    currentGame.guessed_letters = gameData.guessed_letters;
                    currentGame.incorrect_letters = gameData.incorrect_letters;
                    currentGame.attempts = gameData.attempts;
                    currentGame.word_progress = gameData.word_progress;
                    currentGame.players_count = gameData.players_count;
                    currentGame.creator_online = gameData.creator_online;
                    currentGame.completed = gameData.completed;
                    currentGame.winner_id = gameData.winner_id;
                    currentGame.is_started = gameData.is_started;
                    currentGame.remaining_time = gameData.remaining_time;
                    
                    updateGameInterface();
                    
                    if (gameData.remaining_time <= 0 && !gameExpired && gameData.is_started) {
                        gameExpired = true;
                        endGameByTimeout();
                    }
                    
                    if (gameData.completed) {
                        clearInterval(gameStateInterval);
                        endGame(currentGame.winner_id === currentUser.telegram_id);
                    }
                }
            }
        } catch (error) {
            console.error('❌ خطا در به‌روزرسانی وضعیت بازی:', error);
        }
    }, 2000);
}

// تابع گزارش اتصال به سرور
async function reportConnection(connected = true) {
    if (!currentGame || !currentUser) return;
    
    try {
        const endpoint = connected ? 'connect' : 'disconnect';
        await fetch(`/api/games/${currentGame.game_id}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id
            })
        });
    } catch (error) {
        console.error('❌ خطا در گزارش اتصال:', error);
    }
}

// تابع شروع گزارش‌دهی اتصال
function startConnectionReporting() {
    if (connectionInterval) {
        clearInterval(connectionInterval);
    }
    
    reportConnection(true);
    
    connectionInterval = setInterval(() => {
        reportConnection(true);
    }, 20000);
}

// تابع توقف گزارش‌دهی اتصال
function stopConnectionReporting() {
    if (connectionInterval) {
        clearInterval(connectionInterval);
        connectionInterval = null;
    }
    reportConnection(false);
}

// تابع پیوستن به بازی با کد
async function joinGame() {
    if (!currentUser) {
        showNotification('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود', 'error');
        return;
    }

    const gameCode = document.getElementById('gameCode').value.trim().toUpperCase();

    if (!gameCode || gameCode.length !== 6) {
        showNotification('کد بازی باید ۶ حرفی باشد', 'error');
        return;
    }

    await joinExistingGame(gameCode);
}

// تابع پیوستن به بازی موجود
async function joinExistingGame(gameCode) {
    try {
        const response = await fetch(`/api/games/${gameCode}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id
            })
        });

        const result = await response.json();

        if (result.success) {
            const gameResponse = await fetch(`/api/games/${gameCode}`);
            const gameResult = await gameResponse.json();

            if (gameResult.success) {
                const gameData = gameResult.game;
                currentGame = {
                    game_id: gameCode,
                    category: gameData.category,
                    max_attempts: gameData.max_attempts,
                    time_limit: gameData.time_limit,
                    attempts: gameData.attempts || 0,
                    score: 0,
                    creator_id: gameData.creator_id,
                    guessed_letters: gameData.guessed_letters || [],
                    incorrect_letters: gameData.incorrect_letters || [],
                    word_progress: gameData.word_progress || '_'.repeat(gameData.word.length),
                    word: gameData.word,
                    completed: gameData.completed,
                    creator_online: gameData.creator_online,
                    winner_id: gameData.winner_id,
                    players_count: gameData.players_count,
                    is_started: gameData.is_started,
                    remaining_time: gameData.remaining_time
                };

                isCreator = (gameData.creator_id === currentUser.telegram_id);
                
                if (result.reconnected) {
                    showNotification(`اتصال مجدد به بازی انجام شد!`, 'success');
                } else {
                    showNotification(`به بازی پیوستید!`, 'success');
                }
                document.getElementById('gameCode').value = '';
                
                openGameModal();
                
                startGameStatePolling(gameCode);
                
            }
        } else {
            showNotification(result.error || 'خطا در پیوستن به بازی', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در پیوستن به بازی:', error);
        showNotification('خطا در پیوستن به بازی', 'error');
    }
}

// تابع باز کردن مودال بازی
function openGameModal() {
    if (!currentGame) return;

    document.getElementById('gameModalTitle').textContent = 'بازی حدس کلمه';
    document.getElementById('gameCategoryDisplay').textContent = `دسته‌بندی: ${currentGame.category}`;
    
    initializeGame();
    document.getElementById('gameModal').style.display = 'block';
    
    startConnectionReporting();
}

// تابع بستن مودال بازی
function closeGameModal() {
    document.getElementById('gameModal').style.display = 'none';
    stopGameTimer();
    stopConnectionReporting();
    
    if (gameStateInterval) {
        clearInterval(gameStateInterval);
        gameStateInterval = null;
    }
    
    currentGame = null;
    hintsUsed = 0;
    isCreator = false;
    gameExpired = false;
}

// تابع مقداردهی اولیه بازی
function initializeGame() {
    if (!currentGame) return;

    updateGameInterface();
}

// تابع دریافت اطلاعات بازیکنان
async function getPlayersInfo(gameId) {
    try {
        const response = await fetch(`/api/games/${gameId}/players-info`);
        const result = await response.json();
        
        if (result.success) {
            return result.players;
        }
        return [];
    } catch (error) {
        console.error('❌ خطا در دریافت اطلاعات بازیکنان:', error);
        return [];
    }
}

// تابع به‌روزرسانی رابط بازی
async function updateGameInterface() {
    if (!currentGame) return;

    const gameStatus = document.getElementById('gameStatus');
    
    if (currentGame.completed) {
        showGameResult();
        return;
    }

    const players = await getPlayersInfo(currentGame.game_id);
    const creator = players.find(p => p.is_creator);
    const otherPlayers = players.filter(p => !p.is_creator);

    if (isCreator) {
        if (!currentGame.is_started) {
            gameStatus.innerHTML = `
                <div class="creator-notice-minimal waiting">
                    <i class="fas fa-clock"></i>
                    <span>در انتظار بازیکن برای شروع بازی...</span>
                    <div class="waiting-badge">منتظر بازیکن</div>
                </div>
            `;
        } else {
            let playersInfoHtml = '';
            
            if (otherPlayers.length > 0) {
                playersInfoHtml = otherPlayers.map(player => `
                    <div class="player-info-item">
                        <div class="player-avatar-small">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="player-details">
                            <div class="player-name">${player.full_name}</div>
                            <div class="player-meta">
                                <span class="player-username">@${player.username}</span>
                                <span class="player-status ${player.is_online ? 'online' : 'offline'}">
                                    <i class="fas fa-circle"></i>
                                    ${player.is_online ? 'آنلاین' : 'آفلاین'}
                                </span>
                            </div>
                        </div>
                    </div>
                `).join('');
            } else {
                playersInfoHtml = '<div class="no-players">هنوز بازیکنی به بازی نپیوسته است</div>';
            }

            gameStatus.innerHTML = `
                <div class="creator-notice-minimal">
                    <i class="fas fa-crown"></i>
                    <span>شما سازنده این بازی هستید. بازیکنان حاضر:</span>
                    ${currentGame.creator_online ? '<div class="online-badge">آنلاین</div>' : '<div class="offline-badge">آفلاین</div>'}
                </div>
                <div class="players-list-minimal">
                    ${playersInfoHtml}
                </div>
            `;
        }
    } else {
        if (!currentGame.is_started) {
            gameStatus.innerHTML = `
                <div class="player-notice-minimal waiting">
                    <i class="fas fa-clock"></i>
                    <span>در انتظار شروع بازی توسط بازیکن دوم...</span>
                    <div class="waiting-badge">منتظر شروع</div>
                </div>
            `;
        } else {
            let creatorInfo = '';
            if (creator) {
                creatorInfo = `
                    <div class="creator-info">
                        <i class="fas fa-crown"></i>
                        <span>سازنده: ${creator.full_name}</span>
                        ${currentGame.creator_online ? 
                            '<div class="online-badge">آنلاین</div>' : 
                            '<div class="offline-badge">آفلاین</div>'
                        }
                    </div>
                `;
            }

            gameStatus.innerHTML = `
                <div class="player-notice-minimal">
                    <i class="fas fa-gamepad"></i>
                    <span>شما بازیکن هستید. حروف را در باکس زیر وارد کنید!</span>
                </div>
                ${creatorInfo}
            `;
        }
    }

    document.getElementById('gameCategoryDisplay').textContent = `دسته‌بندی: ${currentGame.category}`;

    if (currentGame.word_progress) {
        displayWordProgress(currentGame.word_progress);
    } else if (currentGame.word) {
        displayWordProgress('_'.repeat(currentGame.word.length));
    } else {
        displayWordProgress('_______');
    }
    
    updateGuessedLetters(
        currentGame.guessed_letters || [],
        currentGame.incorrect_letters || []
    );

    timeLeft = currentGame.remaining_time || 0;
    updateTimerDisplay();
    
    updateAttemptsDisplay();
    
    const guessInputSection = document.getElementById('guessInputSection');
    const playerGuessesSection = document.getElementById('playerGuessesSection');
    
    if (isCreator) {
        guessInputSection.style.display = 'none';
        playerGuessesSection.style.display = 'block';
        updatePlayerGuessesDisplay();
        
        // نمایش حروف حدس زده شده توسط بازیکنان برای سازنده
        updateCreatorGuessedLettersDisplay();
    } else {
        guessInputSection.style.display = 'block';
        playerGuessesSection.style.display = 'none';
        
        const isGameActive = !currentGame.completed && currentGame.is_started && timeLeft > 0;
        document.getElementById('hintBtn').disabled = !isGameActive;
        document.getElementById('guessBtn').disabled = !isGameActive;
        document.getElementById('guessInput').disabled = !isGameActive;
        
        if (!currentGame.is_started) {
            document.getElementById('guessInput').placeholder = "در انتظار شروع بازی...";
        } else {
            document.getElementById('guessInput').placeholder = "حرف مورد نظر را وارد کنید...";
        }
        
        hintsUsed = 0;
        document.getElementById('hintCount').textContent = toPersianNumber(2);
        
        if (isGameActive) {
            gameStartTime = new Date();
            startGameTimer();
        }
        
        if (isGameActive) {
            setTimeout(() => {
                document.getElementById('guessInput').focus();
            }, 500);
        }
    }
}

// تابع نمایش حروف حدس زده شده توسط بازیکنان برای سازنده
function updateCreatorGuessedLettersDisplay() {
    if (!isCreator || !currentGame) return;
    
    const correctContainer = document.getElementById('correctLetters');
    const incorrectContainer = document.getElementById('incorrectLetters');
    
    correctContainer.innerHTML = currentGame.guessed_letters && currentGame.guessed_letters.length > 0 ? 
        currentGame.guessed_letters.map(letter => `
            <div class="letter-badge correct">${letter}</div>
        `).join('') : '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';
    
    incorrectContainer.innerHTML = currentGame.incorrect_letters && currentGame.incorrect_letters.length > 0 ? 
        currentGame.incorrect_letters.map(letter => `
            <div class="letter-badge incorrect">${letter}</div>
        `).join('') : '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';
}

// تابع نمایش پیشرفت کلمه با انیمیشن
function displayWordProgress(wordProgress) {
    const wordDisplay = document.getElementById('wordDisplay');
    wordDisplay.innerHTML = '';
    
    const newLetters = wordProgress.split('');
    
    newLetters.forEach((char, index) => {
        const letterElement = document.createElement('div');
        letterElement.className = 'letter-minimal';
        
        if (char === ' ') {
            letterElement.classList.add('space');
            letterElement.innerHTML = '&nbsp;';
        } else {
            letterElement.textContent = char;
            
            if (char !== '_') {
                letterElement.classList.add('revealed');
            }
        }
        
        wordDisplay.appendChild(letterElement);
    });
}

// تابع به‌روزرسانی حروف حدس زده شده
function updateGuessedLetters(correctLetters, incorrectLetters) {
    const correctContainer = document.getElementById('correctLetters');
    const incorrectContainer = document.getElementById('incorrectLetters');
    
    correctContainer.innerHTML = correctLetters && correctLetters.length > 0 ? 
        correctLetters.map(letter => `
            <div class="letter-badge correct">${letter}</div>
        `).join('') : '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';
    
    incorrectContainer.innerHTML = incorrectLetters && incorrectLetters.length > 0 ? 
        incorrectLetters.map(letter => `
            <div class="letter-badge incorrect">${letter}</div>
        `).join('') : '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';
}

// تابع به‌روزرسانی نمایش حدس‌های بازیکنان (برای سازنده)
async function updatePlayerGuessesDisplay() {
    if (!currentGame || !isCreator) return;
    
    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/player-guesses`);
        const result = await response.json();
        
        const container = document.getElementById('playerGuessesContainer');
        
        if (result.success && result.guesses.length > 0) {
            container.innerHTML = result.guesses.map(guess => `
                <div class="player-guess-item">
                    <div class="player-name">${guess.player_name}</div>
                    <div class="player-guess">حرف "${guess.letter}" - <span class="guess-result ${guess.is_correct ? 'correct' : 'incorrect'}">${guess.is_correct ? 'صحیح' : 'غلط'}</span></div>
                    <div class="guess-time">${guess.time_ago}</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state-minimal">هنوز حدسی ثبت نشده است</div>';
        }
    } catch (error) {
        console.error('❌ خطا در دریافت حدس‌های بازیکنان:', error);
        document.getElementById('playerGuessesContainer').innerHTML = '<div class="error">خطا در بارگذاری حدس‌ها</div>';
    }
}

// تابع ارسال حدس
async function submitGuess() {
    const guessInput = document.getElementById('guessInput');
    const letter = guessInput.value.trim().toUpperCase();
    
    if (!letter || letter.length !== 1) {
        showNotification('لطفاً فقط یک حرف وارد کنید', 'warning');
        return;
    }

    const persianLetters = 'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
    if (!persianLetters.includes(letter)) {
        showNotification('لطفاً فقط حروف فارسی وارد کنید', 'warning');
        guessInput.value = '';
        return;
    }

    await guessLetter(letter);
    
    guessInput.value = '';
    guessInput.blur();
}

// تابع حدس زدن حرف
async function guessLetter(letter) {
    if (!currentGame || !currentUser || isCreator || !currentGame.is_started || currentGame.completed || timeLeft <= 0) return;

    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/guess-letter`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id,
                letter: letter
            })
        });

        const result = await response.json();

        if (result.success) {
            updateGameState(result);
            
            if (result.game_completed) {
                endGame(true);
            }
        } else {
            showNotification(result.error || 'خطا در پردازش حدس', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در ارسال حدس:', error);
        showNotification('خطا در ارسال حدس', 'error');
    }
}

// تابع به‌روزرسانی وضعیت بازی
function updateGameState(result) {
    if (result.word_progress) {
        displayWordProgress(result.word_progress);
    }
    
    updateGuessedLetters(result.correct_letters, result.incorrect_letters);
    
    if (result.score) {
        currentGame.score += result.score;
        document.getElementById('currentScore').textContent = toPersianNumber(currentGame.score);
    }
    
    if (result.remaining_attempts !== undefined) {
        currentGame.attempts = currentGame.max_attempts - result.remaining_attempts;
        updateAttemptsDisplay();
    }

    if (result.remaining_time !== undefined) {
        timeLeft = result.remaining_time;
        updateTimerDisplay();
    }

    if (result.is_correct) {
        showNotification(`حرف "${result.letter}" صحیح است! +${toPersianNumber(result.score)} امتیاز`, 'success');
    } else {
        showNotification(`حرف "${result.letter}" غلط است! ${toPersianNumber(result.score)} امتیاز`, 'error');
    }
}

// تابع شروع تایمر بازی
function startGameTimer() {
    stopGameTimer();
    
    gameTimer = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        
        if (timeLeft <= 0 && !gameExpired) {
            gameExpired = true;
            endGameByTimeout();
        }
    }, 1000);
}

// تابع توقف تایمر بازی
function stopGameTimer() {
    if (gameTimer) {
        clearInterval(gameTimer);
        gameTimer = null;
    }
}

// تابع به‌روزرسانی نمایش تایمر
function updateTimerDisplay() {
    const timerText = formatTime(timeLeft);
    document.getElementById('timer').textContent = timerText;
    
    const timerElement = document.getElementById('timer');
    if (timeLeft < 60) {
        timerElement.style.color = '#ef4444';
        timerElement.style.fontWeight = 'bold';
    } else if (timeLeft < 180) {
        timerElement.style.color = '#f59e0b';
    } else {
        timerElement.style.color = 'var(--text-primary)';
    }
}

// تابع به‌روزرسانی نمایش تعداد حدس‌ها
function updateAttemptsDisplay() {
    if (!currentGame) return;
    document.getElementById('attempts').textContent = 
        `${toPersianNumber(currentGame.attempts)}/${toPersianNumber(currentGame.max_attempts)}`;
}

// تابع استفاده از راهنمایی - بهبود یافته
function useHint() {
    if (!currentGame || hintsUsed >= 2 || isCreator || !currentGame.is_started || currentGame.completed || timeLeft <= 0) return;
    
    // کسر امتیاز برای استفاده از راهنمایی
    currentGame.score -= 30;
    document.getElementById('currentScore').textContent = toPersianNumber(Math.max(0, currentGame.score));
    
    hintsUsed++;
    document.getElementById('hintCount').textContent = toPersianNumber(2 - hintsUsed);
    
    if (hintsUsed >= 2) {
        document.getElementById('hintBtn').disabled = true;
    }
    
    const persianLetters = 'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی'.split('');
    
    // اولویت‌بندی: حروف صحیح که هنوز حدس زده نشده‌اند
    let availableLetters = [];
    
    if (currentGame.word) {
        // پیدا کردن حروف موجود در کلمه که هنوز حدس زده نشده‌اند
        const wordLetters = currentGame.word.split('').filter(letter => letter !== ' ');
        const unguessedCorrectLetters = wordLetters.filter(letter => 
            !currentGame.guessed_letters?.includes(letter) && 
            !currentGame.incorrect_letters?.includes(letter)
        );
        
        if (unguessedCorrectLetters.length > 0) {
            // اگر حروف صحیح حدس زده نشده وجود دارد، از بین آنها انتخاب کن
            availableLetters = unguessedCorrectLetters;
        } else {
            // در غیر این صورت از بین حروف تصادفی که حدس زده نشده‌اند انتخاب کن
            availableLetters = persianLetters.filter(letter => 
                !currentGame.guessed_letters?.includes(letter) && 
                !currentGame.incorrect_letters?.includes(letter)
            );
        }
    } else {
        availableLetters = persianLetters.filter(letter => 
            !currentGame.guessed_letters?.includes(letter) && 
            !currentGame.incorrect_letters?.includes(letter)
        );
    }
    
    if (availableLetters.length > 0) {
        const randomLetter = availableLetters[Math.floor(Math.random() * availableLetters.length)];
        
        // بررسی اینکه آیا حرف پیشنهادی جزو حروف غلط است
        const isIncorrectSuggestion = currentGame.word && !currentGame.word.includes(randomLetter);
        
        if (isIncorrectSuggestion) {
            showNotification(`راهنمایی: حرف "${randomLetter}" را امتحان نکنید! (۳۰- امتیاز)`, 'warning');
        } else {
            showNotification(`راهنمایی: حرف "${randomLetter}" را امتحان کنید! (۳۰- امتیاز)`, 'warning');
        }
        
        document.getElementById('guessInput').value = randomLetter;
        document.getElementById('guessInput').focus();
    } else {
        showNotification('همه حروف حدس زده شده‌اند!', 'info');
    }
}

// تابع پایان بازی به دلیل اتمام زمان
function endGameByTimeout() {
    stopGameTimer();
    stopConnectionReporting();
    
    document.getElementById('hintBtn').disabled = true;
    document.getElementById('guessBtn').disabled = true;
    document.getElementById('guessInput').disabled = true;

    showNotification(`زمان بازی به پایان رسید! ⌛`, 'warning');
    
    const gameStatus = document.getElementById('gameStatus');
    gameStatus.innerHTML = `
        <div class="player-notice-minimal">
            <i class="fas fa-clock"></i>
            <span>زمان بازی به پایان رسید! منتظر اعلام برنده نهایی باشید.</span>
        </div>
    `;

    if (currentGame.word) {
        displayWordProgress(currentGame.word);
    }
}

// تابع پایان بازی
function endGame(isWin) {
    stopGameTimer();
    stopConnectionReporting();
    
    document.getElementById('hintBtn').disabled = true;
    document.getElementById('guessBtn').disabled = true;
    document.getElementById('guessInput').disabled = true;

    if (isWin) {
        showNotification(`تبریک! شما برنده شدید! 🎉 امتیاز نهایی: ${toPersianNumber(currentGame.score)}`, 'success');
        
        const wordDisplay = document.getElementById('wordDisplay');
        wordDisplay.classList.add('win-animation');
    } else {
        // محاسبه جریمه
        const maxPossibleScore = currentGame.word ? currentGame.word.length * 50 + currentGame.word.length * 10 * 2 + currentGame.word.length * 5 : 0;
        const penalty = Math.floor(maxPossibleScore * 0.3);
        const finalScore = Math.max(0, currentGame.score - penalty);
        
        showNotification(`متاسفانه بازی را باختید. امتیاز نهایی: ${toPersianNumber(finalScore)} (جریمه: ${toPersianNumber(penalty)} امتیاز)`, 'error');
        
        if (currentGame.word) {
            displayWordProgress(currentGame.word);
        }
    }

    currentGame.completed = true;

    setTimeout(() => {
        loadUserData();
    }, 2000);
}

// تابع نمایش نتیجه بازی (برای بازی‌های تمام شده)
function showGameResult() {
    stopGameTimer();
    stopConnectionReporting();
    
    document.getElementById('hintBtn').disabled = true;
    document.getElementById('guessBtn').disabled = true;
    document.getElementById('guessInput').disabled = true;

    if (currentGame.word) {
        displayWordProgress(currentGame.word);
    }
    
    const gameStatus = document.getElementById('gameStatus');
    
    const isWinner = currentGame.winner_id === currentUser.telegram_id;
    if (isWinner) {
        gameStatus.innerHTML = `
            <div class="player-notice-minimal">
                <i class="fas fa-trophy"></i>
                <span>تبریک! شما برنده این بازی شدید! 🎉</span>
            </div>
        `;
        showNotification(`تبریک! شما برنده این بازی شدید! 🎉`, 'success');
    } else if (currentGame.winner_id) {
        gameStatus.innerHTML = `
            <div class="player-notice-minimal">
                <i class="fas fa-flag-checkered"></i>
                <span>بازی تمام شد! یکی از بازیکنان دیگر برنده شده است.</span>
            </div>
        `;
        showNotification(`بازی تمام شد!`, 'info');
    } else {
        gameStatus.innerHTML = `
            <div class="player-notice-minimal">
                <i class="fas fa-flag-checkered"></i>
                <span>بازی تمام شد! زمان به پایان رسید.</span>
            </div>
        `;
        showNotification(`بازی تمام شد!`, 'info');
    }
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

// تابع رفرش بازی‌های فعال
function refreshActiveGames() {
    showNotification('در حال بروزرسانی لیست بازی‌ها...', 'info');
    loadActiveGames();
}

// تابع بارگذاری تاریخچه بازی‌ها
async function loadGameHistory() {
    try {
        if (!currentUser) return;
        
        const response = await fetch(`/api/user/${currentUser.telegram_id}/games`);
        const result = await response.json();

        if (result.success) {
            displayGameHistory(result.games);
        } else {
            document.getElementById('gameHistoryList').innerHTML = '<div class="error">خطا در بارگذاری تاریخچه بازی‌ها</div>';
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری تاریخچه بازی‌ها:', error);
        document.getElementById('gameHistoryList').innerHTML = '<div class="loading-minimal"><i class="fas fa-exclamation-triangle"></i><span>خطا در بارگذاری</span></div>';
    }
}

// تابع نمایش تاریخچه بازی‌ها - بهبود یافته
function displayGameHistory(games) {
    const gameHistoryList = document.getElementById('gameHistoryList');

    if (games.length === 0) {
        gameHistoryList.innerHTML = `
            <div class="empty-state-minimal">
                <i class="fas fa-history"></i>
                <h3>هیچ بازی تاریخی وجود ندارد</h3>
                <p>شما هنوز در هیچ بازی شرکت نکرده‌اید!</p>
            </div>
        `;
        return;
    }

    gameHistoryList.innerHTML = games.map(game => `
        <div class="game-item-minimal">
            <div class="game-header-minimal">
                <div class="game-code-minimal">${game.game_id}</div>
                <div class="game-category-minimal">${game.category}</div>
            </div>
            <div class="game-info-minimal">
                <div class="info-row-compact">
                    <i class="fas fa-user"></i>
                    <span>سازنده: ${game.creator_name || 'ناشناس'}</span>
                </div>
                <div class="info-row-compact">
                    <i class="fas fa-font"></i>
                    <span>کلمه: ${game.word}</span>
                </div>
                <div class="info-row-compact">
                    <i class="fas fa-redo"></i>
                    <span>حدس‌ها: ${toPersianNumber(game.attempts)}/${toPersianNumber(game.max_attempts)}</span>
                </div>
                <div class="info-row-compact">
                    <i class="fas ${game.is_winner ? 'fa-crown success' : 'fa-times danger'}"></i>
                    <span>نتیجه: ${game.is_winner ? 'برنده 🎉' : 'باخت'}</span>
                </div>
                <div class="info-row-compact">
                    <i class="fas fa-calendar"></i>
                    <span>تاریخ: ${new Date(game.created_at).toLocaleDateString('fa-IR')}</span>
                </div>
            </div>
            <div class="game-history-letters">
                <div class="history-letters-section">
                    <h4>حروف صحیح:</h4>
                    <div class="history-letters-container">
                        ${game.guessed_letters && game.guessed_letters.length > 0 ? 
                            game.guessed_letters.map(letter => `<span class="history-letter-badge correct">${letter}</span>`).join('') : 
                            '<span class="no-letters">-</span>'
                        }
                    </div>
                </div>
                <div class="history-letters-section">
                    <h4>حروف غلط:</h4>
                    <div class="history-letters-container">
                        ${game.incorrect_letters && game.incorrect_letters.length > 0 ? 
                            game.incorrect_letters.map(letter => `<span class="history-letter-badge incorrect">${letter}</span>`).join('') : 
                            '<span class="no-letters">-</span>'
                        }
                    </div>
                </div>
            </div>
            <div class="game-actions-minimal">
                <button class="btn-primary-minimal btn-small" onclick="viewGameDetails('${game.game_id}')">
                    <i class="fas fa-eye"></i>
                    مشاهده جزئیات
                </button>
            </div>
        </div>
    `).join('');
}

// تابع مشاهده جزئیات بازی
async function viewGameDetails(gameId) {
    try {
        const response = await fetch(`/api/games/${gameId}`);
        const result = await response.json();

        if (result.success) {
            currentGame = {
                game_id: gameId,
                category: result.game.category,
                max_attempts: result.game.max_attempts,
                time_limit: result.game.time_limit,
                attempts: result.game.attempts || 0,
                score: 0,
                creator_id: result.game.creator_id,
                guessed_letters: result.game.guessed_letters || [],
                incorrect_letters: result.game.incorrect_letters || [],
                word_progress: result.game.word_progress,
                word: result.game.word,
                completed: result.game.completed,
                winner_id: result.game.winner_id,
                creator_online: false,
                is_started: true
            };

            isCreator = (result.game.creator_id === currentUser.telegram_id);
            openGameModal();
        } else {
            showNotification('خطا در دریافت اطلاعات بازی', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در دریافت اطلاعات بازی:', error);
        showNotification('خطا در دریافت اطلاعات بازی', 'error');
    }
}

// تابع به‌روزرسانی ساعت زنده
function updateLiveClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('fa-IR');
    document.getElementById('currentTime').textContent = timeString;
    
    const dateString = now.toLocaleDateString('fa-IR');
    document.getElementById('persianDate').textContent = dateString;
}

// مدیریت ارسال با Enter
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('guessInput')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            submitGuess();
        }
    });
    
    document.getElementById('gameWord')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            createGame();
        }
    });
    
    document.getElementById('gameCode')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            joinGame();
        }
    });
    
    // Competitive mode Enter key support
    document.getElementById('competitiveGuessInput')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            submitCompetitiveGuess();
        }
    });
});

// بستن مودال با کلیک خارج از آن
window.onclick = function(event) {
    const gameModal = document.getElementById('gameModal');
    const competitiveModal = document.getElementById('competitiveModal');
    const resultsModal = document.getElementById('competitiveResultsModal');
    
    if (event.target === gameModal) closeGameModal();
    if (event.target === competitiveModal) closeCompetitiveModal();
    if (event.target === resultsModal) closeResultsModal();
}

// مدیریت کلیدهای صفحه‌کلید
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeGameModal();
        closeCompetitiveModal();
        closeResultsModal();
    }
});

// مدیریت زمانی که کاربر صفحه را ترک می‌کند
window.addEventListener('beforeunload', function() {
    stopConnectionReporting();
    if (competitiveMatchId) {
        leaveCompetitiveMatch();
    }
});

// مدیریت visibility change
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        stopConnectionReporting();
    } else if (currentGame && !currentGame.completed) {
        startConnectionReporting();
    }
});

// مقداردهی اولیه
document.addEventListener('DOMContentLoaded', function() {
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    loadUserData();
    
    setInterval(() => {
        if (document.getElementById('active-games').classList.contains('active')) {
            loadActiveGames();
        }
        if (document.getElementById('competitive-mode').classList.contains('active')) {
            loadOnlinePlayersCount();
            loadWaitingMatches();
        }
    }, 5000);
});
