const { Client } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;

async function resetDatabase() {
    const client = new Client({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        await client.connect();
        console.log('Connected to database successfully');

        // دریافت لیست تمام جداول
        const tablesQuery = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
        `;
        const tablesResult = await client.query(tablesQuery);
        const tables = tablesResult.rows.map(row => row.table_name);

        if (tables.length === 0) {
            console.log('No tables found in database');
            return;
        }

        console.log(`Found ${tables.length} tables:`, tables);

        // حذف جداول به ترتیب و با CASCADE برای مدیریت وابستگی‌ها
        for (const table of tables) {
            try {
                console.log(`Dropping table: ${table}`);
                await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
                console.log(`Table ${table} dropped successfully`);
            } catch (error) {
                console.error(`Error dropping table ${table}:`, error.message);
            }
        }

        console.log('Database reset completed successfully!');

    } catch (error) {
        console.error('Error resetting database:', error);
    } finally {
        await client.end();
        console.log('Database connection closed');
    }
}

// اجرای تابع
resetDatabase();
