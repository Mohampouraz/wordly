const { Client } = require('pg');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:uADpBikvq08jFXFWHURmINea1L5oz389@dpg-d4bn1mer433s73d1tiug-a.frankfurt-postgres.render.com/wordlygame_yqt5";

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

        // لیست تمام جداول
        const tablesQuery = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `;
        const tablesResult = await client.query(tablesQuery);
        const tables = tablesResult.rows.map(row => row.table_name);

        if (tables.length === 0) {
            console.log('No tables found in database');
            return;
        }

        // غیرفعال کردن constraintها
        await client.query('SET session_replication_role = replica;');

        // حذف تمام جداول
        for (const table of tables) {
            console.log(`Dropping table: ${table}`);
            await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        }

        // فعال کردن مجدد constraintها
        await client.query('SET session_replication_role = DEFAULT;');

        console.log('Database reset completed successfully!');
        console.log(`Dropped ${tables.length} tables: ${tables.join(', ')}`);

    } catch (error) {
        console.error('Error resetting database:', error);
    } finally {
        await client.end();
        console.log('Database connection closed');
    }
}

// اجرای تابع
resetDatabase();
