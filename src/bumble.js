const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '../data/session.json');

// Bumble uses regional API endpoints. EU/Israel uses bmaeu, Americas uses am1.
// We try bmaeu first (EU), fall back to am1 if needed.
const ENDPOINTS = [
  'https://bmaeu.bumble.com/mwebapi.phtml',
  'https://am1.bumble.com/mwebapi.phtml',
];

function loadSession() {
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getHeaders(session) {
  return {
    'Authorization': `Bearer ${session.token}`,
    'X-Pinguid': session.device_id || '',
    'X-App-Version': '6.0.0',
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': 'Bumble/60000 CFNetwork/1498.700.2 Darwin/23.6.0',
    'Accept': 'application/json',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8',
  };
}

// Build the Bumble POST body for a given action
function buildBody(action, params = {}) {
  return {
    version: 1,
    message_type: action,
    message: params,
  };
}

async function apiCall(action, params = {}) {
  const session = loadSession();
  if (!session.token) {
    const err = new Error('NO_TOKEN');
    err.code = 'NO_TOKEN';
    throw err;
  }

  // Try each endpoint until one works
  let lastErr;
  for (const base of ENDPOINTS) {
    try {
      const response = await axios.post(
        `${base}?${action}`,
        buildBody(action, params),
        { headers: getHeaders(session), timeout: 15000 }
      );
      return response.data;
    } catch (err) {
      if (err.response && err.response.status === 401) {
        const authErr = new Error('TOKEN_EXPIRED');
        authErr.code = 'TOKEN_EXPIRED';
        throw authErr;
      }
      lastErr = err;
    }
  }
  throw lastErr;
}

// Fetch list of matches/conversations
async function getMatches() {
  const data = await apiCall('GET_CONNECTIONS', {
    connection_page_token: '',
    page_size: 50,
  });

  const section = data?.message?.section || [];
  const matches = [];

  for (const s of section) {
    for (const conn of (s.connections || [])) {
      const user = conn.user || {};
      matches.push({
        id: user.user_id,
        name: user.name,
        age: user.age,
        thumbnail: user.profile_photo?.large_photo?.url || null,
        lastMessage: conn.last_activity?.message?.message_body || '',
        lastActivity: conn.last_activity?.date,
        isUnread: conn.is_new,
        matchId: conn.match_id,
      });
    }
  }

  return matches;
}

// Fetch full profile of a match
async function getMatchProfile(userId) {
  const data = await apiCall('GET_USER', { user_id: userId });
  const user = data?.message?.user || {};

  const photos = (user.album?.photos || []).map(p => ({
    url: p.large_photo?.url || p.url,
  }));

  const interests = (user.interests?.selected_hashtags || []).map(t => t.name);

  const sections = user.profile?.social_sections?.sections || [];
  let bio = '';
  let job = '';
  let school = '';

  for (const sec of sections) {
    if (sec.id === 'about_me') bio = sec.content?.text || '';
    if (sec.id === 'my_job') job = sec.content?.text || '';
    if (sec.id === 'education') school = sec.content?.text || '';
  }

  return {
    id: userId,
    name: user.name,
    age: user.age,
    bio,
    interests,
    job,
    school,
    distance: user.distance_long,
    photos,
  };
}

// Fetch messages in a conversation
async function getMessages(matchId) {
  const data = await apiCall('SERVER_OPEN_CHAT', { chat_instance_id: matchId });
  const messages = data?.message?.chat_messages || [];

  return messages.map(m => ({
    id: m.id,
    senderId: m.user_id,
    text: m.message_body,
    timestamp: m.date,
  }));
}

// Send a message to a match
async function sendMessage(matchId, text) {
  await apiCall('SERVER_SEND_MESSAGE', {
    chat_instance_id: matchId,
    message: { message_body: text, type: 'chat_message_type_text' },
    uid: Date.now().toString(),
  });
}

module.exports = { getMatches, getMatchProfile, getMessages, sendMessage };
