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

// تابع تبدیل اعداد به فارسی
function toPersianNumber(number) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return number.toString().replace(/\d/g, digit => persianDigits[parseInt(digit)]);
}

// تابع مدیریت تب‌ها
function openTab(tabName) {
    // مخفی کردن همه تب‌ها
    const tabContents = document.getElementsByClassName('tab-content-minimal');
    for (let tab of tabContents) {
        tab.classList.remove('active');
    }

    // غیرفعال کردن همه دکمه‌های تب
    const tabButtons = document.getElementsByClassName('tab-minimal');
    for (let button of tabButtons) {
        button.classList.remove('active');
    }

    // نمایش تب انتخاب شده
    document.getElementById(tabName).classList.add('active');
    event.currentTarget.classList.add('active');

    // اگر تب بازی‌های فعال است، لیست را بارگذاری کن
    if (tabName === 'active-games') {
        loadActiveGames();
    }
    
    // اگر تب تاریخچه بازی است، تاریخچه را بارگذاری کن
    if (tabName === 'game-history') {
        loadGameHistory();
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

// تابع بارگذاری آمار
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        if (response.ok) {
            const stats = await response.json();
            // آمار کلی در داشبورد نمایش داده می‌شود
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
            
            // بارگذاری مجدد لیست بازی‌ها
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
                
                // به‌روزرسانی وضعیت بازی
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
                    
                    // به‌روزرسانی رابط
                    updateGameInterface();
                    
                    // بررسی انقضای زمان
                    if (gameData.remaining_time <= 0 && !gameExpired && gameData.is_started) {
                        gameExpired = true;
                        endGameByTimeout();
                    }
                    
                    // اگر بازی تمام شده، پولینگ را متوقف کن
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
    
    // گزارش اتصال اولیه
    reportConnection(true);
    
    // گزارش اتصال هر 20 ثانیه
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
            // دریافت اطلاعات کامل بازی
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
                
                // باز کردن بازی
                openGameModal();
                
                // شروع پولینگ برای وضعیت بازی
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
    
    // شروع گزارش‌دهی اتصال
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
    
    // بازی فقط از رابط کاربری بسته می‌شود، از سرور حذف نمی‌شود
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

// تابع به‌روزرسانی رابط بازی
function updateGameInterface() {
    if (!currentGame) return;

    const gameStatus = document.getElementById('gameStatus');
    
    if (currentGame.completed) {
        // بازی تمام شده
        showGameResult();
        return;
    }

    // نمایش وضعیت بر اساس نقش کاربر
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
            gameStatus.innerHTML = `
                <div class="creator-notice-minimal">
                    <i class="fas fa-crown"></i>
                    <span>شما سازنده این بازی هستید. می‌توانید پیشرفت بازیکنان را مشاهده کنید.</span>
                    ${currentGame.creator_online ? '<div class="online-badge">آنلاین</div>' : '<div class="offline-badge">آفلاین</div>'}
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
            gameStatus.innerHTML = `
                <div class="player-notice-minimal">
                    <i class="fas fa-gamepad"></i>
                    <span>شما بازیکن هستید. حروف را در باکس زیر وارد کنید!</span>
                    ${currentGame.creator_online ? 
                        '<div class="online-badge">سازنده آنلاین است</div>' : 
                        '<div class="offline-badge">سازنده آفلاین است</div>'
                    }
                </div>
            `;
        }
    }

    // نمایش پیشرفت کلمه
    if (currentGame.word_progress) {
        displayWordProgress(currentGame.word_progress);
    } else if (currentGame.word) {
        displayWordProgress('_'.repeat(currentGame.word.length));
    } else {
        displayWordProgress('_______');
    }
    
    // نمایش حروف حدس زده شده
    updateGuessedLetters(
        currentGame.guessed_letters || [],
        currentGame.incorrect_letters || []
    );

    // تنظیم تایمر
    timeLeft = currentGame.remaining_time || 0;
    updateTimerDisplay();
    
    // تنظیم تعداد حدس‌ها
    updateAttemptsDisplay();
    
    // تنظیم دکمه‌ها بر اساس نقش و وضعیت بازی
    const isGameActive = !currentGame.completed && currentGame.is_started && timeLeft > 0;
    document.getElementById('hintBtn').disabled = isCreator || !isGameActive;
    document.getElementById('guessBtn').disabled = isCreator || !isGameActive;
    document.getElementById('guessInput').disabled = isCreator || !isGameActive;
    
    // اگر سازنده هستید، فقط مشاهده کننده باشید
    if (isCreator) {
        document.getElementById('hintBtn').disabled = true;
        document.getElementById('guessBtn').disabled = true;
        document.getElementById('guessInput').disabled = true;
        document.getElementById('guessInput').placeholder = "شما سازنده هستید - فقط مشاهده";
    } else if (!currentGame.is_started) {
        document.getElementById('guessInput').placeholder = "در انتظار شروع بازی...";
    } else {
        document.getElementById('guessInput').placeholder = "حرف مورد نظر را وارد کنید...";
    }
    
    // بازنشانی راهنمایی‌ها
    hintsUsed = 0;
    document.getElementById('hintCount').textContent = toPersianNumber(2);
    
    // ذخیره زمان شروع برای بازیکنان
    if (isGameActive && !isCreator) {
        gameStartTime = new Date();
        startGameTimer();
    }
    
    // فوکوس روی اینپوت برای بازیکنان
    if (!isCreator && isGameActive) {
        setTimeout(() => {
            document.getElementById('guessInput').focus();
        }, 500);
    }
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
    
    correctContainer.innerHTML = correctLetters.map(letter => `
        <div class="letter-badge correct">${letter}</div>
    `).join('') || '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';
    
    incorrectContainer.innerHTML = incorrectLetters.map(letter => `
        <div class="letter-badge incorrect">${letter}</div>
    `).join('') || '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';
}

// تابع ارسال حدس
async function submitGuess() {
    const guessInput = document.getElementById('guessInput');
    const letter = guessInput.value.trim().toUpperCase();
    
    if (!letter || letter.length !== 1) {
        showNotification('لطفاً فقط یک حرف وارد کنید', 'warning');
        return;
    }

    // بررسی حروف فارسی
    const persianLetters = 'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی';
    if (!persianLetters.includes(letter)) {
        showNotification('لطفاً فقط حروف فارسی وارد کنید', 'warning');
        guessInput.value = '';
        return;
    }

    await guessLetter(letter);
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
            // پاک کردن اینپوت
            document.getElementById('guessInput').value = '';
            
            // به‌روزرسانی وضعیت بازی
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
    // به‌روزرسانی نمایش کلمه با انیمیشن
    if (result.word_progress) {
        displayWordProgress(result.word_progress);
    }
    
    // به‌روزرسانی حروف حدس زده شده
    updateGuessedLetters(result.correct_letters, result.incorrect_letters);
    
    // به‌روزرسانی امتیاز
    if (result.score) {
        currentGame.score += result.score;
        document.getElementById('currentScore').textContent = toPersianNumber(currentGame.score);
    }
    
    // به‌روزرسانی تعداد حدس‌ها
    if (result.remaining_attempts !== undefined) {
        currentGame.attempts = currentGame.max_attempts - result.remaining_attempts;
        updateAttemptsDisplay();
    }

    // به‌روزرسانی زمان باقی‌مانده
    if (result.remaining_time !== undefined) {
        timeLeft = result.remaining_time;
        updateTimerDisplay();
    }

    // نمایش نتیجه حدس
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
    
    // تغییر رنگ تایمر وقتی زمان کم است
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

// تابع استفاده از راهنمایی
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
    
    // پیدا کردن حروف حدس زده نشده
    const persianLetters = 'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی'.split('');
    const availableLetters = persianLetters.filter(letter => 
        !currentGame.guessed_letters?.includes(letter) && 
        !currentGame.incorrect_letters?.includes(letter)
    );
    
    if (availableLetters.length > 0) {
        const randomLetter = availableLetters[Math.floor(Math.random() * availableLetters.length)];
        showNotification(`راهنمایی: حرف "${randomLetter}" را امتحان کنید! (۳۰- امتیاز)`, 'warning');
        
        // قرار دادن حرف در اینپوت
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
    
    // غیرفعال کردن دکمه‌ها و اینپوت
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

    // نمایش کلمه کامل
    if (currentGame.word) {
        displayWordProgress(currentGame.word);
    }
}

// تابع پایان بازی
function endGame(isWin) {
    stopGameTimer();
    stopConnectionReporting();
    
    // غیرفعال کردن دکمه‌ها و اینپوت
    document.getElementById('hintBtn').disabled = true;
    document.getElementById('guessBtn').disabled = true;
    document.getElementById('guessInput').disabled = true;

    if (isWin) {
        showNotification(`تبریک! شما برنده شدید! 🎉 امتیاز نهایی: ${toPersianNumber(currentGame.score)}`, 'success');
        
        // نمایش انیمیشن پیروزی
        const wordDisplay = document.getElementById('wordDisplay');
        wordDisplay.classList.add('win-animation');
    } else {
        showNotification(`متاسفانه بازی را باختید. امتیاز نهایی: ${toPersianNumber(currentGame.score)}`, 'error');
        
        // نمایش کلمه کامل
        if (currentGame.word) {
            displayWordProgress(currentGame.word);
        }
    }

    currentGame.completed = true;

    // به‌روزرسانی آمار کاربر
    setTimeout(() => {
        loadUserData();
    }, 2000);
}

// تابع نمایش نتیجه بازی (برای بازی‌های تمام شده)
function showGameResult() {
    stopGameTimer();
    stopConnectionReporting();
    
    // غیرفعال کردن دکمه‌ها و اینپوت
    document.getElementById('hintBtn').disabled = true;
    document.getElementById('guessBtn').disabled = true;
    document.getElementById('guessInput').disabled = true;

    // نمایش کلمه کامل
    if (currentGame.word) {
        displayWordProgress(currentGame.word);
    }
    
    const gameStatus = document.getElementById('gameStatus');
    
    // نمایش وضعیت برنده
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
    // حذف نوتیفیکیشن‌های قبلی
    const existingNotifications = document.querySelectorAll('.custom-notification');
    existingNotifications.forEach(notification => {
        notification.remove();
    });

    const notification = document.createElement('div');
    notification.className = 'custom-notification';
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

// تابع نمایش تاریخچه بازی‌ها
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
});

// بستن مودال با کلیک خارج از آن
window.onclick = function(event) {
    const gameModal = document.getElementById('gameModal');
    
    if (event.target === gameModal) closeGameModal();
}

// مدیریت کلیدهای صفحه‌کلید
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeGameModal();
    }
});

// مدیریت زمانی که کاربر صفحه را ترک می‌کند
window.addEventListener('beforeunload', function() {
    stopConnectionReporting();
});

// مدیریت visibility change (وقتی کاربر به تب دیگر می‌رود)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // کاربر صفحه را ترک کرده
        stopConnectionReporting();
    } else if (currentGame && !currentGame.completed) {
        // کاربر برگشته - اتصال مجدد
        startConnectionReporting();
    }
});

// مقداردهی اولیه
document.addEventListener('DOMContentLoaded', function() {
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    loadUserData();
    
    // رفرش خودکار بازی‌های فعال هر 30 ثانیه
    setInterval(() => {
        if (document.getElementById('active-games').classList.contains('active')) {
            loadActiveGames();
        }
    }, 30000);
});
