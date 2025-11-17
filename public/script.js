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

// تابع تبدیل تاریخ شمسی (منبع: https://github.com/ali-master/jalali-js)
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
    
    // به‌روزرسانی تاریخ شمسی
    const persianDate = toPersianDate(now);
    document.getElementById('persianDate').textContent = persianDate.formatted;
}

// تابع دریافت اطلاعات کاربر از تلگرام
async function getUserData() {
    try {
        // اگر در محیط تلگرام هستیم، از Telegram Web App API استفاده می‌کنیم
        if (window.Telegram && Telegram.WebApp) {
            const tg = Telegram.WebApp;
            const user = tg.initDataUnsafe.user;
            
            if (user) {
                return {
                    telegram_id: user.id,
                    full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                    username: user.username || 'ندارد'
                };
            }
        }
        
        // اگر در محیط عادی مرورگر هستیم، از API سرور استفاده می‌کنیم
        // برای تست: یک کاربر نمونه برگردان
        return {
            telegram_id: 123456789,
            full_name: 'کاربر نمونه',
            username: 'sample_user'
        };
        
    } catch (error) {
        console.error('Error getting user data:', error);
        return null;
    }
}

// تابع بارگذاری اطلاعات کاربر
async function loadUserData() {
    const userData = await getUserData();
    
    if (userData) {
        // نمایش اطلاعات در کارت اصلی
        document.getElementById('userId').textContent = userData.telegram_id;
        document.getElementById('fullName').textContent = userData.full_name;
        document.getElementById('username').textContent = userData.username;
        document.getElementById('userName').textContent = userData.full_name;
        
        // نمایش اطلاعات در مودال‌ها
        document.getElementById('modalUserId').textContent = userData.telegram_id;
        document.getElementById('modalFullName').textContent = userData.full_name;
        document.getElementById('modalUsername').textContent = userData.username;
        
        // دریافت اطلاعات کامل از سرور
        try {
            const response = await fetch(`/api/user/${userData.telegram_id}`);
            if (response.ok) {
                const userInfo = await response.json();
                
                const firstSeenDate = toPersianDate(userInfo.first_seen);
                const lastSeenDate = toPersianDate(userInfo.last_seen);
                
                // نمایش اطلاعات زمانی
                document.getElementById('firstSeen').textContent = firstSeenDate.formatted;
                document.getElementById('lastSeen').textContent = lastSeenDate.formatted;
                
                // نمایش در مودال‌ها
                document.getElementById('modalFirstSeen').textContent = formatDateTime(userInfo.first_seen);
                document.getElementById('modalLastSeen').textContent = formatDateTime(userInfo.last_seen);
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
            
            // مقادیر پیش‌فرض برای تست
            const now = new Date();
            const persianNow = toPersianDate(now);
            
            document.getElementById('firstSeen').textContent = persianNow.formatted;
            document.getElementById('lastSeen').textContent = persianNow.formatted;
            document.getElementById('modalFirstSeen').textContent = formatDateTime(now);
            document.getElementById('modalLastSeen').textContent = formatDateTime(now);
        }
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
    // به‌روزرسانی اطلاعات زمانی در مودال
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
    
    if (event.target === userModal) {
        closeUserModal();
    }
    if (event.target === timeModal) {
        closeTimeModal();
    }
}

// مقداردهی اولیه هنگام لود صفحه
document.addEventListener('DOMContentLoaded', function() {
    // شروع ساعت زنده
    updateLiveClock();
    setInterval(updateLiveClock, 1000);
    
    // بارگذاری اطلاعات کاربر
    loadUserData();
    
    // مقداردهی اولیه اطلاعات در مودال زمانی
    const now = new Date();
    const persianDate = toPersianDate(now);
    document.getElementById('modalPersianDate').textContent = persianDate.formatted;
    document.getElementById('modalCurrentTime').textContent = formatDateTime(now);
    
    // راه‌اندازی تلگرام وب اپ
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.ready();
        Telegram.WebApp.expand(); // باز کردن کامل صفحه
    }
});
