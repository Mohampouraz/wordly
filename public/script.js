// متغیرهای global
let currentUser = null;
let telegramApp = null;
let isTelegramEnvironment = false;

// تابع بررسی محیط تلگرام
function checkTelegramEnvironment() {
    console.log('🔍 Checking Telegram environment...');
    
    // روش ۱: بررسی وجود Telegram.WebApp
    if (window.Telegram && window.Telegram.WebApp) {
        console.log('✅ Telegram.WebApp found');
        telegramApp = window.Telegram.WebApp;
        return true;
    }
    
    // روش ۲: بررسی وجود window.TelegramWebApp (نسخه قدیمی)
    if (window.TelegramWebApp) {
        console.log('✅ TelegramWebApp found (legacy)');
        telegramApp = window.TelegramWebApp;
        return true;
    }
    
    // روش ۳: بررسی پارامترهای URL که تلگرام اضافه می‌کند
    const urlParams = new URLSearchParams(window.location.search);
    const tgWebAppData = urlParams.get('tgWebAppData');
    const tgWebAppVersion = urlParams.get('tgWebAppVersion');
    
    if (tgWebAppData || tgWebAppVersion) {
        console.log('✅ Telegram URL parameters found');
        return true;
    }
    
    console.log('❌ Not in Telegram environment');
    return false;
}

// تابع مقداردهی اولیه تلگرام
function initializeTelegramApp() {
    if (!telegramApp) {
        console.log('❌ Telegram app not available');
        return false;
    }
    
    try {
        // راه‌اندازی تلگرام وب اپ
        telegramApp.ready();
        telegramApp.expand();
        
        // تنظیمات ظاهری
        telegramApp.setHeaderColor('#667eea');
        telegramApp.setBackgroundColor('#667eea');
        telegramApp.enableClosingConfirmation();
        
        // تنظیم دکمه اصلی
        telegramApp.MainButton.setText('بازگشت به تلگرام');
        telegramApp.MainButton.show();
        telegramApp.MainButton.onClick(() => {
            telegramApp.close();
        });
        
        console.log('✅ Telegram Web App initialized successfully');
        console.log('Platform:', telegramApp.platform);
        console.log('Version:', telegramApp.version);
        console.log('Init Data:', telegramApp.initData);
        console.log('User Data:', telegramApp.initDataUnsafe?.user);
        
        return true;
    } catch (error) {
        console.error('❌ Error initializing Telegram app:', error);
        return false;
    }
}

// تابع دریافت اطلاعات کاربر از تلگرام
function getTelegramUserData() {
    if (!telegramApp) {
        console.log('❌ Telegram app not available for user data');
        return null;
    }
    
    try {
        // روش اصلی: از initDataUnsafe
        if (telegramApp.initDataUnsafe && telegramApp.initDataUnsafe.user) {
            const user = telegramApp.initDataUnsafe.user;
            console.log('📱 User data from Telegram initDataUnsafe:', user);
            
            return {
                telegram_id: user.id,
                full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                username: user.username || 'ندارد',
                language_code: user.language_code || 'fa',
                is_bot: user.is_bot || false
            };
        }
        
        // روش جایگزین: از initData (اگر initDataUnsafe کار نکرد)
        if (telegramApp.initData) {
            console.log('ℹ️ Trying to parse initData directly');
            // اینجا می‌توانید initData را پارس کنید
            // اما معمولاً initDataUnsafe کافی است
        }
        
        console.log('❌ No user data found in Telegram');
        return null;
        
    } catch (error) {
        console.error('💥 Error getting Telegram user data:', error);
        return null;
    }
}

// تابع همگام‌سازی با سرور
async function syncUserWithServer(userData) {
    try {
        console.log('🔄 Syncing user with server:', userData);
        
        const response = await fetch('/api/user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userData)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ User synced with server:', result);
            return result;
        } else {
            console.error('❌ Server returned error:', response.status);
            return null;
        }
    } catch (error) {
        console.error('💥 Error syncing with server:', error);
        return null;
    }
}

// تابع دریافت اطلاعات از سرور
async function fetchUserFromServer(telegramId) {
    try {
        console.log(`🔍 Fetching user ${telegramId} from server...`);
        
        const response = await fetch(`/api/user/${telegramId}`);
        
        if (response.ok) {
            const userData = await response.json();
            console.log('✅ User data from server:', userData);
            return userData;
        } else if (response.status === 404) {
            console.log('ℹ️ User not found on server');
            return null;
        } else {
            throw new Error(`Server error: ${response.status}`);
        }
    } catch (error) {
        console.error('💥 Error fetching from server:', error);
        return null;
    }
}

