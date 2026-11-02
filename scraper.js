/**
 * Webify Multi-Platform Multi-Device Lead Scraper & Extractor
 * Discovers businesses & founders worldwide with Territory Partitioning
 * Supports up to 6 WhatsApp accounts with isolated territory allocations.
 * Multi-Engine Harvester: Yandex B2B + Craigslist + Apify Google Search.
 */

const fs = require('fs');
const path = require('path');

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || '';
const LEADS_FILE = path.join(__dirname, 'leads_db.json');
const BACKUP_FILE = path.join(__dirname, 'leads_db.backup.json');
const SENT_HISTORY_FILE = path.join(__dirname, 'sent_history.json');

let cachedDb = null;

/**
 * Permanent Sent History Tracker (Ensures NO recipient is EVER messaged twice across any device)
 */
function loadSentHistory() {
  try {
    if (fs.existsSync(SENT_HISTORY_FILE)) {
      const raw = fs.readFileSync(SENT_HISTORY_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return new Set(list);
    }
  } catch (e) {}
  return new Set();
}

function getPhoneVariations(phone) {
  if (!phone) return [];
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return [];
  const variations = new Set([digits]);
  if (digits.length === 11 && digits.startsWith('1')) {
    variations.add(digits.slice(1));
  } else if (digits.length === 10) {
    variations.add('1' + digits);
    variations.add('91' + digits);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    variations.add(digits.slice(2));
  }
  return [...variations];
}

function recordSentPhone(phone) {
  if (!phone) return;
  const history = loadSentHistory();
  const variations = getPhoneVariations(phone);
  let changed = false;
  for (const v of variations) {
    if (!history.has(v)) {
      history.add(v);
      changed = true;
    }
  }
  if (changed) {
    try {
      fs.writeFileSync(SENT_HISTORY_FILE, JSON.stringify([...history], null, 2), 'utf8');
    } catch (e) {}
  }
}

function recordBulkSentPhones(phoneList) {
  if (!Array.isArray(phoneList)) return { added: 0, total: 0 };
  const history = loadSentHistory();
  let added = 0;
  for (const p of phoneList) {
    const variations = getPhoneVariations(p);
    for (const v of variations) {
      if (v.length >= 7 && !history.has(v)) {
        history.add(v);
        added++;
      }
    }
  }
  if (added > 0) {
    try {
      fs.writeFileSync(SENT_HISTORY_FILE, JSON.stringify([...history], null, 2), 'utf8');
      console.log(`🛡️ [Sent History Shield] Recorded ${added} past numbers in permanent shield ledger. Total shielded: ${history.size}`);
    } catch (e) {
      console.error('Error saving sent history:', e.message);
    }
  }
  return { added, total: history.size };
}

function getTotalShieldedCount() {
  return loadSentHistory().size;
}

function isPhoneAlreadySent(phone) {
  if (!phone) return false;
  const history = loadSentHistory();
  const variations = getPhoneVariations(phone);
  return variations.some(v => history.has(v));
}

function loadDatabase() {
  if (cachedDb && cachedDb.leads && Array.isArray(cachedDb.leads)) {
    return cachedDb;
  }
  try {
    if (fs.existsSync(LEADS_FILE)) {
      const raw = fs.readFileSync(LEADS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.leads)) {
        cachedDb = parsed;
        return cachedDb;
      }
    }
  } catch (e) {
    console.warn('⚠️ Main leads_db.json read error, attempting backup restore:', e.message);
  }

  // Fallback to backup file
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.leads)) {
        console.log('✅ Successfully restored leads database from backup!');
        cachedDb = parsed;
        return cachedDb;
      }
    }
  } catch (backupErr) {
    console.error('Backup read failed:', backupErr.message);
  }

  cachedDb = { leads: [], sentCount: 0 };
  return cachedDb;
}

function saveDatabase(db) {
  if (!db || !Array.isArray(db.leads)) return;
  cachedDb = db;
  const tempFile = path.join(__dirname, `leads_db.tmp.${Date.now()}`);
  try {
    const jsonStr = JSON.stringify(db, null, 2);
    fs.writeFileSync(tempFile, jsonStr, 'utf8');
    fs.renameSync(tempFile, LEADS_FILE);
    fs.writeFileSync(BACKUP_FILE, jsonStr, 'utf8');
  } catch (e) {
    console.error('Error saving leads DB:', e.message);
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (err) {}
    }
  }
}

