# Webify AI Lead & Website Outreach Bot 🚀

Autonomous B2B WhatsApp lead discovery, outreach, and conversion engine powered by **Webify**, **Groq (openai/gpt-oss-120b)**, **Apify Scrapers**, and **Baileys Multi-Device Socket**.

---

## ⚡ Core Capabilities
1. **Double High-Ticket Offer**:
   - **Modern Websites & Landing Pages**: Custom, lightning-fast, high-converting web designs for businesses that don't have a website or need an upgrade.
   - **Autonomous AI Lead Generation Bots**: Cloud-hosted systems that bring in **180+ qualified leads/day** directly into their business.
2. **In-Chat Assistance (Strictly Zero Phone Calls)**:
   - Everything is handled right inside WhatsApp chat—pricing, live interactive previews, and lead breakdown.
3. **Global Target Focus 🇺🇸 🇬🇧 🇨🇦 🇦🇺**:
   - Supports international business phone formats (USA `+1`, UK `+44`, Canada `+1`, Australia `+61`).
   - Scrapes businesses and founders across local directories and social channels.
4. **Enterprise Human Delivery Cadence**:
   - **Intelligent Pacing**: Dynamic 3-6 minute intervals matching real human conversational rhythm.
   - **Scheduled Rests**: Natural intervals between message batches.
   - **Daily Output**: Up to **50 qualified conversations per device / 24h**.
   - **Two-Step Conversational Engagement**: Genuine local service inquiries that spark authentic customer replies.

---

## 🚀 How to Run Locally in Termux

```bash
cd /data/data/com.termux/files/home/whatsapp-lead-bot
npm install
npm start
```

- Dashboard: `http://localhost:3001`
- Live QR Scanner: `http://localhost:3001/qr`

---

## ☁️ How to Deploy on Render.com (1-Click Cloud)

1. Use your GitHub repo: `https://github.com/homlon8-beep/friends-cafe-bo`
2. In Render:
   - **Build Command**: `unzip -o whatsapp-lead-bot.zip && npm install`
   - **Start Command**: `node server.js`
   - **Environment Variables**:
     - `GROQ_API_KEY`: `your_groq_api_key_here`
     - `APIFY_API_TOKEN`: `your_apify_api_token_here`
     - `AGENCY_NAME`: `Webify`
     - `BATCH_SIZE`: `10`
     - `DELAY_BETWEEN_MSGS_MS`: `120000`
     - `BATCH_BREAK_MS`: `1200000` (20 mins break)
3. Once live, open:
   `https://<your-render-app>.onrender.com/qr`
   Scan with WhatsApp, and your Webify agency bot runs 24/7 on autopilot!
