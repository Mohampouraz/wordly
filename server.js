// server.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const pool = new Pool({
    connectionString: 'postgresql://abolfazl:gecrw6BsIFRJfASXUuG3NTepMnv1Hqpx@dpg-d3qbq8d6ubrc73fqfim0-a.frankfurt-postgres.render.com/wordlygame',
    ssl: { rejectUnauthorized: false }
});

// پاک کردن دیتابیس موجود
async function resetDatabase() {
    try {
        await pool.query('DROP TABLE IF EXISTS words CASCADE');
        await pool.query('DROP TABLE IF EXISTS categories CASCADE');
        await pool.query('DROP TABLE IF EXISTS games CASCADE');
        await pool.query('DROP TABLE IF EXISTS users CASCADE');
        await pool.query('DROP TABLE IF EXISTS rankings CASCADE');

        // ایجاد جداول جدید
        await pool.query(`
            CREATE TABLE categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL
            );
        `);
        await pool.query(`
            CREATE TABLE words (
                id SERIAL PRIMARY KEY,
                word VARCHAR(255) NOT NULL,
                category_id INTEGER REFERENCES categories(id),
                creator_id INTEGER
            );
        `);
        await pool.query(`
            CREATE TABLE users (
                id BIGINT PRIMARY KEY,
                username VARCHAR(255)
            );
        `);
        await pool.query(`
            CREATE TABLE games (
                id SERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(id),
                word_id INTEGER REFERENCES words(id),
                revealed TEXT[],
                guessed JSONB[],
                remaining_attempts INTEGER,
                max_attempts INTEGER,
                score INTEGER DEFAULT 0,
                correct_guesses INTEGER DEFAULT 0,
                hints_used INTEGER DEFAULT 0
            );
        `);
        await pool.query(`
            CREATE TABLE rankings (
                id SERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(id),
                score INTEGER,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // اضافه کردن داده‌های نمونه
        const catRes = await pool.query("INSERT INTO categories (name) VALUES ('حیوانات'), ('میوه‌ها') RETURNING id");
        const catIds = catRes.rows.map(r => r.id);
        await pool.query("INSERT INTO words (word, category_id) VALUES ('گربه', $1), ('سیب', $2)", [catIds[0], catIds[1]]);

        console.log('دیتابیس ریست شد.');
    } catch (err) {
        console.error('خطا در ریست دیتابیس:', err);
    }
}

resetDatabase();

// لیست چالش‌ها
app.get('/challenges', async (req, res) => {
    try {
        const result = await pool.query('SELECT w.id, c.name as category FROM words w JOIN categories c ON w.category_id = c.id');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// شروع چالش
app.post('/start-challenge/:challengeId', async (req, res) => {
    const { userId } = req.body;
    const challengeId = req.params.challengeId;
    try {
        // ثبت کاربر اگر وجود ندارد
        await pool.query('INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, 'ناشناس']);

        const wordRes = await pool.query('SELECT word FROM words WHERE id = $1', [challengeId]);
        const word = wordRes.rows[0].word;
        const length = word.length;
        const maxAttempts = Math.floor(1.5 * length);
        const revealed = Array(length).fill(null);

        const gameRes = await pool.query(
            'INSERT INTO games (user_id, word_id, revealed, guessed, remaining_attempts, max_attempts) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [userId, challengeId, revealed, [], maxAttempts, maxAttempts]
        );
        res.json(gameRes.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// حدس حرف
app.post('/guess/:gameId', async (req, res) => {
    const { guess } = req.body;
    const gameId = req.params.gameId;
    try {
        const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
        let game = gameRes.rows[0];
        const wordRes = await pool.query('SELECT word FROM words WHERE id = $1', [game.word_id]);
        const word = wordRes.rows[0].word.toLowerCase();

        if (game.remaining_attempts <= 0) return res.json({ success: false, message: 'فرصت تمام شد.' });

        const positions = [];
        let correct = false;
        for (let i = 0; i < word.length; i++) {
            if (word[i] === guess && !game.revealed[i]) {
                game.revealed[i] = guess.toUpperCase();
                positions.push(i);
                correct = true;
                game.correct_guesses++;
            }
        }

        game.guessed.push({ letter: guess.toUpperCase(), correct });
        game.remaining_attempts--;

        await pool.query(
            'UPDATE games SET revealed = $1, guessed = $2, remaining_attempts = $3, correct_guesses = $4 WHERE id = $5',
            [game.revealed, game.guessed, game.remaining_attempts, game.correct_guesses, gameId]
        );

        res.json({ success: true, game: { ...game, word }, correct, positions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// راهنمایی
app.post('/hint/:gameId', async (req, res) => {
    const { position } = req.body;
    const gameId = req.params.gameId;
    try {
        const gameRes = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
        let game = gameRes.rows[0];
        if (game.remaining_attempts < 2 || game.hints_used >= 3) return res.json({ success: false, message: 'راهنمایی مجاز نیست.' });

        const wordRes = await pool.query('SELECT word FROM words WHERE id = $1', [game.word_id]);
        const word = wordRes.rows[0].word.toLowerCase();
        const letter = word[position].toUpperCase();

        game.revealed[position] = letter;
        game.remaining_attempts -= 2;
        game.hints_used++;

        await pool.query(
            'UPDATE games SET revealed = $1, remaining_attempts = $2, hints_used = $3 WHERE id = $4',
            [game.revealed, game.remaining_attempts, game.hints_used, gameId]
        );

        res.json({ success: true, game: { ...game, word }, letter });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// پایان بازی
app.post('/end-game/:gameId', async (req, res) => {
    const { score } = req.body;
    const gameId = req.params.gameId;
    try {
        const gameRes = await pool.query('SELECT user_id FROM games WHERE id = $1', [gameId]);
        const userId = gameRes.rows[0].user_id;
        await pool.query('INSERT INTO rankings (user_id, score) VALUES ($1, $2)', [userId, score]);
        await pool.query('DELETE FROM games WHERE id = $1', [gameId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// انصراف
app.post('/quit/:gameId', async (req, res) => {
    const gameId = req.params.gameId;
    try {
        const gameRes = await pool.query('SELECT user_id FROM games WHERE id = $1', [gameId]);
        const userId = gameRes.rows[0].user_id;
        await pool.query('INSERT INTO rankings (user_id, score) VALUES ($1, 0)', [userId]);
        await pool.query('DELETE FROM games WHERE id = $1', [gameId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`سرور در پورت ${port} اجرا شد.`);
});