const TOLL_FREE_PREFIXES = new Set(['800', '888', '877', '866', '855', '844', '833']);
function isTollFree(cleanNumber) {
  const digits = String(cleanNumber).replace(/\D/g, '');
  const areaCode = digits.startsWith('1') ? digits.slice(1, 4) : digits.slice(0, 3);
  return TOLL_FREE_PREFIXES.has(areaCode);
}

/**
 * Clean & Format International Phone Numbers into Baileys JID
 */
function formatWhatsAppJid(rawNumber) {
  if (!rawNumber) return null;
  let rawStr = String(rawNumber).trim();
  let digits = rawStr.replace(/\D/g, '');

  // STRICT FILTER: Exclude Indian numbers (+91) entirely
  if (rawStr.startsWith('+91') || digits.startsWith('91')) {
    return null;
  }

  let country = 'GLOBAL';

  if (rawStr.startsWith('+1') || (digits.startsWith('1') && digits.length === 11)) {
    digits = digits.startsWith('1') ? digits : '1' + digits;
    country = 'USA';
  } else if (rawStr.startsWith('+44') || (digits.startsWith('44') && (digits.length === 12 || digits.length === 11))) {
    digits = digits.startsWith('44') ? digits : '44' + digits;
    country = 'UK';
  } else if (digits.startsWith('07') && digits.length === 11) {
    digits = '44' + digits.slice(1);
    country = 'UK';
  } else if (rawStr.startsWith('+61') || (digits.startsWith('61') && digits.length === 11)) {
    digits = digits.startsWith('61') ? digits : '61' + digits;
    country = 'Australia';
  } else if (digits.startsWith('04') && digits.length === 10) {
    digits = '61' + digits.slice(1);
    country = 'Australia';
  } else if (digits.length === 10) {
    // US / Canada NANP Standard (Area code 2-9, exchange 2-9)
    if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
      digits = '1' + digits;
      country = 'USA';
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (isTollFree(digits)) return null;

  return {
    cleanNumber: digits,
    jid: `${digits}@s.whatsapp.net`,
    country
  };
}

/**
 * Multi-Device Territory & Niche Partitioning
 * Guarantees that Device 1, Device 2, Device 3 harvest completely different leads
 */
const TERRITORIES = {
  device_1: {
    name: 'East & Central US - Structural & High-Ticket Trades',
    cities: [
      'newyork', 'chicago', 'houston', 'atlanta', 'miami', 
      'boston', 'philadelphia', 'charlotte', 'raleigh', 'tampa', 
      'detroit', 'minneapolis', 'columbus', 'pittsburgh', 'indianapolis', 'cleveland'
    ],
    niches: [
      'roofing', 'hvac', 'remodeling', 'general contractor', 'flooring', 
      'plumber', 'commercial cleaning', 'masonry', 'siding', 'kitchen remodel', 
      'bathroom remodel', 'insulation', 'concrete contractor', 'water damage'
    ]
  },
  device_2: {
    name: 'West & South US - Essential Home & Fast Services',
    cities: [
      'losangeles', 'dallas', 'austin', 'phoenix', 'sandiego', 
      'denver', 'lasvegas', 'seattle', 'sanantonio', 'orlando', 
      'portland', 'sacramento', 'sanfrancisco', 'saltlakecity', 'tucson', 'fortworth'
    ],
    niches: [
      'electrician', 'landscaping', 'pressure washing', 'pest control', 'moving company', 
      'handyman', 'painter', 'tree service', 'epoxy flooring', 'carpet cleaning', 
      'fence installation', 'garage door repair', 'window cleaning', 'locksmith'
    ]
  },
  device_3: {
    name: 'Global & Digital Metros - Agencies, Clinics & Founders',
    cities: [
      'london', 'toronto', 'vancouver', 'sydney', 'melbourne', 
      'manchester', 'birmingham', 'leeds', 'calgary', 'brisbane'
    ],
    niches: [
      'web design', 'marketing agency', 'medspa', 'chiropractor', 'gym', 
      'real estate', 'solar installation', 'auto detailing', 'wellness clinic', 'accounting'
    ]
  },
  device_4: {
    name: 'Canada & North America - Tech & Commercial Growth',
    cities: ['toronto', 'montreal', 'vancouver', 'calgary', 'ottawa', 'edmonton', 'winnipeg'],
    niches: ['commercial roofing', 'hvac commercial', 'general contractor', 'web agency', 'plumbing']
  },
  device_5: {
    name: 'UK & Australia - Professional Services & Local Trades',
    cities: ['london', 'manchester', 'birmingham', 'sydney', 'melbourne', 'brisbane', 'perth'],
    niches: ['electrician', 'landscaping', 'cleaning services', 'plumber', 'remodeling', 'builder']
  },
  device_6: {
    name: 'US Sunbelt & Coastal Growth - Premier Services',
    cities: ['miami', 'tampa', 'nashville', 'charlotte', 'scottsdale', 'boca raton', 'austin', 'dallas', 'orlando'],
    niches: ['luxury home remodeling', 'pool builder', 'solar energy', 'commercial cleaning', 'roofing specialist', 'high-end landscaping']
  }
};

// Aliases for account_1..3 compatibility
TERRITORIES.account_1 = TERRITORIES.device_1;
TERRITORIES.account_2 = TERRITORIES.device_2;
TERRITORIES.account_3 = TERRITORIES.device_3;

function getTerritoryForAccount(accountId) {
  const key = String(accountId).startsWith('device_') || String(accountId).startsWith('account_') 
    ? accountId 
    : `device_${accountId}`;
  if (TERRITORIES[key]) return TERRITORIES[key];

  const allCities = [...TERRITORIES.device_1.cities, ...TERRITORIES.device_2.cities, ...TERRITORIES.device_3.cities];
  const allNiches = [...TERRITORIES.device_1.niches, ...TERRITORIES.device_2.niches, ...TERRITORIES.device_3.niches];
  return {
    name: `Territory for ${key}`,
    cities: allCities.sort(() => 0.5 - Math.random()),
    niches: allNiches.sort(() => 0.5 - Math.random())
  };
}

/**
 * Add unique leads to database, tagging with assigned account
 */
function addLeadsToQueue(newLeads = [], defaultAccount = null) {
  const db = loadDatabase();
  const existingPhones = new Set(db.leads.map(l => l.phone));
  let added = 0;

  for (const item of newLeads) {
    const formatted = formatWhatsAppJid(item.phone || item.number);
    if (!formatted) continue;

    if (isPhoneAlreadySent(formatted.cleanNumber)) continue;

    if (!existingPhones.has(formatted.cleanNumber)) {
      const assigned = item.assignedAccount || defaultAccount || null;
      const newLeadObj = {
        phone: formatted.cleanNumber,
        jid: formatted.jid,
        country: formatted.country || item.country || 'USA',
        name: item.name || '',
        niche: item.niche || 'Business Owner',
        trade: item.trade || item.niche || 'local service',
        city: item.city || 'your area',
        source: item.source || 'multi_account_scraper',
        query: item.query || '',
        assignedAccount: assigned,
        discoveredAt: new Date().toISOString(),
        status: 'queued',
        lastSentAt: null
      };

      db.leads.push(newLeadObj);
      existingPhones.add(formatted.cleanNumber);
      added++;
    }
  }

  saveDatabase(db);
  console.log(`✅ [Webify Leads DB] Added ${added} new unique leads${defaultAccount ? ` for ${defaultAccount}` : ''}. Total in DB: ${db.leads.length}`);
  return { added, total: db.leads.length };
}

/**
 * Atomic Lead Claiming: Prioritizes ALREADY PRE-VERIFIED WhatsApp leads
 * Guarantees NO two devices ever message or touch the same lead
 */
function claimNextLead(deviceId) {
  const db = loadDatabase();
  const now = Date.now();
  const devKey1 = `device_${deviceId}`;
  const devKey2 = `account_${deviceId}`;

  const isValidTargetLead = (l) => {
    if (!l || !l.phone) return false;
    const p = String(l.phone).replace(/\D/g, '');
    // STRICT FIREWALL: Never contact Indian numbers (+91)
    if (p.startsWith('91') || l.country === 'India') return false;
    if (isPhoneAlreadySent(p)) return false;
    return true;
  };

  // 1. TOP PRIORITY: Pre-verified WhatsApp lead assigned to this device
  let lead = db.leads.find(l => {
    if (!isValidTargetLead(l)) return false;
    if (l.status === 'queued' && l.whatsapp_verified === true && (l.assignedAccount === devKey1 || l.assignedAccount === devKey2 || l.assignedAccount === String(deviceId))) {
      return true;
    }
    return false;
  });

  // 2. TOP PRIORITY: Any unassigned pre-verified WhatsApp lead
  if (!lead) {
    lead = db.leads.find(l => {
      if (!isValidTargetLead(l)) return false;
      return l.status === 'queued' && l.whatsapp_verified === true && !l.assignedAccount;
    });
  }

  // 3. SECONDARY: Any queued lead specifically assigned to this device
  if (!lead) {
    lead = db.leads.find(l => {
      if (!isValidTargetLead(l)) return false;
      if (l.status === 'queued' && (l.assignedAccount === devKey1 || l.assignedAccount === devKey2 || l.assignedAccount === String(deviceId))) {
        return true;
      }
      return false;
    });
  }

  // 4. SECONDARY: Any unassigned queued lead
  if (!lead) {
    lead = db.leads.find(l => {
      if (!isValidTargetLead(l)) return false;
      return l.status === 'queued' && !l.assignedAccount;
    });
  }

  // 5. Fallback: Recover stalled processing lead (> 15 minutes ago)
  if (!lead) {
    lead = db.leads.find(l => {
      if (!isValidTargetLead(l)) return false;
      if (l.status === 'processing' && l.claimed_at && (now - l.claimed_at > 15 * 60 * 1000)) {
        return true;
      }
      return false;
    });
  }

  if (lead) {
    lead.status = 'processing';
    lead.claimed_by = deviceId;
    lead.claimed_at = now;
    lead.assignedAccount = devKey1;
    saveDatabase(db);
    return lead;
  }

  return null;
}

/**
 * Get unverified queued leads for batch pre-verification
 */
function getUnverifiedQueuedLeads(limit = 25) {
  const db = loadDatabase();
  const unverified = [];
  for (const l of db.leads) {
    if (l.status === 'queued' && !l.whatsapp_verified && l.status !== 'not_on_whatsapp') {
      const p = String(l.phone).replace(/\D/g, '');
      if (!p.startsWith('91') && l.country !== 'India' && !isPhoneAlreadySent(p)) {
        unverified.push(l);
        if (unverified.length >= limit) break;
      }
    }
  }
  return unverified;
}

/**
 * Count how many pre-verified WhatsApp leads are waiting in queue
 */
function getVerifiedQueuedLeadsCount(deviceId = null) {
  const db = loadDatabase();
  const devKey1 = deviceId ? `device_${deviceId}` : null;
  const devKey2 = deviceId ? `account_${deviceId}` : null;

  return db.leads.filter(l => {
    if (l.status !== 'queued' || l.whatsapp_verified !== true) return false;
    const p = String(l.phone).replace(/\D/g, '');
    if (p.startsWith('91') || isPhoneAlreadySent(p)) return false;
    if (deviceId) {
      return (l.assignedAccount === devKey1 || l.assignedAccount === devKey2 || !l.assignedAccount);
    }
    return true;
  }).length;
}

/**
 * Apply batch WhatsApp verification results to the database in bulk
 */
function markBatchVerificationResults(resultsMap) {
  if (!resultsMap || !(resultsMap instanceof Map) || resultsMap.size === 0) return 0;
  const db = loadDatabase();
  let updatedCount = 0;

  for (const lead of db.leads) {
    if (lead.status === 'queued' && !lead.whatsapp_verified) {
      const clean = String(lead.phone).replace(/\D/g, '');
      if (resultsMap.has(clean)) {
        const info = resultsMap.get(clean);
        if (info.exists) {
          lead.whatsapp_verified = true;
          if (info.jid) lead.jid = info.jid;
          if (info.lid) lead.lid = info.lid;
        } else {
          lead.status = 'not_on_whatsapp';
          lead.whatsapp_verified = false;
        }
        updatedCount++;
      }
    }
  }

  if (updatedCount > 0) {
    saveDatabase(db);
    console.log(`🛡️ [Pre-Verifier] Updated ${updatedCount} leads in DB (${db.leads.filter(l => l.status === 'queued' && l.whatsapp_verified).length} verified WhatsApp leads ready in queue).`);
  }
  return updatedCount;
}

function releaseLeadClaim(phone) {
  const db = loadDatabase();
  const cleanDigits = String(phone).replace(/\D/g, '');
  const lead = db.leads.find(l => l.phone === cleanDigits || l.phone === phone);
  if (lead && lead.status === 'processing') {
    lead.status = 'queued';
    lead.claimed_by = null;
    lead.claimed_at = null;
    saveDatabase(db);
  }
}

function getQueuedLeadForAccount(accountId) {
  return claimNextLead(accountId);
}

function getQueuedLeadsCount(accountId = null) {
  const db = loadDatabase();
  if (accountId) {
    const devKey1 = `device_${accountId}`;
    const devKey2 = `account_${accountId}`;
    return db.leads.filter(l => l.status === 'queued' && (l.assignedAccount === devKey1 || l.assignedAccount === devKey2 || !l.assignedAccount)).length;
  }
  return db.leads.filter(l => l.status === 'queued').length;
}

function getQueuedLeads(limit = 10) {
  const db = loadDatabase();
  return db.leads.filter(l => l.status === 'queued').slice(0, limit);
}

function getHotRepliedLeads() {
  const db = loadDatabase();
  return db.leads.filter(l => l.status === 'replied' || l.status === 'hot').slice(-50).reverse();
}

/**
 * Update status of a lead
 */
function updateLeadStatus(phone, status, error = null, deviceId = null) {
  const db = loadDatabase();
  const cleanDigits = String(phone).replace(/\D/g, '');
  const lead = db.leads.find(l => l.phone === cleanDigits || l.phone === phone || (l.jid && l.jid.includes(cleanDigits)));
  if (lead) {
    lead.status = status;
    if (deviceId) lead.handledByDevice = deviceId;
    if (status === 'sent') {
      lead.lastSentAt = new Date().toISOString();
      db.sentCount = (db.sentCount || 0) + 1;
      recordSentPhone(cleanDigits);
    }
    if (error) lead.lastError = error;
    saveDatabase(db);
  }
}

function syncExistingChatsToDatabase(chatsSet) {
  if (!chatsSet || !(chatsSet instanceof Set) || chatsSet.size === 0) return 0;
  const db = loadDatabase();
  let updated = 0;
  for (const lead of db.leads) {
    if (lead.status === 'queued') {
      const clean = String(lead.phone).replace(/\D/g, '');
      const variations = [clean];
      if (clean.length === 11 && clean.startsWith('1')) variations.push(clean.slice(1));
      else if (clean.length === 10) variations.push('1' + clean, '91' + clean);
      else if (clean.length === 12 && clean.startsWith('91')) variations.push(clean.slice(2));

      if (variations.some(v => chatsSet.has(v))) {
        lead.status = 'already_contacted';
        lead.failReason = 'Synced from existing WhatsApp chat history';
        updated++;
      }
    }
  }
  if (updated > 0) {
    saveDatabase(db);
    console.log(`🛡️ [Database Shield Sync] Automatically shielded and marked ${updated} leads as 'already_contacted' based on your WhatsApp history!`);
  }
  return updated;
}

// Rotating User Agents for web scrapers
const ROTATING_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
];

