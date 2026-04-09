require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bumble = require('./src/bumble');
const { generateSuggestions } = require('./src/claude');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const PERSONA_FILE = path.join(DATA_DIR, 'persona.json');

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SESSION_FILE)) fs.writeFileSync(SESSION_FILE, '{}');
if (!fs.existsSync(PERSONA_FILE)) {
  fs.writeFileSync(PERSONA_FILE, JSON.stringify({
    name: '', age: '', city: '', job: '',
    traits: '', interests: '', lookingFor: '',
    communicationStyle: '', languagePreference: 'Hebrew'
  }, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Session ---

app.get('/api/session', (req, res) => {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  res.json({ configured: !!session.token });
});

app.post('/api/session', (req, res) => {
  const { token, device_id } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ token, device_id: device_id || '' }, null, 2));
  res.json({ ok: true });
});

// --- Persona ---

app.get('/api/persona', (req, res) => {
  const persona = JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf8'));
  res.json(persona);
});

app.post('/api/persona', (req, res) => {
  const current = JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf8'));
  const updated = { ...current, ...req.body };
  fs.writeFileSync(PERSONA_FILE, JSON.stringify(updated, null, 2));
  res.json({ ok: true });
});

// --- Matches ---

app.get('/api/matches', async (req, res) => {
  try {
    const matches = await bumble.getMatches();
    res.json(matches);
  } catch (err) {
    handleBumbleError(err, res);
  }
});

// --- Match Profile ---

app.get('/api/match/:id/profile', async (req, res) => {
  try {
    const profile = await bumble.getMatchProfile(req.params.id);
    res.json(profile);
  } catch (err) {
    handleBumbleError(err, res);
  }
});

// --- Messages ---

app.get('/api/match/:id/messages', async (req, res) => {
  try {
    const messages = await bumble.getMessages(req.params.id);
    res.json(messages);
  } catch (err) {
    handleBumbleError(err, res);
  }
});

// --- AI Suggestions ---

app.post('/api/match/:id/suggest', async (req, res) => {
  try {
    const persona = JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf8'));
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));

    const [profile, messages] = await Promise.all([
      bumble.getMatchProfile(req.params.id),
      bumble.getMessages(req.params.id),
    ]);

    const suggestions = await generateSuggestions(persona, profile, messages, session.user_id);
    res.json({ suggestions, profile });
  } catch (err) {
    handleBumbleError(err, res);
  }
});

// --- Send Message ---

app.post('/api/match/:id/send', async (req, res) => {
  const { text, matchId } = req.body;
  if (!text || !matchId) return res.status(400).json({ error: 'text and matchId required' });
  try {
    await bumble.sendMessage(matchId, text);
    res.json({ ok: true });
  } catch (err) {
    handleBumbleError(err, res);
  }
});

// --- Bulk Send ---

app.post('/api/bulk-send', async (req, res) => {
  const { targets } = req.body;
  // targets: [{ userId, matchId, name, message }]
  if (!Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: 'targets array required' });
  }

  const results = [];
  for (const t of targets) {
    try {
      await bumble.sendMessage(t.matchId, t.message);
      results.push({ userId: t.userId, name: t.name, ok: true });
    } catch (err) {
      results.push({ userId: t.userId, name: t.name, ok: false, error: err.message });
    }
    // Small delay between sends to avoid rate limiting
    await sleep(1500);
  }

  res.json({ results });
});

// --- Helpers ---

function handleBumbleError(err, res) {
  if (err.code === 'NO_TOKEN') {
    return res.status(401).json({ error: 'NO_TOKEN', message: 'Please set up your Bumble token first.' });
  }
  if (err.code === 'TOKEN_EXPIRED') {
    return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Your Bumble token has expired. Please re-capture it.' });
  }
  console.error(err);
  res.status(500).json({ error: 'API_ERROR', message: err.message });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Serve frontend pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/bulk', (req, res) => res.sendFile(path.join(__dirname, 'public/bulk.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public/settings.html')));
app.get('/setup', (req, res) => res.sendFile(path.join(__dirname, 'public/setup.html')));

app.listen(PORT, '0.0.0.0', () => {
  const interfaces = require('os').networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(interfaces)) {
    for (const i of iface) {
      if (i.family === 'IPv4' && !i.internal) { localIP = i.address; break; }
    }
  }
  console.log(`\n🚀 Bumble AI Assistant running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   iPhone:  http://${localIP}:${PORT}\n`);
});
