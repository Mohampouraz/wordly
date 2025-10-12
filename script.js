// مدیریت لودینگ و انیمیشن‌ها
document.addEventListener('DOMContentLoaded', function() {
    const loading = document.getElementById('loading');
    const mainContent = document.getElementById('main-content');
    const startButton = document.getElementById('start-game');
    
    // شبیه‌سازی لودینگ ۳ ثانیه‌ای
    setTimeout(() => {
        // محو کردن لودینگ
        loading.style.opacity = '0';
        
        setTimeout(() => {
            loading.style.display = 'none';
            mainContent.classList.remove('hidden');
            
            // انیمیشن ظاهر شدن محتوا
            animateOnScroll();
        }, 500);
        
    }, 3000);
    
    // مدیریت کلیک دکمه شروع بازی
    startButton.addEventListener('click', function() {
        // انیمیشن کلیک
        this.style.transform = 'scale(0.95)';
        
        setTimeout(() => {
            this.style.transform = '';
            
            // در اینجا می‌توانید بازی را شروع کنید
            startGame();
            
        }, 150);
    });
    
    // انیمیشن اسکرول برای کارت‌ها
    function animateOnScroll() {
        const cards = document.querySelectorAll('.feature-card');
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, { threshold: 0.1 });
        
        cards.forEach(card => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(30px)';
            card.style.transition = 'all 0.6s ease';
            observer.observe(card);
        });
    }
    
    // شروع بازی
    function startGame() {
        // نمایش پیام شروع بازی
        showGameMessage('در حال انتقال به بازی...');
        
        // اگر در محیط تلگرام هستیم
        if (window.Telegram && Telegram.WebApp) {
            // ارسال داده به ربات تلگرام
            Telegram.WebApp.sendData(JSON.stringify({
                action: 'start_game',
                game_type: 'word_guess',
                timestamp: new Date().getTime()
            }));
        } else {
            // شبیه‌سازی برای محیط عادی
            setTimeout(() => {
                showGameMessage('بازی به زودی راه‌اندازی می‌شود! 🎮');
            }, 1000);
        }
    }
    
    // نمایش پیام بازی
    function showGameMessage(message) {
        // ایجاد overlay برای پیام
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;
        
        const messageBox = document.createElement('div');
        messageBox.style.cssText = `
            background: white;
            padding: 40px;
            border-radius: 20px;
            text-align: center;
            max-width: 400px;
            margin: 20px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        `;
        
        messageBox.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 20px; color: #667eea;">
                <i class="fas fa-gamepad"></i>
            </div>
            <h3 style="margin-bottom: 15px; color: #333; font-weight: 600;">${message}</h3>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: #667eea; color: white; border: none; padding: 12px 30px; 
                           border-radius: 25px; cursor: pointer; font-family: 'Vazirmatn'; margin-top: 20px;">
                متوجه شدم
            </button>
        `;
        
        overlay.appendChild(messageBox);
        document.body.appendChild(overlay);
    }
    
    // اضافه کردن افکت پارالکس به هیرو سکشن
    window.addEventListener('scroll', function() {
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero-section');
        if (hero) {
            hero.style.transform = `translateY(${scrolled * 0.5}px)`;
        }
    });
});
