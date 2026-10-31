/**
 * Webify Multi-Device Smart Queue Dispatcher (Up to 6 Devices)
 * 
 * Rules:
 * 1. 50 Verified Leads Max per 24 hours PER DEVICE (3 Devices = 150 leads/day, 6 Devices = 300/day)
 * 2. Atomic queue claiming ensures NO two devices ever message or touch the same lead
 * 3. Natural pacing rhythm (3 to 6 minutes between conversations)
 * 4. Micro-batches of 4 to 6 messages followed by scheduled 25 to 45 minute rests
 * 5. Two-Step Conversational Engagement: authentic local inquiry (zero links, zero commercial buzzwords)
 * 6. Supports Global Business Numbers: USA (+1), UK (+44), Canada (+1), Australia (+61)
 */

const path = require('path');
const fs = require('fs');
const ai = require('./ai');
const scraper = require('./scraper');
const whatsapp = require('./whatsapp');
const chatMemory = require('./chatMemory');

const MAX_DEVICES = parseInt(process.env.MAX_DEVICES || '6', 10);
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

// Persistent & Customizable 24-Hour Limits & Pacing Config
function loadBotConfig() {
  const defaults = {
    dailyMaxLeadsPerDevice: parseInt(process.env.DAILY_MAX_LEADS_PER_DEVICE || '50', 10),
    minMsgDelayMs: parseInt(process.env.MIN_MSG_DELAY_MS || '35000', 10),
    maxMsgDelayMs: parseInt(process.env.MAX_MSG_DELAY_MS || '70000', 10),
    minBreakMins: parseInt(process.env.MIN_BREAK_MINS || '5', 10),
    maxBreakMins: parseInt(process.env.MAX_BREAK_MINS || '10', 10),
    minBatchSize: 8,
    maxBatchSize: 12,
    businessHoursShield: false,
    specialDeviceNumber: '9416085989',
    specialDailyLimit: 10,
    vaultCode: '3369',
    pacingPreset: 'fast' // 'turbo', 'fast', 'balanced', 'enterprise', 'custom'
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return { ...defaults, ...data };
    }
  } catch (err) {
    console.warn('Notice: using default bot config:', err.message);
  }
  return defaults;
}

let botConfig = loadBotConfig();

function saveBotConfig(updates) {
  botConfig = { ...botConfig, ...updates };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2), 'utf-8');
    console.log(`⚙️ [Config Saved] 24-Hour limit updated to: ${botConfig.dailyMaxLeadsPerDevice} msgs/device (Preset: ${botConfig.pacingPreset || 'custom'}, delay: ${(botConfig.minMsgDelayMs/1000).toFixed(0)}-${(botConfig.maxMsgDelayMs/1000).toFixed(0)}s, TZ-shield: ${botConfig.businessHoursShield}).`);
  } catch (err) {
    console.error('Failed to save bot_config.json:', err.message);
  }
  return botConfig;
}

function getDailyMaxLeadsPerDevice() {
  return botConfig.dailyMaxLeadsPerDevice || 50;
}

function getDailyLimitForDevice(deviceId) {
  const session = whatsapp.getDevice(deviceId);
  const phone = session && session.phone ? String(session.phone).replace(/\D/g, '') : '';

  // Special Rule: 9416085989 is STRICTLY capped at 10 msgs/day!
  if (phone.includes('9416085989') || (session && session.sock?.user?.id && String(session.sock.user.id).includes('9416085989'))) {
    return 10;
  }

  // Check per-device custom override in botConfig
  if (botConfig.deviceLimits && botConfig.deviceLimits[String(deviceId)]) {
    return parseInt(botConfig.deviceLimits[String(deviceId)], 10) || getDailyMaxLeadsPerDevice();
  }

  return getDailyMaxLeadsPerDevice();
}

