/**
 * Webify Conversational Outreach Engine powered by Gemini, Groq & Free Neural LLM
 * Converts business leads worldwide (USA, UK, Canada, Australia) for:
 * 1. 24/7 Autonomous WhatsApp Lead Finder & Outreach Bots (300 to 600+ leads/day)
 * 2. Modern High-Converting Websites ($299 - $599)
 * 
 * STRICT HUMAN RULE:
 * - NO robot talking. NO bullet points. NO numbered lists. NO rocket emojis (🚀).
 * - Real human WhatsApp texting tone: casual, quick, confident, and direct.
 * - STRICT RULE: NO PHONE CALLS. Everything is handled directly inside this WhatsApp chat.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const AGENCY_NAME = process.env.AGENCY_NAME || 'Webify';

const SYSTEM_PROMPT = `You are LO, a 24-year-old tech entrepreneur and founder of Webify, texting casually on WhatsApp from your phone.

WHO WE ARE & WHAT WE BUILD:
- We build custom 24/7 Autonomous WhatsApp Lead Finder Bots for contractors and local businesses.
  Basically the software pulls 300 to 600 verified homeowner phone numbers every single day from Google Maps, Instagram, and local directories, and starts warm customer chats on autopilot.
- We also build modern, high-converting websites and landing pages ($299 to $599) designed to turn traffic into paying clients.
- We do NOT do phone calls. Everything is handled directly inside WhatsApp chat.

CRITICAL TONE RULES:
1. Talk like a REAL HUMAN texting a friend or fellow business owner on WhatsApp.
2. STRICTLY FORBIDDEN:
   - NEVER use bullet points (•, -, *) or numbered lists (1., 2.).
   - NEVER use rocket emojis (🚀), fire emojis, or cheesy sales emojis.
   - NEVER use markdown bold (**word**) or italics (*word*).
   - NEVER use robotic phrases: "I hope this finds you well", "As an AI", "In today's digital landscape", "Leverage synergies", "Dear business owner".
3. Length: Keep replies to 2 to 4 short, casual, natural sentences. Real founders text fast with their thumbs.
4. Language:
   - Natural conversational English for US/UK/CA/AU.
   - If the lead texts in Hindi or Hinglish, reply in warm, modern, natural conversational Hinglish ("Haan bhai, Webify se hu...").
5. Always acknowledge what the person said first before talking about our bots or websites.
6. The Offer: Always offer to run our scraper right now and send 20 free verified homeowner leads in their city right here in chat so they can see the quality.`;

/**
 * Call Free High-Speed Neural LLM (Pollinations OpenAI Endpoint)
 */
async function callPollinations(messages, temperature = 0.65) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const response = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai',
        messages: messages,
        temperature: temperature,
        max_tokens: 280
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    return null;
  }
}

/**
 * Call Gemini REST API (if GEMINI_API_KEY is present)
 */
async function callGemini(messages, temperature = 0.6) {
  if (!GEMINI_API_KEY) return null;
  try {
    const promptText = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: temperature,
          maxOutputTokens: 300
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    return null;
  }
}

/**
 * Call Groq API
 */
async function callGroq(messages, temperature = 0.6) {
  if (!GROQ_API_KEY || !GROQ_API_KEY.startsWith('gsk_')) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messages,
        temperature: temperature,
        max_tokens: 300
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content?.trim() || '';
    if (!content && data.choices?.[0]?.message?.reasoning) {
      content = data.choices[0].message.reasoning.trim();
    }
    return content;
  } catch (err) {
    return null;
  }
}

/**
 * Multi-Tier LLM Waterfall with Zero Downtime:
 * Gemini -> Groq -> Pollinations Free Neural Engine
 */
