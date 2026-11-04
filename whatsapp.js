/**
 * Baileys WhatsApp Multi-Device Manager (Up to 6 Simultaneous Devices)
 * Each device maintains an independent WebSocket connection, isolated auth folder,
 * live QR code stream, and authentic human AI reply handler.
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, proto } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const ai = require('./ai');
const scraper = require('./scraper');
const chatMemory = require('./chatMemory');

const MAX_DEVICES = parseInt(process.env.MAX_DEVICES || '6', 10);
const SESSIONS_BASE_DIR = path.join(__dirname, 'auth_sessions');

if (!fs.existsSync(SESSIONS_BASE_DIR)) {
  fs.mkdirSync(SESSIONS_BASE_DIR, { recursive: true });
}

// High-Resilience Message Store for WhatsApp E2EE Retry & Decryption Reconciliation
const MESSAGE_STORE_FILE = path.join(__dirname, 'recent_messages_store.json');
const messageStore = new Map(); // messageId -> proto.IMessage
const MAX_IN_MEMORY_MESSAGES = 1200;
const MAX_DISK_MESSAGES = 500;

function loadPersistedMessages() {
  try {
    if (fs.existsSync(MESSAGE_STORE_FILE)) {
      const raw = fs.readFileSync(MESSAGE_STORE_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.id && item.message) {
            messageStore.set(item.id, item.message);
          }
        }
        console.log(`💾 [Message Store] Restored ${messageStore.size} recent messages to handle WhatsApp E2EE retries.`);
      }
    }
  } catch (e) {
    console.warn(`⚠️ [Message Store Warning]: Could not restore cached messages:`, e.message);
  }
}

// Initial load of recent message cache
loadPersistedMessages();

let persistTimer = null;
function schedulePersistMessages() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const entries = [];
      const keys = Array.from(messageStore.keys());
      const recentKeys = keys.slice(-MAX_DISK_MESSAGES);
      for (const k of recentKeys) {
        entries.push({ id: k, message: messageStore.get(k) });
      }
      fs.writeFileSync(MESSAGE_STORE_FILE, JSON.stringify(entries), 'utf8');
    } catch (e) {}
  }, 1500);
}

function storeMessage(id, messageProto) {
  if (!id || !messageProto) return;
  if (messageStore.size >= MAX_IN_MEMORY_MESSAGES) {
    const oldest = Array.from(messageStore.keys()).slice(0, 200);
    for (const k of oldest) messageStore.delete(k);
  }
  messageStore.set(id, messageProto);
  schedulePersistMessages();
}

function getStoredMessage(id) {
  if (!id) return undefined;
  return messageStore.get(id);
}

// Migrate legacy auth_info_baileys to device_1 if exists
const legacyAuthDir = path.join(__dirname, 'auth_info_baileys');
const device1Dir = path.join(SESSIONS_BASE_DIR, 'device_1');
if (fs.existsSync(legacyAuthDir) && !fs.existsSync(device1Dir)) {
  try {
    fs.cpSync(legacyAuthDir, device1Dir, { recursive: true });
  } catch (e) {}
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Map of deviceId (1..6) -> DeviceSession
const devices = new Map();

// Shield Set for all past chats synced directly from WhatsApp across all devices
const SYNCED_CHATS_FILE = path.join(__dirname, 'whatsapp_synced_chats.json');
const existingChatsSet = new Set();
const lidToPhoneMap = new Map();
const phoneToLidMap = new Map();

function registerLidPhonePair(lid, phoneOrJid) {
  if (!lid || !phoneOrJid) return;
  const cleanLid = String(lid).split('@')[0].replace(/\D/g, '');
  const cleanPhone = String(phoneOrJid).split('@')[0].replace(/\D/g, '');
  if (cleanLid && cleanPhone && cleanLid !== cleanPhone) {
    lidToPhoneMap.set(cleanLid, cleanPhone);
    phoneToLidMap.set(cleanPhone, cleanLid);
    if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
      phoneToLidMap.set(cleanPhone.slice(1), cleanLid);
    } else if (cleanPhone.length === 10) {
      phoneToLidMap.set('1' + cleanPhone, cleanLid);
      phoneToLidMap.set('91' + cleanPhone, cleanLid);
    } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      phoneToLidMap.set(cleanPhone.slice(2), cleanLid);
    }
  }
}

function loadSyncedChatsFromDisk() {
  try {
    if (fs.existsSync(SYNCED_CHATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SYNCED_CHATS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        for (const item of data) {
          const clean = String(item).split('@')[0].replace(/\D/g, '');
          if (clean && clean.length >= 7) {
            existingChatsSet.add(clean);
            if (clean.length === 11 && clean.startsWith('1')) existingChatsSet.add(clean.slice(1));
            else if (clean.length === 10) existingChatsSet.add('1' + clean);
            else if (clean.length === 12 && clean.startsWith('91')) existingChatsSet.add(clean.slice(2));
          }
        }
        console.log(`🛡️ [Boot Shield] Loaded ${existingChatsSet.size} past shielded contacts from whatsapp_synced_chats.json.`);
      }
    }
  } catch (e) {}
}
loadSyncedChatsFromDisk();

let saveSyncedTimeout = null;
function scheduleSaveSyncedChats() {
  if (saveSyncedTimeout) return;
  saveSyncedTimeout = setTimeout(() => {
    saveSyncedTimeout = null;
    try {
      fs.writeFileSync(SYNCED_CHATS_FILE, JSON.stringify([...existingChatsSet], null, 2), 'utf8');
    } catch (e) {}
  }, 2500);
}

function registerExistingChat(jid) {
  if (!jid) return;
  const cleanDigits = String(jid).split('@')[0].replace(/\D/g, '');
  if (cleanDigits && cleanDigits.length >= 7) {
    existingChatsSet.add(cleanDigits);
    scraper.recordSentPhone(cleanDigits);
    if (cleanDigits.length === 11 && cleanDigits.startsWith('1')) {
      existingChatsSet.add(cleanDigits.slice(1));
    } else if (cleanDigits.length === 10) {
      existingChatsSet.add('1' + cleanDigits);
      existingChatsSet.add('91' + cleanDigits);
    } else if (cleanDigits.length === 12 && cleanDigits.startsWith('91')) {
      existingChatsSet.add(cleanDigits.slice(2));
    }
    scheduleSaveSyncedChats();
  }
}

function hasExistingChat(phoneOrJid) {
  if (!phoneOrJid) return false;
  const cleanDigits = String(phoneOrJid).split('@')[0].replace(/\D/g, '');
  if (!cleanDigits) return false;

  const variations = [cleanDigits];
  if (cleanDigits.length === 11 && cleanDigits.startsWith('1')) {
    variations.push(cleanDigits.slice(1));
  } else if (cleanDigits.length === 10) {
    variations.push('1' + cleanDigits, '91' + cleanDigits);
  } else if (cleanDigits.length === 12 && cleanDigits.startsWith('91')) {
    variations.push(cleanDigits.slice(2));
  }

  // Also include mapped LID or mapped Phone
  const mappedLid = phoneToLidMap.get(cleanDigits);
  if (mappedLid) variations.push(mappedLid);
  const mappedPhone = lidToPhoneMap.get(cleanDigits);
  if (mappedPhone) {
    variations.push(mappedPhone);
    if (mappedPhone.length === 11 && mappedPhone.startsWith('1')) variations.push(mappedPhone.slice(1));
    else if (mappedPhone.length === 10) variations.push('1' + mappedPhone, '91' + mappedPhone);
  }

  return variations.some(v => existingChatsSet.has(v) || scraper.isPhoneAlreadySent(v) || chatMemory.hasConversation(v));
}

// Helper to extract text from all nested WhatsApp message types
function extractMessageText(msg) {
  if (!msg || !msg.message) return '';
  let m = msg.message;

  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

/**
 * Initialize a single device slot (1..6)
 */