// تابع اصلی دریافت اطلاعات کاربر
async function getUserData() {
    console.log('👤 Starting user data retrieval...');
    
    // اول بررسی کن آیا در محیط تلگرام هستیم
    isTelegramEnvironment = checkTelegramEnvironment();
    
    if (isTelegramEnvironment) {
        console.log('🌐 In Telegram environment, getting Telegram user data');
        
        // مقداردهی اولیه تلگرام
        initializeTelegramApp();
        
        // اطلاعات کاربر از تلگرام بگیر
        const telegramUser = getTelegramUserData();
        
        if (telegramUser) {
            console.log('✅ Successfully got user data from Telegram');
            
            // نمایش وضعیت موفق
            showStatus('اتصال به تلگرام برقرار شد ✅', 'success');
            
            // همگام‌سازی با سرور
            const serverUser = await syncUserWithServer(telegramUser);
            
            // اگر سرور جواب داد از آن استفاده کن، در غیر این صورت از داده‌های تلگرام
            if (serverUser) {
                return serverUser;
            } else {
                console.log('⚠️ Using Telegram data (server sync failed)');
                return {
                    ...telegramUser,
                    first_seen: new Date().toISOString(),
                    last_seen: new Date().toISOString(),
                    game_score: 0,
                    is_active: true
                };
            }
        } else {
            console.log('❌ Failed to get user data from Telegram');
            showStatus('خطا در دریافت اطلاعات از تلگرام', 'error');
        }
    } else {
        console.log('🌐 Not in Telegram environment');
        showStatus('در حال اجرا در مرورگر معمولی', 'info');
    }
    
    // اگر به اینجا رسیدیم، یا در تلگرام نیستیم یا خطا داشتیم
    // سعی کن از سرور اطلاعات بگیر
    console.log('🔄 Trying to get data from server...');
    
    const urlParams = new URLSearchParams(window.location.search);
    const telegramId = urlParams.get('tgid') || urlParams.get('id');
    
    if (telegramId) {
        const serverUser = await fetchUserFromServer(telegramId);
        if (serverUser) {
            return serverUser;
        }
    }
    
    // اگر هیچ کدام کار نکرد، داده‌های تست نشان بده
    console.log('⚠️ Using test data');
    showStatus('در حال استفاده از داده‌های تست', 'warning');
    
    return {
        telegram_id: 123456789,
        full_name: 'کاربر تست (Not in Telegram)',
        username: 'test_user',
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        game_score: Math.floor(Math.random() * 1000),
        is_active: true
    };
}

// تابع نمایش وضعیت
function showStatus(message, type = 'info') {
    const statusCard = document.getElementById('telegramStatus');
    const statusText = document.getElementById('statusText');
    
    if (!statusCard || !statusText) return;
    
    // تنظیم رنگ بر اساس نوع
    const colors = {
        success: '#28a745',
        error: '#dc3545',
        warning: '#ffc107',
        info: '#17a2b8'
    };
    
    statusCard.style.borderLeftColor = colors[type] || colors.info;
    statusText.textContent = message;
    statusCard.classList.remove('hidden');
}

// تابع مخفی کردن وضعیت
function hideStatus() {
    const statusCard = document.getElementById('telegramStatus');
    if (statusCard) {
        statusCard.classList.add('hidden');
    }
}

// تابع نمایش نوتیفیکیشن
function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    
    if (!notification || !notificationText) return;
    
    const colors = {
        success: 'linear-gradient(135deg, #28a745, #20c997)',
        error: 'linear-gradient(135deg, #dc3545, #e83e8c)',
        warning: 'linear-gradient(135deg, #ffc107, #fd7e14)',
        info: 'linear-gradient(135deg, #17a2b8, #6f42c1)'
    };
    
    notification.style.background = colors[type] || colors.info;
    notificationText.textContent = message;
    
    notification.classList.remove('hidden');
    notification.classList.add('show');
    
    setTimeout(() => {
        hideNotification();
    }, duration);
}

function hideNotification() {
    const notification = document.getElementById('notification');
    if (notification) {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.classList.add('hidden');
        }, 300);
    }
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
        formatted: `${persian[2]} ${persianMonths[persian[1] - 1]} ${persian[0]}`
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

// تابع بارگذاری اطلاعات کاربر
async function loadUserData() {
    console.log('👤 Loading user data...');
    
    try {
        const userData = await getUserData();
        
        if (userData) {
            currentUser = userData;
            console.log('✅ User data loaded successfully:', userData);
            
            // نمایش اطلاعات در صفحه
            updateUserInterface(userData);
            
            // نمایش پیام خوش‌آمدگویی
            if (userData.telegram_id !== 123456789) {
                showNotification(`خوش آمدید ${userData.full_name}! 🎉`, 'success', 3000);
            } else {
                showNotification('در حال تست - در تلگرام اطلاعات واقعی نمایش داده می‌شود', 'info', 4000);
            }
            
        } else {
            throw new Error('No user data received');
        }
    } catch (error) {
        console.error('💥 Failed to load user data:', error);
        showNotification('خطا در دریافت اطلاعات کاربر', 'error');
    }
}

