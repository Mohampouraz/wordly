// script.js - نسخه کامل اصلاح شده کلاینت
// منطق بازی: تمرکز بر به‌روزرسانی وضعیت از سرور، حذف تایمر محلی و افزایش پایداری چندنفره

// متغیرهای global
let currentUser = null;
let currentGame = null;
let gameStateInterval = null; // برای پولینگ در حالت انتظار (Not Started)
let activeGameUpdateInterval = null; // برای پولینگ در حالت بازی فعال (Started)
let connectionInterval = null;
let isCreator = false;
let hintsUsed = 0;
const MAX_HINTS = 2; // ثابت

// --- توابع عمومی و کمکی ---

// تابع تبدیل اعداد به فارسی
function toPersianNumber(number) {
    if (number === null || number === undefined) return '';
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return number.toString().replace(/\d/g, digit => persianDigits[parseInt(digit)]);
}

// تابع نمایش نوتیفیکیشن
function showNotification(message, type = 'info') {
    const notificationElement = document.getElementById('notification-minimal');
    if (!notificationElement) return;

    notificationElement.textContent = message;
    notificationElement.className = `notification-minimal ${type}`;
    notificationElement.style.display = 'block';

    setTimeout(() => {
        notificationElement.style.display = 'none';
    }, 4000);
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
    
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    if (tabName === 'active-games') {
        loadActiveGames();
    }
    
    // اگر تب تاریخچه دارید، می‌توانید آن را اینجا فعال کنید
    // if (tabName === 'game-history') { loadGameHistory(); }
}


// --- توابع مدیریت کاربر و آمار ---

// دریافت اطلاعات کاربر از سرور
async function fetchUserFromServer(id, name, uname) {
    try {
        const response = await fetch(`/api/user/${id}`);
        const result = await response.json();
        
        if (result) {
            currentUser = result;
            // فرض بر این است که API سرور اطلاعات نام و یوزرنیم را در صورت لزوم به‌روز می‌کند
            updateUserInterface();
            loadStats();
            loadActiveGames();
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری اطلاعات کاربری از سرور:', error);
        showNotification('خطا در بارگذاری اطلاعات کاربری.', 'error');
    }
}

// بارگذاری اطلاعات اولیه کاربر (شبیه‌سازی دریافت از تلگرام وب‌اپ)
function loadUserData() {
    // منطق واقعی: دریافت از window.Telegram.WebApp.initDataUnsafe
    const initData = window.Telegram?.WebApp?.initDataUnsafe;
    let userId = 123456789; // شناسه آزمایشی
    let fullName = "بازیکن";
    let username = "player_bot";

    if (initData?.user) {
        userId = initData.user.id;
        fullName = initData.user.first_name + (initData.user.last_name ? ' ' + initData.user.last_name : '');
        username = initData.user.username;
    }
    
    // به‌روزرسانی موقت رابط کاربری قبل از درخواست به سرور
    currentUser = { telegram_id: userId, full_name: fullName, username: username };
    
    fetchUserFromServer(userId, fullName, username);
}

// به‌روزرسانی رابط کاربری پروفایل
function updateUserInterface() {
    if (currentUser) {
        document.getElementById('profileName').textContent = currentUser.full_name || 'کاربر ناشناس';
        document.getElementById('profileUsername').textContent = currentUser.username ? `@${currentUser.username}` : '';
        document.getElementById('totalScore').textContent = toPersianNumber(currentUser.game_score || 0);
        document.getElementById('totalGames').textContent = toPersianNumber(currentUser.total_games || 0);
        document.getElementById('totalWins').textContent = toPersianNumber(currentUser.wins || 0);
    }
}

// بارگذاری آمار کلی
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const result = await response.json();
        if (result.total_users) {
            document.getElementById('totalUsers').textContent = toPersianNumber(result.total_users);
            document.getElementById('activeGamesCountTotal').textContent = toPersianNumber(result.active_games);
        }
    } catch (error) {
        console.error('❌ خطا در بارگذاری آمار کلی:', error);
    }
}


// --- توابع مدیریت بازی (ایجاد و پیوستن) ---

// بارگذاری بازی‌های فعال
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

