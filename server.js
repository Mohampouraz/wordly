const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const app = express();

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8217028556:AAFDNQfmRYuUnto4gb2dAUNyWjKanRZldfA";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://wordlybot.xo.je";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://abolfazl:ZnczfHE6NUZWmPfYtPQjUdsuaseuFoHS@dpg-d3q9nrm3jp1c738f47pg-a.frankfurt-postgres.render.com/wordgame_lbh3";

// Database connection
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all active games
app.get('/api/games', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, u.username as creator_name 
      FROM games g 
      JOIN users u ON g.creator_id = u.id 
      WHERE g.status = 'active'
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new game
app.post('/api/games', async (req, res) => {
  const { creatorId, word, category, mode, maxPlayers } = req.body;
  
  try {
    // Generate unique game code
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    const result = await pool.query(
      `INSERT INTO games (code, word, category, mode, creator_id, max_players, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'active') 
       RETURNING *`,
      [code, word, category, mode, creatorId, maxPlayers]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Join a game
app.post('/api/games/:id/join', async (req, res) => {
  const gameId = req.params.id;
  const { userId } = req.body;
  
  try {
    // Check if game exists and has space
    const gameResult = await pool.query(
      'SELECT * FROM games WHERE id = $1 AND status = $2',
      [gameId, 'active']
    );
    
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const game = gameResult.rows[0];
    
    // Check if user is already in the game
    const playerResult = await pool.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND user_id = $2',
      [gameId, userId]
    );
    
    if (playerResult.rows.length > 0) {
      return res.status(400).json({ error: 'User already in game' });
    }
    
    // Check if game is full
    const playerCountResult = await pool.query(
      'SELECT COUNT(*) FROM game_players WHERE game_id = $1',
      [gameId]
    );
    
    const playerCount = parseInt(playerCountResult.rows[0].count);
    if (playerCount >= game.max_players) {
      return res.status(400).json({ error: 'Game is full' });
    }
    
    // Add player to game
    await pool.query(
      'INSERT INTO game_players (game_id, user_id) VALUES ($1, $2)',
      [gameId, userId]
    );
    
    res.json({ message: 'Joined game successfully' });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit a guess
app.post('/api/games/:id/guess', async (req, res) => {
  const gameId = req.params.id;
  const { userId, letter } = req.body;
  
  try {
    // Record the guess
    await pool.query(
      'INSERT INTO guesses (game_id, user_id, letter, timestamp) VALUES ($1, $2, $3, NOW())',
      [gameId, userId, letter]
    );
    
    // Check if the guess is correct and update game state
    const gameResult = await pool.query('SELECT word FROM games WHERE id = $1', [gameId]);
    const game = gameResult.rows[0];
    const isCorrect = game.word.includes(letter);
    
    res.json({ correct: isCorrect });
  } catch (error) {
    console.error('Error submitting guess:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user ranking
app.get('/api/ranking', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.full_name, COALESCE(SUM(g.score), 0) as total_score
      FROM users u
      LEFT JOIN game_results g ON u.id = g.user_id
      GROUP BY u.id, u.username, u.full_name
      ORDER BY total_score DESC
      LIMIT 100
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ranking:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get online players
app.get('/api/players/online', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT u.id, u.username, u.full_name, u.avatar_url
      FROM users u
      JOIN sessions s ON u.id = s.user_id
      WHERE s.expires_at > NOW()
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching online players:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Web app URL: ${WEB_APP_URL}`);
});