// تابع به‌روزرسانی رابط کاربری
function updateUserInterface(userData) {
    // اطلاعات اصلی
    document.getElementById('userId').textContent = userData.telegram_id;
    document.getElementById('fullName').textContent = userData.full_name;
    document.getElementById('username').textContent = userData.username;
    document.getElementById('gameScore').textContent = userData.game_score || 0;
    document.getElementById('userName').textContent = userData.full_name;
    
    // اطلاعات مودال
    document.getElementById('modalUserId').textContent = userData.telegram_id;
    document.getElementById('modalFullName').textContent = userData.full_name;
    document.getElementById('modalUsername').textContent = userData.username;
    document.getElementById('modalGameScore').textContent = userData.game_score || 0;
    
    // اطلاعات زمانی
    if (userData.first_seen) {
        const firstSeenDate = toPersianDate(userData.first_seen);
        const lastSeenDate = toPersianDate(userData.last_seen);
        
        document.getElementById('firstSeen').textContent = firstSeenDate.formatted;
        document.getElementById('lastSeen').textContent = lastSeenDate.formatted;
        document.getElementById('modalFirstSeen').textContent = formatDateTime(userData.first_seen);
        document.getElementById('modalLastSeen').textContent = formatDateTime(userData.last_seen);
    }
}

// تابع فرمت‌بندی تاریخ و ساعت
function formatDateTime(date) {
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    return new Date(date).toLocaleString('fa-IR', options);
}

// تابع دیباگ تلگرام
function checkTelegramData() {
    console.log('=== TELEGRAM DEBUG INFO ===');
    console.log('Window.Telegram:', window.Telegram);
    console.log('Window.TelegramWebApp:', window.TelegramWebApp);
    
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        console.log('Platform:', tg.platform);
        console.log('Version:', tg.version);
        console.log('Init Data:', tg.initData);
        console.log('Init Data Unsafe:', tg.initDataUnsafe);
        console.log('User:', tg.initDataUnsafe?.user);
    }
    
    // نمایش در نوتیفیکیشن
    if (telegramApp && telegramApp.initDataUnsafe?.user) {
        const user = telegramApp.initDataUnsafe.user;
        showNotification(
            `دیباگ: کاربر تلگرام پیدا شد! ID: ${user.id}, نام: ${user.first_name}`,
            'success',
            5000
        );
    } else {
        showNotification(
            'دیباگ: اطلاعات کاربر تلگرام یافت نشد',
            'error',
            5000
        );
    }
}

// بقیه توابع (loadStats, simulateGame, مودال‌ها و...) مثل قبل

// تابع بارگذاری آمار
async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        if (response.ok) {
            const stats = await response.json();
            document.getElementById('totalUsers').textContent = stats.total_users;
            document.getElementById('onlineUsers').textContent = stats.online_users;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// تابع شبیه‌سازی بازی
async function simulateGame() {
    if (!currentUser) {
        showNotification('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود', 'warning');
        return;
    }
    
    const newScore = Math.floor(Math.random() * 1000) + 100;
    
    try {
        const response = await fetch(`/api/user/${currentUser.telegram_id}/score`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ score: newScore })
        });
        
        if (response.ok) {
            const result = await response.json();
            currentUser.game_score = result.new_score;
            
            document.getElementById('gameScore').textContent = result.new_score;
            document.getElementById('modalGameScore').textContent = result.new_score;
            
            showNotification(`🎉 امتیاز شما به ${result.new_score} رسید!`, 'success');
        } else {
            throw new Error('Failed to update score');
        }
    } catch (error) {
        console.error('Error updating score:', error);
        showNotification('خطا در بروزرسانی امتیاز', 'error');
    }
}

// توابع مدیریت مودال
function showUserModal() {
    document.getElementById('userModal').style.display = 'block';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
}

function showTimeModal() {
    const now = new Date();
    const persianDate = toPersianDate(now);
    
    document.getElementById('modalPersianDate').textContent = persianDate.formatted;
    document.getElementById('modalCurrentTime').textContent = formatDateTime(now);
    
    document.getElementById('timeModal').style.display = 'block';
}

function closeTimeModal() {
    document.getElementById('timeModal').style.display = 'none';
}

// بستن مودال با کلیک خارج از آن
window.onclick = function(event) {
    const userModal = document.getElementById('userModal');
    const timeModal = document.getElementById('timeModal');
    
    if (event.target === userModal) closeUserModal();
    if (event.target === timeModal) closeTimeModal();
}

// تابع بروزرسانی دوره‌ای آمار
function startStatsUpdater() {
    setInterval(loadStats, 30000);
}

// مقداردهی اولیه
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Page loaded, initializing...');
    
    // شروع ساعت زنده
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    
    // بارگذاری اطلاعات کاربر
    await loadUserData();
    
    // بارگذاری آمار
    await loadStats();
    startStatsUpdater();
    
    // مقداردهی اولیه اطلاعات در مودال زمانی
    const now = new Date();
    const persianDate = toPersianDate(now);
    document.getElementById('modalPersianDate').textContent = persianDate.formatted;
    document.getElementById('modalCurrentTime').textContent = formatDateTime(now);
    
    console.log('✅ App initialized successfully');
});

// مدیریت کلیدهای صفحه‌کلید
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeUserModal();
        closeTimeModal();
    }
});