// نمایش بازی‌های فعال
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
                ${game.creator_online ? '<div class="online-indicator" title="سازنده آنلاین"><i class="fas fa-circle"></i></div>' : ''}
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
                    <span>زمان: ${toPersianNumber(Math.floor(game.time_limit / 60).toString().padStart(2, '0'))}:${toPersianNumber(game.time_limit % 60).toString().padStart(2, '0')}</span>
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

// ایجاد بازی جدید
async function createGame() {
    if (!currentUser) {
        showNotification('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود', 'error');
        return;
    }

    const word = document.getElementById('gameWord').value.trim();
    const category = document.getElementById('gameCategory').value;

    if (!word || word.length < 3 || word.length > 20 || !/^[آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی]+$/i.test(word)) {
        showNotification('کلمه باید بین ۳ تا ۲۰ حرف فارسی باشد', 'error');
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
                category: category,
                max_attempts: result.max_attempts,
                time_limit: result.time_limit,
                word_length: result.word_length,
                creator_id: currentUser.telegram_id,
                is_started: false,
                completed: false,
                guessed_letters: [],
                incorrect_letters: [],
                word_progress: '_'.repeat(result.word_length)
            };

            isCreator = true;
            showNotification('بازی با موفقیت ایجاد شد! 🎮', 'success');
            document.getElementById('gameWord').value = '';
            openStartGameModal(result.game_id);
            
            // شروع پولینگ برای به‌روزرسانی وضعیت بازیکنان منتظر
            startGameStatePolling(result.game_id);
            // شروع گزارش‌دهی اتصال
            startConnectionReporting();
        } else {
            showNotification(result.error || 'خطا در ایجاد بازی', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در ایجاد بازی:', error);
        showNotification('خطا در ایجاد بازی', 'error');
    }
}

// پیوستن به بازی موجود
async function joinExistingGame(gameCode) {
    if (!currentUser) {
        showNotification('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود', 'error');
        return;
    }
    
    // 1. پیوستن/Rejoin به بازی
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

        if (!result.success) {
            showNotification(result.error || 'خطا در پیوستن به بازی', 'error');
            return;
        }

        // 2. دریافت اطلاعات کامل بازی
        const gameResponse = await fetch(`/api/games/${gameCode}`);
        const gameResult = await gameResponse.json();

        if (!gameResult.success) {
            showNotification('خطا در دریافت اطلاعات کامل بازی', 'error');
            return;
        }
        
        const gameData = gameResult.game;
        
        // 3. تنظیم وضعیت محلی
        isCreator = (gameData.creator_id === currentUser.telegram_id);
        currentGame = { ...currentGame, ...gameData };
        
        if (result.reconnected) {
            showNotification(`اتصال مجدد به بازی انجام شد!`, 'success');
        } else {
            showNotification(`به بازی پیوستید!`, 'success');
        }
        
        document.getElementById('gameCode').value = '';
        startConnectionReporting(); // شروع گزارش اتصال

        if (currentGame.completed) {
            openGameModal(); 
        } else if (currentGame.is_started) {
            openGameModal();
        } else {
            if (isCreator) {
                openStartGameModal(gameCode);
            }
            openGameModal(); // برای نمایش مودال انتظار
            startGameStatePolling(gameCode);
        }
    } catch (error) {
        console.error('❌ خطا در پیوستن به بازی:', error);
        showNotification('خطا در پیوستن به بازی', 'error');
    }
}

// پیوستن به بازی با کد
async function joinGame() {
    if (!currentUser) {
        showNotification('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود', 'error');
        return;
    }

    const gameCode = document.getElementById('gameCode').value.trim().toUpperCase();

    if (!gameCode || gameCode.length !== 6) {
        showNotification('کد بازی باید ۶ حرفی باشد', 'warning');
        return;
    }

    await joinExistingGame(gameCode);
}

// شروع بازی (فقط توسط سازنده)
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


// --- توابع پولینگ و مدیریت اتصال ---