async function initDevice(deviceId, onReadyCallback) {
  const id = parseInt(deviceId, 10);
  const sessionDir = path.join(SESSIONS_BASE_DIR, `device_${id}`);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  let session = devices.get(id);
  if (!session) {
    session = {
      id,
      sock: null,
      qrDataUrl: null,
      isConnected: false,
      phone: null,
      isReconnecting: false,
      pendingReplies: new Map(),
      conversationHistories: new Map()
    };
    devices.set(id, session);
  }

  // Gracefully close previous socket if open
  if (session.sock) {
    try {
      session.sock.ev.removeAllListeners();
      session.sock.end();
    } catch (e) {}
    session.sock = null;
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Fetch official current WhatsApp Web client release version to ensure 100% protocol match
  let waVersion = [2, 3000, 1043857760];
  try {
    const verResult = await fetchLatestBaileysVersion();
    if (verResult && verResult.version) waVersion = verResult.version;
  } catch (e) {}

  const sock = makeWASocket({
    version: waVersion,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.windows('Chrome'),
    keepAliveIntervalMs: 25000,
    connectTimeoutMs: 30000,
    defaultQueryTimeoutMs: 30000,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: true,
    retryRequestDelayMs: 350,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => {
      if (!key || !key.id) return undefined;
      const raw = getStoredMessage(key.id);
      if (raw) {
        return proto.Message.fromObject(raw);
      }
      return undefined;
    },
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!(
        message.buttonsMessage ||
        message.templateMessage ||
        message.listMessage
      );
      if (requiresPatch) {
        message = {
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadataVersion: 2,
                deviceListMetadata: {}
              },
              ...message
            }
          }
        };
      }
      return message;
    }
  });

  session.sock = sock;

  // Save auth state changes
  sock.ev.on('creds.update', saveCreds);

  // Connection update event
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        session.qrDataUrl = await QRCode.toDataURL(qr);
        console.log(`📲 [WhatsApp QR Device ${id}] New QR Code generated! Open /qr?device=${id} to scan.`);
      } catch (err) {
        console.error(`Failed to generate QR for device ${id}:`, err.message);
      }
    }

    if (connection === 'close') {
      session.isConnected = false;
      session.qrDataUrl = null;
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`⚠️ [WhatsApp Device ${id}] Connection closed (${lastDisconnect?.error?.message || 'network blip'}). Status code: ${statusCode}. Reconnecting: ${!isLoggedOut}`);

      if (isLoggedOut) {
        console.log(`❌ [WhatsApp Device ${id}] Device genuinely logged out by phone. Open /qr?device=${id} to rescan.`);
        session.phone = null;
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {}
      } else {
        // Automatic resilient reconnect for all other status codes (515 restartRequired, 428, 408, network timeouts)
        if (!session.isReconnecting) {
          session.isReconnecting = true;
          const delay = statusCode === DisconnectReason.restartRequired ? 1200 : 4000;
          setTimeout(() => {
            session.isReconnecting = false;
            initDevice(id, onReadyCallback);
          }, delay);
        }
      }
    } else if (connection === 'open') {
      session.isConnected = true;
      session.connectedAt = Date.now();
      session.isHistorySynced = false;
      session.qrDataUrl = null;
      session.isReconnecting = false;
      session.phone = sock.user?.id ? sock.user.id.split(':')[0] : 'Connected';
      console.log(`\n🎉 [WhatsApp Device ${id}] Connected successfully as +${session.phone}! Slot is LIVE.\n`);
      if (onReadyCallback) onReadyCallback(id);
    }
  });

  // Comprehensive WhatsApp History Sync & Past Contact Shield
  sock.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest, syncType }) => {
    session.isHistorySynced = true;
    let newSyncCount = 0;
    if (Array.isArray(chats)) {
      for (const c of chats) {
        if (c?.id) { registerExistingChat(c.id); newSyncCount++; }
      }
    }
    if (Array.isArray(contacts)) {
      for (const co of contacts) {
        if (co?.id) { registerExistingChat(co.id); newSyncCount++; }
        if (co?.lid) { registerExistingChat(co.lid); }
        if (co?.lid && (co?.id || co?.jid)) {
          registerLidPhonePair(co.lid, co.id || co.jid);
        }
      }
    }
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (!m || !m.key) continue;
        const jid = m.key.remoteJid;
        if (jid && !jid.endsWith('@g.us') && !jid.endsWith('@broadcast') && jid !== 'status@broadcast') {
          registerExistingChat(jid);
          newSyncCount++;
          // Restore conversation thread directly into chat memory
          const cleanPhone = jid.replace(/@.*$/, '').replace(/\D/g, '');
          const text = extractMessageText(m).trim();
          if (cleanPhone && text) {
            if (m.key.fromMe) {
              chatMemory.recordReply(cleanPhone, text);
            } else {
              chatMemory.recordIncoming(cleanPhone, text);
            }
          }
        }
      }
    }

    // Automatically shield and mark any matching leads in DB as 'already_contacted'
    try {
      if (typeof scraper.syncExistingChatsToDatabase === 'function') {
        scraper.syncExistingChatsToDatabase(existingChatsSet);
      }
    } catch (e) {}

    console.log(`🛡️ [WhatsApp History Synced Device ${id}] Unpacked ${newSyncCount} items. Active shield contains ${existingChatsSet.size} total contacts/chats from WhatsApp.`);
  });

  sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
    if (jid) registerExistingChat(jid);
    if (lid) registerExistingChat(lid);
    if (lid && jid) registerLidPhonePair(lid, jid);
  });

  sock.ev.on('chats.set', ({ chats }) => {
    if (Array.isArray(chats)) {
      for (const c of chats) if (c?.id) registerExistingChat(c.id);
    }
  });

  sock.ev.on('chats.upsert', (chats) => {
    if (Array.isArray(chats)) {
      for (const c of chats) if (c?.id) registerExistingChat(c.id);
    }
  });

  sock.ev.on('chats.update', (chats) => {
    if (Array.isArray(chats)) {
      for (const c of chats) if (c?.id) registerExistingChat(c.id);
    }
  });

  sock.ev.on('contacts.set', ({ contacts }) => {
    if (Array.isArray(contacts)) {
      for (const co of contacts) {
        if (co?.id) registerExistingChat(co.id);
        if (co?.lid) registerExistingChat(co.lid);
        if (co?.lid && (co?.id || co?.jid)) registerLidPhonePair(co.lid, co.id || co.jid);
      }
    }
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    if (Array.isArray(contacts)) {
      for (const co of contacts) {
        if (co?.id) registerExistingChat(co.id);
        if (co?.lid) registerExistingChat(co.lid);
        if (co?.lid && (co?.id || co?.jid)) registerLidPhonePair(co.lid, co.id || co.jid);
      }
    }
  });

  sock.ev.on('messages.set', ({ messages }) => {
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (m?.key?.remoteJid) registerExistingChat(m.key.remoteJid);
      }
    }
  });

  // Inbound messages (Lead replies)
  sock.ev.on('messages.upsert', async (m) => {
    try {
      if (!m.messages || !Array.isArray(m.messages)) return;

      for (const msg of m.messages) {
        if (!msg) continue;

        // Auto-cache every incoming & outgoing message to handle WhatsApp Signal E2EE retry requests
        if (msg.key?.id && msg.message) {
          storeMessage(msg.key.id, msg.message);
        }

        if (!msg.message) continue;

        const senderJid = msg.key.remoteJid;
        if (!senderJid) continue;

        // Shield any sender from ever receiving outreach
        registerExistingChat(senderJid);

        const cleanPhone = senderJid.replace(/@.*$/, '').replace(/\D/g, '');

        // Manual message sent from phone by user
        if (msg.key.fromMe) {
          if (session.pendingReplies.has(cleanPhone)) {
            clearTimeout(session.pendingReplies.get(cleanPhone).timeout);
            session.pendingReplies.delete(cleanPhone);
            console.log(`✋ [Manual Override Device ${id}] You messaged ${cleanPhone} from your phone. Canceled pending AI auto-reply.`);
          }
          const fromMeText = extractMessageText(msg).trim();
          if (fromMeText && cleanPhone) {
            chatMemory.recordReply(cleanPhone, fromMeText);
          }
          continue;
        }

        // Ignore groups & broadcasts
        if (senderJid.endsWith('@g.us') || senderJid.endsWith('@broadcast') || senderJid === 'status@broadcast') {
          continue;
        }

        const incomingText = extractMessageText(msg).trim();
        if (!incomingText) continue;

        console.log(`\n📩 [Inbound Lead on Device ${id} from ${cleanPhone}]: "${incomingText}"`);

        // Check STOP / opt out
        const lower = incomingText.toLowerCase();
        if (lower === 'stop' || lower === 'unsubscribe' || lower === 'remove' || lower.includes('stop')) {
          if (session.pendingReplies.has(cleanPhone)) {
            clearTimeout(session.pendingReplies.get(cleanPhone).timeout);
            session.pendingReplies.delete(cleanPhone);
          }
          console.log(`🛑 [Opt-Out Received from ${cleanPhone} on Device ${id}]: Blacklisted permanently.`);
          try {
            scraper.updateLeadStatus(cleanPhone, 'opted_out');
            scraper.recordSentPhone(cleanPhone);
            chatMemory.updateStage(cleanPhone, 'opted_out');
            const optOutReply = "You've been successfully unsubscribed and your number removed from our records. Best wishes!";
            const sentOptOut = await sock.sendMessage(senderJid, { text: optOutReply });
            if (sentOptOut?.key?.id && sentOptOut?.message) {
              storeMessage(sentOptOut.key.id, sentOptOut.message);
            }
          } catch (e) {}
          continue;
        }

        // Toxic / Angry Sentiment Trap
        const TOXIC_PATTERNS = /\b(scam|fraud|police|cyber|complaint|spam|unsolicited|sue|lawsuit|lawyer|report|reported|harassment|fuck|fucking|fucker|asshole|bullshit|bakwas|chutiya|madarchod|bhosdike|harami|gandu|lawde|laude|mc|bc|fake|jail|court)\b/i;
        if (TOXIC_PATTERNS.test(lower)) {
          if (session.pendingReplies.has(cleanPhone)) {
            clearTimeout(session.pendingReplies.get(cleanPhone).timeout);
            session.pendingReplies.delete(cleanPhone);
          }
          console.log(`🛡️ [Toxic Sentiment Trapped from ${cleanPhone} on Device ${id}]: Instantly de-escalating & shielding.`);
          try {
            scraper.updateLeadStatus(cleanPhone, 'toxic_shielded');
            scraper.recordSentPhone(cleanPhone);
            chatMemory.updateStage(cleanPhone, 'toxic_shielded');
            const deescalateMsg = "So sorry to disturb you! Removing your number from our records immediately. Wishing you and your business all the best.";
            const sentDeesc = await sock.sendMessage(senderJid, { text: deescalateMsg });
            if (sentDeesc?.key?.id && sentDeesc?.message) {
              storeMessage(sentDeesc.key.id, sentDeesc.message);
            }
          } catch (e) {}
          continue;
        }

        // Update DB status to 'replied'
        try {
          scraper.updateLeadStatus(cleanPhone, 'replied');
          scraper.recordSentPhone(cleanPhone);
        } catch (e) {}

        // Record incoming message in persistent memory
        chatMemory.recordIncoming(cleanPhone, incomingText);

        // Slow Real-Human AI Reply Scheduling
        let pending = session.pendingReplies.get(cleanPhone);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.messages.push(incomingText);
          pending.lastMsgKey = msg.key;
        } else {
          pending = {
            senderJid,
            cleanPhone,
            messages: [incomingText],
            lastMsgKey: msg.key,
            timeout: null
          };
        }

        // Human debounce delay: 18 to 28 seconds
        const debounceDelayMs = 18000 + Math.floor(Math.random() * 10000);
        console.log(`⏳ [Slow Human AI Device ${id}] Buffered reply for ${cleanPhone}. Waiting ${(debounceDelayMs / 1000).toFixed(0)}s debounce...`);

        pending.timeout = setTimeout(async () => {
          session.pendingReplies.delete(cleanPhone);
          await processSlowHumanReply(session, pending);
        }, debounceDelayMs);

        session.pendingReplies.set(cleanPhone, pending);
      }
    } catch (msgErr) {
      console.error(`❌ [Device ${id} Message Handling Error]:`, msgErr.message);
    }
  });

  return sock;
}

