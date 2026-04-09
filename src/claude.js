const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function formatChatHistory(messages, myUserId) {
  return messages
    .slice(-20)
    .map(m => {
      const sender = m.senderId === myUserId ? 'Me' : 'Match';
      return `${sender}: ${m.text}`;
    })
    .join('\n');
}

function buildPrompt(persona, matchProfile, chatHistory, lastMessage, count) {
  const interestsList = (matchProfile.interests || []).join(', ') || 'not specified';

  return `You are helping ${persona.name || 'the user'} write replies on the Bumble dating app.

Write in their voice and style. Detect the language used in the conversation and reply in that same language. Default to Hebrew (עברית) if unclear.

User profile:
- Name: ${persona.name || ''}
- Age: ${persona.age || ''}
- City: ${persona.city || ''}
- Job: ${persona.job || ''}
- Personality traits: ${persona.traits || ''}
- Interests: ${persona.interests || ''}
- Looking for: ${persona.lookingFor || ''}
- Communication style: ${persona.communicationStyle || 'natural and friendly'}

Match profile:
- Name: ${matchProfile.name}, Age: ${matchProfile.age}
- Bio: ${matchProfile.bio || 'no bio'}
- Interests: ${interestsList}
- Job: ${matchProfile.job || 'unknown'}
- School: ${matchProfile.school || 'unknown'}
- Distance: ${matchProfile.distance || 'unknown'}

Conversation history:
${chatHistory}

Last message from ${matchProfile.name}: "${lastMessage}"

Generate ${count} different reply suggestions. Make each one distinct in tone (e.g., funny, curious, flirty, direct). Keep replies short and conversational — like real chat messages, not essays.

Respond ONLY with a JSON array, no extra text:
[
  {"suggestion": "...", "tone": "funny"},
  {"suggestion": "...", "tone": "curious"}
]`;
}

async function generateSuggestions(persona, matchProfile, messages, myUserId) {
  if (!messages || messages.length === 0) {
    return [{ suggestion: 'היי! מה שלומך? 😊', tone: 'friendly' }];
  }

  const lastMsg = messages[messages.length - 1];

  // Don't suggest if the last message was sent by the user
  if (lastMsg.senderId === myUserId) {
    return [];
  }

  const chatHistory = formatChatHistory(messages, myUserId);
  const lastMessage = lastMsg.text;

  // Fewer suggestions for short conversations
  const count = messages.length <= 2 ? 2 : Math.min(4, messages.length);

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(
    buildPrompt(persona, matchProfile, chatHistory, lastMessage, count)
  );

  const raw = result.response.text().trim();

  // Extract JSON array from response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error('Gemini returned invalid format');
  }

  const suggestions = JSON.parse(match[0]);
  return suggestions.slice(0, 4);
}

module.exports = { generateSuggestions };
