// wipeDB_raw.js

// =======================================================
// CONFIGURATION / ENV VARIABLES
// =======================================================
// آدرس اتصال به دیتابیس. از متغیر محیطی یا مقدار پیش‌فرض استفاده می‌شود.
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

// =======================================================
// IMPORTS
// =======================================================
const { Client } = require('pg');

// =======================================================
// RAW SQL QUERY
// =======================================================
// کوئری برای یافتن تمام جداول در schema 'public' و حذف آنها با CASCADE (حذف وابستگی‌ها)
const WIPE_QUERY = `
    DO $$ DECLARE
        r RECORD;
    BEGIN
        -- دریافت تمام جداول در schema 'public'
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            -- اجرای دستور DROP TABLE CASCADE برای هر جدول
            EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
        
        -- اگر sequence ها (برای SERIAL fields) را هم می‌خواهید ریست کنید:
        FOR r IN (SELECT relname FROM pg_class WHERE relkind = 'S' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) LOOP
            EXECUTE 'DROP SEQUENCE IF EXISTS ' || quote_ident(r.relname) || ' CASCADE';
        END LOOP;
        
    END $$;
`;

/**
 * تابع اصلی برای اتصال و پاک کردن دیتابیس با کوئری خام
 */
async function wipeDatabaseRaw() {
    console.log('--- ⚠️ هشدار: در حال اجرای عملیات پاک کردن کامل دیتابیس با کوئری خام! ⚠️ ---');
    
    const client = new Client({
        connectionString: DATABASE_URL,
        // ضروری برای اتصال SSL به دیتابیس‌های Render
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('✅ اتصال به دیتابیس با موفقیت برقرار شد.');

        // 2. اجرای کوئری پاکسازی
        console.log('⏳ در حال حذف تمام جداول و sequenceها...');
        await client.query(WIPE_QUERY);
        
        console.log('✅ تمام جداول و داده‌های دیتابیس با موفقیت حذف (Wiped) شدند.');
        console.log('--- ✅ عملیات پاکسازی به پایان رسید. ---');

    } catch (error) {
        console.error('❌ خطا در عملیات پاکسازی دیتابیس:', error.message);
        console.error('**نکته:** اگر خطای "Connection terminated unexpectedly" رخ داد، مطمئن شوید `DATABASE_URL` و تنظیمات `ssl` صحیح هستند.');
    } finally {
        // بستن اتصال
        await client.end();
        process.exit(0);
    }
}

wipeDatabaseRaw();
