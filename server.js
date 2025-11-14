// ENV / config
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

const { Client } = require('pg');

// 1. کوئری SQL برای حذف تمام جداول
// این کوئری تمام جداول در schema 'public' را پیدا کرده و دستور DROP TABLE CASCADE را برای هر کدام اجرا می‌کند.
// CASCADE: وابستگی‌های جدول (مثل Foreign Keys) را نیز حذف می‌کند.
const WIPE_QUERY = `
    DO $$ DECLARE
        r RECORD;
    BEGIN
        -- دریافت تمام جداول در schema 'public'
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            -- اجرای دستور DROP TABLE CASCADE برای هر جدول
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
    END $$;
`;

/**
 * تابع اصلی برای پاک کردن کامل دیتابیس با کوئری خام
 */
async function wipeDatabaseRaw() {
    console.log('--- ⚠️ هشدار: در حال اجرای عملیات پاک کردن کامل دیتابیس با کوئری خام! ⚠️ ---');
    
    const client = new Client({
        connectionString: DATABASE_URL,
        // ضروری برای اتصال SSL به Render
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('✅ اتصال به دیتابیس با موفقیت برقرار شد.');

        // 2. اجرای کوئری پاکسازی
        console.log('⏳ در حال حذف تمام جداول...');
        const result = await client.query(WIPE_QUERY);
        
        console.log('✅ تمام جداول دیتابیس با موفقیت حذف (Wiped) شدند.');
        console.log('--- ✅ عملیات پاکسازی به پایان رسید. ---');

    } catch (error) {
        console.error('❌ خطا در عملیات پاکسازی دیتابیس:', error.message);
    } finally {
        // بستن اتصال
        await client.end();
        process.exit(0);
    }
}

wipeDatabaseRaw();