/**
 * Extract International phone numbers from raw HTML text
 */
function extractInternationalPhones(text) {
  const results = [];
  if (!text) return results;

  // 1. US / Canada 10 & 11 digits
  const usRegex = /(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?([2-9]\d{2})[-.\s]?(\d{4})\b/g;
  let match;
  while ((match = usRegex.exec(text)) !== null) {
    const raw = match[0];
    const digits = raw.replace(/\D/g, '');
    const clean1 = digits.length === 10 ? '1' + digits : digits;
    if (clean1.length === 11 && clean1.startsWith('1') && !isTollFree(clean1)) {
      results.push({ phone: clean1, country: 'USA' });
    }
  }

  // 2. UK (+44)
  const ukRegex = /(?:\+?44[-.\s]?|0)7\d{3}[-.\s]?\d{6}\b/g;
  while ((match = ukRegex.exec(text)) !== null) {
    const digits = match[0].replace(/\D/g, '');
    const cleanUk = digits.startsWith('0') ? '44' + digits.slice(1) : (digits.startsWith('44') ? digits : '44' + digits);
    results.push({ phone: cleanUk, country: 'UK' });
  }

  // 3. Australia (+61)
  const auRegex = /(?:\+?61[-.\s]?|0)4\d{2}[-.\s]?\d{3}[-.\s]?\d{3}\b/g;
  while ((match = auRegex.exec(text)) !== null) {
    const digits = match[0].replace(/\D/g, '');
    const cleanAu = digits.startsWith('0') ? '61' + digits.slice(1) : (digits.startsWith('61') ? digits : '61' + digits);
    results.push({ phone: cleanAu, country: 'Australia' });
  }

  return results;
}

/**
 * Scrape Yandex for B2B phone numbers
 */
async function scrapeYandex(query) {
  const url = `https://yandex.com/search/?text=${encodeURIComponent(query)}&numdoc=20`;
  const ua = ROTATING_USER_AGENTS[Math.floor(Math.random() * ROTATING_USER_AGENTS.length)];
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) return [];
    const html = await res.text();
    if (html.includes('captcha') && html.length < 10000) {
      return [];
    }
    const stripped = html.replace(/<[^>]+>/g, ' ');
    return extractInternationalPhones(stripped);
  } catch (e) {
    return [];
  }
}

