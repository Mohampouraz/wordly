// متغیرهای global
let currentUser = null;
let currentGame = null;
let gameTimer = null;
let timeLeft = 0;
let hintsUsed = 0;
let gameStartTime = null;
let isCreator = false;

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

    if (userData.first_seen) {
        const firstSeenDate = toPersianDate(userData.first_seen);
        const lastSeenDate = toPersianDate(userData.last_seen);
        
        document.getElementById('firstSeen').textContent = firstSeenDate.formatted;
        document.getElementById('lastSeen').textContent = lastSeenDate.formatted;
    }
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

    gamesList.innerHTML = games.map(game => `
        <div class="game-item-minimal">
            <div class="game-header-minimal">
                <div class="game-code-minimal">${game.game_id}</div>
                <div class="game-category-minimal">${game.category}</div>
            </div>
            <div class="game-info-minimal">
                <div class="info-row-compact">
                    <i class="fas fa-user"></i>
                    <span>سازنده: ${game.creator_name || 'ناشناس'} ${game.creator_username ? `(@${game.creator_username})` : ''}</span>
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
                    <span>زمان: ${toPersianNumber(Math.floor(game.time_limit / 60))}:${toPersianNumber(game.time_limit % 60)}</span>
                </div>
            </div>
            <div class="game-actions-minimal">
                <button class="btn-success-minimal btn-small" onclick="joinExistingGame('${game.game_id}')">
                    <i class="fas fa-sign-in-alt"></i>
                    پیوستن
                </button>
            </div>
        </div>
    `).join('');
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
            currentGame = {
                game_id: result.game_id,
                word: word.toUpperCase(),
                category: category,
                max_attempts: result.max_attempts,
                time_limit: result.time_limit,
                attempts: 0,
                score: 0,
                creator_id: currentUser.telegram_id,
                is_started: false
            };

            isCreator = true;
            showNotification('بازی با موفقیت ایجاد شد! 🎮', 'success');
            document.getElementById('gameWord').value = '';
            openStartGameModal(result.game_id);
        } else {
            showNotification('خطا در ایجاد بازی', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در ایجاد بازی:', error);
        showNotification('خطا در ایجاد بازی', 'error');
    }
}

// تابع باز کردن مودال شروع بازی
function openStartGameModal(gameCode) {
    document.getElementById('createdGameCode').textContent = gameCode;
    document.getElementById('currentPlayersCount').textContent = '۱';
    document.getElementById('startGameModal').style.display = 'block';
}

// تابع بستن مودال شروع بازی
function closeStartGameModal() {
    document.getElementById('startGameModal').style.display = 'none';
}

