const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function formatChatHistory(messages, myUserId) {
  return messages
    .slice(-20)
    .map(m => {
      const sender = m.senderId === myUserId ? 'Me' : 'Match';
      return `${sender}: ${m.text}`;
    })
    .join('\n');
}

function buildSystemPrompt(persona) {
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

Always keep replies short, authentic, and conversational — like real chat messages, not essays.`;
}

function buildUserPrompt(matchProfile, chatHistory, lastMessage, count) {
  const interestsList = (matchProfile.interests || []).join(', ') || 'not specified';

  return `Match profile:
- Name: ${matchProfile.name}, Age: ${matchProfile.age}
- Bio: ${matchProfile.bio || 'no bio'}
- Interests: ${interestsList}
- Job: ${matchProfile.job || 'unknown'}
- School: ${matchProfile.school || 'unknown'}
- Distance: ${matchProfile.distance || 'unknown'}

Conversation history:
${chatHistory}

Last message from ${matchProfile.name}: "${lastMessage}"

Generate ${count} different reply suggestions. Make each one distinct in tone (e.g., funny, curious, flirty, direct). Detect the language from the conversation and use it.

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

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: buildSystemPrompt(persona),
    messages: [
      { role: 'user', content: buildUserPrompt(matchProfile, chatHistory, lastMessage, count) },
    ],
  });

  const raw = response.content[0].text.trim();

  // Extract JSON array from response
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error('Claude returned invalid format');
  }

  const suggestions = JSON.parse(match[0]);
  return suggestions.slice(0, 4);
}

module.exports = { generateSuggestions };