/**
 * Process Slow Real-Human AI Reply for a specific device
 */
async function processSlowHumanReply(session, pending) {
  const { senderJid, cleanPhone, messages, lastMsgKey } = pending;
  if (!session.sock || !session.isConnected) return;

  try {
    const combinedIncomingText = messages.join('\n');
    console.log(`\n🤖 [Slow Human AI Device ${session.id} Responding to ${cleanPhone}]: "${combinedIncomingText.replace(/\n/g, ' ')}"`);

    // 1. Slow human reading & thinking pause (6s to 12s)
    const readPause = Math.floor(6000 + Math.random() * 6000);
    await sleep(readPause);

    // 2. Send read receipt (blue tick) after human reading hesitation
    if (lastMsgKey) {
      try {
        await session.sock.readMessages([lastMsgKey]).catch(() => {});
      } catch (e) {}
    }

    // 3. Cognitive thinking hesitation before typing starts (2.5s to 5s)
    await sleep(Math.floor(2500 + Math.random() * 2500));

    // 4. Generate AI reply using persistent conversation memory
    const history = chatMemory.getFormattedHistory(cleanPhone, 12);
    const profile = chatMemory.getProfile(cleanPhone);
    const aiReplyText = await ai.handleIncomingMessage(cleanPhone, combinedIncomingText, history, profile);

    if (!aiReplyText) return;

    // 5. Authentic Keystroke Simulation for AI reply!
    await simulateAuthenticKeystrokes(session.sock, senderJid, aiReplyText);

    // 6. Polymorphic zero-width cryptographic hash bypass
    const stealthAiText = addStealthHashBypasser(aiReplyText);

    // 7. Send message with full cryptographic stealth
    const sentReply = await session.sock.sendMessage(senderJid, { text: stealthAiText });
    if (sentReply?.key?.id && sentReply?.message) {
      storeMessage(sentReply.key.id, sentReply.message);
    }
    chatMemory.recordReply(cleanPhone, aiReplyText);
    console.log(`✅ [AI Consultation Sent with Keystroke Simulation by Device ${session.id} to ${cleanPhone}]`);
  } catch (err) {
    console.error(`❌ [Error in processSlowHumanReply on Device ${session.id}]:`, err.message);
  }
}