/**
 * Craigslist Scraper for US Cities
 */
async function scrapeCraigslist(city, niche, minLeads = 15) {
  const extracted = [];
  const queryModifiers = ['', 'commercial', 'emergency', 'residential', 'licensed', 'services'];
  const modifier = queryModifiers[Math.floor(Math.random() * queryModifiers.length)];
  const fullQuery = modifier ? `${modifier} ${niche}` : niche;
  const searchUrl = `https://${city}.craigslist.org/search/bbb?query=${encodeURIComponent(fullQuery)}`;

  try {
    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': ROTATING_USER_AGENTS[0],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!res.ok) return [];
    const html = await res.text();
    const results = [...html.matchAll(/<li class="cl-static-search-result"[^>]*>(.*?)<\/li>/gs)].map(m => m[1]);
    const phoneRegex = /(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?([2-9]\d{2})[-.\s]?(\d{4})\b/g;

    for (const r of results) {
      if (extracted.length >= minLeads) break;
      const titleMatch = r.match(/<div class="title">(.*?)<\/div>/);
      const rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : `${niche} specialist`;
      const matches = [...r.matchAll(phoneRegex)].map(m => m[0]);

      for (const phone of matches) {
        const cleanDigits = phone.replace(/\D/g, '');
        const clean1 = cleanDigits.length === 10 ? '1' + cleanDigits : cleanDigits;
        if (clean1.length === 11 && clean1.startsWith('1') && !isTollFree(clean1)) {
          extracted.push({
            phone: clean1,
            name: rawTitle.replace(/[^\w\s-]/g, '').slice(0, 35).trim() || 'Business Owner',
            niche: `${niche.charAt(0).toUpperCase() + niche.slice(1)} (${city.toUpperCase()})`,
            trade: niche,
            city: city,
            country: 'USA',
            source: 'craigslist_us'
          });
          break;
        }
      }
    }
  } catch (err) {}

  return extracted;
}

/**
 * Free Multi-Account Web Scraper
 * Combines Yandex Search + Craigslist for high-yield lead generation
 */
async function triggerFreeWebScraper(options = {}) {
  const targetAccount = options.targetAccount || 'device_1';
  const minLeads = options.targetCount || 30;
  const territory = getTerritoryForAccount(targetAccount);

  console.log(`⚡ [Multi-Scraper - ${targetAccount}] Harvesting fresh leads in: ${territory.name}...`);

  const extracted = [];
  const seenPhonesInBatch = new Set();

  const cityList = options.targetCity ? [options.targetCity] : [...territory.cities].sort(() => 0.5 - Math.random());
  const nicheList = options.targetNiche ? [options.targetNiche] : [...territory.niches].sort(() => 0.5 - Math.random());

  for (const city of cityList) {
    if (extracted.length >= minLeads) break;

    for (const niche of nicheList) {
      if (extracted.length >= minLeads) break;

      // 1. Try Yandex B2B Search first
      const yandexQueries = [
        `site:facebook.com "call or text" "${niche}" "${city}" -site:linktr.ee`,
        `site:instagram.com "${niche}" "${city}" "call or text"`,
        `"${niche}" "${city}" "call or text" OR "phone:"`
      ];

      for (const yQuery of yandexQueries) {
        if (extracted.length >= minLeads) break;
        const yResults = await scrapeYandex(yQuery);
        for (const item of yResults) {
          if (!seenPhonesInBatch.has(item.phone) && !isPhoneAlreadySent(item.phone)) {
            seenPhonesInBatch.add(item.phone);
            extracted.push({
              phone: item.phone,
              name: `${niche.charAt(0).toUpperCase() + niche.slice(1)} in ${city.charAt(0).toUpperCase() + city.slice(1)}`,
              niche: `${niche} (${city})`,
              trade: niche,
              city: city,
              country: item.country || 'USA',
              assignedAccount: targetAccount,
              source: `yandex_${targetAccount}`,
              query: yQuery
            });
          }
        }
      }

      // 2. If US territory and still need leads, scrape Craigslist
      if (extracted.length < minLeads && (territory.name.includes('US') || territory.cities.includes('dallas') || territory.cities.includes('austin') || territory.cities.includes('chicago'))) {
        const clResults = await scrapeCraigslist(city, niche, minLeads - extracted.length);
        for (const cl of clResults) {
          if (!seenPhonesInBatch.has(cl.phone) && !isPhoneAlreadySent(cl.phone)) {
            seenPhonesInBatch.add(cl.phone);
            cl.assignedAccount = targetAccount;
            extracted.push(cl);
          }
        }
      }
    }
  }

  console.log(`🎯 [Multi-Scraper - ${targetAccount}] Harvested ${extracted.length} verified leads for ${territory.name}.`);
  return addLeadsToQueue(extracted, targetAccount);
}

/**
 * Apify Lead Discovery (Fallback)
 */
async function triggerApifyLeadDiscovery(targetAccount = 'device_1') {
  if (!APIFY_TOKEN) return [];
  console.log(`🔍 [Apify Multi-Account] Running lead discovery for ${targetAccount}...`);

  const territory = getTerritoryForAccount(targetAccount);
  const sampleCity = territory.cities[Math.floor(Math.random() * territory.cities.length)];
  const sampleNiche = territory.niches[Math.floor(Math.random() * territory.niches.length)];

  const searchQueries = [
    `site:facebook.com ("call or text" OR "DM to order") ("${sampleNiche}" OR "contractor") ("${sampleCity}") -site:linktr.ee`,
    `site:instagram.com ("call or text" OR "DM for quote") ("${sampleNiche}") ("no website" OR "website coming soon")`,
    `("${sampleNiche}") ("${sampleCity}") ("call or text" OR "text us at") ("+1" OR "phone:") -site:yelp.com`
  ];

  try {
    const runResponse = await fetch(`https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&memory=512`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: searchQueries.join('\n'),
        maxPagesPerQuery: 1,
        resultsPerPage: 25,
        mobileResults: true,
        languageCode: 'en'
      })
    });

    if (!runResponse.ok) return [];

    const items = await runResponse.json();
    const extracted = [];

    for (const item of items) {
      const textToSearch = `${item.title || ''} ${item.description || ''} ${item.snippet || ''}`;
      const found = extractInternationalPhones(textToSearch);
      for (const f of found) {
        extracted.push({
          phone: f.phone,
          name: (item.title || '').split(/[-|–]/)[0].trim().slice(0, 30),
          niche: (item.searchQuery || sampleNiche).slice(0, 25),
          trade: sampleNiche,
          city: sampleCity,
          country: f.country,
          assignedAccount: targetAccount,
          source: `apify_${targetAccount}`,
          query: item.searchQuery || ''
        });
      }
    }

    return addLeadsToQueue(extracted, targetAccount);
  } catch (err) {
    console.error('❌ Apify Run Failed:', err.message);
    return [];
  }
}