function setDailyMaxLeadsPerDevice(count, preset = 'custom') {
  const num = parseInt(count, 10);
  if (isNaN(num) || num < 1) return botConfig;

  const updates = { dailyMaxLeadsPerDevice: num, pacingPreset: preset };

  // Adjust pacing intelligently if presets are chosen
  if (preset === 'turbo') {
    updates.minMsgDelayMs = 25000;
    updates.maxMsgDelayMs = 45000;
    updates.minBreakMins = 3;
    updates.maxBreakMins = 6;
    updates.minBatchSize = 10;
    updates.maxBatchSize = 15;
    updates.businessHoursShield = false;
  } else if (preset === 'fast' || preset === 'high_growth') {
    updates.minMsgDelayMs = 35000;
    updates.maxMsgDelayMs = 70000;
    updates.minBreakMins = 5;
    updates.maxBreakMins = 10;
    updates.minBatchSize = 8;
    updates.maxBatchSize = 12;
    updates.businessHoursShield = false;
  } else if (preset === 'balanced') {
    updates.minMsgDelayMs = 60000;
    updates.maxMsgDelayMs = 110000;
    updates.minBreakMins = 8;
    updates.maxBreakMins = 15;
    updates.minBatchSize = 6;
    updates.maxBatchSize = 10;
    updates.businessHoursShield = false;
  } else if (preset === 'ultra_safe' || preset === 'enterprise') {
    updates.minMsgDelayMs = 120000;
    updates.maxMsgDelayMs = 240000;
    updates.minBreakMins = 20;
    updates.maxBreakMins = 35;
    updates.minBatchSize = 4;
    updates.maxBatchSize = 7;
    updates.businessHoursShield = true;
  }

  return saveBotConfig(updates);
}

function updatePacingConfig(updates = {}) {
  const allowed = [
    'minMsgDelayMs',
    'maxMsgDelayMs',
    'minBreakMins',
    'maxBreakMins',
    'minBatchSize',
    'maxBatchSize',
    'businessHoursShield',
    'dailyMaxLeadsPerDevice',
    'pacingPreset'
  ];

  const filtered = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) {
      filtered[k] = updates[k];
    }
  }

  if (updates.preset) {
    return setDailyMaxLeadsPerDevice(updates.dailyMaxLeads || botConfig.dailyMaxLeadsPerDevice, updates.preset);
  }

  return saveBotConfig(filtered);
}

function getBotConfig() {
  return { ...botConfig };
}

const MIN_BATCH_SIZE = parseInt(process.env.MIN_BATCH_SIZE || '8', 10);
const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || '12', 10);
const STRICT_HOURS = process.env.STRICT_HOURS === 'true';

let isRunning = false;
let isPaused = false;
let isProactiveScraping = false;
let currentDay = new Date().toDateString();

// Device worker states: deviceId (1..6) -> WorkerState
const deviceStates = new Map();

function getRandomBatchLimit() {
  const min = botConfig.minBatchSize || MIN_BATCH_SIZE;
  const max = botConfig.maxBatchSize || MAX_BATCH_SIZE;
  return Math.floor(min + Math.random() * (max - min + 1));
}

// Recipient Timezone & Area Code Offset Engine
function getUsAreaCodeOffset(areaCodeStr) {
  const code = parseInt(areaCodeStr, 10);
  const easternCodes = [201, 202, 203, 207, 212, 215, 216, 239, 240, 267, 301, 302, 305, 315, 321, 330, 347, 352, 386, 401, 404, 407, 410, 412, 434, 443, 470, 475, 484, 516, 518, 540, 561, 570, 585, 603, 607, 609, 610, 631, 646, 678, 703, 704, 706, 716, 717, 724, 727, 732, 754, 757, 770, 772, 774, 781, 786, 802, 803, 804, 813, 814, 828, 843, 845, 848, 856, 857, 860, 862, 863, 864, 865, 878, 904, 908, 910, 912, 914, 917, 919, 929, 937, 941, 954, 973, 978, 980];
  const centralCodes = [205, 210, 214, 217, 218, 224, 225, 228, 251, 254, 256, 260, 262, 269, 281, 308, 309, 312, 314, 316, 318, 319, 320, 325, 331, 334, 337, 361, 402, 405, 409, 414, 417, 430, 432, 469, 479, 501, 507, 512, 515, 534, 539, 563, 573, 601, 605, 608, 612, 615, 618, 620, 629, 630, 636, 641, 651, 660, 662, 682, 701, 708, 712, 713, 715, 731, 737, 763, 765, 769, 773, 779, 785, 812, 815, 816, 830, 832, 847, 850, 859, 870, 901, 903, 913, 918, 920, 931, 936, 940, 952, 956, 972, 979, 985];
  const mountainCodes = [303, 307, 385, 406, 435, 505, 575, 719, 720, 801, 970];
  const pacificCodes = [206, 209, 213, 253, 310, 323, 360, 408, 415, 424, 425, 442, 503, 509, 510, 530, 541, 559, 562, 619, 626, 628, 650, 657, 661, 702, 707, 714, 725, 747, 760, 775, 805, 818, 831, 858, 909, 916, 925, 949, 951, 971];

  if (easternCodes.includes(code)) return -4;
  if (centralCodes.includes(code)) return -5;
  if (mountainCodes.includes(code)) return -6;
  if (pacificCodes.includes(code)) return -7;
  return -5; // Default US Central
}

