// متغیرهای global
let currentUser = null;
let currentGame = null;
let gameTimer = null;
let timeLeft = 0;
let hintsUsed = 0;
let gameStartTime = null;

// تابع تبدیل اعداد به فارسی
function toPersianNumber(number) {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return number.toString().replace(/\d/g, digit => persianDigits[parseInt(digit)]);
}

// تابع مدیریت تب‌ها
function openTab(tabName) {
    // مخفی کردن همه تب‌ها
    const tabContents = document.getElementsByClassName('tab-content');
    for (let tab of tabContents) {
        tab.classList.remove('active');
    }

    // غیرفعال کردن همه دکمه‌های تب
    const tabButtons = document.getElementsByClassName('tab-btn');
    for (let button of tabButtons) {
        button.classList.remove('active');
    }

    // نمایش تب انتخاب شده
    document.getElementById(tabName).classList.add('active');
    event.currentTarget.classList.add('active');
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
            document.getElementById('totalUsers').textContent = toPersianNumber(stats.total_users);
            document.getElementById('activeUsers').textContent = toPersianNumber(stats.active_users);
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
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
                score: 0
            };

            showNotification('بازی با موفقیت ایجاد شد! 🎮', 'success');
            openGameModal();
        } else {
            showNotification('خطا در ایجاد بازی', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در ایجاد بازی:', error);
        showNotification('خطا در ایجاد بازی', 'error');
    }
}

// تابع پیوستن به بازی
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
            showNotification(`به بازی پیوستید! تعداد بازیکنان: ${toPersianNumber(result.players_count)}`, 'success');
            document.getElementById('gameCode').value = '';
        } else {
            showNotification('خطا در پیوستن به بازی', 'error');
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
}

// تابع مقداردهی اولیه بازی
function initializeGame() {
    if (!currentGame) return;

    // نمایش کلمه به صورت underline
    displayWord(currentGame.word);
    
    // تنظیم تایمر
    timeLeft = currentGame.time_limit;
    updateTimerDisplay();
    startGameTimer();
    
    // تنظیم تعداد حدس‌ها
    updateAttemptsDisplay();
    
    // بازنشانی تاریخچه حدس‌ها
    document.getElementById('guessHistory').innerHTML = '';
    
    // بازنشانی راهنمایی‌ها
    hintsUsed = 0;
    document.getElementById('hintCount').textContent = toPersianNumber(2);
    document.getElementById('hintBtn').disabled = false;
    
    // ذخیره زمان شروع
    gameStartTime = new Date();
}

// تابع نمایش کلمه
function displayWord(word) {
    const wordDisplay = document.getElementById('wordDisplay');
    wordDisplay.innerHTML = '';
    
    const letters = word.split('');
    letters.forEach(letter => {
        const letterElement = document.createElement('div');
        letterElement.className = 'letter';
        
        if (letter === ' ') {
            letterElement.classList.add('space');
            letterElement.innerHTML = '&nbsp;';
        } else {
            letterElement.textContent = '_';
        }
        
        wordDisplay.appendChild(letterElement);
    });
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
    document.getElementById('attempts').textContent = `${toPersianNumber(currentGame.attempts)}/${toPersianNumber(currentGame.max_attempts)}`;
}

