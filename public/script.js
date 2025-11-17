// متغیرهای全局
let currentUser = null;
let telegramApp = null;

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

// تابع تبدیل تاریخ شمسی
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

// تابع به‌روزرسانی ساعت زنده
function updateLiveClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('fa-IR');
    document.getElementById('currentTime').textContent = timeString;
    
    const persianDate = toPersianDate(now);
    document.getElementById('persianDate').textContent = persianDate.formatted;
}

// تابع نمایش نوتیفیکیشن
function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    
    // تنظیم رنگ بر اساس نوع
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
    
    // پنهان کردن خودکار
    setTimeout(() => {
        hideNotification();
    }, duration);
}

function hideNotification() {
    const notification = document.getElementById('notification');
    notification.classList.remove('show');
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 300);
}

// تابع initialize تلگرام
function initializeTelegramApp() {
    if (window.Telegram && window.Telegram.WebApp) {
        telegramApp = window.Telegram.WebApp;
        
        // تنظیمات اولیه تلگرام وب اپ
        telegramApp.expand();
        telegramApp.enableClosingConfirmation();
        telegramApp.setHeaderColor('#667eea');
        telegramApp.setBackgroundColor('#667eea');
        
        console.log('✅ Telegram Web App initialized');
        console.log('Platform:', telegramApp.platform);
        console.log('Init Data:', telegramApp.initData);
        console.log('User Data:', telegramApp.initDataUnsafe.user);
        
        // نمایش دکمه اصلی
        telegramApp.MainButton.setText('بازگشت به تلگرام');
        telegramApp.MainButton.show();
        telegramApp.MainButton.onClick(() => {
            telegramApp.close();
        });
        
        return true;
    }
    return false;
}

// تابع دریافت اطلاعات کاربر
async function getUserData() {
    try {
        console.log('🔍 Getting user data...');
        
        // اگر در محیط تلگرام هستیم
        if (telegramApp && telegramApp.initDataUnsafe.user) {
            const user = telegramApp.initDataUnsafe.user;
            console.log('✅ User data from Telegram:', user);
            
            const userData = {
                telegram_id: user.id,
                full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                username: user.username || 'ندارد',
                language_code: user.language_code || 'fa'
            };
            
            // اطلاعات کاربر را به سرور هم گزارش بده
            await syncUserWithServer(userData);
            return userData;
        } else {
            console.log('❌ Not in Telegram environment, using server data');
            return await fetchUserFromServer();
        }
    } catch (error) {
        console.error('Error in getUserData:', error);
        return await fetchUserFromServer();
    }
}

// تابع همگام‌سازی کاربر با سرور
async function syncUserWithServer(userData) {
    try {
        const response = await fetch('/api/user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(userData)
        });
        
        if (!response.ok) {
            throw new Error('Failed to sync user with server');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error syncing user:', error);
    }
}

// تابع دریافت اطلاعات کاربر از سرور
async function fetchUserFromServer() {
    try {
        console.log('🔍 Fetching user data from server...');
        
        let telegramId = null;
        
        // اگر در تلگرام هستیم، از initData استفاده می‌کنیم
        if (telegramApp && telegramApp.initDataUnsafe.user) {
            telegramId = telegramApp.initDataUnsafe.user.id;
        } else {
            // برای محیط تست
            telegramId = '123456789';
        }
        
        const response = await fetch(`/api/user/${telegramId}`);
        if (response.ok) {
            const userData = await response.json();
            console.log('✅ User data from server:', userData);
            return userData;
        } else {
            throw new Error('Failed to fetch user data');
        }
    } catch (error) {
        console.error('Error fetching from server:', error);
        // داده‌های نمونه برای تست
        return {
            telegram_id: 123456789,
            full_name: 'کاربر تست',
            username: 'test_user',
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
            game_score: 0
        };
    }
}

// تابع بارگذاری اطلاعات کاربر
async function loadUserData() {
    console.log('👤 Loading user data...');
    
    try {
        const userData = await getUserData();
        
        if (userData) {
            currentUser = userData;
            console.log('✅ User data loaded:', userData);
            
            // نمایش اطلاعات در کارت اصلی
            document.getElementById('userId').textContent = userData.telegram_id;
            document.getElementById('fullName').textContent = userData.full_name;
            document.getElementById('username').textContent = userData.username;
            document.getElementById('gameScore').textContent = userData.game_score || 0;
            document.getElementById('userName').textContent = userData.full_name;
            
            // نمایش اطلاعات در مودال‌ها
            document.getElementById('modalUserId').textContent = userData.telegram_id;
            document.getElementById('modalFullName').textContent = userData.full_name;
            document.getElementById('modalUsername').textContent = userData.username;
            document.getElementById('modalGameScore').textContent = userData.game_score || 0;
            
            // نمایش اطلاعات زمانی
            if (userData.first_seen) {
                const firstSeenDate = toPersianDate(userData.first_seen);
                const lastSeenDate = toPersianDate(userData.last_seen);
                
                document.getElementById('firstSeen').textContent = firstSeenDate.formatted;
                document.getElementById('lastSeen').textContent = lastSeenDate.formatted;
                document.getElementById('modalFirstSeen').textContent = formatDateTime(userData.first_seen);
                document.getElementById('modalLastSeen').textContent = formatDateTime(userData.last_seen);
            }
            
            // نمایش نوتیفیکیشن خوش‌آمدگویی
            showNotification(`خوش آمدید ${userData.full_name}! 🎉`, 'success', 3000);
            
        } else {
            throw new Error('No user data received');
        }
    } catch (error) {
        console.error('❌ Failed to load user data:', error);
        showNotification('خطا در دریافت اطلاعات کاربر', 'error');
    }
}

// تابع بارگذاری آمار ربات
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
    
    // تولید امتیاز تصادفی
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
            
            // به‌روزرسانی نمایش
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
    setInterval(loadStats, 30000); // هر 30 ثانیه
}

// مقداردهی اولیه هنگام لود صفحه
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Page loaded, initializing...');
    
    // راه‌اندازی تلگرام وب اپ
    initializeTelegramApp();
    
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