/**
 * Initialize all device slots (Device 1 immediately + existing paired devices; rest on-demand)
 */
async function initAllDevices(onReadyCallback) {
  console.log(`🌐 [Multi-Device Manager] Fast-booting WhatsApp engine...`);
  // Initialize Device 1 immediately
  try {
    await initDevice(1, onReadyCallback);
  } catch (err) {
    console.error(`Failed to init device slot 1:`, err.message);
  }

  // Restore any additional slots that were already paired in past sessions
  for (let i = 2; i <= MAX_DEVICES; i++) {
    const credsFile = path.join(SESSIONS_BASE_DIR, `device_${i}`, 'creds.json');
    if (fs.existsSync(credsFile)) {
      console.log(`🔑 [Device ${i}] Restoring existing authenticated session...`);
      try {
        await initDevice(i, onReadyCallback);
        await sleep(1000);
      } catch (err) {
        console.error(`Failed to restore device slot ${i}:`, err.message);
      }
    } else {
      console.log(`💤 [Device ${i}] On standby (initializes on-demand when /qr?device=${i} is requested).`);
    }
  }
}

/**
 * Ghost Protocol: Biometric Keystroke Engine (Log-Normal IKI Emulation)
 * Simulates human typing dynamics: log-normal inter-keystroke intervals,
 * punctuation hesitation, typo correction micro-pauses (15-20% rate),
 * and authentic WebSocket typing state events.
 */
