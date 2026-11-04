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

require('dotenv').config();
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const AGENCY_NAME = process.env.AGENCY_NAME || 'Webify';

const SYSTEM_PROMPT = `You are Shaurya from Webify, texting casually on WhatsApp from your phone.

IDENTITY & NAME RULE:
- Your name is Shaurya. If asked who you are or when introducing yourself, always say "I'm Shaurya from Webify".
- NEVER use "LO" or any other name.

WHO WE ARE & WHAT WE BUILD:
- We build custom 24/7 Autonomous WhatsApp Lead Finder Bots and modern high-converting websites for contractors and local businesses (USA, UK, Canada, Australia).
- We help local contractors book 15 to 30+ extra high-paying client jobs every month on autopilot.
- We do NOT do phone calls. Everything is handled directly inside WhatsApp chat.

CRITICAL PRICING & QUOTE RULE:
- NEVER QUOTE PRICES OR DOLLAR/RUPEE NUMBERS YOURSELF.
- If the lead asks about price, cost, rates, packages, or how much it costs (e.g. "how much?", "price?", "cost?", "pricing?", "rates?", "kitna charge hai?", "kitna paisa?"):
  You MUST tell them:
  "Our owner will assist you directly in this chat in under 20 minutes with exact custom pricing and packages! In the meantime, what kind of monthly volume or setup are you looking for?"
  For Hindi/Hinglish:
  "Humare owner aapko isi chat me agle 20 minute ke andar pricing aur packages ke baare me personally assist karenge! Tab tak aap bataye normally aapko kaisa setup ya daily kitni leads chahiye?"

REPAIR / SERVICE CONFUSION CLARIFICATION RULE:
- If the lead asks for "pictures", "photos", "what kind of job", "address", "leak", or thinks you are a customer needing repairs or service:
  IMMEDIATELY clarify politely:
  "Hey, sorry for any confusion! I'm Shaurya from Webify, not a customer needing repairs. We build modern high-converting websites and automated lead generation systems for local contractors. Reached out to see if you guys are currently looking to take on more jobs this month?"

CRITICAL CONVERSATIONAL MEMORY & TONE RULES:
1. TALK LIKE A REAL HUMAN texting a friend or fellow business owner on WhatsApp. Short, direct, conversational (1 to 3 short sentences).
2. REMEMBER THE CONVERSATION HISTORY:
   - NEVER re-introduce yourself or repeat "I'm Shaurya from Webify" if you already introduced yourself earlier in the chat history!
   - NEVER repeat your standard pitch if you already explained what we do.
   - If they say "yes", "sure", "okay", or "send them", DO NOT repeat the pitch! Say you're pulling 20 verified leads right now and ask if they prefer any specific zip code/area or the whole city.
   - If they ask a specific question, answer that exact question directly first.
3. STRICTLY FORBIDDEN:
   - NEVER use bullet points (•, -, *) or numbered lists (1., 2.).
   - NEVER use rocket emojis (🚀), fire emojis, or cheesy sales emojis.
   - NEVER use markdown bold (**word**) or italics (*word*).
   - NEVER sound like a customer support bot or AI assistant.
4. LANGUAGE:
   - Natural conversational English for US/UK/CA/AU.
   - If the lead texts in Hindi or Hinglish, reply in warm, modern, natural conversational Hinglish ("Haan bhai, Webify se hu...").`;

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
  const modelsToTry = [GROQ_MODEL, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];

  for (const mdl of modelsToTry) {
    if (!mdl) continue;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: mdl,
          messages: messages,
          temperature: temperature,
          max_tokens: 1024
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (!response.ok) continue;

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content?.trim() || '';
      if (!content && data.choices?.[0]?.message?.reasoning) {
        content = data.choices[0].message.reasoning.trim();
      }
      if (content && content.length > 5) {
        return content;
      }
    } catch (err) {
      continue;
    }
  }
  return null;
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
  (n) => n ? `Hey ${n},` : `Hey,`,
  (n) => n ? `Hi ${n}!` : `Hi!`,
  (n) => n ? `Hello ${n},` : `Hello,`,
  (n) => n ? `Hey ${n}! Quick question—` : `Quick question—`,
  (n) => n ? `Hi ${n}, wanted to check:` : `Wanted to check:`,
  (n) => `Hey there,`,
  (n) => n ? `hey ${n},` : `hey,`,
  (n) => n ? `Hi ${n}—` : `Hi there—`
];

const INQUIRIES = [
  (t, c) => `do you guys service ${c} for ${t} work?`,
  (t, c) => `are you currently taking on new ${t} jobs around ${c}?`,
  (t, c) => `wanted to ask if you guys handle ${t} projects in the ${c} area?`,
  (t, c) => `do you have room on the schedule for more ${t} work in ${c}?`,
  (t, c) => `are you open for new ${t} clients in ${c} right now?`,
  (t, c) => `do you guys do ${t} jobs in ${c}?`,
  (t, c) => `wanted to see if you have availability for ${t} work around ${c}?`,
  (t, c) => `is your schedule open for ${t} projects in ${c}?`,
  (t, c) => `are you guys still taking ${t} jobs in ${c}?`,
  (t, c) => `wanted to check if your crew handles ${t} work in ${c}?`
];