// پولینگ برای به‌روزرسانی وضعیت بازی (در حالت انتظار)
function startGameStatePolling(gameId) {
    if (gameStateInterval) clearInterval(gameStateInterval);
    if (activeGameUpdateInterval) clearInterval(activeGameUpdateInterval);
    
    gameStateInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/games/${gameId}`);
            const result = await response.json();
            
            if (result.success) {
                const gameData = result.game;
                
                currentGame = { ...currentGame, ...gameData };
                
                if (document.getElementById('startGameModal').style.display === 'block') {
                    document.getElementById('currentPlayersCount').textContent = 
                        toPersianNumber(gameData.players_count);
                }
                
                if (gameData.is_started) {
                    clearInterval(gameStateInterval);
                    currentGame.is_started = true;
                    showNotification('بازی شروع شد! 🚀', 'success');
                    closeStartGameModal();
                    openGameModal();
                }
            }
        } catch (error) {
            console.error('❌ خطا در به‌روزرسانی وضعیت بازی (Polling):', error);
        }
    }, 2000); // هر 2 ثانیه
}

// به‌روزرسانی وضعیت بازی فعال (در حالت بازی)
function startActiveGameUpdatePolling() {
    if (gameStateInterval) clearInterval(gameStateInterval);
    if (activeGameUpdateInterval) clearInterval(activeGameUpdateInterval);
    
    activeGameUpdateInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/games/${currentGame.game_id}`);
            const result = await response.json();
            
            if (result.success) {
                const gameData = result.game;
                
                currentGame = { ...currentGame, ...gameData };
                
                updateGameDisplay(gameData);
                
                if (gameData.completed || gameData.time_left <= 0) {
                    clearInterval(activeGameUpdateInterval);
                    showGameResult();
                }
            }
        } catch (error) {
            console.error('❌ خطا در به‌روزرسانی وضعیت بازی (Active):', error);
        }
    }, 1000); // هر 1 ثانیه
}

// گزارش اتصال به سرور
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

// شروع گزارش‌دهی اتصال
function startConnectionReporting() {
    if (connectionInterval) clearInterval(connectionInterval);
    reportConnection(true);
    connectionInterval = setInterval(() => {
        reportConnection(true);
    }, 20000); // هر 20 ثانیه
}

// توقف گزارش‌دهی اتصال
function stopConnectionReporting() {
    if (connectionInterval) {
        clearInterval(connectionInterval);
        connectionInterval = null;
    }
    reportConnection(false);
}


// --- توابع مودال و نمایش بازی ---

// باز کردن مودال شروع بازی (Wait Modal)
function openStartGameModal(gameCode) {
    document.getElementById('createdGameCode').textContent = gameCode;
    document.getElementById('currentPlayersCount').textContent = toPersianNumber(currentGame?.players_count || 1);
    document.getElementById('startGameModal').style.display = 'block';
}

// بستن مودال شروع بازی
function closeStartGameModal() {
    document.getElementById('startGameModal').style.display = 'none';
    if (gameStateInterval) {
        clearInterval(gameStateInterval);
        gameStateInterval = null;
    }
}

// باز کردن مودال اصلی بازی
function openGameModal() {
    if (!currentGame) return;
    
    document.getElementById('gameModalTitle').textContent = 'بازی حدس کلمه';
    document.getElementById('gameCategoryDisplay').textContent = `دسته‌بندی: ${currentGame.category}`;
    
    initializeGame();
    
    document.getElementById('gameModal').style.display = 'block';
}

// بستن مودال اصلی بازی
function closeGameModal() {
    document.getElementById('gameModal').style.display = 'none';
    stopConnectionReporting();
    
    if (gameStateInterval) clearInterval(gameStateInterval);
    if (activeGameUpdateInterval) clearInterval(activeGameUpdateInterval);
    
    currentGame = null;
    hintsUsed = 0;
    isCreator = false;
}

// مقداردهی اولیه بازی
function initializeGame() {
    if (!currentGame) return;
    
    hintsUsed = 0; 
    document.getElementById('hintCount').textContent = toPersianNumber(MAX_HINTS);
    document.getElementById('hintBtn').disabled = false;
    
    if (currentGame.completed) {
        showGameResult();
    } else if (!currentGame.is_started) {
        updateGameDisplay(currentGame);
    } else {
        startActiveGameUpdatePolling();
    }
    
    if (!isCreator && currentGame.is_started && !currentGame.completed) {
        setTimeout(() => {
            document.getElementById('guessInput').focus();
        }, 500);
    }
}

