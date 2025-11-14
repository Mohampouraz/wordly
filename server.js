// آدرس سرور بک‌اند
const BACKEND_URL = 'https://wordlygame.onrender.com';
let currentSessionId = null;
let eventSource = null;

// هنگامی که صفحه بارگذاری شد
document.addEventListener('DOMContentLoaded', async function() {
    showLoadingState();
    
    // بررسی اینکه در محیط تلگرام هستیم
    if (window.Telegram && Telegram.WebApp) {
        await initializeTelegramWebApp();
    } else {
        // حالت توسعه - نمایش داده‌های نمونه
        showDemoData();
    }
});

// نمایش حالت لودینگ
function showLoadingState() {
    document.getElementById('user-fullname').innerHTML = '<span class="loading"></span> در حال بارگذاری...';
    document.getElementById('user-id').textContent = '---';
    document.getElementById('user-fullname-value').textContent = '---';
}

// راه‌اندازی وب‌اپ تلگرام
async function initializeTelegramWebApp() {
    try {
        const tg = window.Telegram.WebApp;
        
        // گسترش وب‌اپ به صورت کامل
        tg.expand();
        
        // تغییر رنگ تم
        tg.setHeaderColor('#4A6CF7');
        tg.setBackgroundColor('#0F172A');
        
        // دریافت داده‌های init از تلگرام
        const initData = tg.initData;
        const user = tg.initDataUnsafe.user;
        
        if (user && initData) {
            // نمایش اطلاعات کاربر
            displayUserInfo(user);
            
            // ثبت کاربر در سرور
            await registerUser(initData);
            
            // اتصال به SSE برای دریافت نوتیفیکیشن‌ها
            connectToNotifications();
        } else {
            showError('خطا در دریافت اطلاعات کاربر از تلگرام');
            showDemoData();
        }
    } catch (error) {
        console.error('Telegram WebApp initialization error:', error);
        showError('خطا در راه‌اندازی وب‌اپ تلگرام');
        showDemoData();
    }
}

// نمایش اطلاعات کاربر
function displayUserInfo(user) {
    const fullName = `${user.first_name} ${user.last_name || ''}`.trim();
    document.getElementById('user-fullname').textContent = fullName;
    document.getElementById('user-id').textContent = user.id;
    document.getElementById('user-fullname-value').textContent = fullName;
}

// ثبت کاربر در سرور
async function registerUser(initData) {
    try {
        const response = await fetch(`${BACKEND_URL}/user-info`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ initData })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentSessionId = data.sessionId;
            console.log('✅ User registered successfully');
            
            // نمایش toast موفقیت
            showToast('خوش آمدید', 'اطلاعات شما با موفقیت ثبت شد', 'success');
        } else {
            showError(data.error || 'خطا در ثبت کاربر');
        }
    } catch (error) {
        console.error('❌ Registration error:', error);
        showError('خطا در ارتباط با سرور');
    }
}

// اتصال به سیستم نوتیفیکیشن
function connectToNotifications() {
    if (!currentSessionId) {
        console.log('⏳ Waiting for session ID...');
        setTimeout(connectToNotifications, 1000);
        return;
    }
    
    try {
        // بستن اتصال قبلی اگر وجود دارد
        if (eventSource) {
            eventSource.close();
        }
        
        eventSource = new EventSource(`${BACKEND_URL}/events?sessionId=${currentSessionId}`);
        
        eventSource.onopen = function() {
            console.log('✅ Connected to notifications server');
        };
        
        eventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                handleNotification(data);
            } catch (error) {
                console.error('Error parsing notification:', error);
            }
        };
        
        eventSource.onerror = function(error) {
            console.error('❌ SSE error:', error);
            
            // تلاش مجدد پس از 3 ثانیه
            setTimeout(connectToNotifications, 3000);
        };
        
    } catch (error) {
        console.error('Error connecting to notifications:', error);
        setTimeout(connectToNotifications, 3000);
    }
}