// تابع ارسال حدس
async function submitGuess() {
    if (!currentGame || !currentUser) return;

    const guessInput = document.getElementById('guessInput');
    const guess = guessInput.value.trim().toUpperCase();

    if (!guess || guess.length !== currentGame.word.length) {
        showNotification(`حدس باید ${toPersianNumber(currentGame.word.length)} حرفی باشد`, 'error');
        return;
    }

    // محاسبه زمان سپری شده
    const timeSpent = Math.floor((new Date() - gameStartTime) / 1000);

    try {
        const response = await fetch(`/api/games/${currentGame.game_id}/guess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                player_id: currentUser.telegram_id,
                guess: guess,
                time_spent: timeSpent
            })
        });

        const result = await response.json();

        if (result.success) {
            currentGame.attempts++;
            currentGame.score += result.score;
            
            updateAttemptsDisplay();
            document.getElementById('currentScore').textContent = toPersianNumber(currentGame.score);
            
            // نمایش نتیجه حدس
            displayGuessResult(guess, result.result);
            
            // پاک کردن فیلد ورودی
            guessInput.value = '';
            
            if (result.game_completed) {
                endGame(true);
            } else if (currentGame.attempts >= currentGame.max_attempts) {
                endGame(false);
            }
        } else {
            showNotification('خطا در پردازش حدس', 'error');
        }
    } catch (error) {
        console.error('❌ خطا در ارسال حدس:', error);
        showNotification('خطا در ارسال حدس', 'error');
    }
}

// تابع نمایش نتیجه حدس
function displayGuessResult(guess, result) {
    const guessHistory = document.getElementById('guessHistory');
    const guessItem = document.createElement('div');
    guessItem.className = 'guess-item';
    
    const guessLetters = document.createElement('div');
    guessLetters.className = 'guess-letters';
    
    const guessArray = guess.split('');
    guessArray.forEach((letter, index) => {
        const letterElement = document.createElement('div');
        letterElement.className = `guess-letter ${result.positions[index]}`;
        letterElement.textContent = letter;
        guessLetters.appendChild(letterElement);
    });
    
    guessItem.appendChild(guessLetters);
    guessHistory.insertBefore(guessItem, guessHistory.firstChild);
}

// تابع استفاده از راهنمایی
function useHint() {
    if (!currentGame || hintsUsed >= 2) return;
    
    const wordLetters = currentGame.word.split('');
    const hiddenLetters = document.querySelectorAll('#wordDisplay .letter:not(.revealed):not(.space)');
    
    if (hiddenLetters.length === 0) return;
    
    // انتخاب یک حرف تصادفی برای نمایش
    const randomIndex = Math.floor(Math.random() * hiddenLetters.length);
    const letterIndex = Array.from(hiddenLetters).indexOf(hiddenLetters[randomIndex]);
    
    // نمایش حرف
    hiddenLetters[randomIndex].textContent = wordLetters[letterIndex];
    hiddenLetters[randomIndex].classList.add('revealed');
    
    // کسر امتیاز برای استفاده از راهنمایی
    currentGame.score -= 50;
    document.getElementById('currentScore').textContent = toPersianNumber(currentGame.score);
    
    hintsUsed++;
    document.getElementById('hintCount').textContent = toPersianNumber(2 - hintsUsed);
    
    if (hintsUsed >= 2) {
        document.getElementById('hintBtn').disabled = true;
    }
    
    showNotification('از راهنمایی استفاده شد (۵۰- امتیاز)', 'warning');
}

// تابع پایان بازی
function endGame(isWin) {
    stopGameTimer();
    
    if (isWin) {
        showNotification(`تبریک! شما برنده شدید! 🎉 امتیاز شما: ${toPersianNumber(currentGame.score)}`, 'success');
    } else {
        showNotification(`متاسفانه بازی را باختید. کلمه: ${currentGame.word}`, 'error');
    }
    
    // غیرفعال کردن دکمه‌ها
    document.getElementById('guessInput').disabled = true;
    document.getElementById('hintBtn').disabled = true;
    
    // نمایش تمام حروف
    const wordLetters = currentGame.word.split('');
    const letterElements = document.querySelectorAll('#wordDisplay .letter:not(.space)');
    letterElements.forEach((element, index) => {
        element.textContent = wordLetters[index];
        element.classList.add('revealed');
    });
}

// تابع نمایش نوتیفیکیشن
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? 'linear-gradient(135deg, #28a745, #20c997)' : 
                     type === 'error' ? 'linear-gradient(135deg, #dc3545, #e83e8c)' : 
                     type === 'warning' ? 'linear-gradient(135deg, #ffc107, #fd7e14)' : 
                     'linear-gradient(135deg, #17a2b8, #6f42c1)'};
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 1000;
        font-family: Vazirmatn, sans-serif;
        max-width: 400px;
    `;
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 
                           type === 'error' ? 'exclamation-circle' : 
                           type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
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

// مدیریت ارسال حدس با Enter
document.getElementById('guessInput')?.addEventListener('keypress', function(event) {
    if (event.key === 'Enter') {
        submitGuess();
    }
});

// بستن مودال با کلیک خارج از آن
window.onclick = function(event) {
    const gameModal = document.getElementById('gameModal');
    if (event.target === gameModal) {
        closeGameModal();
    }
}

// مقداردهی اولیه
document.addEventListener('DOMContentLoaded', function() {
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    loadUserData();
});