const SIGN_OFFS = [
  '',
  ' Thanks!',
  ' Appreciate it.',
  ' Let me know!',
  ' Thanks in advance.',
  ' —thanks!'
];

const DIRECT_WEBIFY_TEMPLATES = [
  (trade, city) => `Hey! I'm Shaurya from Webify. We build modern high-converting websites and automated customer outreach for ${trade} companies in ${city}. Are you guys looking to take on more client jobs this month?`,
  (trade, city) => `Hi there! I'm Shaurya from Webify. Reaching out because we help local ${trade} contractors around ${city} bring in more high-paying clients through custom websites and automated outreach. Do you have capacity for more jobs right now?`,
  (trade, city) => `Hey! Shaurya from Webify here. We build automated client acquisition systems and modern websites for ${trade} businesses in ${city}. Wanted to check if you guys are currently looking for more client work?`,
  (trade, city) => `Hi! I'm Shaurya from Webify. Found your business while researching top ${trade} services in ${city}. We help contractors book 15-25 extra jobs every month through modern websites and automated outreach. Would you be open to taking on more projects?`,
  (trade, city) => `Hey! Quick message—I'm Shaurya from Webify. We design high-converting websites and automated WhatsApp client outreach for ${trade} pros in ${city}. Are you guys currently accepting more work?`,
  (trade, city) => `Hi! Shaurya from Webify here. Reaching out to see if your ${trade} business in ${city} has room on the schedule for more qualified homeowner inquiries this month? We build custom websites and automated client systems for contractors.`
];

function addInvisibleWatermark(text) {
  if (!text) return '';
  const zeroWidthChars = ['​', '‌', '‍', '﻿', '⁠'];
  let mark = '';
  const len = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < len; i++) {
    mark += zeroWidthChars[Math.floor(Math.random() * zeroWidthChars.length)];
  }
  return text + mark;
}

/**
 * High-Entropy Permutation Matrix
 * Combines 8 greetings x 10 inquiries x 6 sign-offs (480 permutations)
 */