// تابع شروع بازی (فقط توسط سازنده)
async function startGame() {
    if (!currentGame || !isCreator) return;

    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/start`, {
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
            showNotification('بازی شروع شد! بازیکنان می‌توانند حدس بزنند.', 'success');
            closeStartGameModal();
            currentGame.is_started = true;
            openGameModal();
        } else {
            showNotification(result.error || 'خطا در شروع بازی', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در شروع بازی:', error);
        showNotification('خطا در شروع بازی', 'error');
    }
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
                    attempts: gameData.attempts,
                    score: 0,
                    creator_id: gameData.creator_id,
                    is_started: gameData.is_started,
                    guessed_letters: gameData.guessed_letters,
                    incorrect_letters: gameData.incorrect_letters,
                    word_progress: gameData.word_progress,
                    word: gameData.word
                };

                isCreator = (gameData.creator_id === currentUser.telegram_id);
                
                if (isCreator) {
                    if (!currentGame.is_started) {
                        openStartGameModal(gameCode);
                    } else {
                        showNotification('شما سازنده این بازی هستید که قبلاً شروع شده است', 'info');
                        openGameModal();
                    }
                } else {
                    showNotification(`به بازی پیوستید! تعداد بازیکنان: ${toPersianNumber(result.players_count)}`, 'success');
                    document.getElementById('gameCode').value = '';
                    openGameModal();
                }
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
}

// تابع بستن مودال بازی
function closeGameModal() {
    document.getElementById('gameModal').style.display = 'none';
    stopGameTimer();
    currentGame = null;
    hintsUsed = 0;
    isCreator = false;
}

// تابع مقداردهی اولیه بازی
function initializeGame() {
    if (!currentGame) return;

    // نمایش وضعیت
    const gameStatus = document.getElementById('gameStatus');
    if (isCreator) {
        if (currentGame.is_started) {
            gameStatus.innerHTML = `
                <div class="creator-notice-minimal">
                    <i class="fas fa-crown"></i>
                    <span>شما سازنده این بازی هستید. بازی شروع شده و بازیکنان در حال حدس زدن هستند.</span>
                </div>
            `;
        } else {
            gameStatus.innerHTML = `
                <div class="creator-notice-minimal">
                    <i class="fas fa-crown"></i>
                    <span>شما سازنده این بازی هستید. برای شروع بازی روی دکمه "شروع بازی" کلیک کنید.</span>
                </div>
            `;
        }
    } else {
        if (currentGame.is_started) {
            gameStatus.innerHTML = `
                <div class="player-notice-minimal">
                    <i class="fas fa-gamepad"></i>
                    <span>شما بازیکن هستید. حروف را در باکس زیر وارد کنید!</span>
                </div>
            `;
        } else {
            gameStatus.innerHTML = `
                <div class="player-notice-minimal waiting">
                    <i class="fas fa-clock"></i>
                    <span>در انتظار شروع بازی توسط سازنده...</span>
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
    timeLeft = currentGame.time_limit || 180;
    updateTimerDisplay();
    
    // فقط اگر بازی شروع شده باشد تایمر را شروع کن
    if (currentGame.is_started && !isCreator) {
        startGameTimer();
    }
    
    // تنظیم تعداد حدس‌ها
    updateAttemptsDisplay();
    
    // تنظیم دکمه‌ها
    document.getElementById('hintBtn').disabled = isCreator || !currentGame.is_started;
    document.getElementById('guessBtn').disabled = isCreator || !currentGame.is_started;
    document.getElementById('guessInput').disabled = isCreator || !currentGame.is_started;
    
    // بازنشانی راهنمایی‌ها
    hintsUsed = 0;
    document.getElementById('hintCount').textContent = toPersianNumber(2);
    
    // ذخیره زمان شروع
    gameStartTime = new Date();
    
    // فوکوس روی اینپوت
    if (!isCreator && currentGame.is_started) {
        setTimeout(() => {
            document.getElementById('guessInput').focus();
        }, 500);
    }
}

