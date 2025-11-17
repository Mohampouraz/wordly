// متغیرهای global
let currentUser = null;

// تابع اصلی دریافت اطلاعات کاربر
async function getUserData() {
    console.log('🔍 شروع دریافت اطلاعات کاربر...');
    
    let userData = null;

    // روش 1: دریافت از Telegram Web App
    if (window.Telegram && window.Telegram.WebApp) {
        console.log('📱 بررسی Telegram Web App...');
        const tg = window.Telegram.WebApp;
        
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            const tgUser = tg.initDataUnsafe.user;
            console.log('✅ کاربر از Telegram Web App پیدا شد:', tgUser);
            
            userData = {
                telegram_id: tgUser.id,
                full_name: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim(),
                username: tgUser.username || 'ندارد',
                language_code: tgUser.language_code || 'fa',
                data_source: 'telegram_web_app'
            };
            
            // راه‌اندازی تلگرام وب اپ
            tg.ready();
            tg.expand();
            tg.setHeaderColor('#667eea');
            tg.setBackgroundColor('#667eea');
        }
    }

    // روش 2: دریافت از پارامترهای URL
    if (!userData) {
        console.log('🔗 بررسی پارامترهای URL...');
        const urlParams = new URLSearchParams(window.location.search);
        const tgid = urlParams.get('tgid');
        
        if (tgid) {
            console.log('✅ آی‌دی کاربر از URL پیدا شد:', tgid);
            userData = {
                telegram_id: parseInt(tgid),
                data_source: 'url_parameter'
            };
        }
    }

    // روش 3: استفاده از داده‌های تست
    if (!userData) {
        console.log('⚠️ استفاده از داده‌های تست');
        userData = {
            telegram_id: 123456789,
            full_name: 'کاربر تست',
            username: 'test_user',
            data_source: 'test_data'
        };
    }

    // دریافت اطلاعات کامل از سرور
    if (userData.telegram_id) {
        console.log('🔄 دریافت اطلاعات کامل از سرور...');
        try {
            const serverUser = await fetchUserFromServer(userData.telegram_id);
            if (serverUser) {
                userData = {
                    ...userData,
                    ...serverUser
                };
                console.log('✅ اطلاعات کامل از سرور دریافت شد');
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
    console.log('👤 در حال بارگذاری اطلاعات کاربر...');
    
    try {
        const userData = await getUserData();
        
        if (userData) {
            currentUser = userData;
            console.log('✅ اطلاعات کاربر با موفقیت بارگذاری شد');
            updateUserInterface(userData);
            loadStats();
            
            if (userData.data_source === 'telegram_web_app') {
                showWelcomeMessage(`خوش آمدید ${userData.full_name}! 🎉`);
            }
        }
    } catch (error) {
        console.error('💥 خطا در بارگذاری اطلاعات کاربر:', error);
    }
}

// تابع به‌روزرسانی رابط کاربری
function updateUserInterface(userData) {
    document.getElementById('userId').textContent = userData.telegram_id;
    document.getElementById('fullName').textContent = userData.full_name || '---';
    document.getElementById('username').textContent = userData.username || '---';
    document.getElementById('gameScore').textContent = userData.game_score || 0;
    document.getElementById('userName').textContent = userData.full_name || 'کاربر';

    document.getElementById('modalUserId').textContent = userData.telegram_id;
    document.getElementById('modalFullName').textContent = userData.full_name || '---';
    document.getElementById('modalUsername').textContent = userData.username || '---';
    document.getElementById('modalGameScore').textContent = userData.game_score || 0;

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
            document.getElementById('totalUsers').textContent = stats.total_users;
            document.getElementById('activeUsers').textContent = stats.active_users;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// تابع نمایش پیام خوش‌آمدگویی
function showWelcomeMessage(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #28a745, #20c997);
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 1000;
        font-family: Vazir, sans-serif;
    `;
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-check-circle"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
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

// تابع شبیه‌سازی بازی
async function simulateGame() {
    if (!currentUser) {
        alert('لطفاً منتظر بمانید اطلاعات کاربر بارگذاری شود');
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
            
            showWelcomeMessage(`🎉 امتیاز شما به ${result.new_score} رسید!`);
        }
    } catch (error) {
        console.error('Error updating score:', error);
    }
}

// تابع بروزرسانی اطلاعات
function refreshUserData() {
    showWelcomeMessage('در حال بروزرسانی اطلاعات...');
    loadUserData();
}

// توابع مدیریت مودال
function showUserModal() {
    document.getElementById('userModal').style.display = 'block';
}

function closeUserModal() {
    document.getElementById('userModal').style.display = 'none';
}

window.onclick = function(event) {
    const userModal = document.getElementById('userModal');
    if (event.target === userModal) closeUserModal();
}

// مقداردهی اولیه
document.addEventListener('DOMContentLoaded', function() {
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    loadUserData();
});