function generateSpintaxOutreach(trade, city, name = '', mode = 'stealth_hook') {
  if (mode === 'direct_pitch') {
    const template = DIRECT_WEBIFY_TEMPLATES[Math.floor(Math.random() * DIRECT_WEBIFY_TEMPLATES.length)];
    return addInvisibleWatermark(template(trade, city));
  }
  const g = GREETINGS[Math.floor(Math.random() * GREETINGS.length)](name);
  const inq = INQUIRIES[Math.floor(Math.random() * INQUIRIES.length)](trade, city);
  const s = SIGN_OFFS[Math.floor(Math.random() * SIGN_OFFS.length)];
  const fullText = `${g} ${inq}${s}`.trim();
  return addInvisibleWatermark(fullText);
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
 * Generate Step 1 Initial Outreach
 * Supports 2-Step Stealth Hook (Anti-Spam Immunity) and Direct Pitch
 */
async function generateOutreachMessage(leadOrName = '', fallbackTrade = 'contractor', fallbackCity = 'your area', country = 'USA', mode = 'stealth_hook') {
  let lead = {};
  if (typeof leadOrName === 'object' && leadOrName !== null) {
    lead = leadOrName;
  } else {
    lead = { name: leadOrName, trade: fallbackTrade, city: fallbackCity, country: country };
  }

  let rawTrade = (lead.trade || lead.niche || 'local contractor').toLowerCase();
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
  const name = (lead.name || '').trim();

  // Stealth hook mode produces pure conversational inquiry with 0% spam flags
  if (mode === 'stealth_hook') {
    return generateSpintaxOutreach(trade, city, name, 'stealth_hook');
  }

  try {
    const prompt = [
      {
        role: 'system',
        content: `You are Shaurya from Webify, texting a local ${trade} business in ${city}.
CRITICAL RULES:
- Always be STRAIGHT TO THE POINT.
- Introduce yourself as "I'm Shaurya from Webify" or "Shaurya from Webify here".
- Explain in 1 sentence that we build modern high-converting websites and automated client outreach systems that help local ${trade} contractors get more high-paying jobs.
- Ask if they are currently looking to take on more client work or jobs this month.
- NEVER pretend to be a customer needing repairs or service.
- Real human WhatsApp tone: friendly, casual, confident, 2 short sentences max.`
      },
      {
        role: 'user',
        content: `Write a short, direct 2-sentence WhatsApp outreach message to this ${trade} business in ${city}.`
      }
    ];

    const generated = await generateAiResponse(prompt, 0.7);
    const cleaned = sanitizeOutreach(generated, trade, city);
    if (cleaned && cleaned.length > 20 && cleaned.length < 180 && !cleaned.includes('[')) {
      return cleaned;
    }
  } catch (e) {}

  return generateSpintaxOutreach(trade, city, name, 'direct_pitch');
}

/**
 * Smart Human Dialogue Fallback Generator (Context-Aware, 0% Robotic Slop)
 */
function generateSmartHumanFallback(incomingText, profile = {}, history = []) {
  const lower = (incomingText || '').toLowerCase();
  const trade = profile.trade || 'local business';
  const city = profile.city && profile.city !== 'your area' ? profile.city : 'your area';
  const hasHistory = Array.isArray(history) && history.length > 0;

  // Check Hinglish
  const isHinglish = /\b(kya|kaam|bhai|haan|nhi|nahi|batao|karo|kitna|paisa|rupaye|namaste|sahab)\b/i.test(lower);
  if (isHinglish) {
    if (lower.includes('paisa') || lower.includes('kitna') || lower.includes('cost') || lower.includes('rate') || lower.includes('price')) {
      return `Humare owner aapko isi chat me agle 20 minute ke andar pricing aur packages ke baare me personally assist karenge! Tab tak aap bataye normally aapko kaisa setup ya daily kitni leads chahiye?`;
    }
    if (hasHistory) {
      return `Haanji bhai, bilkul! Main aapko 20 free verified sample leads ready karke bhej raha hu. Aapko poore city ki chahiye ya koi specific area ya pincode?`;
    }
    return `Hey bhai! Mai Shaurya, Webify se hu. Hum local businesses ke liye automated WhatsApp lead finder bots aur modern websites banate hain. Basically Google Maps se verified customer numbers nikaal ke WhatsApp pe direct leads connect karta hai bot. Kya aapko aapke area me 20 free sample leads bhej ke dikhau?`;
  }

  // Pricing inquiry
  if (/\b(price|cost|how much|pricing|rates|quote|fee|charge|package|packages)\b/i.test(lower)) {
    return `Our owner will assist you directly in this chat in under 20 minutes with exact custom pricing and packages! In the meantime, what kind of monthly volume or setup are you looking for?`;
  }

  // Repair / Job / Picture confusion handler (e.g. "What kind any pictures", "send pictures", "address", "what damage")
  if (/\b(picture|pictures|photo|photos|what kind|damage|leak|address|where are you located|what's the issue|whats the issue)\b/i.test(lower)) {
    return `Hey, sorry for the confusion! I'm Shaurya from Webify, not a customer needing repairs. We build modern high-converting websites and automated client acquisition systems for local ${trade} contractors. Reached out to see if you guys are looking to take on more jobs this month, or if your schedule is already packed?`;
  }

  // "Who is this?" / "How did you get my number?"
  if (/\b(who is this|who are you|how did you get|who's this|where did you get)\b/i.test(lower)) {
    return `Hey! I'm Shaurya from Webify. Found your business on Google while looking for solid ${trade} pros in ${city}.

We build custom WhatsApp lead finder bots and modern websites for contractors. Reached out directly to see if you guys could take on an extra 15-20 jobs this month, or if you're already booked out?`;
  }

  // "How does it work?" / "Tell me more" / "What bot?"
  if (/\b(how does it work|how it works|tell me more|details|what bot|explain|what do you mean)\b/i.test(lower)) {
    return `Basically the bot scans Google Maps, Instagram, and local public registries in ${city} for people looking for ${trade} services. It verifies their phone numbers and starts a warm WhatsApp chat on autopilot.

Most contractors get 10 to 25 warm job inquiries every week without paying for expensive ads. Want me to send a quick 30-second screen recording showing how it works?`;
  }

  // If we already talked to them, do NOT repeat the pitch!
  if (hasHistory) {
    if (/\b(yes|yeah|sure|okay|ok|send|interested|show me|go ahead|yep)\b/i.test(lower)) {
      return `Awesome! Pulling 20 verified leads for ${city} right now. Would you prefer them from a specific zip code or across the entire area?`;
    }
    return `Got it! What kind of monthly volume or setup are you looking for? Or want me to pull 20 free sample leads for your area right now so you can check quality?`;
  }

  // General positive confirmation ("Yes we do", "Yeah what do you need", "Available")
  return `Awesome, thanks for getting back! I'm Shaurya from Webify—we build custom WhatsApp lead finder bots and high-converting websites for local contractors.

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

  // Append up to 14 past messages (deduplicating trailing message if already recorded)
  if (Array.isArray(history) && history.length > 0) {
    const past = [...history];
    const lastMsg = past[past.length - 1];
    if (lastMsg && lastMsg.role === 'user' && lastMsg.content === incomingText) {
      past.pop();
    }
    past.slice(-14).forEach(h => {
      messages.push({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content
      });
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
  return generateSmartHumanFallback(incomingText, profile, history);
}

module.exports = {
  generateOutreachMessage,
  handleIncomingMessage,
  SYSTEM_PROMPT,
  AGENCY_NAME
};