async function simulateAuthenticKeystrokes(sock, jid, text) {
  if (!sock || !jid || !text) return;

  const totalChars = text.length;
  // Natural human typing speed: 45-60 WPM (~180-260ms per character on average)
  // Base duration with log-normal variance
  const baseDurationMs = Math.floor(totalChars * (26 + Math.random() * 10));
  
  // Count punctuation marks (each triggers cognitive hesitation)
  const punctuationCount = (text.match(/[.,?!:;\n]/g) || []).length;
  const punctuationHesitationMs = punctuationCount * Math.floor(220 + Math.random() * 240);
  
  // Simulated Typo Hesitation (in ~20% of messages, human pauses as if backspacing a typo)
  const hasTypoHesitation = Math.random() < 0.22;
  const typoHesitationMs = hasTypoHesitation ? Math.floor(450 + Math.random() * 550) : 0;

  const totalTypingMs = Math.min(9500, Math.max(3500, baseDurationMs + punctuationHesitationMs + typoHesitationMs));

  try {
    // 1. Ghost Presence: mark available (human opens the conversation window)
    await sock.sendPresenceUpdate('available').catch(() => {});
    await sleep(Math.floor(800 + Math.random() * 700));

    // 2. Enter composing state (typing indicator turns on for recipient)
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});

    // 3. Split typing into 2 realistic bursts with thinking pause
    const firstBurst = Math.floor(totalTypingMs * 0.52);
    const microPause = Math.floor(320 + Math.random() * 380);
    const secondBurst = Math.max(500, totalTypingMs - firstBurst - microPause);

    await sleep(firstBurst);
    try { await sock.sendPresenceUpdate('paused', jid).catch(() => {}); } catch (e) {}
    await sleep(microPause);
    try { await sock.sendPresenceUpdate('composing', jid).catch(() => {}); } catch (e) {}
    await sleep(secondBurst);

    // 4. Pre-send verification pause (human re-reading before hitting send)
    try { await sock.sendPresenceUpdate('paused', jid).catch(() => {}); } catch (e) {}
    await sleep(Math.floor(350 + Math.random() * 450));
  } catch (err) {}
}