function getRecipientLocalTime(phone, country = 'USA') {
  const clean = String(phone).replace(/\D/g, '');
  const now = new Date();
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;

  let offset = -5; // default Central Time
  if (clean.startsWith('44') || country === 'UK') {
    offset = 1; // UK BST
  } else if (clean.startsWith('61') || country === 'Australia') {
    offset = 11; // Sydney / Melbourne AEST
  } else {
    const areaCode = clean.startsWith('1') ? clean.slice(1, 4) : clean.slice(0, 3);
    offset = getUsAreaCodeOffset(areaCode);
  }

  const localHourDecimal = (utcHours + offset + 24) % 24;
  const hours = Math.floor(localHourDecimal);
  const minutes = Math.floor((localHourDecimal - hours) * 60);
  return {
    hours,
    minutes,
    decimal: localHourDecimal,
    isBusinessHours: localHourDecimal >= 8.5 && localHourDecimal <= 18.75 // 8:30 AM to 6:45 PM
  };
}

/**
 * Box-Muller Gaussian pacing distribution (3 to 6 minutes bell curve)
 */
function getGaussianMsgDelayMs(minMs = botConfig.minMsgDelayMs || 180000, maxMs = botConfig.maxMsgDelayMs || 360000) {
  if (minMs > maxMs) {
    const tmp = minMs;
    minMs = maxMs;
    maxMs = tmp;
  }
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const standardNormal = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 6;
  let sample = mean + standardNormal * stdDev;
  if (sample < minMs) sample = minMs + Math.random() * (maxMs - minMs) * 0.08;
  if (sample > maxMs) sample = maxMs - Math.random() * (maxMs - minMs) * 0.08;
  return Math.floor(sample);
}

function getRandomMsgDelayMs() {
  return getGaussianMsgDelayMs(botConfig.minMsgDelayMs || 35000, botConfig.maxMsgDelayMs || 70000);
}

function getRandomBreakDurationMs() {
  const minMins = botConfig.minBreakMins || 5;
  const maxMins = botConfig.maxBreakMins || 10;
  const mins = minMins + Math.random() * (maxMins - minMins);
  return Math.floor(mins * 60 * 1000);
}

function isOperatingHours() {
  if (!STRICT_HOURS) return true;
  const now = new Date();
  const hour = now.getHours();
  return (hour >= 9 && hour < 22);
}

function formatLocalTime(timestamp) {
  if (!timestamp) return null;
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return new Date(timestamp).toLocaleTimeString();
  }
}

function checkAndResetDailyCounters() {
  const todayStr = new Date().toDateString();
  if (todayStr !== currentDay) {
    currentDay = todayStr;
    for (const state of deviceStates.values()) {
      state.dailySentCount = 0;
      state.currentBatchCount = 0;
      state.currentBatchLimit = getRandomBatchLimit();
    }
    console.log(`🌅 [Delivery Scheduler] New calendar day. Reset daily outreach counters to 0/${getDailyMaxLeadsPerDevice()} per device.`);
  }
}