// تابع اصلی به‌روزرسانی نمایش بازی
function updateGameDisplay(gameData) {
    const gameStatus = document.getElementById('gameStatus');
    // پیدا کردن اطلاعات بازیکن فعلی از لیست بازیکنان
    const playerSelfData = gameData.players?.find(p => p.player_id === currentUser.telegram_id);
    
    if (gameData.completed || gameData.time_left <= 0) {
        showGameResult();
        return;
    } else if (!gameData.is_started) {
        // حالت انتظار
        gameStatus.innerHTML = `
            <div class="creator-notice-minimal">
                <i class="fas fa-users"></i> 
                <span>${isCreator ? 'شما سازنده این بازی هستید.' : 'منتظر شروع بازی توسط سازنده بمانید.'}</span>
                <p>تعداد بازیکنان: ${toPersianNumber(gameData.players_count)}</p>
                <div class="online-badge">${gameData.creator_online ? 'سازنده آنلاین' : 'سازنده آفلاین'}</div>
            </div>
        `;
        document.getElementById('guessInputContainer').style.display = 'none';
        document.getElementById('wordProgressContainer').style.display = 'none';
        document.getElementById('leaderboardContainer').style.display = 'block';
    } else {
        // حالت فعال
        gameStatus.innerHTML = `
            <div class="${isCreator ? 'creator-notice-minimal' : 'player-notice-minimal'}">
                <i class="fas ${isCreator ? 'fa-crown' : 'fa-gamepad'}"></i> 
                <span>${isCreator ? 'شما سازنده هستید. بازی فعال است.' : 'شما بازیکن هستید. حدس بزنید!'}</span>
                <div class="online-badge">${gameData.creator_online ? 'سازنده آنلاین' : 'سازنده آفلاین'}</div>
            </div>
        `;
        document.getElementById('guessInputContainer').style.display = isCreator ? 'none' : 'flex';
        document.getElementById('wordProgressContainer').style.display = 'block';
        document.getElementById('leaderboardContainer').style.display = 'block';
    }
    
    // به‌روزرسانی تایمر (از سرور)
    const minutes = Math.floor(gameData.time_left / 60);
    const seconds = gameData.time_left % 60;
    const timerText = `${toPersianNumber(minutes.toString().padStart(2, '0'))}:${toPersianNumber(seconds.toString().padStart(2, '0'))}`;
    document.getElementById('timer').textContent = timerText;
    
    // نمایش پیشرفت کلمه
    displayWordProgress(gameData.word_progress);
    
    // نمایش حروف حدس زده شده
    updateGuessedLetters(gameData.guessed_letters, gameData.incorrect_letters);
    
    // نمایش وضعیت فردی (برای بازیکنان)
    if (playerSelfData) {
        document.getElementById('currentScore').textContent = toPersianNumber(playerSelfData.score || 0);
        document.getElementById('attempts').textContent = `${toPersianNumber(playerSelfData.attempts)}/${toPersianNumber(gameData.max_attempts)}`;
        
        const isMaxAttempts = playerSelfData.attempts >= gameData.max_attempts;
        if (isMaxAttempts && !isCreator) {
             document.getElementById('guessInput').disabled = true;
             document.getElementById('guessBtn').disabled = true;
        } else {
             document.getElementById('guessInput').disabled = false;
             document.getElementById('guessBtn').disabled = false;
        }

    } else {
        // برای سازنده
        document.getElementById('currentScore').textContent = '---';
        document.getElementById('attempts').textContent = `---/${toPersianNumber(gameData.max_attempts)}`;
    }
    
    // به‌روزرسانی جدول امتیازات
    updateLeaderboard(gameData.players);
}

// به‌روزرسانی جدول امتیازات
function updateLeaderboard(playersArray) {
    const leaderboardBody = document.getElementById('leaderboardBody');
    if (!playersArray || playersArray.length === 0) {
        leaderboardBody.innerHTML = '<tr><td colspan="4">هیچ بازیکنی در بازی نیست</td></tr>';
        return;
    }

    const sortedPlayers = playersArray.sort((a, b) => b.score - a.score);
    
    leaderboardBody.innerHTML = sortedPlayers.map((player, index) => {
        const isSelf = player.player_id === currentUser.telegram_id;
        const isWinner = player.is_winner;
        const attempts = player.attempts || 0;
        
        return `
            <tr class="${isSelf ? 'table-row-self' : ''}">
                <td>${toPersianNumber(index + 1)}</td>
                <td>
                    ${isWinner ? '<i class="fas fa-trophy text-success-minimal"></i> ' : ''}
                    ${player.full_name || 'ناشناس'} ${player.username ? `(@${player.username})` : ''}
                </td>
                <td>${toPersianNumber(player.score || 0)}</td>
                <td>${toPersianNumber(attempts)}</td>
            </tr>
        `;
    }).join('');
}