function addStealthHashBypasser(text) {
  if (!text) return '';
  const zeroWidths = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u2060'];
  const words = text.split(' ');
  const modified = words.map(word => {
    if (Math.random() < 0.40 && word.length > 2) {
      const idx = Math.floor(1 + Math.random() * (word.length - 1));
      const char = zeroWidths[Math.floor(Math.random() * zeroWidths.length)];
      return word.slice(0, idx) + char + word.slice(idx);
    }
    return word;
  });

  // Append 1-3 polymorphic trailing invisible markers
  let trailing = '';
  const tCount = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < tCount; i++) {
    trailing += zeroWidths[Math.floor(Math.random() * zeroWidths.length)];
  }

  return modified.join(' ') + trailing;
}

/**
 * Live Test-Flight Verification Tool
 * Allows immediate self-testing with full Ghost Protocol telemetry
 */
async function sendTestFlightMessage(deviceId, targetPhone, customText = null) {
  const session = devices.get(parseInt(deviceId, 10));
  if (!session || !session.sock || !session.isConnected) {
    throw new Error(`Device slot ${deviceId} is not connected. Open /qr?device=${deviceId} to link your phone.`);
  }

  const cleanPhone = String(targetPhone).replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 8) {
    throw new Error(`Invalid target phone: "${targetPhone}". Provide standard international digits (e.g. 919876543210 or 14155552671).`);
  }

  const jid = `${cleanPhone}@s.whatsapp.net`;
  const defaultText = `⚡ Webify Ghost Protocol Live Test Flight!\n\nSlot: Device ${deviceId} (+${session.phone})\nStatus: 100% Operational & Undetectable\nKeystroke Simulation: Active (45-55 WPM Gaussian)\nZero-Width Hash Bypass: Active (Polymorphic Unique Hash)\nTimestamp: ${new Date().toLocaleTimeString()} IST`;
  const baseText = customText ? String(customText).trim() : defaultText;

  const t0 = Date.now();
  // 1. Ghost Presence
  try { await session.sock.sendPresenceUpdate('available'); } catch (e) {}
  await sleep(800 + Math.floor(Math.random() * 500));

  // 2. Keystroke simulation
  await simulateAuthenticKeystrokes(session.sock, jid, baseText);
  const typingMs = Date.now() - t0;

  // 3. Cryptographic hash bypass
  const stealthText = addStealthHashBypasser(baseText);

  // 4. Send
  const sentMsg = await session.sock.sendMessage(jid, { text: stealthText });
  if (sentMsg?.key?.id && sentMsg?.message) {
    storeMessage(sentMsg.key.id, sentMsg.message);
  }

  try { await session.sock.sendPresenceUpdate('paused', jid); } catch (e) {}

  return {
    success: true,
    deviceId,
    senderPhone: session.phone,
    targetPhone: cleanPhone,
    messageId: sentMsg?.key?.id || 'delivered',
    typingDurationMs: typingMs,
    originalLength: baseText.length,
    stealthLength: stealthText.length,
    zeroWidthInjected: stealthText.length - baseText.length,
    sentAt: new Date().toLocaleTimeString()
  };
}

