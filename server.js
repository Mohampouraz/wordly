<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wordly - بازی کلمات</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" integrity="sha512-SnH5WK+bZxgPHs44uWIX+LLMDJ/AHwE2YV5B8u/W0B0Fw/A5q2r9wF8yFvj5zF+D5s1f1f/d+N/A5q2r9wF8yFvj5zF+D5s1f1f/d+N/A5==" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    
    <style>
        body {
            font-family: 'Vazirmatn', sans-serif;
            font-weight: 500; /* وزن پیش‌فرض فونت */
        }
        .tab-active {
            @apply bg-white text-purple-700 border-b-4 border-purple-700 font-extrabold shadow-inner;
        }
        .tab-button {
            @apply py-3 px-2 text-center text-sm font-semibold text-gray-700 transition duration-300 ease-in-out hover:bg-gray-100;
        }
        .input-style {
            @apply mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 p-3 transition duration-150;
        }
        /* کلاس برای نمایش حروف حدس زده شده */
        .guessed-letter-item {
            @apply inline-block px-3 py-1 m-1 bg-gray-200 text-gray-800 rounded-full font-bold text-lg shadow-sm;
        }
    </style>
</head>
<body class="bg-gray-50 min-h-screen p-4">

    <div class="max-w-4xl mx-auto bg-white shadow-2xl rounded-2xl overflow-hidden">
        
        <header class="p-5 bg-purple-700 text-white text-center">
            <h1 class="text-3xl font-extrabold tracking-wide"><i class="fa-solid fa-gem text-yellow-300"></i> Wordly Game <i class="fa-solid fa-gem text-yellow-300"></i></h1>
            <p class="text-purple-300 mt-1">پنل کاربری و مدیریت بازی‌ها</p>
        </header>

        <nav class="flex border-b border-gray-200 bg-gray-50">
            <button id="tab-profile" class="tab-button flex-1 tab-active" onclick="showTab('profile')"><i class="fa-solid fa-user ml-1"></i> پروفایل</button>
            <button id="tab-create" class="tab-button flex-1" onclick="showTab('create')"><i class="fa-solid fa-plus-circle ml-1"></i> ایجاد بازی</button>
            <button id="tab-duel" class="tab-button flex-1" onclick="showTab('duel')"><i class="fa-solid fa-swords ml-1"></i> دو نفره</button>
            <button id="tab-active" class="tab-button flex-1" onclick="showTab('active')"><i class="fa-solid fa-fire-alt ml-1"></i> بازی‌ها</button>
        </nav>

        <div class="p-8">
            
            <div id="content-profile" class="tab-content">
                <h2 class="text-2xl font-bold mb-6 text-gray-800 border-b pb-2"><i class="fa-solid fa-user-circle ml-2 text-purple-600"></i> داشبورد پروفایل</h2>
                
                <div class="bg-gradient-to-br from-purple-50 to-indigo-100 border border-purple-200 p-8 rounded-xl shadow-lg">
                    
                    <div class="text-center mb-6">
                        <p class="text-xl text-gray-600">امتیاز کل:</p>
                        <p id="user-score" class="text-6xl font-extrabold text-purple-700 mt-1 animate-pulse">...</p>
                        <span id="user-level" class="inline-block bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full mt-2 shadow-md">درحال بارگذاری سطح...</span>
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-gray-700">
                        <div class="bg-white p-4 rounded-lg shadow-md"><p class="mb-2"><span class="font-bold text-purple-600">نام کاربری:</span> <span id="user-name" class="font-medium text-gray-900">...</span></p></div>
                        <div class="bg-white p-4 rounded-lg shadow-md"><p class="mb-2"><span class="font-bold text-purple-600">آیدی عددی:</span> <span id="user-id" class="text-sm text-gray-500">...</span></p></div>
                        <div class="bg-white p-4 rounded-lg shadow-md text-center col-span-1 md:col-span-2"><p class="mb-2 text-sm"><span class="font-bold text-purple-600">تاریخ و زمان:</span> <br><span id="current-date" class="text-lg font-mono text-gray-800 ml-2">...</span><span id="current-time" class="text-lg font-mono text-gray-800">...</span></p></div>
                    </div>
                    
                    <hr class="my-6 border-purple-200">
                    
                    <div class="text-center">
                        <button onclick="document.getElementById('edit-modal').classList.remove('hidden')" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition duration-300 transform hover:scale-105">
                            <i class="fa-solid fa-cogs ml-2"></i>ویرایش و تنظیمات
                        </button>
                    </div>
                </div>
            </div>

            <div id="content-create" class="tab-content hidden">
                <h2 class="text-2xl font-bold mb-6 text-gray-800"><i class="fa-solid fa-plus-circle ml-2 text-purple-600"></i> ایجاد بازی جدید (تعریف کلمه)</h2>
                <form id="create-game-form" class="p-6 bg-white border border-purple-100 rounded-xl shadow-xl space-y-6">
                    
                    <p class="text-gray-600 border-b pb-3 mb-4"><i class="fa-solid fa-keyboard ml-1"></i> کلمه و مشخصات آن را برای بازی جدید وارد کنید:</p>

                    <div>
                        <label for="word-input" class="block text-sm font-medium text-gray-700">کلمه انتخابی (فارسی، حداقل ۵ حرف):</label>
                        <input type="text" id="word-input" name="word" required minlength="5" pattern="[\u0600-\u06FF]+" placeholder="مثلاً: برنامه" class="input-style border-2 border-purple-300/50" />
                        <p class="text-xs text-red-500 mt-1 hidden" id="word-error">کلمه باید حداقل ۵ حرف و فقط فارسی باشد.</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label for="category-input" class="block text-sm font-medium text-gray-700">دسته‌بندی کلمه:</label>
                            <input type="text" id="category-input" name="category" required placeholder="مثلاً: فناوری، غذا" class="input-style" />
                        </div>
                        <div>
                            <label for="difficulty-select" class="block text-sm font-medium text-gray-700">سطح دشواری:</label>
                            <select id="difficulty-select" name="difficulty" required class="input-style">
                                <option value="آسان">آسان (۱ امتیاز راهنما)</option>
                                <option value="متوسط">متوسط (۲ امتیاز راهنما)</option>
                                <option value="سخت">سخت (۳ امتیاز راهنما)</option>
                            </select>
                        </div>
                    </div>

                    <button type="submit" class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 transform hover:scale-[1.01]">
                        <i class="fa-solid fa-gamepad ml-2"></i> ثبت کلمه و ایجاد بازی
                    </button>
                    
                    <p id="create-game-message" class="mt-4 text-center font-bold"></p>
                </form>
            </div>

            <div id="content-duel" class="tab-content hidden">
                <h2 class="text-2xl font-bold mb-6 text-gray-800"><i class="fa-solid fa-users ml-2 text-purple-600"></i> دعوت و رقابت دو نفره</h2>
                <div class="p-6 bg-yellow-50 border border-yellow-300 rounded-xl shadow-lg">
                    <p class="text-yellow-800 mb-4">لینک دعوت برای بازی دو نفره:</p>
                    <div class="relative">
                        <input type="text" readonly value="https://wordlygame.onrender.com/?invite=1234" class="w-full bg-white p-3 pr-12 rounded-lg border border-yellow-400 text-sm font-mono text-gray-700">
                        <button class="absolute left-2 top-1/2 transform -translate-y-1/2 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-bold py-1 px-2 rounded-lg" onclick="navigator.clipboard.writeText(document.querySelector('#content-duel input').value); alert('لینک کپی شد!');">
                            <i class="fa-solid fa-copy"></i> کپی
                        </button>
                    </div>
                </div>
            </div>

            <div id="content-active" class="tab-content hidden">
                <h2 class="text-2xl font-bold mb-6 text-gray-800"><i class="fa-solid fa-fire ml-2 text-purple-600"></i> بازی‌های فعال و قابل پیوستن</h2>
                <p class="text-gray-600 mb-4">بازی‌هایی که شما ساخته‌اید یا بازی‌هایی که می‌توانید به آن‌ها بپیوندید:</p>
                
                <div id="active-games-list" class="mt-4 space-y-4">
                    <div class="text-center text-gray-500 p-8 bg-gray-100 rounded-lg">
                         <i class="fa-solid fa-spinner fa-spin ml-2"></i> در حال بارگذاری لیست بازی‌ها...
                    </div>
                </div>
            </div>

        </div>
    </div>

    <div id="game-view-modal" class="hidden fixed inset-0 bg-gray-900 bg-opacity-80 flex items-center justify-center transition-opacity duration-300 z-50 p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 rtl transform scale-95 transition-transform duration-300 ease-out">
            
            <div class="flex justify-between items-center border-b pb-4 mb-5">
                <h3 class="text-2xl font-extrabold text-purple-700"><i class="fa-solid fa-play-circle ml-2"></i> وضعیت بازی <span id="modal-game-code" class="text-sm bg-purple-100 px-2 py-1 rounded-md"></span></h3>
                <button onclick="closeGameView()" class="text-gray-400 hover:text-gray-600 text-3xl font-light leading-none">&times;</button>
            </div>
            
            <div class="grid grid-cols-2 gap-4 mb-6 text-center border-b pb-4">
                <div class="bg-purple-50 p-3 rounded-lg shadow-inner">
                    <p class="text-sm text-gray-600">زمان باقیمانده:</p>
                    <p id="modal-timer" class="text-4xl font-mono font-bold text-red-600 mt-1"></p>
                </div>
                <div class="bg-purple-50 p-3 rounded-lg shadow-inner">
                    <p class="text-sm text-gray-600">فرصت حدس:</p>
                    <p id="modal-attempts-left" class="text-4xl font-extrabold text-purple-700 mt-1">--</p>
                </div>
            </div>

            <div class="mb-6 bg-gray-100 p-4 rounded-xl shadow-md">
                <p class="text-sm text-gray-600 mb-2">اطلاعات کلمه:</p>
                <div class="flex justify-around items-center text-sm font-bold">
                    <span id="modal-word-category" class="bg-blue-200 text-blue-800 px-3 py-1 rounded-full"><i class="fa-solid fa-tag ml-1"></i></span>
                    <span id="modal-word-difficulty" class="bg-red-200 text-red-800 px-3 py-1 rounded-full"><i class="fa-solid fa-star ml-1"></i></span>
                    <span id="modal-word-length" class="bg-green-200 text-green-800 px-3 py-1 rounded-full"><i class="fa-solid fa-ruler-horizontal ml-1"></i> طول: -</span>
                </div>
            </div>

            <div id="modal-word-display" class="text-center text-5xl font-mono tracking-widest mb-6 font-extrabold text-gray-800">
                </div>

            <div id="modal-player-actions" class="border p-4 rounded-xl shadow-inner bg-white">
                <form id="guess-form" class="flex gap-3 items-center mb-3">
                    <input type="text" id="guess-input" maxlength="1" required placeholder="حدس یک حرف" class="input-style p-3 text-center text-2xl font-bold flex-grow max-w-[100px]" style="caret-color: transparent;" oninput="this.value = this.value.replace(/[^ء-ی]/g, '')">
                    <button type="submit" class="flex-grow bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-4 rounded-lg transition duration-150">
                        <i class="fa-solid fa-location-arrow ml-2"></i> حدس بزن
                    </button>
                    <button type="button" id="hint-button" class="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-4 rounded-lg transition duration-150 whitespace-nowrap">
                        <i class="fa-solid fa-lightbulb ml-2"></i> راهنمایی (هزینه: <span id="hint-cost">1</span>)
                    </button>
                </form>
                <p id="guess-message" class="text-center font-semibold text-sm"></p>
                
                <div class="mt-4 border-t pt-3">
                    <p class="text-sm text-gray-600 mb-2">حروف حدس زده شده:</p>
                    <div id="guessed-letters-history">
                        <span class="text-gray-400">حرفی حدس زده نشده است.</span>
                    </div>
                </div>
            </div>
            
            <div id="modal-creator-status" class="hidden p-4 rounded-xl bg-blue-50 border border-blue-300 mt-4 text-center">
                <p class="font-bold text-blue-800"><i class="fa-solid fa-eye ml-2"></i> شما سازنده این بازی هستید.</p>
                <p class="text-sm text-blue-700 mt-1">بازی توسط <span id="modal-status-player-name" class="font-extrabold">--</span> در حال انجام است. شما نمی‌توانید حدس بزنید، اما می‌توانید وضعیت را مشاهده کنید.</p>
            </div>
            
        </div>
    </div>

    <div id="edit-modal" class="hidden fixed inset-0 bg-gray-900 bg-opacity-70 flex items-center justify-center transition-opacity duration-300 z-50 p-4">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 rtl transform scale-95 transition-transform duration-300 ease-out">
            <div class="flex justify-between items-center border-b pb-4 mb-5">
                <h3 class="text-xl font-bold text-purple-700"><i class="fa-solid fa-pencil-alt ml-2"></i> ویرایش اطلاعات کاربری</h3>
                <button onclick="document.getElementById('edit-modal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-3xl font-light leading-none">&times;</button>
            </div>
            
            <form>
                <div class="mb-6">
                    <label for="modal-name" class="block text-gray-700 text-sm font-bold mb-2">نام کاربری (قابل نمایش):</label>
                    <input type="text" id="modal-name" value="" class="shadow-inner appearance-none border border-gray-300 rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-purple-500" />
                    <p class="text-xs text-gray-500 mt-1">تغییر آیدی عددی امکان‌پذیر نیست.</p>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="button" onclick="document.getElementById('edit-modal').classList.add('hidden')" class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-5 rounded-full ml-3 transition duration-150"><i class="fa-solid fa-times ml-2"></i> لغو</button>
                    <button type="submit" class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-5 rounded-full shadow-md transition duration-150"><i class="fa-solid fa-save ml-2"></i> ذخیره</button>
                </div>
            </form>
        </div>
    </div>


    <script>
        let GLOBAL_USER_ID = null;
        let GLOBAL_FULL_NAME = 'کاربر میهمان';
        let currentInterval = null; // برای مدیریت تایمر بازی
        let currentGameCode = null; // کد بازی جاری

        // توابع کمکی
        function showTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            document.querySelectorAll('.tab-button').forEach(button => {
                button.classList.remove('tab-active');
            });

            document.getElementById(`content-${tabId}`).classList.remove('hidden');
            document.getElementById(`tab-${tabId}`).classList.add('tab-active');

            if (tabId === 'active') {
                loadActiveGames();
            }
        }

        function updateDateTime() {
            const now = new Date();
            const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
            // استفاده از RegExp برای حذف کاراکترهای نامرئی
            const currentTime = now.toLocaleTimeString('fa-IR', timeOptions).replace(/[\u200E\u200F]/g, ''); 
            document.getElementById('current-time').textContent = currentTime;

            const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
            const currentDate = now.toLocaleDateString('fa-IR', dateOptions).replace(/[\u200E\u200F]/g, '');
            document.getElementById('current-date').textContent = currentDate;
        }

        function getLevelFromScore(score) {
            if (score >= 1500) return 'استاد کلمات 👑';
            if (score >= 1200) return 'بازیکن حرفه‌ای ⭐';
            if (score >= 1000) return 'بازیکن تازه‌کار ✨';
            return 'بازیکن میهمان';
        }
        
        function toJalali(dateString) {
            const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
            return new Date(dateString).toLocaleDateString('fa-IR', options).replace(/[\u200E\u200F]/g, '');
        }
        
        function formatTime(seconds) {
            if (seconds < 0) seconds = 0;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
        }


        function loadUserDataAndScore() {
            try {
                if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
                    const userData = window.Telegram.WebApp.initDataUnsafe.user;
                    
                    if (userData) {
                        GLOBAL_USER_ID = userData.id.toString();
                        GLOBAL_FULL_NAME = `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || `کاربر تلگرام (${GLOBAL_USER_ID})`;
                        
                        document.getElementById('user-name').textContent = GLOBAL_FULL_NAME;
                        document.getElementById('user-id').textContent = GLOBAL_USER_ID;
                        document.getElementById('modal-name').value = GLOBAL_FULL_NAME;
                        
                        fetch(`/api/user/score?userId=${GLOBAL_USER_ID}&fullName=${encodeURIComponent(GLOBAL_FULL_NAME)}`)
                            .then(response => response.json())
                            .then(data => {
                                if (data.success) {
                                    const score = data.score;
                                    const localizedScore = score.toLocaleString('fa-IR');
                                    const level = getLevelFromScore(score);
                                    
                                    document.getElementById('user-score').textContent = localizedScore;
                                    document.getElementById('user-level').textContent = level;
                                    
                                    document.getElementById('user-level').classList.remove('bg-green-500', 'bg-yellow-500', 'bg-blue-500', 'bg-gray-500');
                                    if (score >= 1500) {
                                        document.getElementById('user-level').classList.add('bg-yellow-500');
                                    } else if (score >= 1000) {
                                        document.getElementById('user-level').classList.add('bg-blue-500');
                                    } else {
                                        document.getElementById('user-level').classList.add('bg-gray-500');
                                    }
                                } else {
                                    document.getElementById('user-score').textContent = 'خطا در بارگذاری';
                                }
                            })
                            .catch(error => {
                                console.error("Error fetching score from server:", error);
                                document.getElementById('user-score').textContent = 'خطا در ارتباط';
                            });

                    } else {
                        document.getElementById('user-name').textContent = 'بازیکن موقت';
                        document.getElementById('user-id').textContent = 'N/A';
                        document.getElementById('user-score').textContent = '1000'; 
                        document.getElementById('user-level').textContent = 'بازیکن میهمان';
                        document.getElementById('modal-name').value = 'بازیکن موقت';
                    }
                } else {
                    document.getElementById('user-name').textContent = 'بازیکن آزمایشی';
                    document.getElementById('user-id').textContent = '000000000';
                    document.getElementById('user-score').textContent = '1000';
                    document.getElementById('user-level').textContent = 'بازیکن میهمان';
                    document.getElementById('modal-name').value = 'بازیکن آزمایشی';
                }
            } catch (e) {
                console.error("Critical error in loadTelegramUserData:", e);
            }
        }
        
        // تابع ایجاد بازی
        document.getElementById('create-game-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const messageElement = document.getElementById('create-game-message');
            messageElement.textContent = 'در حال ثبت بازی...';
            messageElement.className = 'mt-4 text-center font-bold text-purple-600';

            if (!GLOBAL_USER_ID) {
                messageElement.textContent = 'خطا: اطلاعات کاربری تلگرام بارگذاری نشده است.';
                messageElement.className = 'mt-4 text-center font-bold text-red-600';
                return;
            }

            const word = form['word'].value.trim();
            const category = form['category'].value.trim();
            const difficulty = form['difficulty'].value;

            // اعتبارسنجی فارسی بودن و حداقل طول
            if (word.length < 5 || !/^[\u0600-\u06FF]+$/.test(word)) {
                document.getElementById('word-error').classList.remove('hidden');
                messageElement.textContent = '';
                return;
            }
            document.getElementById('word-error').classList.add('hidden');


            try {
                const response = await fetch('/api/game/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        word: word,
                        category: category,
                        difficulty: difficulty,
                        creatorId: GLOBAL_USER_ID
                    })
                });
                const data = await response.json();

                if (data.success) {
                    messageElement.textContent = `✅ بازی با کد ${data.gameCode} ایجاد شد! (کلمه: ${data.word} - سطح: ${data.difficulty})`;
                    messageElement.className = 'mt-4 text-center font-bold text-green-600 p-3 bg-green-50 rounded-lg border border-green-300';
                    form.reset(); 
                    loadActiveGames();
                } else {
                    messageElement.textContent = `❌ خطا در ایجاد بازی: ${data.message}`;
                    messageElement.className = 'mt-4 text-center font-bold text-red-600';
                }
            } catch (error) {
                messageElement.textContent = '❌ خطای شبکه: ارتباط با سرور برقرار نشد.';
                messageElement.className = 'mt-4 text-center font-bold text-red-600';
            }
        });
        
        // تابع اصلی برای مدیریت پیوستن/مشاهده بازی
        async function joinGameOrView(gameCode, isCreator, status) {
            currentGameCode = gameCode;
            let endpoint = '';
            let method = 'GET';
            let body = null;
            let successMessage = '';

            // اگر کاربر سازنده است، همیشه وضعیت را مشاهده می‌کند
            if (isCreator) {
                endpoint = `/api/game/status/${gameCode}?userId=${GLOBAL_USER_ID}`;
                successMessage = 'مشاهده وضعیت بازی';
                method = 'GET';
            } else if (status === 'waiting') {
                // بازیکن برای شروع بازی می‌پیوندد
                endpoint = '/api/game/join';
                method = 'POST';
                body = JSON.stringify({ gameCode, playerId: GLOBAL_USER_ID });
                successMessage = 'شما به بازی پیوستید!';
            } else if (status === 'active') {
                 // بازیکن فعال به مشاهده بازی می‌آید
                endpoint = `/api/game/status/${gameCode}?userId=${GLOBAL_USER_ID}`;
                successMessage = 'مشاهده وضعیت بازی';
                method = 'GET';
            } else {
                // بازی تمام شده
                endpoint = `/api/game/status/${gameCode}?userId=${GLOBAL_USER_ID}`;
                successMessage = 'مشاهده نتیجه بازی';
                method = 'GET';
            }

            try {
                const response = await fetch(endpoint, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: body
                });
                const data = await response.json();

                if (data.success) {
                    // اگر Join موفق بود (POST)، اطلاعات بازی در فیلد gameData نیست، مستقیماً از دیتا استفاده می‌کنیم
                    const gameData = data.gameData || data; 
                    
                    showGameView(gameData);
                    document.getElementById('game-view-modal').classList.remove('hidden');
                    document.getElementById('guess-message').textContent = successMessage;
                } else {
                    alert(`خطا: ${data.message}`);
                }
            } catch (error) {
                console.error("Error in joinGameOrView:", error);
                alert("خطای شبکه در ارتباط با سرور.");
            }
        }
        
        // تابع بازیابی وضعیت بازی از سرور (برای به‌روزرسانی Real-time)
        async function fetchGameStatus(gameCode) {
            try {
                const response = await fetch(`/api/game/status/${gameCode}?userId=${GLOBAL_USER_ID}`);
                const data = await response.json();
                
                if (data.success && data.gameData) {
                    showGameView(data.gameData);
                } else {
                    console.error("Failed to fetch real-time status.");
                    if (data.message) document.getElementById('guess-message').textContent = `خطا در به‌روزرسانی: ${data.message}`;
                }
            } catch (error) {
                console.error("Network error fetching status:", error);
            }
        }

        // تابع به‌روزرسانی نمای بازی (Modal)
        function showGameView(gameData) {
            const isCreator = gameData.isCreator;
            const isPlayer = gameData.isPlayer;
            const isActive = gameData.status === 'active';
            const isFinished = ['finished', 'lost', 'won'].includes(gameData.status);

            document.getElementById('modal-game-code').textContent = gameData.gameCode;
            document.getElementById('modal-word-category').innerHTML = `<i class="fa-solid fa-tag ml-1"></i> ${gameData.category}`;
            document.getElementById('modal-word-difficulty').innerHTML = `<i class="fa-solid fa-star ml-1"></i> ${gameData.difficulty}`;
            document.getElementById('modal-word-length').textContent = `طول: ${gameData.wordLength} حرف`;
            
            // نمایش کلمه (فاصله بین حروف برای زیبایی)
            document.getElementById('modal-word-display').textContent = gameData.wordToDisplay.split('').join(' ');
            
            // نمایش فرصت‌ها و راهنما
            document.getElementById('modal-attempts-left').textContent = gameData.attemptsLeft;
            document.getElementById('hint-cost').textContent = gameData.hintCost;
            
            // به‌روزرسانی تاریخچه حدس‌ها
            const historyEl = document.getElementById('guessed-letters-history');
            historyEl.innerHTML = gameData.guessedLetters.length > 0
                ? gameData.guessedLetters.map(l => `<span class="guessed-letter-item">${l}</span>`).join('')
                : `<span class="text-gray-400">حرفی حدس زده نشده است.</span>`;

            // منطق نمایش دکمه‌ها و فرم
            const playerActionsEl = document.getElementById('modal-player-actions');
            const creatorStatusEl = document.getElementById('modal-creator-status');
            const guessInput = document.getElementById('guess-input');
            const hintButton = document.getElementById('hint-button');

            if (isPlayer && isActive) {
                // اگر بازی‌کننده است و بازی فعال است
                playerActionsEl.classList.remove('hidden');
                creatorStatusEl.classList.add('hidden');
                guessInput.disabled = false;
                hintButton.disabled = false;
            } else if (isCreator || isFinished) {
                // اگر سازنده است یا بازی تمام شده است (فقط مشاهده)
                playerActionsEl.classList.add('hidden');
                creatorStatusEl.classList.remove('hidden');
                document.getElementById('modal-status-player-name').textContent = gameData.playerName || 'هنوز کسی نپیوسته است';
            } else {
                 // حالت‌های دیگر (مثلاً بازی‌کننده است اما بازی تمام شده)
                playerActionsEl.classList.add('hidden');
                creatorStatusEl.classList.add('hidden');
            }
            
            // مدیریت پیام وضعیت نهایی
            const msgEl = document.getElementById('guess-message');
            if (gameData.status === 'won') {
                msgEl.textContent = 'تبریک! کلمه حدس زده شد.';
                msgEl.className = 'mt-4 text-center font-extrabold text-green-600 text-lg';
            } else if (gameData.status === 'lost') {
                msgEl.textContent = 'متأسفانه باختید. فرصت‌ها یا زمان تمام شد.';
                msgEl.className = 'mt-4 text-center font-extrabold text-red-600 text-lg';
            } else if (isFinished) {
                msgEl.textContent = `بازی به اتمام رسید (وضعیت: ${gameData.status})`;
                msgEl.className = 'mt-4 text-center font-extrabold text-gray-600 text-lg';
            } else if (!isActive) {
                msgEl.textContent = 'منتظر پیوستن بازیکن...';
                msgEl.className = 'mt-4 text-center font-semibold text-gray-500';
            }


            // مدیریت تایمر
            if (currentInterval) clearInterval(currentInterval);

            if (isActive) {
                startTimer(gameData.timeRemainingSeconds, gameData.totalTimeSeconds);
            } else {
                // نمایش زمان کل یا پیام پایان
                document.getElementById('modal-timer').textContent = isFinished ? 'پایان' : formatTime(gameData.totalTimeSeconds);
                timerEl.classList.remove('animate-pulse', 'text-red-600', 'text-yellow-600', 'text-green-600');
            }
        }
        
        function closeGameView() {
            document.getElementById('game-view-modal').classList.add('hidden');
            if (currentInterval) clearInterval(currentInterval);
            currentInterval = null;
            currentGameCode = null;
            loadActiveGames(); // برای اطمینان از به‌روزرسانی وضعیت در صفحه اصلی
        }

        // تابع مدیریت Real-time Timer
        function startTimer(initialSeconds, totalSeconds) {
            let seconds = initialSeconds;
            const timerEl = document.getElementById('modal-timer');
            const totalTime = totalSeconds;

            timerEl.classList.remove('animate-pulse', 'text-red-600', 'text-yellow-600', 'text-green-600');
            
            // تعیین رنگ اولیه
            if (seconds > totalTime * 0.5) {
                timerEl.classList.add('text-green-600');
            } else if (seconds > totalTime * 0.2) {
                timerEl.classList.add('text-yellow-600');
            } else {
                timerEl.classList.add('text-red-600');
                timerEl.classList.add('animate-pulse'); // چشمک زدن در زمان کم
            }

            timerEl.textContent = formatTime(seconds);

            currentInterval = setInterval(() => {
                seconds--;
                timerEl.textContent = formatTime(seconds);

                // تغییر رنگ بر اساس زمان
                if (seconds === Math.round(totalTime * 0.5)) {
                    timerEl.classList.remove('text-green-600');
                    timerEl.classList.add('text-yellow-600');
                } else if (seconds === Math.round(totalTime * 0.2)) {
                    timerEl.classList.remove('text-yellow-600');
                    timerEl.classList.add('text-red-600');
                    timerEl.classList.add('animate-pulse');
                }

                if (seconds <= 0) {
                    clearInterval(currentInterval);
                    timerEl.textContent = "زمان تمام شد!";
                    // TODO: فراخوانی API برای اتمام بازی و ثبت باخت (در server.js تا حدودی مدیریت شد)
                }
                
                // در فواصل منظم (مثلاً هر 10 ثانیه) وضعیت را از سرور می‌گیریم تا به‌روز باشد
                if (seconds > 0 && seconds % 10 === 0 && currentGameCode) {
                    fetchGameStatus(currentGameCode);
                }

            }, 1000);
        }
        
        // تابع به‌روزرسانی لیست بازی‌های فعال
        async function loadActiveGames() {
            const listElement = document.getElementById('active-games-list');
            listElement.innerHTML = `<div class="text-center text-gray-500 p-8 bg-gray-100 rounded-lg"><i class="fa-solid fa-spinner fa-spin ml-2"></i> در حال بارگذاری...</div>`;

            if (!GLOBAL_USER_ID) {
                listElement.innerHTML = `<div class="text-center text-red-500 p-8 bg-red-50 rounded-lg border border-red-300"><i class="fa-solid fa-exclamation-triangle ml-2"></i> لطفا ابتدا اطلاعات کاربری را بارگذاری کنید.</div>`;
                return;
            }

            try {
                const response = await fetch(`/api/games/active?userId=${GLOBAL_USER_ID}`);
                const data = await response.json();

                if (data.success && data.games.length > 0) {
                    listElement.innerHTML = data.games.map(game => {
                        let statusColor, statusText, buttonText, buttonClass, details, action;
                        
                        if (game.is_creator) {
                            // منطق برای سازنده
                            statusColor = game.status === 'waiting' ? 'border-yellow-500' : 'border-purple-500';
                            statusText = game.status === 'waiting' ? 'منتظر بازیکن' : game.status === 'active' ? 'درحال بازی' : 'پایان یافته';
                            buttonText = game.status === 'waiting' ? `دعوت (کد: ${game.game_code})` : 'مشاهده وضعیت';
                            buttonClass = game.status === 'waiting' ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-purple-600 hover:bg-purple-700';
                            details = `<span class="font-bold text-gray-800">[${game.difficulty}] کلمه: ${game.word.split('').join(' ')}</span>`;
                            action = `joinGameOrView('${game.game_code}', true, '${game.status}')`;
                        } else {
                            // منطق برای بازیکن دیگر
                            statusColor = game.status === 'waiting' ? 'border-green-500' : 'border-gray-500';
                            statusText = game.status === 'waiting' ? `قابل پیوستن (سازنده: ${game.creator_name})` : `درحال انجام (سازنده: ${game.creator_name})`;
                            buttonText = game.status === 'waiting' ? 'پیوستن به بازی' : 'مشاهده بازی';
                            buttonClass = game.status === 'waiting' ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700';
                            details = `<span class="font-bold text-gray-800">[${game.difficulty}] بازی با کد: ${game.game_code}</span>`;
                            action = `joinGameOrView('${game.game_code}', false, '${game.status}')`;
                        }
                        
                        return `
                            <li class="bg-white p-4 rounded-xl shadow-md border-l-4 ${statusColor} flex justify-between items-center transform hover:shadow-lg transition-shadow duration-300">
                                <div>
                                    ${details}
                                    <p class="text-sm text-gray-500 mt-1">وضعیت: ${statusText} • شروع: ${toJalali(game.created_at)}</p>
                                </div>
                                <button onclick="${action}" class="${buttonClass} text-white font-bold py-2 px-4 rounded-full shadow-md text-sm whitespace-nowrap">
                                    <i class="fa-solid ${game.is_creator ? 'fa-eye' : 'fa-sign-in-alt'} ml-1"></i> ${buttonText}
                                </button>
                            </li>
                        `;
                    }).join('');
                } else {
                    listElement.innerHTML = `<div class="text-center text-gray-500 p-8 bg-gray-100 rounded-lg"><i class="fa-solid fa-info-circle ml-2"></i> هیچ بازی فعالی برای شما یا بازی قابل پیوستنی یافت نشد.</div>`;
                }
            } catch (error) {
                console.error("Error loading active games:", error);
                listElement.innerHTML = `<div class="text-center text-red-500 p-8 bg-red-50 rounded-lg border border-red-300"><i class="fa-solid fa-exclamation-triangle ml-2"></i> خطا در بارگذاری بازی‌ها.</div>`;
            }
        }
        
        // Listener برای فرم حدس
        document.getElementById('guess-form').addEventListener('submit', (e) => {
            e.preventDefault();
            alert("قابلیت حدس هنوز در سمت سرور پیاده‌سازی نشده است. لطفا منتظر به‌روزرسانی‌های بعدی باشید!");
            document.getElementById('guess-input').value = '';
        });
        
        // Listener برای دکمه راهنما
        document.getElementById('hint-button').addEventListener('click', () => {
             alert("قابلیت راهنما هنوز در سمت سرور پیاده‌سازی نشده است. لطفا منتظر به‌روزرسانی‌های بعدی باشید!");
        });


        document.addEventListener('DOMContentLoaded', () => {
            loadUserDataAndScore();
            showTab('profile');
            updateDateTime();
            setInterval(updateDateTime, 1000); 
        });

    </script>
</body>
</html>
