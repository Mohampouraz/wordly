<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>بازی کلمات - ربات تلگرام</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/dist/font/vazirmatn-font-face.css" rel="stylesheet" type="text/css" />
    
    <style>
        /* اعمال فونت Vazirmatn به صورت سراسری */
        body {
            font-family: 'Vazirmatn', sans-serif;
        }
        /* کلاس برای فعال کردن زبانه (Tab) */
        .tab-active {
            @apply bg-white text-indigo-600 border-b-4 border-indigo-600 font-bold shadow-inner;
        }
        .tab-button {
            /* استایل پایه برای دکمه‌ها */
            @apply py-3 px-2 text-center text-sm font-medium text-gray-700 transition duration-300 ease-in-out hover:bg-gray-100;
        }
    </style>
</head>
<body class="bg-gray-50 min-h-screen p-4">

    <div class="max-w-4xl mx-auto bg-white shadow-2xl rounded-2xl overflow-hidden transform hover:shadow-indigo-300/50 transition-all duration-500">
        
        <header class="p-5 bg-indigo-600 text-white text-center">
            <h1 class="text-3xl font-extrabold tracking-wide">💎 Wordly Game 💎</h1>
            <p class="text-indigo-200 mt-1">پنل کاربری و مدیریت بازی‌ها</p>
        </header>

        <nav class="flex border-b border-gray-200 bg-gray-50">
            <button id="tab-profile" class="tab-button flex-1 tab-active" onclick="showTab('profile')">
                <span class="inline-block ml-1">👤</span> اطلاعات کاربری
            </button>
            <button id="tab-create" class="tab-button flex-1" onclick="showTab('create')">
                <span class="inline-block ml-1">➕</span> ایجاد بازی
            </button>
            <button id="tab-duel" class="tab-button flex-1" onclick="showTab('duel')">
                <span class="inline-block ml-1">⚔️</span> بازی دو نفره
            </button>
            <button id="tab-active" class="tab-button flex-1" onclick="showTab('active')">
                <span class="inline-block ml-1">🔥</span> بازی‌های فعال
            </button>
        </nav>

        <div class="p-8">
            
            <div id="content-profile" class="tab-content">
                <h2 class="text-2xl font-bold mb-6 text-gray-800 border-b pb-2">👤 داشبورد پروفایل</h2>
                
                <div class="bg-gradient-to-br from-indigo-50 to-purple-100 border border-indigo-200 p-8 rounded-xl shadow-lg transform hover:scale-[1.01] transition-transform duration-300">
                    
                    <div class="text-center mb-6">
                        <p class="text-xl text-gray-600">امتیاز کل:</p>
                        <p id="user-score" class="text-6xl font-extrabold text-indigo-700 mt-1 animate-pulse">1250</p>
                        <span class="inline-block bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full mt-2 shadow-md">سطح: بازیکن حرفه‌ای</span>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-gray-700">
                        
                        <div class="bg-white p-4 rounded-lg shadow-md">
                            <p class="mb-2"><span class="font-bold text-indigo-600">نام کاربری:</span> <span id="user-name" class="font-medium">ابوالفضل رضایی</span></p>
                            <p class="mb-2"><span class="font-bold text-indigo-600">آیدی عددی:</span> <span id="user-id" class="text-sm text-gray-500">123456789</span></p>
                        </div>
                        
                        <div class="bg-white p-4 rounded-lg shadow-md text-center">
                            <p class="mb-2 text-sm"><span class="font-bold text-indigo-600">تاریخ امروز (شمسی):</span> <br><span id="current-date" class="text-lg font-mono text-gray-800">۱۴۰۴/۰۸/۳۰</span></p>
                            <p class="mb-0 text-sm"><span class="font-bold text-indigo-600">زمان لحظه‌ای:</span> <br><span id="current-time" class="text-lg font-mono text-gray-800">۰۳:۲۲:۴۷</span></p>
                        </div>

                    </div>

                    <hr class="my-6 border-indigo-200">
                    
                    <div class="text-center">
                        <button onclick="document.getElementById('edit-modal').classList.remove('hidden')" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-full shadow-lg transition duration-300 transform hover:scale-105">
                            ویرایش و تنظیمات پروفایل
                        </button>
                    </div>
                </div>
            </div>

            <div id="content-create" class="tab-content hidden">
                <h2 class="text-2xl font-bold mb-6 text-gray-800">➕ ایجاد بازی جدید (تک‌نفره)</h2>
                <div class="bg-gray-100 p-6 rounded-xl shadow-inner">
                    <p class="text-gray-600 mb-4">تنظیمات مورد نظر برای شروع یک دور بازی جدید را انتخاب کنید:</p>
                    <div class="space-y-4">
                        <label class="block">
                            <span class="text-gray-700">سطح دشواری:</span>
                            <select class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 p-2">
                                <option>آسان (۵ حرفی)</option>
                                <option>متوسط (۶ حرفی)</option>
                                <option>سخت (کلمات کمتر شناخته شده)</option>
                            </select>
                        </label>
                    </div>
                    <button class="mt-6 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 transform hover:scale-[1.01]">
                        شروع بازی و حدس کلمه!
                    </button>
                </div>
            </div>

            <div id="content-duel" class="tab-content hidden">
                <h2 class="text-2xl font-bold mb-6 text-gray-800">⚔️ دعوت و رقابت دو نفره</h2>
                <div class="p-6 bg-yellow-50 border border-yellow-300 rounded-xl shadow-lg">
                    <p class="text-yellow-800 mb-4">از این لینک برای دعوت دوستانتان به یک رقابت جذاب استفاده کنید:</p>
                    <div class="relative">
                        <input type="text" readonly value="https://wordlygame.onrender.com/?invite=1234" class="w-full bg-white p-3 pr-12 rounded-lg border border-yellow-400 text-sm font-mono text-gray-700">
                        <button class="absolute left-2 top-1/2 transform -translate-y-1/2 bg-yellow-500 hover:bg-yellow-600 text-white text-xs font-bold py-1 px-2 rounded-lg" onclick="navigator.clipboard.writeText(document.querySelector('#content-duel input').value); alert('لینک کپی شد!');">
                            کپی
                        </button>
                    </div>
                </div>
            </div>

            <div id="content-active" class="tab-content hidden">
                <h2 class="text-2xl font-bold mb-6 text-gray-800">🔥 بازی‌های در حال انتظار</h2>
                <p class="text-gray-600 mb-4">اینجا لیستی از بازی‌هایی است که منتظر اقدام شما هستند:</p>
                
                <ul class="mt-4 space-y-4">
                    <li class="bg-white p-4 rounded-xl shadow-md border-l-4 border-red-500 flex justify-between items-center transform hover:shadow-lg transition-shadow duration-300">
                        <div>
                            <span class="font-bold text-red-600">نوبت شماست</span> - بازی با <span class="text-gray-800">@opponent_user</span>
                            <p class="text-xs text-gray-500 mt-1">شروع: ۲۰ دقیقه پیش</p>
                        </div>
                        <button class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-full shadow-md">
                            ادامه بازی
                        </button>
                    </li>
                    <li class="bg-white p-4 rounded-xl shadow-md border-l-4 border-gray-400 flex justify-between items-center">
                        <div>
                            <span class="font-bold text-gray-600">منتظر حریف</span> - بازی با <span class="text-gray-800">@another_user</span>
                            <p class="text-xs text-gray-500 mt-1">شروع: دیروز</p>
                        </div>
                        <span class="text-sm text-gray-500">...</span>
                    </li>
                </ul>
            </div>

        </div>
    </div>

    <div id="edit-modal" class="hidden fixed inset-0 bg-gray-900 bg-opacity-70 flex items-center justify-center transition-opacity duration-300 z-50 p-4">
        
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 rtl transform scale-95 transition-transform duration-300 ease-out">
            
            <div class="flex justify-between items-center border-b pb-4 mb-5">
                <h3 class="text-xl font-bold text-indigo-700">✏️ ویرایش اطلاعات کاربری</h3>
                <button onclick="document.getElementById('edit-modal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-3xl font-light leading-none">
                    &times;
                </button>
            </div>
            
            <form>
                <div class="mb-6">
                    <label for="modal-name" class="block text-gray-700 text-sm font-bold mb-2">نام کاربری (قابل نمایش):</label>
                    <input type="text" id="modal-name" value="ابوالفضل رضایی" class="shadow-inner appearance-none border border-gray-300 rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                    <p class="text-xs text-gray-500 mt-1">تغییر آیدی عددی امکان‌پذیر نیست.</p>
                </div>
                <div class="flex justify-end pt-4">
                    <button type="button" onclick="document.getElementById('edit-modal').classList.add('hidden')" class="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-5 rounded-full ml-3 transition duration-150">
                        لغو
                    </button>
                    <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-5 rounded-full shadow-md transition duration-150">
                        ذخیره
                    </button>
                </div>
            </form>

        </div>
    </div>

    <script>
        // تابع برای جابجایی بین زبانه‌ها
        function showTab(tabId) {
            // مخفی کردن همه محتواها
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            // غیرفعال کردن کلاس active از همه دکمه‌ها
            document.querySelectorAll('.tab-button').forEach(button => {
                button.classList.remove('tab-active');
            });

            // نمایش محتوای زبانه انتخاب شده
            document.getElementById(`content-${tabId}`).classList.remove('hidden');
            // فعال کردن دکمه زبانه انتخاب شده
            document.getElementById(`tab-${tabId}`).classList.add('tab-active');
        }

        // تابع برای به‌روزرسانی زمان و تاریخ
        function updateDateTime() {
            const now = new Date();
            
            // نمایش زمان (مثال: ۰۳:۲۲:۴۷)
            // از ToLocaleTimeString با تنظیمات فارسی استفاده می‌شود
            const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
            const currentTime = now.toLocaleTimeString('fa-IR', timeOptions).replace(/[\u200E\u200F]/g, ''); 
            document.getElementById('current-time').textContent = currentTime;

            // نمایش تاریخ شمسی (مثال: ۱۴۰۴/۰۸/۳۰)
            // از ToLocaleDateString با تنظیمات فارسی استفاده می‌شود
            const dateOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
            const currentDate = now.toLocaleDateString('fa-IR', dateOptions).replace(/[\u200E\u200F]/g, '');
            document.getElementById('current-date').textContent = currentDate;
        }

        // به‌روزرسانی اولیه و تنظیم برای به‌روزرسانی هر ثانیه
        updateDateTime();
        setInterval(updateDateTime, 1000); 

        // مطمئن می‌شویم که اولین زبانه (profile) در ابتدا نمایش داده شود
        document.addEventListener('DOMContentLoaded', () => {
            showTab('profile');
        });

    </script>
</body>
</html>
