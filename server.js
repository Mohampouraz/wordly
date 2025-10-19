// این فایل سرور Node.js است که برای اجرا روی wordlygame.onrender.com طراحی شده است.
// برای ذخیره‌سازی دائم داده‌ها از Firebase Firestore استفاده می‌کند.

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================================================
// ۱. تنظیمات و مقداردهی اولیه Firebase Admin
// ====================================================

// شناسه برنامه را از محیط دریافت کنید یا یک مقدار پیش‌فرض تعیین کنید
const APP_ID = process.env.APP_ID || 'wordly_game_v1';

// محتویات فایل Service Account JSON باید به صورت یک رشته JSON در متغیر محیطی ذخیره شود
const FIREBASE_ADMIN_CONFIG = process.env.FIREBASE_ADMIN_CONFIG;

if (!FIREBASE_ADMIN_CONFIG) {
    console.error("FATAL ERROR: FIREBASE_ADMIN_CONFIG environment variable is not set.");
    process.exit(1);
}

try {
    const serviceAccount = JSON.parse(FIREBASE_ADMIN_CONFIG);
    
    // مقداردهی اولیه Firebase Admin SDK
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    const db = getFirestore();
    console.log("Firebase Admin SDK initialized successfully.");

    // تعریف مسیرهای Firestore بر اساس ساختار امنیتی: /artifacts/{appId}/public/data/{collection}
    const publicDataPath = `artifacts/${APP_ID}/public/data`;
    const playersCollection = `${publicDataPath}/players`;
    const leadersCollection = `${publicDataPath}/leaders`;
    const submissionsCollection = `${publicDataPath}/submissions`;
    
    // برای جلوگیری از ایجاد اندیس‌های پیچیده و حفظ سادگی،
    // برای فیلتر و مرتب‌سازی داده‌های حجیم از عملیات‌های سمت سرور استفاده می‌کنیم.

    // ====================================================
    // ۲. Middlewares
    // ====================================================

    // تنظیم CORS برای اجازه دسترسی فقط از فرانت‌اِند مورد نظر شما
    app.use(cors({
        origin: 'https://wordlybot.xo.je',
        methods: ['GET', 'POST']
    }));
    app.use(bodyParser.json());

    // ----------------------------------------------------
    // ۳. API Endpoints
    // ----------------------------------------------------

    /**
     * ثبت ورود بازیکن و به‌روزرسانی زمان فعالیت
     * POST /api/register-player
     */
    app.post('/api/register-player', async (req, res) => {
        const { telegramId, username } = req.body;

        if (!telegramId || !username) {
            return res.status(400).json({ success: false, message: 'Missing telegramId or username.' });
        }

        const playerRef = db.collection(playersCollection).doc(telegramId);
        const timestamp = Date.now();

        try {
            await playerRef.set({
                telegramId,
                username,
                lastSeen: timestamp,
                // برای تشخیص ورود جدید، از یک فیلد timestamp جدید استفاده می‌کنیم
                entryTimestamp: FieldValue.serverTimestamp() 
            }, { merge: true }); // از merge استفاده می‌کنیم تا فیلدهای موجود حفظ شوند

            res.json({ success: true, message: 'Player registered/updated.', player: { telegramId, username, lastSeen: timestamp } });
        } catch (error) {
            console.error("Error registering player:", error);
            res.status(500).json({ success: false, message: 'Server error during player registration.' });
        }
    });

    /**
     * به‌روزرسانی امتیاز در رتبه‌بندی
     * POST /api/update-score
     */
    app.post('/api/update-score', async (req, res) => {
        const { telegramId, username, score } = req.body;

        if (!telegramId || typeof score !== 'number') {
            return res.status(400).json({ success: false, message: 'Invalid input.' });
        }

        const leaderRef = db.collection(leadersCollection).doc(telegramId);

        try {
            await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(leaderRef);

                if (!doc.exists || score > doc.data().score) {
                    // اگر وجود ندارد یا امتیاز جدید بالاتر است، به‌روزرسانی کن
                    transaction.set(leaderRef, {
                        telegramId,
                        username,
                        score: score,
                        lastUpdated: FieldValue.serverTimestamp()
                    }, { merge: true });
                    return res.json({ success: true, message: 'Score updated.' });
                } else {
                    // اگر امتیاز جدید بالاتر نیست، کاری نکن
                    return res.json({ success: true, message: 'Score is not higher, no update performed.' });
                }
            });
        } catch (error) {
            console.error("Transaction failed to update score:", error);
            res.status(500).json({ success: false, message: 'Server error during score update.' });
        }
    });

    /**
     * دریافت لیست رتبه‌بندی (مرتب شده)
     * GET /api/leaderboard
     */
    app.get('/api/leaderboard', async (req, res) => {
        try {
            // ایجاد کوئری: بر اساس امتیاز (score) نزولی مرتب‌سازی و محدود به ۱۰ رکورد
            const q = db.collection(leadersCollection)
                        .orderBy('score', 'desc')
                        .limit(10);
            
            const snapshot = await q.get();
            
            const leaders = snapshot.docs.map(doc => doc.data());
            
            res.json({ leaders });
        } catch (error) {
            console.error("Error fetching leaderboard:", error);
            res.status(500).json({ success: false, message: 'Server error fetching leaderboard.' });
        }
    });

    /**
     * ذخیره کلمه پیشنهادی
     * POST /api/submit-word
     */
    app.post('/api/submit-word', async (req, res) => {
        const { word, submittedBy, telegramId } = req.body;

        if (!word || !submittedBy) {
            return res.status(400).json({ success: false, message: 'Missing word or submitter info.' });
        }

        try {
            const docRef = await db.collection(submissionsCollection).add({
                word: word.toUpperCase(),
                submittedBy,
                telegramId,
                timestamp: FieldValue.serverTimestamp(),
                status: 'pending' // وضعیت پیش‌فرض برای بررسی
            });
            res.json({ success: true, message: 'Word submitted for review.', id: docRef.id });
        } catch (error) {
            console.error("Error submitting word:", error);
            res.status(500).json({ success: false, message: 'Server error submitting word.' });
        }
    });

    /**
     * فید بازیکنان جدید (استفاده توسط polling در کلاینت)
     * GET /api/new-players?since=<timestamp>
     * * توجه: به دلیل محدودیت‌های اندیس‌گذاری و عدم امکان استفاده از FieldValue.serverTimestamp() 
     * در فیلترها، از فیلد lastSeen (که یک timestamp عددی است) استفاده می‌کنیم.
     */
    app.get('/api/new-players', async (req, res) => {
        // since: timestamp عددی آخرین باری که کلاینت داده دریافت کرده است
        const sinceTimestamp = parseInt(req.query.since) || 0; 

        // تعریف threshold برای غیرفعال شدن (۵ دقیقه)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        
        try {
            // کوئری برای دریافت تمام بازیکنانی که اخیراً فعال بوده‌اند
            const q = db.collection(playersCollection)
                        .where('lastSeen', '>', fiveMinutesAgo)
                        .limit(20); // محدود کردن کوئری
                        
            const snapshot = await q.get();
            
            let newPlayers = snapshot.docs.map(doc => ({ ...doc.data(), lastSeen: doc.data().lastSeen }));
            
            // در سمت سرور، بازیکنانی که lastSeen آن‌ها از sinceTimestamp کلاینت بیشتر است را فیلتر می‌کنیم
            const recentPlayers = newPlayers
                .filter(p => p.lastSeen > sinceTimestamp)
                .sort((a, b) => a.lastSeen - b.lastSeen);

            res.json({ players: recentPlayers });
        } catch (error) {
            console.error("Error fetching new players:", error);
            res.status(500).json({ success: false, message: 'Server error fetching new players.' });
        }
    });


    // ====================================================
    // ۴. شروع سرور
    // ====================================================

    app.listen(PORT, () => {
        console.log(`WordlyBot Server running on port ${PORT}`);
    });

} catch (e) {
    console.error("Failed to parse Firebase Admin Config or initialize app:", e);
    process.exit(1);
}