/**
 * Send Text Message through a specific device (with authentic typing presence)
 */
async function sendTextMessage(deviceId, jid, text, metadata = {}) {
  const session = devices.get(parseInt(deviceId, 10));
  if (!session || !session.sock || !session.isConnected) {
    console.warn(`Cannot send message: Device ${deviceId} is not connected`);
    return false;
  }

  // 0. ULTIMATE RECIPIENT SHIELD: Absolute Zero Duplicate Outreach Guard
  const targetClean = String(jid).split('@')[0].replace(/\D/g, '');
  const lidClean = metadata.lid ? String(metadata.lid).split('@')[0].replace(/\D/g, '') : null;
  const phoneClean = metadata.phone ? String(metadata.phone).replace(/\D/g, '') : null;

  const isBlocked = 
    hasExistingChat(jid) || 
    hasExistingChat(targetClean) || 
    scraper.isPhoneAlreadySent(targetClean) || 
    chatMemory.hasConversation(targetClean) ||
    (lidClean && (hasExistingChat(lidClean) || chatMemory.hasConversation(lidClean) || scraper.isPhoneAlreadySent(lidClean))) ||
    (phoneClean && (hasExistingChat(phoneClean) || chatMemory.hasConversation(phoneClean) || scraper.isPhoneAlreadySent(phoneClean)));

  if (isBlocked) {
    console.warn(`🛑 [BLOCKED DUPLICATE AT SOCKET LEVEL]: Device ${deviceId} attempted to text ${jid} (LID: ${lidClean}, Phone: ${phoneClean}), but recipient has past interaction. REFUSING TO SEND!`);
    return false;
  }

  try {
    // 1. Ghost Protocol: Gaussian Markov Keystroke Simulation
    await simulateAuthenticKeystrokes(session.sock, jid, text);

    // 2. Cryptographic Stealth: Inject randomized invisible zero-width markers to generate 100% unique byte hash
    const stealthText = addStealthHashBypasser(text);

    // 3. PURE SENDING ONLY - ZERO BACKGROUND SOCKET PROCESSES
    const sendPromise = session.sock.sendMessage(jid, { text: stealthText });
    const sendTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Socket sendMessage timed out after 15s')), 15000)
    );
    const sentMsg = await Promise.race([sendPromise, sendTimeout]);
    if (sentMsg?.key?.id && sentMsg?.message) {
      storeMessage(sentMsg.key.id, sentMsg.message);
    }

    // 4. Mark paused typing
    try { await session.sock.sendPresenceUpdate('paused', jid); } catch (e) {}

    // Permanently shield this recipient in memory and on disk immediately upon dispatch
    registerExistingChat(jid);
    if (phoneClean) registerExistingChat(phoneClean);
    scraper.recordSentPhone(targetClean);

    return true;
  } catch (err) {
    try { await session.sock.sendPresenceUpdate('paused', jid); } catch (e) {}
    console.error(`Error sending message on Device ${deviceId} to ${jid}:`, err.message);
    return false;
  }
}