function getOrCreateDeviceState(deviceId) {
  let state = deviceStates.get(deviceId);
  if (!state) {
    state = {
      id: deviceId,
      currentBatchCount: 0,
      currentBatchLimit: getRandomBatchLimit(),
      dailySentCount: 0,
      totalSentSession: 0,
      consecutiveFailures: 0,
      nextActionTime: null,
      currentStatus: 'Initializing slot...'
    };
    deviceStates.set(deviceId, state);
  }
  return state;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Worker loop for an individual WhatsApp device slot
 */
async function runDeviceWorker(deviceId) {
  const state = getOrCreateDeviceState(deviceId);
  console.log(`⚡ [Worker Device ${deviceId}] Started independent dispatcher (50 leads/day cap).`);

  // Stagger startup so all devices don't fire at the exact same second
  await sleep((deviceId - 1) * 12000);

  while (isRunning) {
    if (isPaused) {
      state.currentStatus = 'Paused by User';
      await sleep(5000);
      continue;
    }

    checkAndResetDailyCounters();

    // 1. Device Daily Cap Check (Special 10 msgs/day for 9416085989; customizable for all others)
    const currentDailyLimit = getDailyLimitForDevice(deviceId);
    if (state.dailySentCount >= currentDailyLimit) {
      const isSpecial = currentDailyLimit === 10;
      state.currentStatus = `Daily Target Reached (${state.dailySentCount}/${currentDailyLimit}${isSpecial ? ' [Slot Capped @ 10/day]' : ''}). Scheduled to resume tomorrow...`;
      state.nextActionTime = Date.now() + 60 * 60 * 1000;
      await sleep(30000); // Check every 30s so user raising limit in UI resumes bot immediately
      continue;
    }

    // 2. Strict Operating Hours Check (if enabled)
    if (!isOperatingHours()) {
      state.currentStatus = '🌙 Night Rest Mode. Resuming during business hours (9 AM)...';
      state.nextActionTime = Date.now() + 30 * 60 * 1000;
      await sleep(60000);
      continue;
    }

    // 3. Check if this specific device is connected
    if (!whatsapp.isDeviceConnected(deviceId)) {
      state.currentStatus = `Waiting for WhatsApp QR scan on /qr?device=${deviceId}...`;
      await sleep(8000);
      continue;
    }

    // 4. Proactive lead harvest if backlog for this device territory is low
    const remainingInQueue = scraper.getQueuedLeadsCount(deviceId);
    if (remainingInQueue < 15 && !isProactiveScraping) {
      isProactiveScraping = true;
      console.log(`⚡ [Scraper] Device ${deviceId} queue has ${remainingInQueue} leads. Harvesting fresh leads in background...`);
      scraper.triggerFreeWebScraper({ targetAccount: `device_${deviceId}`, targetCount: 25 })
        .catch(e => console.error('Continuous harvest notice:', e.message))
        .finally(() => { isProactiveScraping = false; });
    }

    // 5. Atomic Claim: Grab next unassigned lead for this device
    let lead = scraper.claimNextLead(deviceId);
    if (!lead) {
      state.currentStatus = `Queue Empty: Harvesting fresh leads for Device ${deviceId}...`;
      try {
        await scraper.triggerFreeWebScraper({ targetAccount: `device_${deviceId}`, targetCount: 25 });
      } catch (err) {}
      lead = scraper.claimNextLead(deviceId);
      if (!lead) {
        await sleep(15000);
        continue;
      }
    }

    // 6. Validate & Format Phone Number
    if (String(lead.phone).startsWith('91') || lead.country === 'India') {
      console.log(`🛡️ [Safety Shield] Dropped Indian number +${lead.phone}. Webify bot strictly targets US/UK/Canada/Australia.`);
      scraper.updateLeadStatus(lead.phone, 'rejected_indian_number', null, deviceId);
      continue;
    }

    const formatted = scraper.formatWhatsAppJid(lead.phone);
    if (!formatted) {
      console.log(`❌ [Device ${deviceId}] Skipped invalid phone ${lead.phone}.`);
      scraper.updateLeadStatus(lead.phone, 'invalid_number', null, deviceId);
      continue;
    }

    lead.jid = formatted.jid;
    lead.phone = formatted.cleanNumber;

    // 7. Duplicate & Sent Shield
    if (scraper.isPhoneAlreadySent(lead.phone) || whatsapp.hasExistingChat(lead.phone)) {
      console.log(`⏩ [Device ${deviceId}] ${lead.phone} was already contacted. Skipping!`);
      scraper.updateLeadStatus(lead.phone, 'sent', null, deviceId);
      continue;
    }

    // 7b. Recipient Business Hours & Timezone Protection (Guarantees zero nighttime disturbance)
    if (botConfig.businessHoursShield !== false) {
      const recipientTime = getRecipientLocalTime(lead.phone, lead.country);
      if (!recipientTime.isBusinessHours) {
        const timeStr = `${recipientTime.hours}:${recipientTime.minutes < 10 ? '0' : ''}${recipientTime.minutes}`;
        state.currentStatus = `🌙 Timezone Sync: +${lead.phone} is outside business hours (${timeStr} local time). Holding until 8:30 AM...`;
        console.log(`🌙 [Timezone Protection Device ${deviceId}] +${lead.phone} is currently asleep (${timeStr} local time). Postponing until morning.`);
        scraper.releaseLeadClaim(lead.phone);
        await sleep(30000);
        continue;
      }
    }

    // 8. Verify WhatsApp registration
    state.currentStatus = `Checking WhatsApp registration for +${lead.phone}...`;
    const waCheck = await whatsapp.checkNumberOnWhatsApp(deviceId, lead.phone);
    if (!waCheck.exists) {
      console.log(`❌ [Device ${deviceId}] +${lead.phone} is not registered on WhatsApp. Skipping!`);
      scraper.updateLeadStatus(lead.phone, 'not_on_whatsapp', null, deviceId);
      await sleep(300);
      continue;
    }

    lead.jid = waCheck.jid || formatted.jid;

    // 9. Generate Two-Step Undetectable Outreach Message
    state.currentStatus = `Preparing personalized outreach for +${lead.phone}...`;
    const outreachText = await ai.generateOutreachMessage(lead);

    // 10. Send via WhatsApp through this device
    state.currentStatus = `Sending outreach to +${lead.phone}...`;
    let sendSucceeded = false;
    try {
      const sent = await whatsapp.sendTextMessage(deviceId, lead.jid, outreachText);
      if (sent) {
        scraper.updateLeadStatus(lead.phone, 'sent', null, deviceId);
        chatMemory.recordOutreach(lead.phone, outreachText, {
          name: lead.name,
          trade: lead.trade || lead.niche,
          city: lead.city,
          country: lead.country
        });
        state.currentBatchCount++;
        state.totalSentSession++;
        state.dailySentCount++;
        state.consecutiveFailures = 0;
        sendSucceeded = true;
        console.log(`✅ [Real WhatsApp Sent by Device ${deviceId} (${state.currentBatchCount}/${state.currentBatchLimit})] To +${lead.phone}. Today: ${state.dailySentCount}/${getDailyMaxLeadsPerDevice()}`);
      } else {
        state.consecutiveFailures++;
        scraper.updateLeadStatus(lead.phone, 'failed', 'Socket send failure', deviceId);
      }
    } catch (sendErr) {
      state.consecutiveFailures++;
      console.error(`❌ [Device ${deviceId} Send Error]:`, sendErr.message);
      scraper.updateLeadStatus(lead.phone, 'failed', sendErr.message, deviceId);
    }

    // Circuit Breaker: 3 consecutive failures cools down this device socket for 20 mins
    if (state.consecutiveFailures >= 3) {
      state.currentStatus = '⚠️ Socket synchronization pause (3 delivery hiccups). Cooling down for 20 mins...';
      state.nextActionTime = Date.now() + 20 * 60 * 1000;
      console.log(`\n🛡️ [Delivery Optimizer Device ${deviceId}] 3 hiccups detected. Resting for 20 mins until ${formatLocalTime(state.nextActionTime)}...\n`);
      await sleep(20 * 60 * 1000);
      state.consecutiveFailures = 0;
      continue;
    }

    // 11. Human Pacing / Breaks
    if (sendSucceeded) {
      if (state.currentBatchCount >= state.currentBatchLimit) {
        const breakMs = getRandomBreakDurationMs();
        const breakMins = Math.round(breakMs / 60000);
        state.nextActionTime = Date.now() + breakMs;
        state.currentStatus = `Batch of ${state.currentBatchLimit} sent! Scheduled rest interval (${breakMins}m)...`;
        console.log(`\n☕ [Pacing Rhythm Device ${deviceId}] Batch limit hit (${state.currentBatchLimit} sent). Scheduled ${breakMins}-minute rest until ${formatLocalTime(state.nextActionTime)}...\n`);

        await sleep(breakMs);

        state.currentBatchCount = 0;
        state.currentBatchLimit = getRandomBatchLimit();
        console.log(`⚡ [Worker Device ${deviceId}] Rest finished! Next batch rolled: ${state.currentBatchLimit} leads.`);
      } else {
        // Random 3 to 6 minutes delay between conversations for completely natural delivery
        const jitterDelayMs = getRandomMsgDelayMs();
        const delaySec = Math.round(jitterDelayMs / 1000);
        const delayMins = (delaySec / 60).toFixed(1);
        state.nextActionTime = Date.now() + jitterDelayMs;
        state.currentStatus = `Natural delivery cadence (${delayMins}m pause)...`;
        console.log(`⏳ [Pacing Device ${deviceId}] Next lead scheduled at ${formatLocalTime(state.nextActionTime)} (${delayMins}m pause)...`);
        await sleep(jitterDelayMs);
      }
    } else {
      await sleep(2000);
    }
  }
}

/**
 * Start queue workers across all devices
 */
async function startQueueWorker() {
  if (isRunning) return;
  isRunning = true;
  console.log(`🚀 [Multi-Device Master Engine Active] Up to ${MAX_DEVICES} devices, ${getDailyMaxLeadsPerDevice()} leads/day each (3 devices = 150 leads/day, 6 devices = 300/day).`);

  for (let i = 1; i <= MAX_DEVICES; i++) {
    getOrCreateDeviceState(i);
    runDeviceWorker(i).catch(err => {
      console.error(`Worker error on device ${i}:`, err.message);
    });
  }
}

function pauseQueue() {
  isPaused = true;
  console.log('⏸️ [Queue Worker] Paused all devices');
}

function resumeQueue() {
  isPaused = false;
  console.log('▶️ [Queue Worker] Resumed all devices');
}

function getQueueState() {
  const db = scraper.loadDatabase();
  const queuedCount = db.leads.filter(l => l.status === 'queued').length;
  const sentCount = db.leads.filter(l => l.status === 'sent').length;
  checkAndResetDailyCounters();

  const connectedDevices = whatsapp.getConnectedDevices();
  const currentLimit = getDailyMaxLeadsPerDevice();
  let totalDailySent = 0;
  let totalSessionSent = 0;

  const devicesDetail = [];
  const now = Date.now();

  for (let i = 1; i <= MAX_DEVICES; i++) {
    const s = getOrCreateDeviceState(i);
    const dev = whatsapp.getDevice(i);
    const devLimit = getDailyLimitForDevice(i);
    const remainingSec = s.nextActionTime ? Math.max(0, Math.round((s.nextActionTime - now) / 1000)) : 0;
    const isSpecial10 = devLimit === 10 || (dev && dev.phone && String(dev.phone).includes('9416085989'));

    totalDailySent += s.dailySentCount;
    totalSessionSent += s.totalSentSession;

    devicesDetail.push({
      id: i,
      isConnected: dev ? dev.isConnected : false,
      phone: dev ? dev.phone : null,
      isSpecial10: isSpecial10,
      dailySentCount: s.dailySentCount,
      dailyMaxLeads: devLimit,
      currentBatchCount: s.currentBatchCount,
      batchSize: s.currentBatchLimit,
      currentStatus: s.currentStatus,
      nextActionTime: formatLocalTime(s.nextActionTime),
      nextActionTimestamp: s.nextActionTime,
      nextActionRemainingSec: remainingSec
    });
  }

  const activeCount = connectedDevices.length;
  const dynamicTarget = activeCount > 0 ? activeCount * currentLimit : currentLimit * MAX_DEVICES;

  return {
    isRunning,
    isPaused,
    maxDevices: MAX_DEVICES,
    connectedDevicesCount: activeCount,
    dailySentCount: totalDailySent,
    dailyMaxLeads: dynamicTarget,
    dailyMaxPerDevice: currentLimit,
    botConfig: getBotConfig(),
    totalSentSession: totalSessionSent,
    totalSentDb: sentCount,
    queuedRemaining: queuedCount,
    isDaytime: isOperatingHours(),
    devices: devicesDetail,
    // Backwards compatibility shortcuts
    currentStatus: activeCount > 0 ? `${activeCount}/${MAX_DEVICES} Devices Active (${totalDailySent}/${dynamicTarget} Sent)` : 'Waiting for WhatsApp QR scan on /qr...',
    batchSize: 7,
    currentBatchCount: 0,
    nextActionTime: null
  };
}

module.exports = {
  startQueueWorker,
  pauseQueue,
  resumeQueue,
  getQueueState,
  getDailyMaxLeadsPerDevice,
  setDailyMaxLeadsPerDevice,
  updatePacingConfig,
  getBotConfig,
  getGaussianMsgDelayMs
};