// نمایش پیشرفت کلمه
function displayWordProgress(wordProgress) {
    const wordDisplay = document.getElementById('wordDisplay');
    wordDisplay.innerHTML = '';
    const newLetters = wordProgress.split('');
    newLetters.forEach((char) => {
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

// به‌روزرسانی حروف حدس زده شده
function updateGuessedLetters(correctLetters, incorrectLetters) {
    const correctContainer = document.getElementById('correctLetters');
    const incorrectContainer = document.getElementById('incorrectLetters');

    correctContainer.innerHTML = (correctLetters || []).map(letter => `
        <div class="letter-badge correct">${letter}</div>
    `).join('') || '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';

    incorrectContainer.innerHTML = (incorrectLetters || []).map(letter => `
        <div class="letter-badge incorrect">${letter}</div>
    `).join('') || '<div style="color: var(--gray-400); font-size: 0.9rem;">-</div>';
}

// نمایش نتیجه بازی
function showGameResult() {
    if (activeGameUpdateInterval) clearInterval(activeGameUpdateInterval);
    
    const gameStatus = document.getElementById('gameStatus');
    const winnerDisplay = document.getElementById('winnerDisplay');
    
    winnerDisplay.innerHTML = '';
    
    // اگر زمان تمام شده یا برنده‌ای مشخص نشده است
    if (!currentGame.winner_id && currentGame.time_left === 0) {
        gameStatus.innerHTML = `
            <div class="player-notice-minimal">
                <i class="fas fa-hourglass-end"></i> 
                <span>زمان بازی به پایان رسید!</span>
            </div>
        `;
        showNotification(`بازی تمام شد! زمان به پایان رسید.`, 'info');
    } else if (!currentGame.winner_id) {
        gameStatus.innerHTML = `
            <div class="player-notice-minimal">
                <i class="fas fa-flag-checkered"></i> 
                <span>بازی تمام شد! کلمه حدس زده نشد.</span>
            </div>
        `;
        showNotification(`بازی تمام شد! کلمه حدس زده نشد.`, 'info');
    } else {
        const winner = currentGame.players?.find(p => p.player_id === currentGame.winner_id);
        const winnerName = winner?.full_name || 'یک بازیکن ناشناس';
        
        if (currentGame.winner_id === currentUser.telegram_id) {
            gameStatus.innerHTML = `
                <div class="player-notice-minimal">
                    <i class="fas fa-trophy"></i> 
                    <span>تبریک! شما برنده این بازی شدید! 🎉</span>
                </div>
            `;
            showNotification(`تبریک! شما برنده این بازی شدید! 🎉`, 'success');
        } else {
            gameStatus.innerHTML = `
                <div class="player-notice-minimal">
                    <i class="fas fa-flag-checkered"></i> 
                    <span>بازی تمام شد! ${winnerName} برنده شد.</span>
                </div>
            `;
            showNotification(`بازی تمام شد! ${winnerName} برنده شد.`, 'info');
        }
        
        winnerDisplay.innerHTML = `
            <div class="winner-info-minimal">
                <i class="fas fa-crown"></i>
                <span>برنده: ${winnerName}</span>
            </div>
        `;
    }
    
    // غیرفعال کردن
    document.getElementById('guessInput').disabled = true;
    document.getElementById('guessBtn').disabled = true;
    document.getElementById('hintBtn').disabled = true;
}


// --- توابع اصلی بازی (حدس و راهنمایی) ---

// ارسال حدس
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
    
    if (currentGame.guessed_letters.includes(letter) || currentGame.incorrect_letters.includes(letter)) {
        showNotification('این حرف قبلاً حدس زده شده است', 'warning');
        guessInput.value = '';
        return;
    }

    await guessLetter(letter);
    guessInput.value = '';
}

// حدس زدن حرف
async function guessLetter(letter) {
    if (!currentGame || !currentUser || isCreator || !currentGame.is_started || currentGame.completed) return;
    
    document.getElementById('guessInput').disabled = true;
    document.getElementById('guessBtn').disabled = true;

    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/guess-letter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                player_id: currentUser.telegram_id,
                letter: letter
            })
        });

        const result = await response.json();

        if (result.success) {
            if (result.is_correct) {
                showNotification(`حرف "${result.letter}" صحیح است! ${result.score_change >= 0 ? '+' : ''}${toPersianNumber(result.score_change)} امتیاز`, 'success');
            } else {
                showNotification(`حرف "${result.letter}" غلط است! ${toPersianNumber(result.score_change)} امتیاز`, 'error');
            }
            
            if (result.game_completed) {
                showNotification('تبریک! بازی با موفقیت به پایان رسید! 🎉', 'success');
            }
            
        } else {
            showNotification(result.error || 'خطا در ارسال حدس', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در حدس حرف:', error);
        showNotification('خطا در ارتباط با سرور', 'error');
    } finally {
        if (!currentGame.completed) {
            document.getElementById('guessInput').disabled = false;
            document.getElementById('guessBtn').disabled = false;
        }
    }
}