// مدیریت نوتیفیکیشن‌های دریافتی
function handleNotification(data) {
    console.log('📨 Received notification:', data.type);
    
    switch (data.type) {
        case 'connected':
            showToast('اتصال موفق', 'اتصال با سرور برقرار شد', 'success');
            break;
            
        case 'user_joined':
            if (data.user) {
                showToast('کاربر جدید', data.message, 'join');
                updateOnlineUsers();
            }
            break;
            
        case 'online_users':
            if (data.users) {
                displayOnlineUsers(data.users);
            }
            break;
            
        case 'keepalive':
            // نگه‌داری اتصال - هیچ کاری لازم نیست
            break;
            
        default:
            console.log('Unknown notification type:', data.type);
    }
}

// نمایش لیست کاربران آنلاین
function displayOnlineUsers(users) {
    const usersList = document.getElementById('users-list');
    const onlineCount = document.getElementById('online-count');
    
    if (!usersList || !onlineCount) return;
    
    onlineCount.textContent = users.length;
    
    if (users.length === 0) {
        usersList.innerHTML = '<div class="user-item" style="justify-content: center; color: var(--text-secondary);">هیچ کاربر آنلاینی وجود ندارد</div>';
        return;
    }
    
    usersList.innerHTML = users.map(user => `
        <div class="user-item">
            <div class="user-avatar">
                ${user.fullName ? user.fullName.charAt(0) : '?'}
            </div>
            <div class="user-details">
                <div class="user-name">${user.fullName || 'کاربر ناشناس'}</div>
                <div class="user-id">ID: ${user.id}</div>
            </div>
            <div class="user-status"></div>
        </div>
    `).join('');
}

// نمایش نوتیفیکیشن toast
function showToast(title, message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;
    
    const toastId = 'toast-' + Date.now();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.id = toastId;
    
    const icons = {
        'success': '✅',
        'error': '❌',
        'warning': '⚠️',
        'info': 'ℹ️',
        'join': '👋'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // حذف خودکار پس از 4 ثانیه
    setTimeout(() => {
        const toastElement = document.getElementById(toastId);
        if (toastElement) {
            toastElement.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toastElement.remove(), 300);
        }
    }, 4000);
}

// به‌روزرسانی لیست کاربران آنلاین
async function updateOnlineUsers() {
    try {
        const response = await fetch(`${BACKEND_URL}/online-users`);
        const data = await response.json();
        
        if (data.success && data.users) {
            displayOnlineUsers(data.users);
        }
    } catch (error) {
        console.error('Error fetching online users:', error);
    }
}

// نمایش خطا
function showError(message) {
    showToast('خطا', message, 'error');
}

// حالت توسعه - نمایش داده‌های نمونه
function showDemoData() {
    console.log('🔧 Running in demo mode');
    
    const demoUser = {
        id: 123456789,
        first_name: 'کاربر',
        last_name: 'نمونه'
    };
    
    displayUserInfo(demoUser);
    
    // نمایش کاربران نمونه
    const demoUsers = [
        { id: 111111111, fullName: 'علی محمدی' },
        { id: 222222222, fullName: 'فاطمه احمدی' },
        { id: 333333333, fullName: 'محمد رضایی' }
    ];
    
    displayOnlineUsers(demoUsers);
    
    showToast('حالت توسعه', 'شما در حال مشاهده نسخه دمو هستید', 'info');
}

// به‌روزرسانی دوره‌ای لیست کاربران آنلاین
setInterval(updateOnlineUsers, 30000);

// تست سلامت سرور
async function testServerHealth() {
    try {
        const response = await fetch(`${BACKEND_URL}/health`);
        const data = await response.json();
        console.log('Server health:', data);
    } catch (error) {
        console.error('Server health check failed:', error);
    }
}

// تست سلامت هر 60 ثانیه
setInterval(testServerHealth, 60000);
