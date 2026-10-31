/**
 * Webify Chat Memory Engine
 * Provides persistent multi-turn conversational memory for every contact.
 * Survives server restarts, redeploys, and device reconnections.
 */

const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'conversations_memory.json');
const MAX_MESSAGES_PER_CONTACT = 30;

// In-memory cache of conversations: phone -> { profile, messages }
const memoryStore = new Map();

/**
 * Load persisted memory from disk on startup
 */
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
      if (typeof data === 'object' && data !== null) {
        for (const [phone, conv] of Object.entries(data)) {
          memoryStore.set(String(phone).replace(/\D/g, ''), conv);
        }
        console.log(`🧠 [Chat Memory] Restored ${memoryStore.size} active chat threads from persistent storage.`);
      }
    }
  } catch (err) {
    console.warn('⚠️ [Chat Memory Warning]: Could not read conversations_memory.json:', err.message);
  }
}

// Initial boot load
loadMemory();

let saveTimeout = null;
function scheduleSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      const exportObj = {};
      for (const [phone, conv] of memoryStore.entries()) {
        exportObj[phone] = conv;
      }
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(exportObj, null, 2), 'utf8');
    } catch (err) {
      console.error('❌ [Chat Memory Error]: Failed to save to disk:', err.message);
    }
  }, 1200);
}

/**
 * Get or create contact conversation
 */
function getOrCreate(rawPhone) {
  const cleanPhone = String(rawPhone).replace(/\D/g, '');
  let conv = memoryStore.get(cleanPhone);
  if (!conv) {
    conv = {
      phone: cleanPhone,
      profile: {
        name: 'there',
        trade: 'service',
        city: 'your area',
        country: 'USA',
        stage: 'new',
        createdAt: Date.now(),
        lastActive: Date.now()
      },
      messages: []
    };
    memoryStore.set(cleanPhone, conv);
  }
  return conv;
}

/**
 * Record Step 1 Initial Outreach Message
 */
function recordOutreach(rawPhone, outreachText, leadMetadata = {}) {
  const conv = getOrCreate(rawPhone);
  conv.profile.lastActive = Date.now();
  conv.profile.stage = 'outreach_sent';

  if (leadMetadata.name && leadMetadata.name !== 'there') conv.profile.name = leadMetadata.name;
  if (leadMetadata.trade) conv.profile.trade = leadMetadata.trade;
  if (leadMetadata.niche) conv.profile.trade = leadMetadata.niche;
  if (leadMetadata.city) conv.profile.city = leadMetadata.city;
  if (leadMetadata.country) conv.profile.country = leadMetadata.country;

  conv.messages.push({
    role: 'assistant',
    content: outreachText,
    timestamp: Date.now(),
    isInitialOutreach: true
  });

  if (conv.messages.length > MAX_MESSAGES_PER_CONTACT) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONTACT);
  }

  scheduleSave();
}

/**
 * Record Inbound Message from Lead
 */
function recordIncoming(rawPhone, text) {
  const conv = getOrCreate(rawPhone);
  conv.profile.lastActive = Date.now();
  if (conv.profile.stage === 'outreach_sent') {
    conv.profile.stage = 'replied';
  }

  conv.messages.push({
    role: 'user',
    content: text,
    timestamp: Date.now()
  });

  if (conv.messages.length > MAX_MESSAGES_PER_CONTACT) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONTACT);
  }

  scheduleSave();
}

/**
 * Record Assistant Reply
 */
function recordReply(rawPhone, text, newStage = null) {
  const conv = getOrCreate(rawPhone);
  conv.profile.lastActive = Date.now();
  if (newStage) {
    conv.profile.stage = newStage;
  } else if (conv.profile.stage === 'replied') {
    conv.profile.stage = 'pitch_delivered';
  }

  conv.messages.push({
    role: 'assistant',
    content: text,
    timestamp: Date.now()
  });

  if (conv.messages.length > MAX_MESSAGES_PER_CONTACT) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONTACT);
  }

  scheduleSave();
}

/**
 * Update conversation stage
 */
function updateStage(rawPhone, stage) {
  const conv = getOrCreate(rawPhone);
  conv.profile.stage = stage;
  conv.profile.lastActive = Date.now();
  scheduleSave();
}

/**
 * Get formatted history array for LLM context
 */
function getFormattedHistory(rawPhone, limit = 12) {
  const cleanPhone = String(rawPhone).replace(/\D/g, '');
  const conv = memoryStore.get(cleanPhone);
  if (!conv || !Array.isArray(conv.messages)) return [];

  return conv.messages.slice(-limit).map(m => ({
    role: m.role,
    content: m.content
  }));
}

/**
 * Get profile data for contact
 */
function getProfile(rawPhone) {
  const cleanPhone = String(rawPhone).replace(/\D/g, '');
  const conv = memoryStore.get(cleanPhone);
  return conv ? conv.profile : { name: 'there', trade: 'service', city: 'your area', stage: 'new' };
}

/**
 * Get all conversations (for admin dashboard / live inspection)
 */
function getAllConversations() {
  const list = [];
  for (const [phone, conv] of memoryStore.entries()) {
    list.push({
      phone,
      profile: conv.profile,
      messageCount: conv.messages.length,
      lastMessage: conv.messages[conv.messages.length - 1] || null
    });
  }
  return list.sort((a, b) => (b.profile?.lastActive || 0) - (a.profile?.lastActive || 0));
}

function hasConversation(rawPhone) {
  if (!rawPhone) return false;
  const cleanPhone = String(rawPhone).replace(/\D/g, '');
  const conv = memoryStore.get(cleanPhone);
  return Boolean(conv && Array.isArray(conv.messages) && conv.messages.length > 0);
}

module.exports = {
  recordOutreach,
  recordIncoming,
  recordReply,
  updateStage,
  getFormattedHistory,
  getProfile,
  getAllConversations,
  hasConversation
};