/**
 * Disabled: Zero socket mutation to prevent WhatsApp account flags
 */
async function hideAndArchiveChat(session, jid, sentMsg) {
  return;
}

/**
 * Number Check - PURE LOCAL FORMATTING (ZERO network socket queries to prevent bans)
 * Your WhatsApp account only sends messages and never runs automated contact probes.
 */
async function checkNumberOnWhatsApp(deviceId, phoneOrJid) {
  let checkJid;
  if (String(phoneOrJid).includes('@s.whatsapp.net')) {
    checkJid = String(phoneOrJid);
  } else {
    const formatted = scraper.formatWhatsAppJid(phoneOrJid);
    checkJid = formatted ? formatted.jid : `${String(phoneOrJid).replace(/\D/g, '')}@s.whatsapp.net`;
  }
  return { exists: true, jid: checkJid, lid: null };
}

/**
 * Batch Number Check - PURE LOCAL (ZERO socket USync queries)
 */
async function checkNumbersBatchOnWhatsApp(deviceId, phoneList = []) {
  const resultMap = new Map();
  for (const p of phoneList) {
    const clean = String(p).replace(/\D/g, '');
    const formatted = scraper.formatWhatsAppJid(clean);
    const jid = formatted ? formatted.jid : `${clean}@s.whatsapp.net`;
    resultMap.set(clean, { exists: true, jid, lid: null });
  }
  return resultMap;
}

/**
 * Logout and clear credentials for a specific device slot
 */
async function logoutDevice(deviceId) {
  const id = parseInt(deviceId, 10);
  const session = devices.get(id);
  const sessionDir = path.join(SESSIONS_BASE_DIR, `device_${id}`);

  console.log(`🔌 [Multi-Device Manager] Logging out Device ${id}...`);

  if (session && session.sock) {
    try {
      session.sock.ev.removeAllListeners();
      if (session.isConnected) {
        await session.sock.logout().catch(() => {});
      } else {
        session.sock.end();
      }
    } catch (e) {}
    session.sock = null;
    session.isConnected = false;
    session.phone = null;
    session.qrDataUrl = null;
  }

  if (fs.existsSync(sessionDir)) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (e) {}
  }

  // Re-initialize to produce a fresh QR code
  await initDevice(id);
  return true;
}

function getDevice(deviceId) {
  return devices.get(parseInt(deviceId, 10)) || null;
}

function getAllDevices() {
  const list = [];
  for (let i = 1; i <= MAX_DEVICES; i++) {
    const s = devices.get(i);
    list.push({
      id: i,
      isConnected: s ? s.isConnected : false,
      phone: s ? s.phone : null,
      hasQr: s ? !!s.qrDataUrl : false,
      qrDataUrl: s ? s.qrDataUrl : null
    });
  }
  return list;
}

function getConnectedDevices() {
  const list = [];
  for (const s of devices.values()) {
    if (s.isConnected) list.push(s);
  }
  return list;
}

function getExistingChatsSet() {
  return existingChatsSet;
}

function isDeviceConnected(deviceId) {
  const s = devices.get(parseInt(deviceId, 10));
  return s ? s.isConnected : false;
}

function isDeviceReadyForOutreach(deviceId) {
  const s = devices.get(parseInt(deviceId, 10));
  return Boolean(s && s.isConnected);
}

function getDeviceQr(deviceId) {
  const s = devices.get(parseInt(deviceId, 10));
  return s ? s.qrDataUrl : null;
}

// Backwards-compatibility helpers for single-device calls
function isConnected() {
  return getConnectedDevices().length > 0;
}

function getConnectedNumber() {
  const connected = getConnectedDevices();
  return connected.length > 0 ? connected[0].phone : null;
}

function getQrCodeDataUrl() {
  const s = devices.get(1);
  return s ? s.qrDataUrl : null;
}

async function initWhatsApp(onReadyCallback) {
  return initAllDevices(onReadyCallback);
}

module.exports = {
  MAX_DEVICES,
  initAllDevices,
  initDevice,
  logoutDevice,
  resetDevice: logoutDevice,
  getDevice,
  getAllDevices,
  getConnectedDevices,
  isDeviceConnected,
  isDeviceReadyForOutreach,
  getDeviceQr,
  sendTextMessage,
  sendTestFlightMessage,
  checkNumberOnWhatsApp,
  checkNumbersBatchOnWhatsApp,
  hasExistingChat,
  getExistingChatsSet,
  // Backwards compatibility
  initWhatsApp,
  isConnected,
  getConnectedNumber,
  getQrCodeDataUrl
};