// تابع نمایش پیشرفت کلمه با انیمیشن
function displayWordProgress(wordProgress) {
    const wordDisplay = document.getElementById('wordDisplay');
    wordDisplay.innerHTML = '';
    
    const currentLetters = wordDisplay.querySelectorAll('.letter-minimal');
    const newLetters = wordProgress.split('');
    
    newLetters.forEach((char, index) => {
        const letterElement = document.createElement('div');
        letterElement.className = 'letter-minimal';
        
        if (char === ' ') {
            letterElement.classList.add('space');
            letterElement.innerHTML = '&nbsp;';
        } else {
            letterElement.textContent = char;
            
            // اگر حرف از حالت _ به حرف واقعی تغییر کرده، انیمیشن نشان بده
            const currentChar = currentLetters[index] ? currentLetters[index].textContent : '_';
            if (currentChar === '_' && char !== '_') {
                letterElement.classList.add('revealed');
            } else if (char !== '_') {
                letterElement.classList.add('revealed');
                letterElement.style.animation = 'none';
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
    if (!currentGame || !currentUser || isCreator || !currentGame.is_started) return;

    // محاسبه زمان سپری شده
    const timeSpent = Math.floor((new Date() - gameStartTime) / 1000);

    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/guess-letter`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id,
                letter: letter,
                time_spent: timeSpent
            })
        });

        const result = await response.json();

        if (result.success) {
            // پاک کردن اینپوت
            document.getElementById('guessInput').value = '';
            
            // به‌روزرسانی وضعیت بازی
            updateGameState(result);
            
            if (result.game_completed || result.game_over) {
                endGame(result.game_completed);
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
    displayWordProgress(result.word_progress);
    
    // به‌روزرسانی حروف حدس زده شده
    updateGuessedLetters(result.correct_letters, result.incorrect_letters);
    
    // به‌روزرسانی امتیاز
    currentGame.score += result.score;
    document.getElementById('currentScore').textContent = toPersianNumber(currentGame.score);
    
    // به‌روزرسانی تعداد حدس‌ها
    if (!result.is_correct) {
        currentGame.attempts = result.remaining_attempts ? 
            currentGame.max_attempts - result.remaining_attempts : 
            currentGame.attempts + 1;
        updateAttemptsDisplay();
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
        
        if (timeLeft <= 0) {
            endGame(false);
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
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const timerText = `${toPersianNumber(minutes.toString().padStart(2, '0'))}:${toPersianNumber(seconds.toString().padStart(2, '0'))}`;
    document.getElementById('timer').textContent = timerText;
}

// تابع به‌روزرسانی نمایش تعداد حدس‌ها
function updateAttemptsDisplay() {
    if (!currentGame) return;
    const remaining = currentGame.max_attempts - currentGame.attempts;
    document.getElementById('attempts').textContent = 
        `${toPersianNumber(currentGame.attempts)}/${toPersianNumber(currentGame.max_attempts)}`;
}

// تابع استفاده از راهنمایی
function useHint() {
    if (!currentGame || hintsUsed >= 2 || isCreator || !currentGame.is_started) return;
    
    // کسر امتیاز برای استفاده از راهنمایی
    currentGame.score -= 30;
    document.getElementById('currentScore').textContent = toPersianNumber(currentGame.score);
    
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

// تابع پایان بازی
function endGame(isWin) {
    stopGameTimer();
    
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

    // به‌روزرسانی آمار کاربر
    setTimeout(() => {
        loadUserData();
    }, 2000);
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
        z-index: 1000;
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

// تابع تبدیل تاریخ میلادی به شمسی
function toPersianDate(gregorianDate) {
    const date = new Date(gregorianDate);
    const gregorianYear = date.getFullYear();
    const gregorianMonth = date.getMonth() + 1;
    const gregorianDay = date.getDate();
    
    const gregorian = [gregorianYear, gregorianMonth, gregorianDay];
    const persian = gregorian_to_jalali(gregorian[0], gregorian[1], gregorian[2]);
    
    const persianMonths = [
        'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
        'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
    ];
    
    return {
        year: persian[0],
        month: persian[1],
        day: persian[2],
        monthName: persianMonths[persian[1] - 1],
        formatted: `${toPersianNumber(persian[2])} ${persianMonths[persian[1] - 1]} ${toPersianNumber(persian[0])}`
    };
}

function gregorian_to_jalali(gy, gm, gd) {
    var g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var jy = (gy <= 1600) ? 0 : 979;
    gy -= (gy <= 1600) ? 621 : 1600;
    var gy2 = (gm > 2) ? (gy + 1) : gy;
    var days = (365 * gy) + (parseInt((gy2 + 3) / 4)) - (parseInt((gy2 + 99) / 100)) 
        + (parseInt((gy2 + 399) / 400)) - 80 + gd + g_d_m[gm - 1];
    jy += 33 * (parseInt(days / 12053)); 
    days %= 12053;
    jy += 4 * (parseInt(days / 1461));
    days %= 1461;
    jy += parseInt((days - 1) / 365);
    if (days > 365) days = (days - 1) % 365;
    var jm = (days < 186) ? 1 + parseInt(days / 31) : 7 + parseInt((days - 186) / 30);
    var jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
    return [jy, jm, jd];
}

// تابع به‌روزرسانی ساعت زنده
function updateLiveClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('fa-IR');
    document.getElementById('currentTime').textContent = timeString;
    
    const persianDate = toPersianDate(now);
    document.getElementById('persianDate').textContent = persianDate.formatted;
}

// مدیریت ارسال با Enter
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('guessInput')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            submitGuess();
        }
    });
});

// بستن مودال با کلیک خارج از آن
window.onclick = function(event) {
    const gameModal = document.getElementById('gameModal');
    const startGameModal = document.getElementById('startGameModal');
    
    if (event.target === gameModal) closeGameModal();
    if (event.target === startGameModal) closeStartGameModal();
}

// مدیریت کلیدهای صفحه‌کلید
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeGameModal();
        closeStartGameModal();
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
