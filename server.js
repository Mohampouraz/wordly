<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wordly - بازی کلمه‌یابی رقابتی</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        /* استایل‌های کلی */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Vazirmatn', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        :root {
            --primary-color: #6366f1;
            --primary-dark: #4f46e5;
            --secondary-color: #10b981;
            --accent-color: #f59e0b;
            --success-color: #10b981;
            --warning-color: #f59e0b;
            --danger-color: #ef4444;
            --light-color: #f8fafc;
            --dark-color: #1e293b;
            --text-color: #334155;
            --border-radius: 16px;
            --border-radius-sm: 8px;
            --box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            --transition: all 0.3s ease;
        }

        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: var(--text-color);
            min-height: 100vh;
            direction: rtl;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            min-height: 100vh;
        }

        /* هدر */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            margin-bottom: 25px;
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 12px;
            color: var(--primary-color);
            font-size: 1.8rem;
            font-weight: 800;
        }

        .logo i {
            font-size: 2rem;
        }

        .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .user-avatar {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
            font-weight: bold;
            font-size: 1.2rem;
        }

        .user-details {
            display: flex;
            flex-direction: column;
        }

        .user-name {
            font-weight: 700;
            color: var(--dark-color);
        }

        .user-score {
            font-size: 0.9rem;
            color: var(--text-color);
        }

        /* تب‌ها */
        .tabs {
            display: flex;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(10px);
            border-radius: var(--border-radius);
            padding: 8px;
            margin-bottom: 25px;
            box-shadow: var(--box-shadow);
        }

        .tab-button {
            flex: 1;
            padding: 15px;
            border: none;
            background: transparent;
            cursor: pointer;
            border-radius: var(--border-radius-sm);
            transition: var(--transition);
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: var(--text-color);
        }

        .tab-button.active {
            background: white;
            box-shadow: var(--box-shadow);
            color: var(--primary-color);
        }

        .tab-button:hover:not(.active) {
            background: rgba(99, 102, 241, 0.1);
        }

        .tab-pane {
            display: none;
        }

        .tab-pane.active {
            display: block;
            animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* کارت‌های آماری */
        .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: white;
            padding: 25px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            text-align: center;
            border-top: 4px solid var(--primary-color);
            transition: var(--transition);
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-card h3 {
            font-size: 0.9rem;
            color: var(--dark-color);
            margin-bottom: 10px;
        }

        .stat-card p {
            font-size: 2rem;
            font-weight: bold;
            color: var(--primary-color);
        }

        /* دکمه‌های عمل */
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }

        .action-button {
            padding: 20px;
            border: none;
            border-radius: var(--border-radius);
            background: white;
            color: var(--dark-color);
            font-weight: 700;
            cursor: pointer;
            transition: var(--transition);
            box-shadow: var(--box-shadow);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            font-size: 1.1rem;
        }

        .action-button:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.15);
        }

        .action-button i {
            font-size: 2.5rem;
            color: var(--primary-color);
        }

        .action-button.primary {
            background: linear-gradient(135deg, var(--primary-color), var(--primary-dark));
            color: white;
        }

        .action-button.primary i {
            color: white;
        }

        /* بخش بازی رقابتی */
        .competitive-container {
            padding: 20px 0;
        }

        .rooms-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .room-card {
            background: white;
            padding: 25px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            transition: var(--transition);
            border-left: 4px solid var(--primary-color);
        }

        .room-card:hover {
            transform: translateY(-5px);
        }

        .room-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .room-code {
            font-weight: 800;
            font-size: 1.2rem;
            color: var(--primary-color);
            background: rgba(99, 102, 241, 0.1);
            padding: 5px 12px;
            border-radius: 20px;
        }

        .room-status {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.9rem;
        }

        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }

        .status-dot.waiting {
            background: var(--warning-color);
        }

        .status-dot.playing {
            background: var(--success-color);
        }

        .room-players {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 20px;
        }

        .player-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: var(--light-color);
            border-radius: var(--border-radius-sm);
        }

        .player-avatar {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: var(--primary-color);
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
            font-size: 0.8rem;
            font-weight: bold;
        }

        .join-room-btn {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: var(--border-radius-sm);
            background: var(--primary-color);
            color: white;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .join-room-btn:hover {
            background: var(--primary-dark);
        }

        .create-room-section {
            background: white;
            padding: 30px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            text-align: center;
        }

        .create-room-btn {
            padding: 15px 30px;
            border: none;
            border-radius: var(--border-radius);
            background: linear-gradient(135deg, var(--secondary-color), #0ca678);
            color: white;
            font-weight: 700;
            cursor: pointer;
            transition: var(--transition);
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-size: 1.1rem;
        }

        .create-room-btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 20px -5px rgba(16, 185, 129, 0.4);
        }

        .waiting-room, .game-area {
            background: white;
            padding: 30px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            text-align: center;
        }

        .waiting-indicator {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
            margin: 30px 0;
        }

        .spinner {
            width: 60px;
            height: 60px;
            border: 5px solid rgba(99, 102, 241, 0.2);
            border-top: 5px solid var(--primary-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .players-list {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-top: 20px;
        }

        .player-card {
            padding: 20px;
            border: 2px solid var(--light-color);
            border-radius: var(--border-radius);
            min-width: 180px;
            transition: var(--transition);
        }

        .player-card.active {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }

        /* رابط بازی */
        .game-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--light-color);
        }

        .players-info {
            display: flex;
            align-items: center;
            gap: 20px;
        }

        .player-info {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 5px;
        }

        .player-avatar-lg {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
            font-weight: bold;
            font-size: 1.2rem;
        }

        .vs {
            font-weight: bold;
            color: var(--accent-color);
            font-size: 1.2rem;
        }

        .game-progress {
            font-weight: 600;
            background: var(--light-color);
            padding: 10px 20px;
            border-radius: 30px;
        }

        .game-board {
            text-align: center;
        }

        .word-category {
            margin-bottom: 25px;
        }

        .word-category h3 {
            color: var(--primary-color);
            background: rgba(99, 102, 241, 0.1);
            padding: 12px 25px;
            border-radius: 30px;
            display: inline-block;
            font-weight: 700;
        }

        .timer {
            font-size: 3rem;
            font-weight: bold;
            color: var(--accent-color);
            margin: 25px 0;
            background: var(--light-color);
            padding: 20px;
            border-radius: var(--border-radius);
            display: inline-block;
            box-shadow: var(--box-shadow);
        }

        .word-placeholder {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin: 40px 0;
            flex-wrap: wrap;
        }

        .letter-slot {
            width: 60px;
            height: 70px;
            border-bottom: 4px solid var(--primary-color);
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 2rem;
            font-weight: bold;
            transition: var(--transition);
        }

        .letter-slot.filled {
            border-bottom: none;
            transform: translateY(-5px);
        }

        .letter-slot.correct {
            color: var(--success-color);
        }

        .input-section {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin: 30px 0;
        }

        .input-section input {
            width: 70px;
            height: 70px;
            text-align: center;
            font-size: 2rem;
            border: 2px solid var(--light-color);
            border-radius: var(--border-radius);
            transition: var(--transition);
        }

        .input-section input:focus {
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
            outline: none;
        }

        .submit-guess {
            padding: 0 30px;
            border: none;
            border-radius: var(--border-radius);
            background: var(--primary-color);
            color: white;
            font-weight: 700;
            cursor: pointer;
            transition: var(--transition);
        }

        .submit-guess:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }

        .hint-section {
            margin: 25px 0;
        }

        .hint-button {
            padding: 12px 25px;
            background: var(--warning-color);
            color: white;
            border: none;
            border-radius: var(--border-radius);
            cursor: pointer;
            font-weight: 600;
            transition: var(--transition);
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .hint-button:hover {
            background: #e58e0b;
            transform: translateY(-2px);
        }

        .hint-button:disabled {
            background: #cbd5e1;
            cursor: not-allowed;
            transform: none;
        }

        .letters-section {
            display: flex;
            justify-content: center;
            gap: 40px;
            margin-top: 40px;
        }

        .correct-letters, .wrong-letters {
            text-align: center;
            flex: 1;
            max-width: 250px;
        }

        .correct-letters h4, .wrong-letters h4 {
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--light-color);
        }

        .letters-container {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            justify-content: center;
            min-height: 50px;
            padding: 15px;
            border-radius: var(--border-radius);
        }

        .correct-letters .letters-container {
            background: rgba(16, 185, 129, 0.1);
        }

        .wrong-letters .letters-container {
            background: rgba(239, 68, 68, 0.1);
        }

        .letter-badge {
            padding: 8px 12px;
            border-radius: var(--border-radius-sm);
            font-weight: bold;
            font-size: 1.2rem;
        }

        .correct-letter {
            background: var(--success-color);
            color: white;
        }

        .wrong-letter {
            background: var(--danger-color);
            color: white;
        }

        /* پروفایل */
        .profile-container {
            padding: 20px 0;
        }

        .profile-header {
            text-align: center;
            margin-bottom: 40px;
        }

        .avatar {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
            margin: 0 auto 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            color: white;
            font-size: 3rem;
            box-shadow: var(--box-shadow);
        }

        .profile-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
        }

        .profile-stat {
            background: white;
            padding: 25px;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: var(--transition);
        }

        .profile-stat:hover {
            transform: translateY(-5px);
        }

        /* مودال */
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            backdrop-filter: blur(5px);
        }

        .modal-content {
            background: white;
            border-radius: var(--border-radius);
            width: 90%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: var(--box-shadow);
            animation: modalAppear 0.3s ease;
        }

        @keyframes modalAppear {
            from { opacity: 0; transform: scale(0.9) translateY(20px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 25px;
            border-bottom: 1px solid var(--light-color);
        }

        .close-modal {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: var(--text-color);
            transition: var(--transition);
        }

        .close-modal:hover {
            color: var(--danger-color);
        }

        .modal-body {
            padding: 25px;
        }

        /* کلاس‌های کمکی */
        .hidden {
            display: none !important;
        }

        .text-center {
            text-align: center;
        }

        .mt-4 {
            margin-top: 25px;
        }

        /* واکنش‌گرایی */
        @media (max-width: 768px) {
            .container {
                padding: 15px;
            }
            
            .header {
                flex-direction: column;
                gap: 15px;
                text-align: center;
            }
            
            .stats-container {
                grid-template-columns: 1fr;
            }
            
            .quick-actions {
                grid-template-columns: 1fr;
            }
            
            .rooms-grid {
                grid-template-columns: 1fr;
            }
            
            .players-list {
                flex-direction: column;
                align-items: center;
                gap: 15px;
            }
            
            .game-header {
                flex-direction: column;
                gap: 20px;
            }
            
            .letters-section {
                flex-direction: column;
                gap: 25px;
            }
            
            .input-section {
                flex-direction: column;
                align-items: center;
            }
            
            .submit-guess {
                width: 100%;
                max-width: 200px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- هدر -->
        <header class="header">
            <div class="logo">
                <i class="fas fa-puzzle-piece"></i>
                <span>Wordly</span>
            </div>
            <div class="user-info">
                <div class="user-avatar" id="user-avatar">U</div>
                <div class="user-details">
                    <div class="user-name" id="username">کاربر</div>
                    <div class="user-score" id="user-score">امتیاز: ۰</div>
                </div>
            </div>
        </header>

        <!-- تب‌های اصلی -->
        <div class="tabs">
            <button class="tab-button active" data-tab="dashboard">
                <i class="fas fa-home"></i>
                <span>داشبورد</span>
            </button>
            <button class="tab-button" data-tab="competitive">
                <i class="fas fa-gamepad"></i>
                <span>بازی رقابتی</span>
            </button>
            <button class="tab-button" data-tab="profile">
                <i class="fas fa-user"></i>
                <span>پروفایل</span>
            </button>
        </div>

        <!-- محتوای تب‌ها -->
        <div class="tab-content">
            <!-- داشبورد -->
            <div id="dashboard" class="tab-pane active">
                <div class="stats-container">
                    <div class="stat-card">
                        <h3>امتیاز کلی</h3>
                        <p id="total-score">۰</p>
                    </div>
                    <div class="stat-card">
                        <h3>بازی‌های انجام شده</h3>
                        <p id="games-played">۰</p>
                    </div>
                    <div class="stat-card">
                        <h3>بردها</h3>
                        <p id="games-won">۰</p>
                    </div>
                    <div class="stat-card">
                        <h3>رتبه</h3>
                        <p id="user-rank">-#</p>
                    </div>
                </div>
                
                <div class="quick-actions">
                    <button id="quick-play" class="action-button primary">
                        <i class="fas fa-bolt"></i>
                        <span>شروع بازی سریع</span>
                    </button>
                    <button id="create-room" class="action-button">
                        <i class="fas fa-plus-circle"></i>
                        <span>ایجاد اتاق بازی</span>
                    </button>
                    <button id="join-random" class="action-button">
                        <i class="fas fa-random"></i>
                        <span>پیوستن به بازی تصادفی</span>
                    </button>
                </div>
            </div>

            <!-- بازی رقابتی -->
            <div id="competitive" class="tab-pane">
                <div class="competitive-container">
                    <h2 class="text-center" style="margin-bottom: 25px; color: white;">اتاق‌های فعال</h2>
                    
                    <div class="rooms-grid" id="rooms-grid">
                        <!-- اتاق‌های فعال در اینجا نمایش داده می‌شوند -->
                    </div>
                    
                    <div class="create-room-section">
                        <h3 style="margin-bottom: 20px;">اتاق جدید ایجاد کنید</h3>
                        <p style="margin-bottom: 25px; color: var(--text-color);">یک اتاق جدید بسازید و دوستان خود را دعوت کنید</p>
                        <button id="create-new-room" class="create-room-btn">
                            <i class="fas fa-plus"></i>
                            <span>ایجاد اتاق جدید</span>
                        </button>
                    </div>
                    
                    <div id="waiting-room" class="waiting-room hidden">
                        <h3>اتاق بازی: <span id="current-room-code" style="color: var(--primary-color);"></span></h3>
                        <div class="waiting-indicator">
                            <div class="spinner"></div>
                            <p>در انتظار بازیکن دوم...</p>
                        </div>
                        <div class="players-list">
                            <div class="player-card active">
                                <div class="player-avatar-lg" id="waiting-player1-avatar">۱</div>
                                <h4 id="waiting-player1-name">بازیکن ۱</h4>
                                <p>شما</p>
                            </div>
                            <div class="player-card">
                                <div class="player-avatar-lg" id="waiting-player2-avatar">۲</div>
                                <h4 id="waiting-player2-name">در انتظار...</h4>
                                <p>بازیکن ۲</p>
                            </div>
                        </div>
                    </div>

                    <div id="game-area" class="game-area hidden">
                        <!-- محتوای بازی در اینجا قرار می‌گیرد -->
                    </div>
                </div>
            </div>

            <!-- پروفایل -->
            <div id="profile" class="tab-pane">
                <div class="profile-container">
                    <div class="profile-header">
                        <div class="avatar" id="profile-avatar">U</div>
                        <h2 id="profile-name">نام کاربر</h2>
                        <p id="profile-username" style="color: var(--text-color); margin-top: 10px;">@username</p>
                    </div>
                    <div class="profile-stats">
                        <div class="profile-stat">
                            <span>رتبه جهانی:</span>
                            <span id="profile-rank">-#</span>
                        </div>
                        <div class="profile-stat">
                            <span>میانگین امتیاز:</span>
                            <span id="profile-avg-score">۰</span>
                        </div>
                        <div class="profile-stat">
                            <span>نرخ برد:</span>
                            <span id="profile-win-rate">۰٪</span>
                        </div>
                        <div class="profile-stat">
                            <span>کل بازی‌ها:</span>
                            <span id="profile-total-games">۰</span>
                        </div>
                        <div class="profile-stat">
                            <span>بازی‌های برده:</span>
                            <span id="profile-wins">۰</span>
                        </div>
                        <div class="profile-stat">
                            <span>امتیاز کل:</span>
                            <span id="profile-total-score">۰</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- مودال ایجاد اتاق -->
    <div id="create-room-modal" class="modal hidden">
        <div class="modal-content">
            <div class="modal-header">
                <h3>ایجاد اتاق جدید</h3>
                <button class="close-modal">&times;</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 20px;">یک اتاق جدید ایجاد کنید و کد آن را با دوستان خود به اشتراک بگذارید.</p>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="new-room-code" placeholder="کد اتاق (اختیاری)" style="flex: 1; padding: 12px; border: 2px solid var(--light-color); border-radius: var(--border-radius-sm);">
                    <button id="confirm-create-room" class="join-room-btn">ایجاد اتاق</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        // پایگاه داده کلمات
        const wordsDatabase = {
            "آسان": [
                {
                    category: "میوه‌ها",
                    words: ["سیب", "پرتقال", "موز", "انگور", "هلو", "گیلاس", "انار", "انجیر", "خربزه"]
                },
                {
                    category: "حیوانات",
                    words: ["سگ", "گربه", "موش", "مرغ", "خرگوش", "گوسفند", "گاو", "اسب", "ماهی"]
                },
                {
                    category: "وسایل نقلیه",
                    words: ["ماشین", "قطار", "کشتی", "هواپیما", "دوچرخه", "موتور", "اتوبوس", "مترو", "ون"]
                }
            ],
            "متوسط": [
                {
                    category: "شهرهای ایران",
                    words: ["تهران", "مشهد", "اصفهان", "شیراز", "تبریز", "کرج", "قم", "اهواز", "کرمانشاه"]
                },
                {
                    category: "کشورها",
                    words: ["ایران", "ترکیه", "آلمان", "فرانسه", "ایتالیا", "ژاپن", "چین", "روسیه", "کانادا"]
                },
                {
                    category: "رشته‌های تحصیلی",
                    words: ["مهندسی", "پزشکی", "حقوق", "روانشناسی", "مدیریت", "کامپیوتر", "معماری", "حسابداری", "شیمی"]
                }
            ],
            "سخت": [
                {
                    category: "دانشمندان",
                    words: ["ابوریحان", "خیام", "زکریا", "انیشتین", "نیوتن", "داوینچی", "گالیله", "پاستور", "کپلر"]
                },
                {
                    category: "مفاهیم فلسفی",
                    words: ["وجودشناسی", "معرفت‌شناسی", "اخلاق", "منطق", "زیبایی‌شناسی", "متافیزیک", "دیالکتیک", "پدیدارشناسی", "اگزیستانسیالیسم"]
                },
                {
                    category: "عناصر شیمیایی",
                    words: ["هیدروژن", "اکسیژن", "نیتروژن", "کربن", "آهن", "طلا", "نقره", "مس", "جیوه"]
                }
            ]
        };

        // متغیرهای جهانی
        let tg = window.Telegram.WebApp;
        let socket = null;
        let currentUser = null;
        let currentRoom = null;
        let gameState = null;
        let timerInterval = null;
        let timeLeft = 60;
        let activeRooms = [];

        // مقداردهی اولیه برنامه
        document.addEventListener('DOMContentLoaded', function() {
            initializeApp();
            setupEventListeners();
            loadActiveRooms();
        });

        // مقداردهی اولیه برنامه
        function initializeApp() {
            // تنظیمات اولیه تلگرام وب‌اپ
            if (typeof tg !== 'undefined') {
                tg.expand();
                tg.enableClosingConfirmation();
                
                // دریافت اطلاعات کاربر از تلگرام
                const initData = tg.initDataUnsafe;
                if (initData && initData.user) {
                    currentUser = {
                        id: initData.user.id,
                        username: initData.user.username,
                        firstName: initData.user.first_name,
                        lastName: initData.user.last_name
                    };
                    updateUserInfo();
                } else {
                    // حالت تست (زمانی که در محیط تلگرام نیستیم)
                    currentUser = {
                        id: Math.floor(Math.random() * 10000),
                        username: "testuser",
                        firstName: "کاربر",
                        lastName: "تست"
                    };
                    updateUserInfo();
                }
            } else {
                // حالت تست (زمانی که در محیط تلگرام نیستیم)
                currentUser = {
                    id: Math.floor(Math.random() * 10000),
                    username: "testuser",
                    firstName: "کاربر",
                    lastName: "تست"
                };
                updateUserInfo();
            }
            
            // اتصال به Socket.IO
            socket = io();
            
            // تنظیم هندلرهای Socket.IO
            setupSocketHandlers();
        }

        // تنظیم هندلرهای رویداد
        function setupEventListeners() {
            // هندلرهای تب‌ها
            document.querySelectorAll('.tab-button').forEach(button => {
                button.addEventListener('click', function() {
                    switchTab(this.dataset.tab);
                    if (this.dataset.tab === 'competitive') {
                        loadActiveRooms();
                    }
                });
            });
            
            // هندلرهای بازی رقابتی
            document.getElementById('create-new-room').addEventListener('click', showCreateRoomModal);
            document.getElementById('confirm-create-room').addEventListener('click', createNewRoom);
            document.getElementById('quick-play').addEventListener('click', quickPlay);
            document.getElementById('create-room').addEventListener('click', showCreateRoomModal);
            document.getElementById('join-random').addEventListener('click', joinRandomRoom);
            
            // هندلر مودال
            document.querySelectorAll('.close-modal').forEach(btn => {
                btn.addEventListener('click', closeModal);
            });
            
            // بستن مودال با کلیک خارج از آن
            document.getElementById('create-room-modal').addEventListener('click', function(e) {
                if (e.target === this) {
                    closeModal();
                }
            });
        }

        // تنظیم هندلرهای Socket.IO
        function setupSocketHandlers() {
            socket.on('room-joined', (data) => {
                currentRoom = data.roomCode;
                showWaitingRoom(data.roomCode);
            });
            
            socket.on('room-rejoined', (data) => {
                currentRoom = data.roomCode;
                // بازیابی وضعیت بازی
            });
            
            socket.on('room-full', (data) => {
                alert('اتاق بازی پر است. لطفاً اتاق دیگری انتخاب کنید.');
            });
            
            socket.on('game-started', (data) => {
                hideWaitingRoom();
                startGame(data);
            });
            
            socket.on('letter-guessed', (data) => {
                updateGameState(data);
            });
            
            socket.on('game-state-update', (data) => {
                updateGameDisplay(data);
            });
            
            socket.on('active-rooms', (data) => {
                activeRooms = data.rooms;
                updateRoomsDisplay();
            });
            
            socket.on('error', (data) => {
                alert(data.message);
            });
        }

        // تغییر تب
        function switchTab(tabName) {
            // غیرفعال کردن همه تب‌ها
            document.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
            });
            document.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            
            // فعال کردن تب انتخاب شده
            document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
            document.getElementById(tabName).classList.add('active');
        }

        // به روزرسانی اطلاعات کاربر
        function updateUserInfo() {
            if (currentUser) {
                const username = currentUser.username || 
                                `${currentUser.firstName} ${currentUser.lastName || ''}`.trim();
                const firstLetter = currentUser.firstName ? currentUser.firstName.charAt(0) : 'U';
                
                document.getElementById('username').textContent = username;
                document.getElementById('profile-name').textContent = username;
                document.getElementById('profile-username').textContent = currentUser.username ? `@${currentUser.username}` : '';
                
                // ایجاد آواتار بر اساس حرف اول نام
                document.getElementById('user-avatar').textContent = firstLetter;
                document.getElementById('profile-avatar').textContent = firstLetter;
                document.getElementById('waiting-player1-avatar').textContent = firstLetter;
                document.getElementById('waiting-player1-name').textContent = username;
            }
        }

        // بارگذاری اتاق‌های فعال
        function loadActiveRooms() {
            // در حالت واقعی این اطلاعات از سرور دریافت می‌شود
            // برای نمایش نمونه، چند اتاق ساختگی ایجاد می‌کنیم
            activeRooms = [
                {
                    code: 'ABC123',
                    player1: { firstName: 'علی', username: 'ali123' },
                    player2: null,
                    status: 'waiting',
                    created: new Date()
                },
                {
                    code: 'DEF456',
                    player1: { firstName: 'محمد', username: 'mohammad' },
                    player2: { firstName: 'رضا', username: 'reza89' },
                    status: 'playing',
                    created: new Date()
                },
                {
                    code: 'GHI789',
                    player1: { firstName: 'فاطمه', username: 'fatemeh' },
                    player2: null,
                    status: 'waiting',
                    created: new Date()
                }
            ];
            
            updateRoomsDisplay();
        }

        // به روزرسانی نمایش اتاق‌ها
        function updateRoomsDisplay() {
            const roomsGrid = document.getElementById('rooms-grid');
            roomsGrid.innerHTML = '';
            
            if (activeRooms.length === 0) {
                roomsGrid.innerHTML = '<p class="text-center" style="color: white; grid-column: 1 / -1;">هیچ اتاق فعالی وجود ندارد</p>';
                return;
            }
            
            activeRooms.forEach(room => {
                const roomCard = document.createElement('div');
                roomCard.className = 'room-card';
                
                const player1Name = room.player1.firstName || 'بازیکن ۱';
                const player2Name = room.player2 ? room.player2.firstName : 'در انتظار...';
                const player1Avatar = room.player1.firstName ? room.player1.firstName.charAt(0) : '۱';
                const player2Avatar = room.player2 ? room.player2.firstName.charAt(0) : '۲';
                
                roomCard.innerHTML = `
                    <div class="room-header">
                        <div class="room-code">${room.code}</div>
                        <div class="room-status">
                            <div class="status-dot ${room.status}"></div>
                            <span>${room.status === 'waiting' ? 'در انتظار' : 'در حال بازی'}</span>
                        </div>
                    </div>
                    <div class="room-players">
                        <div class="player-item">
                            <div class="player-avatar">${player1Avatar}</div>
                            <span>${player1Name}</span>
                        </div>
                        <div class="player-item">
                            <div class="player-avatar">${player2Avatar}</div>
                            <span>${player2Name}</span>
                        </div>
                    </div>
                    <button class="join-room-btn" data-room="${room.code}" ${room.status === 'playing' ? 'disabled' : ''}>
                        <i class="fas fa-door-open"></i>
                        ${room.status === 'playing' ? 'اتاق پر است' : 'پیوستن به اتاق'}
                    </button>
                `;
                
                roomsGrid.appendChild(roomCard);
            });
            
            // اضافه کردن هندلر برای دکمه‌های پیوستن
            document.querySelectorAll('.join-room-btn:not(:disabled)').forEach(btn => {
                btn.addEventListener('click', function() {
                    const roomCode = this.getAttribute('data-room');
                    joinRoom(roomCode);
                });
            });
        }

        // پیوستن به اتاق
        function joinRoom(roomCode) {
            if (!currentUser) {
                alert('خطا در شناسایی کاربر');
                return;
            }
            
            socket.emit('join-room', {
                roomCode: roomCode,
                userData: currentUser
            });
        }

        // نمایش مودال ایجاد اتاق
        function showCreateRoomModal() {
            document.getElementById('create-room-modal').classList.remove('hidden');
            document.getElementById('new-room-code').value = generateRoomCode();
        }

        // ایجاد اتاق جدید
        function createNewRoom() {
            const roomCode = document.getElementById('new-room-code').value.trim().toUpperCase() || generateRoomCode();
            
            if (!currentUser) {
                alert('خطا در شناسایی کاربر');
                return;
            }
            
            socket.emit('join-room', {
                roomCode: roomCode,
                userData: currentUser
            });
            
            closeModal();
        }

        // تولید کد اتاق تصادفی
        function generateRoomCode() {
            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let result = '';
            for (let i = 0; i < 6; i++) {
                result += characters.charAt(Math.floor(Math.random() * characters.length));
            }
            return result;
        }

        // نمایش اتاق انتظار
        function showWaitingRoom(roomCode) {
            document.getElementById('current-room-code').textContent = roomCode;
            document.getElementById('waiting-room').classList.remove('hidden');
            
            // تغییر به تب بازی رقابتی
            switchTab('competitive');
        }

        // مخفی کردن اتاق انتظار
        function hideWaitingRoom() {
            document.getElementById('waiting-room').classList.add('hidden');
        }

        // شروع بازی
        function startGame(gameData) {
            // نمایش رابط بازی
            showGameInterface(gameData);
            
            // شروع تایمر
            startTimer();
        }

        // نمایش رابط بازی
        function showGameInterface(gameData) {
            const gameArea = document.getElementById('game-area');
            gameArea.classList.remove('hidden');
            
            // انتخاب کلمات تصادفی برای بازی
            const words = getRandomWords("متوسط", 10);
            
            // ذخیره وضعیت بازی
            gameState = {
                player1: gameData.player1,
                player2: gameData.player2,
                words: words,
                currentWordIndex: 0,
                guessedLetters: [],
                wrongLetters: [],
                hintsUsed: 0,
                maxHints: 2,
                scores: {
                    player1: 0,
                    player2: 0
                }
            };
            
            // ایجاد رابط بازی
            gameArea.innerHTML = `
                <div class="game-header">
                    <div class="players-info">
                        <div class="player-info">
                            <div class="player-avatar-lg">${gameData.player1.firstName ? gameData.player1.firstName.charAt(0) : '۱'}</div>
                            <span>${gameData.player1.firstName || 'بازیکن ۱'}</span>
                            <span class="score">امتیاز: <span id="player1-score">۰</span></span>
                        </div>
                        <div class="vs">VS</div>
                        <div class="player-info">
                            <div class="player-avatar-lg">${gameData.player2.firstName ? gameData.player2.firstName.charAt(0) : '۲'}</div>
                            <span>${gameData.player2.firstName || 'بازیکن ۲'}</span>
                            <span class="score">امتیاز: <span id="player2-score">۰</span></span>
                        </div>
                    </div>
                    <div class="game-progress">
                        <span>کلمه: <span id="current-word-index">۱</span>/۱۰</span>
                    </div>
                </div>
                
                <div class="game-board">
                    <div class="word-category">
                        <h3 id="category-name">${words[0].category}</h3>
                    </div>
                    
                    <div class="timer">
                        <span id="timer-display">۶۰</span>
                    </div>
                    
                    <div class="word-placeholder" id="word-placeholder">
                        <!-- حروف کلمه اینجا نمایش داده می‌شوند -->
                    </div>
                    
                    <div class="input-section">
                        <input type="text" id="letter-input" maxlength="1" placeholder="حرف را وارد کنید" autocomplete="off">
                        <button class="submit-guess" id="submit-guess">حدس بزن</button>
                    </div>
                    
                    <div class="hint-section">
                        <button id="use-hint" class="hint-button">
                            <i class="fas fa-lightbulb"></i>
                            <span>راهنمایی (${gameState.maxHints - gameState.hintsUsed})</span>
                        </button>
                    </div>
                    
                    <div class="letters-section">
                        <div class="correct-letters">
                            <h4>حروف صحیح</h4>
                            <div class="letters-container" id="correct-letters-list"></div>
                        </div>
                        <div class="wrong-letters">
                            <h4>حروف غلط</h4>
                            <div class="letters-container" id="wrong-letters-list"></div>
                        </div>
                    </div>
                </div>
            `;
            
            // نمایش کلمه اول
            displayCurrentWord();
            
            // اضافه کردن هندلرهای بازی
            setupGameHandlers();
        }

        // نمایش کلمه فعلی
        function displayCurrentWord() {
            const currentWord = gameState.words[gameState.currentWordIndex].word;
            const wordPlaceholder = document.getElementById('word-placeholder');
            wordPlaceholder.innerHTML = '';
            
            for (let i = 0; i < currentWord.length; i++) {
                const letterSlot = document.createElement('div');
                letterSlot.className = 'letter-slot';
                letterSlot.id = `letter-slot-${i}`;
                
                // اگر حرف قبلاً حدس زده شده، نمایش داده شود
                if (gameState.guessedLetters.includes(currentWord[i])) {
                    letterSlot.textContent = currentWord[i];
                    letterSlot.classList.add('filled', 'correct');
                }
                
                wordPlaceholder.appendChild(letterSlot);
            }
            
            // به روزرسانی نمایش حروف صحیح و غلط
            updateLettersDisplay();
            
            // به روزرسانی شماره کلمه فعلی
            document.getElementById('current-word-index').textContent = convertToPersianNumbers(gameState.currentWordIndex + 1);
            
            // به روزرسانی دسته‌بندی
            document.getElementById('category-name').textContent = gameState.words[gameState.currentWordIndex].category;
        }

        // به روزرسانی نمایش حروف
        function updateLettersDisplay() {
            const correctLettersList = document.getElementById('correct-letters-list');
            const wrongLettersList = document.getElementById('wrong-letters-list');
            
            correctLettersList.innerHTML = '';
            wrongLettersList.innerHTML = '';
            
            gameState.guessedLetters.forEach(letter => {
                const letterBadge = document.createElement('span');
                letterBadge.className = 'letter-badge correct-letter';
                letterBadge.textContent = letter;
                correctLettersList.appendChild(letterBadge);
            });
            
            gameState.wrongLetters.forEach(letter => {
                const letterBadge = document.createElement('span');
                letterBadge.className = 'letter-badge wrong-letter';
                letterBadge.textContent = letter;
                wrongLettersList.appendChild(letterBadge);
            });
        }

        // تنظیم هندلرهای بازی
        function setupGameHandlers() {
            document.getElementById('submit-guess').addEventListener('click', submitGuess);
            document.getElementById('letter-input').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    submitGuess();
                }
            });
            
            document.getElementById('use-hint').addEventListener('click', useHint);
            
            // محدود کردن ورودی به حروف فارسی
            document.getElementById('letter-input').addEventListener('input', function(e) {
                if (!isPersianLetter(e.target.value)) {
                    e.target.value = '';
                }
            });
        }

        // ارسال حدس
        function submitGuess() {
            const letterInput = document.getElementById('letter-input');
            const letter = letterInput.value.trim();
            
            if (!letter || !isPersianLetter(letter)) {
                alert('لطفاً یک حرف فارسی معتبر وارد کنید');
                return;
            }
            
            // بررسی تکراری نبودن حرف
            if (gameState.guessedLetters.includes(letter) || gameState.wrongLetters.includes(letter)) {
                alert('این حرف قبلاً حدس زده شده است');
                letterInput.value = '';
                return;
            }
            
            const currentWord = gameState.words[gameState.currentWordIndex].word;
            
            // بررسی صحیح بودن حدس
            if (currentWord.includes(letter)) {
                // حرف صحیح
                gameState.guessedLetters.push(letter);
                
                // به روزرسانی نمایش کلمه
                updateWordDisplay();
                
                // بررسی کامل شدن کلمه
                if (isWordComplete()) {
                    handleWordComplete();
                }
            } else {
                // حرف غلط
                gameState.wrongLetters.push(letter);
                
                // بررسی پایان خطاها
                const maxWrongGuesses = Math.floor(currentWord.length * 1.2);
                if (gameState.wrongLetters.length >= maxWrongGuesses) {
                    handleMaxWrongGuesses();
                }
            }
            
            // به روزرسانی نمایش حروف
            updateLettersDisplay();
            
            // ارسال به سرور (در حالت چندنفره)
            socket.emit('guess-letter', {
                roomCode: currentRoom,
                letter: letter,
                userId: currentUser.id
            });
            
            letterInput.value = '';
            letterInput.focus();
        }

        // به روزرسانی نمایش کلمه
        function updateWordDisplay() {
            const currentWord = gameState.words[gameState.currentWordIndex].word;
            
            for (let i = 0; i < currentWord.length; i++) {
                const letterSlot = document.getElementById(`letter-slot-${i}`);
                if (gameState.guessedLetters.includes(currentWord[i])) {
                    letterSlot.textContent = currentWord[i];
                    letterSlot.classList.add('filled', 'correct');
                }
            }
        }

        // بررسی کامل شدن کلمه
        function isWordComplete() {
            const currentWord = gameState.words[gameState.currentWordIndex].word;
            
            for (let i = 0; i < currentWord.length; i++) {
                if (!gameState.guessedLetters.includes(currentWord[i])) {
                    return false;
                }
            }
            
            return true;
        }

        // مدیریت کامل شدن کلمه
        function handleWordComplete() {
            // محاسبه امتیاز
            const score = calculateScore();
            
            // به روزرسانی امتیاز بازیکن
            if (currentUser.id === gameState.player1.id) {
                gameState.scores.player1 += score;
                document.getElementById('player1-score').textContent = convertToPersianNumbers(gameState.scores.player1);
            } else {
                gameState.scores.player2 += score;
                document.getElementById('player2-score').textContent = convertToPersianNumbers(gameState.scores.player2);
            }
            
            // رفتن به کلمه بعدی یا پایان بازی
            setTimeout(() => {
                nextWord();
            }, 1500);
        }

        // مدیریت بیشینه حدس‌های غلط
        function handleMaxWrongGuesses() {
            alert(`حدس‌های غلط شما به پایان رسید! کلمه "${gameState.words[gameState.currentWordIndex].word}" بود.`);
            nextWord();
        }

        // رفتن به کلمه بعدی
        function nextWord() {
            gameState.currentWordIndex++;
            
            if (gameState.currentWordIndex >= gameState.words.length) {
                // پایان بازی
                endGame();
            } else {
                // بازنشانی وضعیت برای کلمه جدید
                gameState.guessedLetters = [];
                gameState.wrongLetters = [];
                
                // نمایش کلمه جدید
                displayCurrentWord();
                
                // بازنشانی تایمر
                resetTimer();
            }
        }

        // محاسبه امتیاز
        function calculateScore() {
            const currentWord = gameState.words[gameState.currentWordIndex].word;
            const baseScore = currentWord.length * 10;
            const timeBonus = Math.floor(timeLeft * 0.5);
            const hintPenalty = gameState.hintsUsed * 15;
            
            return Math.max(baseScore + timeBonus - hintPenalty, 0);
        }

        // استفاده از راهنمایی
        function useHint() {
            if (gameState.hintsUsed >= gameState.maxHints) {
                alert('شما تمام راهنمایی‌های خود را استفاده کرده‌اید');
                return;
            }
            
            const currentWord = gameState.words[gameState.currentWordIndex].word;
            let hiddenLetters = [];
            
            // پیدا کردن حروفی که هنوز حدس زده نشده‌اند
            for (let i = 0; i < currentWord.length; i++) {
                if (!gameState.guessedLetters.includes(currentWord[i])) {
                    hiddenLetters.push(i);
                }
            }
            
            if (hiddenLetters.length === 0) {
                alert('همه حروف قبلاً حدس زده شده‌اند');
                return;
            }
            
            // انتخاب یک حرف تصادفی برای نمایش
            const randomIndex = hiddenLetters[Math.floor(Math.random() * hiddenLetters.length)];
            const hintLetter = currentWord[randomIndex];
            
            // افزودن حرف به حروف حدس زده شده
            if (!gameState.guessedLetters.includes(hintLetter)) {
                gameState.guessedLetters.push(hintLetter);
            }
            
            // به روزرسانی نمایش
            updateWordDisplay();
            updateLettersDisplay();
            
            // افزایش تعداد راهنمایی‌های استفاده شده
            gameState.hintsUsed++;
            document.getElementById('use-hint').innerHTML = `
                <i class="fas fa-lightbulb"></i>
                <span>راهنمایی (${gameState.maxHints - gameState.hintsUsed})</span>
            `;
            
            // بررسی کامل شدن کلمه
            if (isWordComplete()) {
                handleWordComplete();
            }
        }

        // شروع تایمر
        function startTimer() {
            timeLeft = 60;
            updateTimerDisplay();
            
            timerInterval = setInterval(() => {
                timeLeft--;
                updateTimerDisplay();
                
                if (timeLeft <= 0) {
                    clearInterval(timerInterval);
                    handleTimeUp();
                }
            }, 1000);
        }

        // به روزرسانی نمایش تایمر
        function updateTimerDisplay() {
            const timerDisplay = document.getElementById('timer-display');
            if (timerDisplay) {
                timerDisplay.textContent = convertToPersianNumbers(timeLeft);
            }
        }

        // بازنشانی تایمر
        function resetTimer() {
            clearInterval(timerInterval);
            startTimer();
        }

        // مدیریت اتمام زمان
        function handleTimeUp() {
            alert('زمان شما به پایان رسید!');
            nextWord();
        }

        // پایان بازی
        function endGame() {
            const gameArea = document.getElementById('game-area');
            
            let winnerText = '';
            if (gameState.scores.player1 > gameState.scores.player2) {
                winnerText = `${gameState.player1.firstName || 'بازیکن ۱'} برنده شد!`;
            } else if (gameState.scores.player2 > gameState.scores.player1) {
                winnerText = `${gameState.player2.firstName || 'بازیکن ۲'} برنده شد!`;
            } else {
                winnerText = 'بازی مساوی شد!';
            }
            
            gameArea.innerHTML = `
                <div class="game-result">
                    <h2>پایان بازی!</h2>
                    <p>${winnerText}</p>
                    <div class="final-scores">
                        <p>${gameState.player1.firstName || 'بازیکن ۱'}: ${convertToPersianNumbers(gameState.scores.player1)} امتیاز</p>
                        <p>${gameState.player2.firstName || 'بازیکن ۲'}: ${convertToPersianNumbers(gameState.scores.player2)} امتیاز</p>
                    </div>
                    <button id="play-again" class="action-button primary" style="margin-top: 30px;">
                        <i class="fas fa-redo"></i>
                        <span>بازی مجدد</span>
                    </button>
                </div>
            `;
            
            document.getElementById('play-again').addEventListener('click', () => {
                location.reload();
            });
        }

        // به‌روزرسانی وضعیت بازی (برای حالت چندنفره)
        function updateGameState(data) {
            // این تابع وضعیت بازی را بر اساس داده‌های دریافتی از سرور به‌روزرسانی می‌کند
        }

        // به‌روزرسانی نمایش بازی
        function updateGameDisplay(data) {
            // این تابع رابط کاربری را بر اساس داده‌های دریافتی از سرور به‌روزرسانی می‌کند
        }

        // بررسی حرف فارسی
        function isPersianLetter(char) {
            const persianRegex = /[\u0600-\u06FF]/;
            return persianRegex.test(char);
        }

        // تبدیل اعداد به فارسی
        function convertToPersianNumbers(number) {
            const persianNumbers = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
            return number.toString().replace(/\d/g, digit => persianNumbers[parseInt(digit)]);
        }

        // دریافت کلمات تصادفی
        function getRandomWords(difficulty, count = 10) {
            const difficultyWords = wordsDatabase[difficulty];
            if (!difficultyWords) return [];
            
            const selectedWords = [];
            const usedCategories = new Set();
            
            while (selectedWords.length < count && usedCategories.size < difficultyWords.length) {
                const randomCategoryIndex = Math.floor(Math.random() * difficultyWords.length);
                
                if (!usedCategories.has(randomCategoryIndex)) {
                    usedCategories.add(randomCategoryIndex);
                    const category = difficultyWords[randomCategoryIndex];
                    const randomWordIndex = Math.floor(Math.random() * category.words.length);
                    
                    selectedWords.push({
                        word: category.words[randomWordIndex],
                        category: category.category
                    });
                }
            }
            
            return selectedWords;
        }

        // بازی سریع
        function quickPlay() {
            const roomCode = generateRoomCode();
            createNewRoomWithCode(roomCode);
        }

        // پیوستن به اتاق تصادفی
        function joinRandomRoom() {
            // پیدا کردن اولین اتاق در انتظار
            const waitingRoom = activeRooms.find(room => room.status === 'waiting');
            if (waitingRoom) {
                joinRoom(waitingRoom.code);
            } else {
                alert('هیچ اتاق در انتظاری یافت نشد. می‌توانید یک اتاق جدید ایجاد کنید.');
            }
        }

        // ایجاد اتاق با کد مشخص
        function createNewRoomWithCode(roomCode) {
            if (!currentUser) {
                alert('خطا در شناسایی کاربر');
                return;
            }
            
            socket.emit('join-room', {
                roomCode: roomCode,
                userData: currentUser
            });
        }

        // بستن مودال
        function closeModal() {
            document.getElementById('create-room-modal').classList.add('hidden');
        }
    </script>
</body>
</html>
