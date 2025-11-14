const { Client } = require('pg');

const dbConfig = {
    connectionString: 'postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame',
    ssl: {
        rejectUnauthorized: false
    }
};

async function wipeDatabase() {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Connected to database');

        // Get all table names
        const tablesQuery = `
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
        `;
        const result = await client.query(tablesQuery);
        
        if (result.rows.length === 0) {
            console.log('ℹ️ Database is already empty');
            return;
        }

        console.log('🗑️ Starting to wipe database...');
        console.log(`📊 Found ${result.rows.length} tables to clear`);

        // Clear all tables using TRUNCATE with CASCADE to handle foreign keys
        for (const row of result.rows) {
            const tableName = row.tablename;
            try {
                await client.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
                console.log(`✅ Cleared table: ${tableName}`);
            } catch (error) {
                console.log(`⚠️ Could not TRUNCATE ${tableName}, trying DELETE...`);
                // Fallback to DELETE if TRUNCATE fails
                await client.query(`DELETE FROM "${tableName}"`);
                console.log(`✅ Cleared table: ${tableName} (using DELETE)`);
            }
        }

        console.log('🎉 Database wiped successfully!');

    } catch (error) {
        console.error('❌ Error wiping database:', error);
    } finally {
        await client.end();
        console.log('🔌 Database connection closed');
    }
}

// Run the wipe function
wipeDatabase();
