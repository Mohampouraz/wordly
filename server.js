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

        // Disable foreign key constraints temporarily
        await client.query('SET session_replication_role = "replica"');

        // Clear all tables
        for (const row of result.rows) {
            const tableName = row.tablename;
            await client.query(`DELETE FROM "${tableName}"`);
            console.log(`✅ Cleared table: ${tableName}`);
        }

        // Re-enable foreign key constraints
        await client.query('SET session_replication_role = "origin"');

        console.log('🎉 Database wiped successfully!');
        console.log(`📊 Cleared ${result.rows.length} tables`);

    } catch (error) {
        console.error('❌ Error wiping database:', error);
    } finally {
        await client.end();
        console.log('🔌 Database connection closed');
    }
}

// Run the wipe function
wipeDatabase();