async function generateAiResponse(messages, temperature = 0.65) {
  // 1. Try Gemini
  if (GEMINI_API_KEY) {
    const geminiRes = await callGemini(messages, temperature);
    if (geminiRes && geminiRes.length > 10) return cleanHumanText(geminiRes);
  }

  // 2. Try Groq
  if (GROQ_API_KEY && GROQ_API_KEY.startsWith('gsk_')) {
    const groqRes = await callGroq(messages, temperature);
    if (groqRes && groqRes.length > 10) return cleanHumanText(groqRes);
  }

  // 3. High-Speed Free Neural LLM
  const pollinationsRes = await callPollinations(messages, temperature);
  if (pollinationsRes && pollinationsRes.length > 10) {
    return cleanHumanText(pollinationsRes);
  }

  return null;
}

/**
 * Strips all AI slop, bullet points, asterisks, and rocket emojis
 */
function cleanHumanText(raw) {
  if (!raw) return '';
  let text = raw.trim();

  // Strip markdown bold and italics
  text = text.replace(/\*\*(.*?)\*\*/g, '$1');
  text = text.replace(/\*(.*?)\*/g, '$1');
  text = text.replace(/__(.*?)__/g, '$1');

  // Strip bullet markers
  text = text.replace(/^[\s•\-\*]+\s*/gm, '');
  text = text.replace(/^\d+\.\s*/gm, '');

  // Strip unwanted emojis
  text = text.replace(/[🚀🔥💥✨🤖]/g, '');

  // Clean trailing spaces and excessive newlines
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

const TRADE_MAP = {
  plumber: 'plumbing',
  cleaner: 'cleaning',
  roofer: 'roofing',
  painter: 'painting',
  contractor: 'contracting / remodeling',
  remodeler: 'remodeling',
  mover: 'moving',
  electrician: 'electrical',
  landscaper: 'landscaping',
  handyman: 'handyman',
  carpenter: 'carpentry',
  hvac: 'HVAC / cooling & heating',
  flooring: 'flooring',
  masonry: 'masonry',
  medspa: 'medspa & aesthetics',
  chiropractor: 'chiropractic clinic',
  gym: 'fitness gym'
};

const GREETINGS = [
  'Hey!',
  'Hi!',
  'Hey there!',
  'Hello!',
  'Good morning!',
  'Good afternoon!',
  'Hi there!',
  'Hope your day is going well!',
  'Hey, hope you guys are doing well!'
];

const OPENERS = [
  'Quick question,',
  'Wanted to ask,',
  'Just checking in,',
  'Quick check with you guys—',
  'Reaching out to ask,',
  'Had a quick question for you,'
];

const INQUIRIES = [
  (trade, city) => `do you guys take on ${trade} jobs in the ${city} area?`,
  (trade, city) => `are you currently booking new ${trade} client work in ${city}?`,
  (trade, city) => `do you have availability for ${trade} projects around ${city} right now?`,
  (trade, city) => `do you guys service the ${city} area for ${trade}?`,
  (trade, city) => `are you taking on new ${trade} projects in ${city} this season?`,
  (trade, city) => `do you handle ${trade} jobs around ${city}?`,
  (trade, city) => `are you guys open for new ${trade} work in ${city} right now?`,
  (trade, city) => `are you currently accepting new ${trade} clients in the ${city} area?`,
  (trade, city) => `wanted to check if you guys handle ${trade} jobs in ${city}?`,
  (trade, city) => `quick check if you have availability for ${trade} projects in ${city}?`
];

function addInvisibleWatermark(text) {
  if (!text) return '';
  const zeroWidthChars = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u2060'];
  let mark = '';
  const len = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < len; i++) {
    mark += zeroWidthChars[Math.floor(Math.random() * zeroWidthChars.length)];
  }
  return text + mark;
}

function generateSpintaxOutreach(trade, city) {
  const g = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  const op = OPENERS[Math.floor(Math.random() * OPENERS.length)];
  const inq = INQUIRIES[Math.floor(Math.random() * INQUIRIES.length)](trade, city);
  return addInvisibleWatermark(`${g} ${op} ${inq}`);
}

