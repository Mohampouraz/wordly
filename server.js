// تنظیمات
const CONFIG = {
    backendUrl: 'https://wordlygame.onrender.com'
};

// وضعیت اپلیکیشن
const AppState = {
    tg: null,
    userData: null,
    socket: null
};

// المنت‌های DOM
const elements = {
    preloader: document.getElementById('preloader'),
    connectionStatus: document.getElementById('connectionStatus'),
    
    // اطلاعات کاربر
    userFullName: document.getElementById('userFullName'),
    userUsername: document.getElementById('userUsername'),
    userId: document.getElementById('userId'),
    userFirstName: document.getElementById('userFirstName'),
    userLastName: document.getElementById('userLastName')
};

// تابع دریافت پارامترهای URL
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        tgWebAppStartParam: params.get('tgWebAppStartParam'),
        userId: params.get('userId')
    };
}

// تابع اصلی راه‌اندازی Telegram Web App
function initializeTelegramWebApp() {
    try {
        // بررسی آیا در محیط Telegram هستیم
        if (window.Telegram && Telegram.WebApp) {
            AppState.tg = Telegram.WebApp;
            
            // گسترش صفحه به fullscreen
            AppState.tg.expand();
            
            // دریافت اطلاعات کاربر از Telegram
            const user = AppState.tg.initDataUnsafe?.user;
            
            if (user) {
                AppState.userData = user;
                updateUserInterface(user);
                connectWebSocket();
                
                console.log('✅ اطلاعات کاربر از Telegram دریافت شد:', user);
                
                // مخفی کردن preloader
                setTimeout(() => {
                    elements.preloader.classList.add('hidden');
                }, 1000);
                
            } else {
                throw new Error('اطلاعات کاربر در دسترس نیست');
            }
            
        } else {
            // اگر در محیط معمولی مرورگر هستیم
            const urlParams = getUrlParams();
            if (urlParams.tgWebAppStartParam) {
                // استفاده از پارامتر Telegram
                simulateUserData(urlParams.tgWebAppStartParam);
            } else {
                // حالت توسعه
                simulateUserData();
            }
        }
        
    } catch (error) {
        console.error('خطا در راه‌اندازی:', error);
        simulateUserData();
    }
}

// تابع به‌روزرسانی رابط کاربری
function updateUserInterface(user) {
    elements.userFullName.textContent = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    elements.userUsername.textContent = user.username ? `@${user.username}` : 'بدون نام کاربری';
    elements.userId.textContent = user.id || '---';
    elements.userFirstName.textContent = user.first_name || '---';
    elements.userLastName.textContent = user.last_name || '---';
    
    elements.connectionStatus.innerHTML = '<span class="status-dot"></span> متصل به تلگرام';
    elements.connectionStatus.classList.add('connected');
}

// تابع شبیه‌سازی داده (برای توسعه)
function simulateUserData(userId = null) {
    const demoUser = {
        id: userId || Math.floor(100000000 + Math.random() * 900000000),
        first_name: 'کاربر',
        last_name: 'نمونه',
        username: 'demo_user'
    };
    
    AppState.userData = demoUser;
    updateUserInterface(demoUser);
    connectWebSocket();
    
    setTimeout(() => {
        elements.preloader.classList.add('hidden');
    }, 1500);
}

// تابع اتصال به WebSocket
function connectWebSocket() {
    try {
        AppState.socket = io(CONFIG.backendUrl);

        AppState.socket.on('connect', () => {
            console.log('✅ متصل به سرور');
            
            if (AppState.userData) {
                AppState.socket.emit('user_connected', AppState.userData);
            }
        });

        AppState.socket.on('user_data', (data) => {
            if (data.success) {
                console.log('✅ اطلاعات کاربر در سرور ذخیره شد');
            }
        });

    } catch (error) {
        console.error('❌ خطا در اتصال به سرور:', error);
    }
}

// راه‌اندازی برنامه
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 راه‌اندازی Telegram Web App...');
    initializeTelegramWebApp();
});
