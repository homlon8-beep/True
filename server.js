/**
 * Webify Web Dashboard & Control Server (Multi-Device Undetectable Edition)
 * Supports up to 6 simultaneous WhatsApp accounts (3 devices = 150 leads/24h, 6 devices = 300/24h)
 * Features /qr multi-device switching, live B2B lead queue controls, and 1-click CSV export
 */

require('dotenv').config();

// Global Process Crash Shield
process.on('uncaughtException', (err) => {
  console.error('🛡️ [Crash Shield - Uncaught Exception]:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('🛡️ [Crash Shield - Unhandled Rejection]:', reason);
});

const express = require('express');
const path = require('path');
const whatsapp = require('./whatsapp');
const scraper = require('./scraper');
const queue = require('./queue');
const chatMemory = require('./chatMemory');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Anti-Sleep Keep-Alive State & Auto-Host Detection
let detectedBaseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
let keepAliveTimer = null;
let lastPingStatus = 'Pending first ping';
let lastPingTime = 'Never';

function startKeepAliveEngine(targetUrl) {
  if (!targetUrl || keepAliveTimer) return;
  detectedBaseUrl = targetUrl.replace(/\/$/, '');
  console.log(`📡 [Anti-Sleep Keep-Alive] Engaged for: ${detectedBaseUrl}`);
  console.log(`⏱️ [Anti-Sleep Keep-Alive] Pinging ${detectedBaseUrl}/ping every 3 minutes to stop Render Free sleep.`);

  const runPing = async () => {
    try {
      const res = await fetch(`${detectedBaseUrl}/ping`, {
        headers: { 'User-Agent': 'Render-AntiSleep-Heartbeat/3.0' },
        signal: AbortSignal.timeout(10000)
      });
      lastPingStatus = `HTTP ${res.status} OK`;
      lastPingTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.log(`💓 [Anti-Sleep Heartbeat] Pinged ${detectedBaseUrl}/ping -> ${lastPingStatus} at ${lastPingTime}`);
    } catch (err) {
      lastPingStatus = `Error: ${err.message}`;
      console.warn(`⚠️ [Anti-Sleep Heartbeat Warning]: ${err.message}`);
    }
  };

  runPing();
  keepAliveTimer = setInterval(runPing, 3 * 60 * 1000);
}

// Inbound Request Interceptor (Locks detectedBaseUrl automatically from incoming traffic)
app.use((req, res, next) => {
  if (!detectedBaseUrl && req.headers.host) {
    const proto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
    const fullHostUrl = `${proto}://${req.headers.host}`;
    if (!fullHostUrl.includes('localhost') && !fullHostUrl.includes('127.0.0.1')) {
      console.log(`🎯 [Auto Host Detect] Detected live server address: ${fullHostUrl}`);
      startKeepAliveEngine(fullHostUrl);
    }
  }
  next();
});

// Fast Ping & Healthcheck endpoints
app.get('/ping', (req, res) => {
  res.status(200).send('OK');
});

app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

/**
 * Multi-Device QR Pairing Page (/qr?device=X)
 */
app.get('/qr', (req, res) => {
  const targetId = parseInt(req.query.device || '1', 10);
  const clampedId = Math.min(whatsapp.MAX_DEVICES, Math.max(1, isNaN(targetId) ? 1 : targetId));

  let session = whatsapp.getDevice(clampedId);
  if (!session || (!session.sock && !session.isConnected)) {
    whatsapp.initDevice(clampedId);
    session = whatsapp.getDevice(clampedId);
  }

  const isConn = session && session.isConnected;
  const qrDataUrl = session ? session.qrDataUrl : null;
  const phone = session ? session.phone : null;

  let bodyContent = '';
  if (isConn) {
    bodyContent = `
      <div class="card connected">
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">✅</div>
        <h2>Device ${clampedId} Connected</h2>
        <div class="phone">+${phone}</div>
        <p class="desc">This WhatsApp device is active, paired, and ready to dispatch B2B leads.</p>
        <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
          <a href="/" class="btn btn-green">Open Dashboard</a>
          <form method="POST" action="/api/devices/${clampedId}/logout" style="margin: 0;">
            <button type="submit" class="btn btn-red" onclick="return confirm('Disconnect Device ${clampedId}?');">Disconnect & Relink</button>
          </form>
        </div>
      </div>
    `;
  } else if (qrDataUrl) {
    bodyContent = `
      <div class="card" id="qr-container">
        <h2>Link Device ${clampedId}</h2>
        <p class="subtitle">Open WhatsApp on your phone → Linked Devices → Link a Device</p>
        <div class="qr-box">
          <img src="${qrDataUrl}" alt="Device ${clampedId} QR Code" class="qr-img" id="qr-img-tag" />
        </div>
        <p class="refresh-hint">⚡ Instant QR Stream Active. Point phone camera now.</p>
        <div style="margin-top: 1rem;">
          <form method="POST" action="/api/devices/${clampedId}/reset" style="margin: 0;">
            <button type="submit" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">⚡ Force Fresh QR (1s Reset)</button>
          </form>
        </div>
      </div>
    `;
  } else {
    bodyContent = `
      <div class="card" id="qr-container">
        <div class="spinner"></div>
        <h2>Generating Device ${clampedId} QR...</h2>
        <p class="subtitle">Establishing fast Baileys handshake, ready in 1-2 seconds...</p>
        <div style="margin-top: 1.25rem;">
          <form method="POST" action="/api/devices/${clampedId}/reset" style="margin: 0;">
            <button type="submit" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">⚡ Force Fresh QR (1s Reset)</button>
          </form>
        </div>
      </div>
    `;
  }

  // Generate Tab switcher for Devices 1..MAX_DEVICES
  const allDevs = whatsapp.getAllDevices();
  const tabsHtml = allDevs.map(d => {
    const isThisActive = (d.id === clampedId);
    let tabClass = 'tab-btn';
    if (d.isConnected) tabClass += ' tab-online';
    if (isThisActive) tabClass += ' tab-active';
    return `<a href="/qr?device=${d.id}" class="${tabClass}">Device ${d.id}${d.isConnected ? ' ●' : ''}</a>`;
  }).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Link WhatsApp Devices - Webify</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: #0b0f19; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem; }
        .wrapper { max-width: 540px; width: 100%; text-align: center; }
        .header-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
        .back-link { color: #818cf8; text-decoration: none; font-size: 0.9rem; font-weight: 600; }
        .tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 1.5rem; }
        .tab-btn { padding: 0.65rem 0.5rem; border-radius: 10px; text-decoration: none; font-size: 0.8rem; font-weight: 700; border: 1px solid #1e293b; background: #111827; color: #94a3b8; transition: all 0.2s; }
        .tab-btn.tab-online { border-color: #059669; color: #6ee7b7; background: #064e3b25; }
        .tab-btn.tab-active { border-color: #6366f1; background: #4f46e525; color: #fff; }
        .card { background: #111827; border: 1px solid #1f2937; border-radius: 20px; padding: 2.25rem 1.75rem; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
        .card.connected { border-color: #059669; }
        h2 { font-size: 1.4rem; margin-bottom: 0.4rem; color: #f8fafc; }
        .subtitle { color: #94a3b8; font-size: 0.85rem; margin-bottom: 1.25rem; }
        .qr-box { background: #fff; padding: 1rem; border-radius: 16px; display: inline-block; margin-bottom: 1.25rem; }
        .qr-img { width: 240px; height: 240px; display: block; }
        .phone { font-size: 1.25rem; font-weight: 700; color: #34d399; margin: 0.5rem 0 1rem; }
        .desc { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.5rem; }
        .btn { display: inline-block; padding: 0.65rem 1.25rem; border-radius: 8px; font-weight: 600; text-decoration: none; border: none; cursor: pointer; font-size: 0.9rem; }
        .btn-green { background: #059669; color: #fff; }
        .btn-red { background: #dc2626; color: #fff; }
        .btn-outline { background: transparent; border: 1px solid #334155; color: #cbd5e1; }
        .refresh-hint { font-size: 0.8rem; color: #64748b; }
        .spinner { width: 40px; height: 40px; border: 4px solid #1f2937; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s infinite linear; margin: 0 auto 1.25rem; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      </style>
      <script>
        // High-Speed Flicker-Free QR Stream
        let currentConnected = ${isConn ? 'true' : 'false'};
        let lastQrData = "${qrDataUrl || ''}";

        async function pollQrStream() {
          try {
            const res = await fetch('/api/devices/${clampedId}/qr-status');
            const data = await res.json();

            if (data.isConnected && !currentConnected) {
              window.location.reload();
              return;
            }

            if (!data.isConnected && data.qrDataUrl && data.qrDataUrl !== lastQrData) {
              lastQrData = data.qrDataUrl;
              const imgTag = document.getElementById('qr-img-tag');
              if (imgTag) {
                imgTag.src = data.qrDataUrl;
              } else {
                // Replace spinner with QR box without reloading page
                const container = document.getElementById('qr-container');
                if (container) {
                  container.innerHTML = \`
                    <h2>Link Device ${clampedId}</h2>
                    <p class="subtitle">Open WhatsApp on your phone &rarr; Linked Devices &rarr; Link a Device</p>
                    <div class="qr-box">
                      <img src="\${data.qrDataUrl}" alt="Device QR Code" class="qr-img" id="qr-img-tag" />
                    </div>
                    <p class="refresh-hint">⚡ Instant QR Stream Active. Point phone camera now.</p>
                    <div style="margin-top: 1rem;">
                      <form method="POST" action="/api/devices/${clampedId}/reset" style="margin: 0;">
                        <button type="submit" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">⚡ Force Fresh QR (1s Reset)</button>
                      </form>
                    </div>
                  \`;
                }
              }
            }
          } catch (e) {}
        }

        if (!currentConnected) {
          setInterval(pollQrStream, 1500);
        }
      </script>
    </head>
    <body>
      <div class="wrapper">
        <div class="header-nav">
          <a href="/" class="back-link">← Back to Dashboard</a>
          <span style="color: #64748b; font-size: 0.85rem;">Slot <strong>${clampedId}</strong> of ${whatsapp.MAX_DEVICES}</span>
        </div>
        <div class="tabs">
          ${tabsHtml}
        </div>
        ${bodyContent}
      </div>
    </body>
    </html>
  `);
});

/**
 * Main Web Dashboard (/)
 */
app.get('/', (req, res) => {
  const state = queue.getQueueState();
  const scraperStats = scraper.getScraperStats();
  const totalShielded = scraper.getTotalShieldedCount ? scraper.getTotalShieldedCount() : 0;
  const hotLeads = scraper.getHotRepliedLeads ? scraper.getHotRepliedLeads() : [];

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="8">
      <title>Webify — Multi-Device AI Lead Engine</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: #0b0f19; color: #f1f5f9; padding: 1.5rem; }
        .container { max-width: 860px; margin: 0 auto; }
        header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #1f2937; padding-bottom: 1.25rem; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem; }
        h1 { font-size: 1.45rem; color: #818cf8; }
        .status-badge { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.9rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 700; text-decoration: none; }
        .status-badge.online { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; }
        .status-badge.offline { background: #7f1d1d; color: #fca5a5; border: 1px solid #dc2626; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .stat-card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 1.25rem; text-align: center; }
        .stat-val { font-size: 1.7rem; font-weight: 800; color: #818cf8; margin-top: 0.35rem; }
        .stat-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .section-box { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 1.5rem; margin-bottom: 1.5rem; }
        h3 { font-size: 1.1rem; margin-bottom: 1rem; color: #f8fafc; }
        .btn-group { display: flex; gap: 0.75rem; flex-wrap: wrap; }
        .btn { padding: 0.65rem 1.25rem; border-radius: 8px; font-weight: 600; text-decoration: none; border: none; cursor: pointer; font-size: 0.9rem; }
        .btn-primary { background: #4f46e5; color: #fff; }
        .btn-green { background: #059669; color: #fff; }
        .btn-outline { background: transparent; border: 1px solid #374151; color: #cbd5e1; }
        textarea { width: 100%; height: 90px; background: #0b0f19; border: 1px solid #374151; border-radius: 8px; color: #fff; padding: 0.75rem; font-size: 0.9rem; margin-bottom: 0.75rem; resize: vertical; }
        .log-box { background: #0b0f19; padding: 1rem; border-radius: 8px; font-family: monospace; font-size: 0.85rem; color: #94a3b8; line-height: 1.5; }
        .device-row { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #0b0f19; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid #1f2937; flex-wrap: wrap; gap: 0.5rem; }
        .device-title { font-weight: 700; color: #f8fafc; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem; }
        .device-meta { font-size: 0.8rem; color: #94a3b8; }
        .badge-pill { padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; }
        .badge-online { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; }
        .badge-offline { background: #374151; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <div>
            <h1>Webify — Multi-Device AI Lead Engine</h1>
            <p style="color: #64748b; font-size: 0.85rem; margin-top: 0.2rem;">Up to 6 Devices Concurrently • 50 Leads / Device (3 Devices = 150 Target) • Websites &amp; 180+ AI Lead Bots • STRICTLY In-Chat Closing</p>
          </div>
          <div>
            ${state.connectedDevicesCount > 0 ?
              `<a href="/qr" class="status-badge online">● ${state.connectedDevicesCount} / ${state.maxDevices} Devices Active</a>` :
              `<a href="/qr" class="status-badge offline">⚠️ Scan Devices QR</a>`
            }
          </div>
        </header>

        <div class="grid">
          <div class="stat-card">
            <div class="stat-label">Active Devices</div>
            <div class="stat-val" style="color: #818cf8;">${state.connectedDevicesCount} / ${state.maxDevices}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Today's Outreach</div>
            <div class="stat-val" style="color: #34d399;">${state.dailySentCount} / ${state.dailyMaxLeads}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Sent (All Time)</div>
            <div class="stat-val">${state.totalSentDb}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Leads In Queue</div>
            <div class="stat-val" style="color: #fbbf24;">${state.queuedRemaining}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Shielded Past Leads</div>
            <div class="stat-val" style="color: #a855f7;">${totalShielded}</div>
          </div>
          <div class="stat-card" style="border-color: #f43f5e33;">
            <div class="stat-label" style="color: #fda4af;">Hot Leads (Replied)</div>
            <div class="stat-val" style="color: #f43f5e;">${hotLeads.length}</div>
          </div>
        </div>

        ${req.query.shielded ? `
          <div style="background: #1e1b4b; border: 1px solid #8b5cf6; border-radius: 12px; padding: 1.1rem; margin-bottom: 1.5rem; color: #e9d5ff;">
            🛡️ <strong>Permanent Duplicate Shield Updated!</strong> Added <strong>${req.query.count || 0}</strong> numbers to permanent blacklist ledger.
          </div>
        ` : ''}

        ${req.query.settings_saved ? `
          <div style="background: #064e3b; border: 1px solid #10b981; border-radius: 12px; padding: 1.1rem; margin-bottom: 1.5rem; color: #a7f3d0; font-weight: 600;">
            ✅ <strong>24-Hour Outreach Limit Updated!</strong> Set to <strong>${req.query.limit}</strong> messages per device in 24 hours. All workers updated immediately.
          </div>
        ` : ''}

        <!-- Customizable 24-Hour Outreach Volume & Speed Controller -->
        <div class="section-box" style="border-left: 4px solid #10b981; background: #064e3b12;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <h3 style="margin: 0; color: #34d399;">⚡ Outreach Speed & Volume Controller</h3>
              <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.2rem;">
                Adjust dispatch speed, message delays, and 24-hour targets. Takes effect immediately on all connected devices.
              </p>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
              <span style="background: #065f46; color: #a7f3d0; font-size: 0.8rem; padding: 0.35rem 0.85rem; border-radius: 9999px; font-weight: 700;">
                Target: ${state.dailyMaxPerDevice || 50} msgs/device/24h
              </span>
              <span style="background: #312e81; color: #c7d2fe; font-size: 0.8rem; padding: 0.35rem 0.85rem; border-radius: 9999px; font-weight: 700;">
                Speed: ${((state.botConfig && state.botConfig.minMsgDelayMs ? state.botConfig.minMsgDelayMs : 35000) / 1000).toFixed(0)}s - ${((state.botConfig && state.botConfig.maxMsgDelayMs ? state.botConfig.maxMsgDelayMs : 70000) / 1000).toFixed(0)}s
              </span>
            </div>
          </div>

          <!-- Speed Presets -->
          <div style="margin-top: 1rem; background: #0b0f19; border: 1px solid #1f2937; border-radius: 10px; padding: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
              <span style="font-size: 0.85rem; color: #f1f5f9; font-weight: 700;">⚡ Dispatch Speed Presets:</span>
              <form method="POST" action="/api/settings/toggle-timezone-shield" style="margin: 0;">
                <button type="submit" class="btn btn-outline" style="font-size: 0.8rem; padding: 0.3rem 0.75rem; border-color: ${state.botConfig && state.botConfig.businessHoursShield ? '#f59e0b' : '#10b981'}; color: ${state.botConfig && state.botConfig.businessHoursShield ? '#fbbf24' : '#34d399'};">
                  ${state.botConfig && state.botConfig.businessHoursShield ? '🌙 US Daytime Lock: ON (Click for 24/7 Any-Time)' : '🟢 24/7 Any-Time Dispatch: ACTIVE (Zero Delay)'}
                </button>
              </form>
            </div>

            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <form method="POST" action="/api/settings/pacing" style="margin: 0;">
                <input type="hidden" name="preset" value="turbo">
                <input type="hidden" name="dailyMaxLeads" value="${state.dailyMaxPerDevice || 50}">
                <button type="submit" class="btn btn-outline" style="padding: 0.45rem 0.85rem; font-size: 0.82rem; ${state.botConfig && state.botConfig.pacingPreset === 'turbo' ? 'border-color: #ec4899; color: #f472b6; background: #83184322;' : ''}">
                  🚀 Turbo (25s - 45s • 10 msgs in ~5m)
                </button>
              </form>

              <form method="POST" action="/api/settings/pacing" style="margin: 0;">
                <input type="hidden" name="preset" value="fast">
                <input type="hidden" name="dailyMaxLeads" value="${state.dailyMaxPerDevice || 50}">
                <button type="submit" class="btn btn-outline" style="padding: 0.45rem 0.85rem; font-size: 0.82rem; ${!state.botConfig || state.botConfig.pacingPreset === 'fast' ? 'border-color: #10b981; color: #34d399; background: #064e3b33;' : ''}">
                  ⚡ Fast Human (35s - 70s • 10 msgs in ~8m)
                </button>
              </form>

              <form method="POST" action="/api/settings/pacing" style="margin: 0;">
                <input type="hidden" name="preset" value="balanced">
                <input type="hidden" name="dailyMaxLeads" value="${state.dailyMaxPerDevice || 50}">
                <button type="submit" class="btn btn-outline" style="padding: 0.45rem 0.85rem; font-size: 0.82rem; ${state.botConfig && state.botConfig.pacingPreset === 'balanced' ? 'border-color: #818cf8; color: #a5b4fc; background: #312e8133;' : ''}">
                  ⚖️ Balanced (1m - 2m • 10 msgs in ~15m)
                </button>
              </form>

              <form method="POST" action="/api/settings/pacing" style="margin: 0;">
                <input type="hidden" name="preset" value="enterprise">
                <input type="hidden" name="dailyMaxLeads" value="${state.dailyMaxPerDevice || 50}">
                <button type="submit" class="btn btn-outline" style="padding: 0.45rem 0.85rem; font-size: 0.82rem; ${state.botConfig && state.botConfig.pacingPreset === 'enterprise' ? 'border-color: #64748b; color: #cbd5e1; background: #1e293b;' : ''}">
                  🛡️ Deep Enterprise (2m - 4m)
                </button>
              </form>
            </div>
          </div>

          <!-- Volume Cap Form -->
          <form method="POST" action="/api/settings/daily-limit" style="margin-top: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
              <label style="font-size: 0.85rem; color: #cbd5e1; font-weight: 600;">Custom 24-Hour Limit (per device):</label>
              <input type="number" name="dailyMaxLeads" min="5" max="500" value="${state.dailyMaxPerDevice || 50}" style="width: 100px; background: #0b0f19; border: 1px solid #10b981; border-radius: 8px; color: #fff; padding: 0.45rem 0.75rem; font-size: 0.95rem; font-weight: 700; text-align: center;" required />
              <button type="submit" class="btn btn-green" style="padding: 0.45rem 1.1rem; font-size: 0.85rem;">💾 Save Limit</button>
            </div>

            <div style="margin-top: 0.85rem; font-size: 0.8rem; color: #94a3b8; background: #0b0f19; padding: 0.75rem 0.9rem; border-radius: 8px; border: 1px solid #1f2937;">
              <div>
                📊 <strong>Total 24-Hour Capacity:</strong> 
                <span style="color: #34d399; font-weight: 700;">${(state.dailyMaxPerDevice || 50) * Math.max(1, state.connectedDevicesCount)} msgs/day</span> across active devices 
                (Up to <span style="color: #818cf8; font-weight: 700;">${(state.dailyMaxPerDevice || 50) * state.maxDevices} msgs/day</span> with all 6 devices linked).
              </div>
              <div style="margin-top: 0.4rem; color: #c4b5fd; font-size: 0.78rem;">
                🔒 <strong>Device Rule:</strong> Number <strong>+91-9416085989</strong> is strictly locked to <strong>10 messages/day</strong> and all sent chats are automatically archived &amp; muted (Secret Vault Code: <strong>3369</strong>). All other numbers send your custom volume (${state.dailyMaxPerDevice || 50}/day).
              </div>
            </div>
          </form>
        </div>

        <!-- Multi-Device Control Center (6 Slots) -->
        <div class="section-box" style="border-left: 4px solid #818cf8;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <h3 style="margin: 0; color: #818cf8;">📱 Multi-Device Control Center (${state.connectedDevicesCount} of ${state.maxDevices} Linked)</h3>
              <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.2rem;">Live countdown timers below. Intelligent delivery cadence &amp; natural conversational rhythm. Atomic claiming prevents duplicate contacts.</p>
            </div>
            <a href="/qr" class="btn btn-primary" style="font-size: 0.85rem;">+ Link / Manage Devices</a>
          </div>

          <div>
            ${state.devices.map(d => `
              <div class="device-row">
                <div>
                  <div class="device-title">
                    <span>Device ${d.id}</span>
                    <span class="badge-pill ${d.isConnected ? 'badge-online' : 'badge-offline'}">
                      ${d.isConnected ? `● +${d.phone}` : 'Not Linked'}
                    </span>
                    ${d.isSpecial10 ? '<span style="background: #4c1d95; color: #c4b5fd; font-size: 0.7rem; padding: 0.15rem 0.55rem; border-radius: 9999px; font-weight: 700; margin-left: 0.4rem;">🔒 Locked (10/day • Vault 3369)</span>' : ''}
                  </div>
                  <div class="device-meta" style="margin-top: 0.4rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <span>Status: <strong style="color: #e2e8f0;">${d.currentStatus}</strong></span>
                    ${d.nextActionTimestamp ? `
                      <span style="background: #064e3b; border: 1px solid #059669; padding: 0.15rem 0.65rem; border-radius: 6px; color: #a7f3d0; font-size: 0.82rem; font-weight: 700;">
                        ⏳ Next Msg: <span class="countdown-timer" data-target="${d.nextActionTimestamp}" title="at ${d.nextActionTime}" style="color: #34d399;">${d.nextActionTime}</span>
                      </span>
                    ` : (d.isConnected ? `
                      <span style="background: #064e3b; border: 1px solid #059669; padding: 0.15rem 0.65rem; border-radius: 6px; color: #a7f3d0; font-size: 0.82rem; font-weight: 700;">
                        ⏳ Next Msg: <span style="color: #34d399;">🟢 Ready to dispatch</span>
                      </span>
                    ` : '')}
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span style="font-weight: 700; color: ${d.dailySentCount >= d.dailyMaxLeads ? '#34d399' : '#818cf8'}; font-size: 0.9rem;">
                    ${d.dailySentCount} / ${d.dailyMaxLeads} today
                  </span>
                  <a href="/qr?device=${d.id}" class="btn btn-outline" style="padding: 0.35rem 0.75rem; font-size: 0.8rem;">
                    ${d.isConnected ? 'Manage' : '📱 Scan QR'}
                  </a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Master Pause / Stop Bot Controls -->
        ${state.isPaused ? `
          <div style="background: #450a0a; border: 1px solid #b91c1c; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h3 style="color: #f87171; margin-bottom: 0.25rem;">🛑 Bot is STOPPED / PAUSED</h3>
              <p style="color: #fca5a5; font-size: 0.85rem; margin: 0;">Outreach is paused on all devices. All leads and queue positions are completely safe.</p>
            </div>
            <form method="POST" action="/api/queue/resume" style="margin: 0;">
              <button type="submit" class="btn" style="background: #16a34a; color: #fff; padding: 0.75rem 1.5rem; font-size: 0.95rem; font-weight: 700; cursor: pointer;">▶️ Resume All Devices</button>
            </form>
          </div>
        ` : `
          <div style="background: #022c22; border: 1px solid #059669; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h3 style="color: #34d399; margin-bottom: 0.25rem;">⚡ Multi-Device Engine ACTIVE (50 Leads / Day Per Device)</h3>
              <p style="color: #6ee7b7; font-size: 0.85rem; margin: 0;">3 Devices Connected = 150 customer conversations/24h • Natural human delivery pacing • Windows 11 Chrome TLS emulation.</p>
            </div>
            <form method="POST" action="/api/queue/pause" style="margin: 0;">
              <button type="submit" class="btn" style="background: #dc2626; color: #fff; padding: 0.75rem 1.5rem; font-size: 0.95rem; font-weight: 700; cursor: pointer;">🛑 Pause All Devices</button>
            </form>
          </div>
        `}

        <!-- Hot Leads Section with 1-Click CSV Export -->
        <div class="section-box" style="border-left: 4px solid #f43f5e; background: #88133712;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <h3 style="margin: 0; color: #fb7185;">🔥 Hot Replied Business Leads (${hotLeads.length})</h3>
              <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.2rem;">Founders &amp; business owners who replied to Step 1. Ready to close website / AI bot deals directly in WhatsApp.</p>
            </div>
            <a href="/api/leads/export-csv" class="btn" style="background: #e11d48; color: #fff; font-weight: 700; text-decoration: none;">📥 Download Leads (.CSV)</a>
          </div>
          ${hotLeads.length === 0 ? '<p style="color: #64748b; font-size: 0.85rem;">No replies yet today. As soon as leads respond, they appear here instantly.</p>' : `
            <div style="max-height: 220px; overflow-y: auto; background: #0b0f19; border-radius: 8px; padding: 0.5rem;">
              ${hotLeads.slice(-10).reverse().map(l => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border-bottom: 1px solid #1f2937;">
                  <div>
                    <strong style="color: #f1f5f9;">+${l.phone}</strong>
                    <span style="color: #94a3b8; font-size: 0.8rem; margin-left: 0.5rem;">${l.name || l.niche || 'Business Owner'} (${l.country || 'USA'})</span>
                  </div>
                  <a href="https://wa.me/${l.phone}" target="_blank" class="btn btn-green" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; text-decoration: none;">💬 Open Chat</a>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div class="section-box">
          <h3>📥 Add Global Business Numbers to Queue</h3>
          <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 0.75rem;">Supports USA (+1), UK (+44), Canada (+1), Australia (+61), and India (+91) formats.</p>
          <form method="POST" action="/api/leads/add-form">
            <textarea name="numbers" placeholder="Paste numbers here (one per line, e.g. 2147895884, +1 469 554 5603, +44 7700 900077, 9876543210)..."></textarea>
            <div class="btn-group">
              <button type="submit" class="btn btn-primary">+ Add to Lead Queue</button>
              <a href="/qr" class="btn btn-outline">📱 Scan / Manage Devices</a>
            </div>
          </form>
        </div>

        <div class="section-box" style="border-left: 4px solid #a855f7;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <h3 style="margin: 0; color: #c084fc;">🛡️ Shield Past Numbers (Older Campaigns / Blacklist)</h3>
            <span style="background: #581c87; color: #e9d5ff; font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 9999px; font-weight: 700;">DUPLICATE SHIELD</span>
          </div>
          <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 0.75rem;">
            WhatsApp history automatically shields all past conversations from your phone. You can also trigger an instant resync or paste custom numbers below:
          </p>
          <form method="POST" action="/api/whatsapp/sync-now" style="margin-bottom: 0.75rem;">
            <button type="submit" class="btn" style="background: #2563eb; color: #fff; font-weight: 700; cursor: pointer; width: 100%;">🔄 Re-Sync All Past Chats From Connected Phone</button>
          </form>
          <form method="POST" action="/api/leads/shield-past">
            <textarea name="pastNumbers" placeholder="Paste numbers here (one per line)..."></textarea>
            <button type="submit" class="btn" style="background: #7c3aed; color: #fff; font-weight: 700; cursor: pointer;">🛡️ Permanently Shield These Numbers</button>
          </form>
        </div>

        <div class="section-box" style="border-color: #059669; background: #064e3b15;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <h3 style="margin: 0; color: #34d399;">🌐 Multi-Territory B2B Harvester (Yandex + Craigslist)</h3>
            <span style="background: ${scraperStats.isPaused ? '#7f1d1d' : '#065f46'}; color: ${scraperStats.isPaused ? '#fca5a5' : '#a7f3d0'}; font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 9999px; font-weight: 700;">${scraperStats.isPaused ? 'PAUSED' : 'ACTIVE 24/7'}</span>
          </div>
          <p class="log-box" style="margin-bottom: 0.75rem;">
            Status: <strong>${scraperStats.status}</strong><br>
            Sweeps Completed: <strong>${scraperStats.cyclesCompleted}</strong> | Session Harvested: <strong>${scraperStats.leadsHarvestedSession}</strong> | Total in DB: <strong>${scraperStats.totalInDb}</strong><br>
            Active Target: <strong>${(scraperStats.lastScrapedCity || 'Dallas').toUpperCase()}</strong> (${scraperStats.lastScrapedNiche || 'roofing'})
          </p>
          <div class="btn-group">
            <form method="POST" action="/api/scraper/trigger-free-form" style="margin: 0;">
              <button type="submit" class="btn btn-green">⚡ Run Fast B2B Sweep (25+ Leads)</button>
            </form>
            <form method="POST" action="${scraperStats.isPaused ? '/api/scraper/resume' : '/api/scraper/pause'}" style="margin: 0;">
              <button type="submit" class="btn btn-outline">${scraperStats.isPaused ? '▶️ Resume Auto-Scraper' : '⏸️ Pause Auto-Scraper'}</button>
            </form>
          </div>
        </div>
      </div>
      <script>
        function updateCountdowns() {
          var now = Date.now();
          document.querySelectorAll('.countdown-timer').forEach(function(el) {
            var target = parseInt(el.getAttribute('data-target') || '0', 10);
            if (!target) return;
            var diff = Math.max(0, Math.floor((target - now) / 1000));
            if (diff > 0) {
              var mins = Math.floor(diff / 60);
              var secs = diff % 60;
              var title = el.getAttribute('title') || '';
              var minsStr = (mins < 10 ? '0' : '') + mins;
              var secsStr = (secs < 10 ? '0' : '') + secs;
              el.innerText = 'in ' + minsStr + ':' + secsStr + ' (' + title + ')';
            } else {
              el.innerText = 'Dispatching now / Ready';
            }
          });
        }
        setInterval(updateCountdowns, 1000);
        updateCountdowns();
        setTimeout(function() {
          window.location.reload();
        }, 20000);
      </script>
    </body>
    </html>
  `);
});

/**
 * API Endpoints
 */
app.get('/api/status', (req, res) => {
  res.json({
    devices: whatsapp.getAllDevices(),
    queue: queue.getQueueState()
  });
});

app.get('/api/conversations', (req, res) => {
  res.json({
    conversations: chatMemory.getAllConversations()
  });
});

app.get('/api/leads/export-csv', (req, res) => {
  const hotLeads = scraper.getHotRepliedLeads ? scraper.getHotRepliedLeads() : [];
  let csv = 'Phone,Name,Niche,Country,Status,Direct_WhatsApp_Link\r\n';
  for (const l of hotLeads) {
    const phone = l.phone || '';
    const name = (l.name || 'Business Owner').replace(/"/g, '""');
    const niche = (l.niche || l.trade || 'Local Service').replace(/"/g, '""');
    const country = l.country || 'USA';
    const status = l.status || 'replied';
    const waLink = `https://wa.me/${phone}`;
    csv += `+${phone},"${name}","${niche}","${country}",${status},"${waLink}"\r\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="webify_qualified_leads.csv"');
  res.send(csv);
});

app.get('/api/devices/:id/qr-status', (req, res) => {
  const id = parseInt(req.params.id || '1', 10);
  const clampedId = Math.min(whatsapp.MAX_DEVICES, Math.max(1, isNaN(id) ? 1 : id));
  let dev = whatsapp.getDevice(clampedId);

  if (!dev || (!dev.sock && !dev.isConnected)) {
    whatsapp.initDevice(clampedId);
    dev = whatsapp.getDevice(clampedId);
  }

  res.json({
    id: clampedId,
    isConnected: dev ? dev.isConnected : false,
    phone: dev ? dev.phone : null,
    hasQr: dev ? !!dev.qrDataUrl : false,
    qrDataUrl: dev ? dev.qrDataUrl : null
  });
});

app.post('/api/settings/daily-limit', (req, res) => {
  const limit = parseInt(req.body.dailyMaxLeads || req.body.limit || '50', 10);
  const preset = req.body.preset || 'custom';
  queue.setDailyMaxLeadsPerDevice(limit, preset);

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ success: true, dailyMaxLeads: limit, config: queue.getBotConfig ? queue.getBotConfig() : {} });
  }
  res.redirect(`/?settings_saved=true&limit=${limit}`);
});

app.post('/api/settings/pacing', (req, res) => {
  const preset = req.body.preset;
  const dailyMaxLeads = parseInt(req.body.dailyMaxLeads || '50', 10);
  if (preset) {
    queue.setDailyMaxLeadsPerDevice(dailyMaxLeads, preset);
  } else {
    const updates = {};
    if (req.body.minMsgDelayMs) updates.minMsgDelayMs = parseInt(req.body.minMsgDelayMs, 10);
    if (req.body.maxMsgDelayMs) updates.maxMsgDelayMs = parseInt(req.body.maxMsgDelayMs, 10);
    if (req.body.businessHoursShield !== undefined) updates.businessHoursShield = (req.body.businessHoursShield === 'true');
    queue.updatePacingConfig(updates);
  }

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ success: true, config: queue.getBotConfig ? queue.getBotConfig() : {} });
  }
  res.redirect(`/?settings_saved=true&pacing=${preset || 'custom'}`);
});

app.post('/api/settings/toggle-timezone-shield', (req, res) => {
  const cfg = queue.getBotConfig ? queue.getBotConfig() : {};
  const current = !!cfg.businessHoursShield;
  queue.updatePacingConfig({ businessHoursShield: !current });

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ success: true, businessHoursShield: !current });
  }
  res.redirect(`/?settings_saved=true&tz_shield=${!current}`);
});

app.get('/api/settings', (req, res) => {
  res.json({
    config: queue.getBotConfig ? queue.getBotConfig() : {},
    state: queue.getQueueState()
  });
});

app.post('/api/devices/:id/reset', async (req, res) => {
  const deviceId = parseInt(req.params.id, 10);
  try {
    await whatsapp.resetDevice(deviceId);
  } catch (err) {
    console.error(`Reset error for device ${deviceId}:`, err.message);
  }
  res.redirect(`/qr?device=${deviceId}&reset=true`);
});

app.post('/api/devices/:id/logout', async (req, res) => {
  const deviceId = parseInt(req.params.id, 10);
  try {
    await whatsapp.logoutDevice(deviceId);
  } catch (err) {
    console.error(`Logout error for device ${deviceId}:`, err.message);
  }
  res.redirect(`/qr?device=${deviceId}&logged_out=true`);
});

app.post('/api/leads/add-form', (req, res) => {
  const numbersText = req.body.numbers || '';
  const lines = numbersText.split('\n');
  const leads = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      leads.push({ phone: trimmed, source: 'manual_dashboard' });
    }
  }

  const result = scraper.addLeadsToQueue(leads);
  res.redirect(`/?added=${result.added}`);
});

app.post('/api/leads/shield-past', (req, res) => {
  const numbersText = req.body.pastNumbers || '';
  const lines = numbersText.split('\n');
  const numbersToShield = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      numbersToShield.push(trimmed);
    }
  }

  const result = scraper.recordBulkSentPhones(numbersToShield);
  try {
    const shieldSet = new Set(numbersToShield.map(n => String(n).replace(/\D/g, '')));
    scraper.syncExistingChatsToDatabase(shieldSet);
  } catch (e) {}
  res.redirect(`/?shielded=true&count=${result.added}`);
});

app.post('/api/whatsapp/sync-now', (req, res) => {
  const syncedSet = typeof whatsapp.getExistingChatsSet === 'function' ? whatsapp.getExistingChatsSet() : new Set();
  let updated = 0;
  if (syncedSet && syncedSet.size > 0) {
    updated = scraper.syncExistingChatsToDatabase(syncedSet);
  }
  res.redirect(`/?synced=true&updated=${updated}&totalShielded=${syncedSet.size}`);
});

app.post('/api/queue/pause', (req, res) => {
  queue.pauseQueue();
  res.redirect('/?paused=true');
});

app.post('/api/queue/resume', (req, res) => {
  queue.resumeQueue();
  res.redirect('/?resumed=true');
});

app.post('/api/scraper/pause', (req, res) => {
  scraper.pauseScraper();
  res.redirect('/?scraper_paused=true');
});

app.post('/api/scraper/resume', (req, res) => {
  scraper.resumeScraper();
  res.redirect('/?scraper_resumed=true');
});

app.post('/api/scraper/trigger-free-form', async (req, res) => {
  try {
    await scraper.triggerFreeWebScraper({ targetCount: 25 });
  } catch (err) {
    console.error('Free Scraper Error:', err);
  }
  res.redirect('/?scraper=free_triggered');
});

app.post('/api/scraper/trigger-form', async (req, res) => {
  try {
    await scraper.triggerApifyLeadDiscovery();
  } catch (err) {
    console.error('Apify Scraper Error:', err);
  }
  res.redirect('/?scraper=apify_triggered');
});

function initKeepAlive() {
  if (detectedBaseUrl) {
    startKeepAliveEngine(detectedBaseUrl);
  } else {
    console.log('💡 [Keep-Alive] Waiting for first inbound request or RENDER_EXTERNAL_URL to lock target URL...');
  }
}

/**
 * Start Server, Scraper, WhatsApp Multi-Devices & Queue Workers
 */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=========================================================`);
  console.log(`🚀 Webify Multi-Device AI Bot running on Port ${PORT}`);
  console.log(`📲 Open http://localhost:${PORT}/qr to link WhatsApp devices (Up to ${whatsapp.MAX_DEVICES})`);
  console.log(`=========================================================\n`);

  // 0. Purge any historical Indian (+91) leads from queue
  scraper.purgeIndianLeads();

  // 1. Start autonomous 24/7 multi-territory scraper
  scraper.start247ContinuousScraper().catch(e => console.error("24/7 Scraper Boot Error:", e.message));

  // 2. Start Anti-Sleep Keep-Alive Heartbeat
  initKeepAlive();

  // 3. Initialize all device slots
  whatsapp.initAllDevices();

  // 4. Start concurrent queue workers across all devices
  queue.startQueueWorker();
});