let is247ScraperRunning = false;
let isScraperPaused = false;
let scraperStats = {
  status: 'Autonomous Multi-Territory Harvest Active',
  cyclesCompleted: 0,
  leadsHarvestedSession: 0,
  lastScrapedAccount: 'device_1',
  lastScrapedCity: 'Dallas',
  lastScrapedNiche: 'roofing',
  lastRunTime: null
};

function pauseScraper() {
  isScraperPaused = true;
  scraperStats.status = 'Scraper Paused by User';
  console.log('⏸️ [Free Scraper Engine] Paused by user.');
}

function resumeScraper() {
  isScraperPaused = false;
  scraperStats.status = 'Resuming Multi-Territory Harvest...';
  console.log('▶️ [Free Scraper Engine] Resumed by user.');
}

function getScraperStats() {
  const db = loadDatabase();
  return {
    ...scraperStats,
    isPaused: isScraperPaused,
    totalInDb: db.leads.length,
    queuedCount: db.leads.filter(l => l.status === 'queued').length,
    sentCount: db.leads.filter(l => l.status === 'sent').length
  };
}

/**
 * Continuous autonomous scraper feeding all devices with diverse leads
 */
async function start247ContinuousScraper() {
  if (is247ScraperRunning) return;
  is247ScraperRunning = true;
  console.log('🌍 [24/7 Multi-Territory Scraper Engine] Running continuous harvest across all devices!');

  const deviceKeys = ['device_1', 'device_2', 'device_3', 'device_4', 'device_5', 'device_6'];
  let currentIdx = 0;

  while (is247ScraperRunning) {
    if (isScraperPaused) {
      await new Promise(r => setTimeout(r, 4000));
      continue;
    }

    try {
      const activeDevice = deviceKeys[currentIdx % deviceKeys.length];
      currentIdx++;

      const queuedCount = getQueuedLeadsCount(activeDevice);
      if (queuedCount >= 40) {
        await new Promise(r => setTimeout(r, 6000));
        continue;
      }

      const territory = getTerritoryForAccount(activeDevice);
      const city = territory.cities[Math.floor(Math.random() * territory.cities.length)];
      const niche = territory.niches[Math.floor(Math.random() * territory.niches.length)];

      scraperStats.lastScrapedAccount = activeDevice;
      scraperStats.lastScrapedCity = city;
      scraperStats.lastScrapedNiche = niche;
      scraperStats.lastRunTime = new Date().toISOString();
      scraperStats.status = `Harvesting for ${activeDevice} in ${city.toUpperCase()} (${niche})...`;

      const result = await triggerFreeWebScraper({
        targetAccount: activeDevice,
        targetCount: 25,
        targetCity: city,
        targetNiche: niche
      });

      scraperStats.cyclesCompleted++;
      scraperStats.leadsHarvestedSession += (result?.added || 0);

      await new Promise(r => setTimeout(r, 12000));
    } catch (err) {
      console.error('❌ [Continuous Scraper Exception]:', err.message);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

function purgeIndianLeads() {
  const db = loadDatabase();
  const before = db.leads.length;
  db.leads = db.leads.filter(l => {
    const p = String(l.phone || '').replace(/\D/g, '');
    return !p.startsWith('91') && l.country !== 'India';
  });
  const removed = before - db.leads.length;
  if (removed > 0) {
    saveDatabase(db);
    console.log(`🧹 [Lead Hygiene] Purged ${removed} Indian (+91) leads from database queue.`);
  }
  return removed;
}

module.exports = {
  loadDatabase,
  saveDatabase,
  purgeIndianLeads,
  addLeadsToQueue,
  claimNextLead,
  getUnverifiedQueuedLeads,
  getVerifiedQueuedLeadsCount,
  markBatchVerificationResults,
  releaseLeadClaim,
  getQueuedLeads,
  getQueuedLeadForAccount,
  getQueuedLeadsCount,
  getHotRepliedLeads,
  updateLeadStatus,
  syncExistingChatsToDatabase,
  triggerFreeWebScraper,
  triggerApifyLeadDiscovery,
  start247ContinuousScraper,
  pauseScraper,
  resumeScraper,
  isPhoneAlreadySent,
  recordSentPhone,
  recordBulkSentPhones,
  getTotalShieldedCount,
  getScraperStats,
  formatWhatsAppJid,
  getTerritoryForAccount,
  TERRITORIES
};