function sanitizeOutreach(rawText, trade, city) {
  if (!rawText) return null;
  let text = rawText.trim();
  text = text.replace(/\[Name\]/gi, 'there');
  text = text.replace(/\[Business\/Website\]/gi, `${trade} business`);
  text = text.replace(/\[business\]/gi, `${trade} business`);
  text = text.replace(/\[website\]/gi, 'website');
  text = text.replace(/\[trade\]/gi, trade);
  text = text.replace(/\[city\]/gi, city);
  text = text.replace(/\[.*?\]/g, '');
  text = text.replace(/^["']|["']$/g, '');
  text = text.replace(/\(Reply STOP.*?\)/gi, '');
  text = text.replace(/\(Text STOP.*?\)/gi, '');
  text = text.replace(/\s+/g, ' ').trim();
  return addInvisibleWatermark(text);
}

/**
 * Generate Step 1 Initial Outreach Inquiry
 */
async function generateOutreachMessage(leadOrName = '', fallbackTrade = 'business', fallbackCity = 'your area', country = 'USA') {
  let lead = {};
  if (typeof leadOrName === 'object' && leadOrName !== null) {
    lead = leadOrName;
  } else {
    lead = { name: leadOrName, trade: fallbackTrade, city: fallbackCity, country: country };
  }

  let rawTrade = (lead.trade || lead.niche || 'local service').toLowerCase();
  const parenMatch = rawTrade.match(/^(.*?)\s*\((.*?)\)$/);
  let city = lead.city || 'your area';
  if (parenMatch) {
    rawTrade = parenMatch[1].trim();
    if (!lead.city || lead.city === 'your area') {
      city = parenMatch[2].trim();
    }
  }

  let trade = TRADE_MAP[rawTrade] || rawTrade;
  city = city.charAt(0).toUpperCase() + city.slice(1);

  try {
    const prompt = [
      {
        role: 'system',
        content: `You are texting a local service business on WhatsApp.
CRITICAL RULES:
- The business trade is "${trade}" in "${city}".
- Write a short, friendly 1-sentence inquiry asking if they currently service or take on ${trade} projects in ${city}.
- NEVER pitch, sell, or mention bots/websites.
- Write like a real local customer asking a simple question.`
      },
      {
        role: 'user',
        content: `Write a short 1-sentence WhatsApp inquiry to this ${trade} business in ${city}.`
      }
    ];

    const generated = await generateAiResponse(prompt, 0.7);
    const cleaned = sanitizeOutreach(generated, trade, city);
    if (cleaned && cleaned.length > 15 && cleaned.length < 120 && !cleaned.includes('[')) {
      return cleaned;
    }
  } catch (e) {}

  return generateSpintaxOutreach(trade, city);
}

/**
 * Smart Human Dialogue Fallback Generator (Context-Aware, 0% Robotic Slop)
 */
function generateSmartHumanFallback(incomingText, profile = {}) {
  const lower = (incomingText || '').toLowerCase();
  const trade = profile.trade || 'local business';
  const city = profile.city && profile.city !== 'your area' ? profile.city : 'your area';

  // Check Hinglish
  const isHinglish = /\b(kya|kaam|bhai|haan|nhi|nahi|batao|karo|kitna|paisa|rupaye|namaste|sahab)\b/i.test(lower);
  if (isHinglish) {
    if (lower.includes('paisa') || lower.includes('kitna') || lower.includes('cost') || lower.includes('rate')) {
      return `Bhai websites normally 15,000 se 25,000 ke beech hoti hain, aur automated lead bots custom rate pe depend karte hain kitni daily leads chahiye (upto 600/day). Aapko ek baar 20 sample verified customer leads nikaal ke bhej du free me?`;
    }
    return `Hey bhai! Mai LO, Webify se hu. Hum local businesses ke liye automated WhatsApp lead finder bots aur modern websites banate hain. Basically Google Maps se verified customer numbers nikaal ke WhatsApp pe direct leads connect karta hai bot. Kya aapko aapke area me 20 free sample leads bhej ke dikhau?`;
  }

  // Pricing inquiry
  if (/\b(price|cost|how much|pricing|rates|quote|fee|charge)\b/i.test(lower)) {
    return `Websites are around $299 to $599, and our automated lead bots depend on how many leads/day you want running (up to 600/day).

I can actually run our scraper for ${city} right now and send you 20 free verified homeowner leads right here in chat so you can check the quality yourself. Want me to pull them for you?`;
  }

  // "Who is this?" / "How did you get my number?"
  if (/\b(who is this|who are you|how did you get|who's this|where did you get)\b/i.test(lower)) {
    return `Hey! I'm LO from Webify. Found your business on Google while looking for solid ${trade} pros in ${city}.

We build custom WhatsApp lead finder bots and modern websites for contractors. Reached out directly to see if you guys could take on an extra 15-20 jobs this month, or if you're already booked out?`;
  }

  // "How does it work?" / "Tell me more" / "What bot?"
  if (/\b(how does it work|how it works|tell me more|details|what bot|explain|what do you mean)\b/i.test(lower)) {
    return `Basically the bot scans Google Maps, Instagram, and local public registries in ${city} for people looking for ${trade} services. It verifies their phone numbers and starts a warm WhatsApp chat on autopilot.

Most contractors get 10 to 25 warm job inquiries every week without paying for expensive ads. Want me to send a quick 30-second screen recording showing how it works?`;
  }

  // General positive confirmation ("Yes we do", "Yeah what do you need", "Available")
  return `Awesome, thanks for getting back! I actually run Webify—we build custom WhatsApp lead finder bots and high-converting websites for local contractors.

Basically our bots pull 300 to 600 verified homeowner leads a day off Google Maps and start chats on autopilot. Could you guys handle an extra 15-20 ${trade} jobs a month in ${city}, or is your schedule already packed?`;
}

/**
 * Handle incoming reply from a lead (The In-Chat Closing Flow)
 * Integrates persistent chat history, contact profile, and zero-fail multi-tier LLM.
 */
async function handleIncomingMessage(senderPhoneOrName, incomingText, history = [], profile = {}) {
  const lower = (incomingText || '').toLowerCase().trim();

  // 1. Opt-out check
  if (lower === 'stop' || lower === 'unsubscribe' || lower === 'remove' || lower.includes('stop')) {
    return "You've been successfully unsubscribed and your number removed from our records. Best wishes!";
  }

  // 2. Toxic / Angry Sentiment Trap: De-escalate immediately
  const TOXIC_PATTERNS = /\b(scam|fraud|police|cyber|complaint|spam|unsolicited|sue|lawsuit|lawyer|report|reported|harassment|fuck|fucking|fucker|asshole|bullshit|bakwas|chutiya|madarchod|bhosdike|harami|gandu|lawde|laude|mc|bc|fake|jail|court)\b/i;
  if (TOXIC_PATTERNS.test(lower)) {
    return "So sorry to disturb you! Removing your number from our records immediately. Wishing you all the best.";
  }

  // Construct context-rich conversation history
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT }
  ];

  // Append lead profile hints for hyper-personalized human response
  const trade = profile.trade || 'local service';
  const city = profile.city || 'their area';
  messages.push({
    role: 'system',
    content: `CONTEXT FOR THIS CHAT:
- Business Trade: ${trade}
- Location: ${city}
- Goal: Casually discuss how Webify's automated lead bots (300 to 600 leads/day from Google Maps) and high-converting websites help them book more jobs.
- Always offer to send 20 free verified sample leads directly right here in chat.`
  });

  // Append up to 10 past messages
  if (Array.isArray(history) && history.length > 0) {
    history.slice(-10).forEach(h => {
      messages.push({ role: h.role, content: h.content });
    });
  }

  messages.push({
    role: 'user',
    content: incomingText
  });

  // Call Multi-Tier LLM Waterfall
  try {
    const aiReply = await generateAiResponse(messages, 0.65);
    if (aiReply && aiReply.trim().length > 15) {
      return aiReply.trim();
    }
  } catch (err) {
    console.warn('⚠️ [AI Engine Warning]: LLM waterfall exhausted, using smart human conversational fallback.');
  }

  // High-converting, smart, context-aware human fallback (ZERO robotic copypasta)
  return generateSmartHumanFallback(incomingText, profile);
}

module.exports = {
  generateOutreachMessage,
  handleIncomingMessage,
  SYSTEM_PROMPT,
  AGENCY_NAME
};