// استفاده از راهنمایی
async function useHint() {
    if (!currentGame || isCreator || !currentGame.is_started || currentGame.completed) return;
    if (hintsUsed >= MAX_HINTS) {
        showNotification(`شما حداکثر ${toPersianNumber(MAX_HINTS)} راهنمایی را استفاده کرده‌اید.`, 'warning');
        document.getElementById('hintBtn').disabled = true;
        return;
    }
    
    document.getElementById('hintBtn').disabled = true;

    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                player_id: currentUser.telegram_id
            })
        });

        const result = await response.json();

        if (result.success) {
            hintsUsed++;
            document.getElementById('hintCount').textContent = toPersianNumber(MAX_HINTS - hintsUsed);
            
            showNotification(`حرف راهنما "${result.hint_letter}" پیدا شد! ${toPersianNumber(result.score_change)} امتیاز جریمه شدید.`, 'info');
            
            if (result.game_completed) {
                showNotification('تبریک! بازی با موفقیت به پایان رسید! 🎉', 'success');
            }
            
        } else {
            showNotification(result.error || 'خطا در استفاده از راهنمایی', 'error');
        }
        
    } catch (error) {
        console.error('❌ خطا در استفاده از راهنمایی:', error);
        showNotification('خطا در ارتباط با سرور', 'error');
    } finally {
        if (hintsUsed < MAX_HINTS && !currentGame.completed) {
            document.getElementById('hintBtn').disabled = false;
        }
    }
}


// --- توابع مقداردهی اولیه و مدیریت رویدادها ---

// به‌روزرسانی ساعت زنده
function updateLiveClock() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    
    const timeString = `${toPersianNumber(hours.toString().padStart(2, '0'))}:${toPersianNumber(minutes.toString().padStart(2, '0'))}:${toPersianNumber(seconds.toString().padStart(2, '0'))}`;
    document.getElementById('liveClock').textContent = timeString;
}

// مقداردهی اولیه در زمان بارگذاری صفحه
document.addEventListener('DOMContentLoaded', function() {
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    loadUserData();
    
    // رفرش خودکار بازی‌های فعال هر 30 ثانیه
    setInterval(() => {
        if (document.getElementById('active-games')?.classList.contains('active')) {
            loadActiveGames();
        }
    }, 30000);
    
    // اتصال Event Listeners به دکمه‌ها
    document.getElementById('guessBtn')?.addEventListener('click', submitGuess);
    document.getElementById('hintBtn')?.addEventListener('click', useHint);
    document.getElementById('startGameBtn')?.addEventListener('click', startGame);
    document.getElementById('joinGameBtn')?.addEventListener('click', joinGame);
    document.getElementById('createGameBtn')?.addEventListener('click', createGame);
    
    // مدیریت کلید Enter
    document.getElementById('guessInput')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') submitGuess();
    });
    document.getElementById('gameWord')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') createGame();
    });
    document.getElementById('gameCode')?.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') joinGame();
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

// مدیریت زمانی که کاربر صفحه را ترک می‌کند
window.addEventListener('beforeunload', function() {
    stopConnectionReporting();
});
