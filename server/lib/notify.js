// Notiser: ntfy / Discord / Telegram. Skickar till alla konfigurerade kanaler.
import { loadSettings } from './config.js';

let lastSent = {}; // dedupe: key -> timestamp

export function isConfigured() {
  const n = loadSettings().notify || {};
  return !!(n.ntfyTopic || n.discordWebhook || (n.telegramBotToken && n.telegramChatId));
}

export async function send(title, message, { key = null, minIntervalMin = 60 } = {}) {
  const n = loadSettings().notify || {};
  if (key) {
    const last = lastSent[key] || 0;
    if (Date.now() - last < minIntervalMin * 60e3) return { skipped: true };
    lastSent[key] = Date.now();
  }

  const results = [];
  if (n.ntfyTopic) {
    results.push(
      fetch(`https://ntfy.sh/${encodeURIComponent(n.ntfyTopic)}`, {
        method: 'POST',
        headers: { Title: Buffer.from(title, 'utf8').toString('latin1') },
        body: message,
      }).then((r) => ({ ntfy: r.ok })).catch((e) => ({ ntfy: false, error: e.message }))
    );
  }
  if (n.discordWebhook) {
    results.push(
      fetch(n.discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `**${title}**\n${message}` }),
      }).then((r) => ({ discord: r.ok })).catch((e) => ({ discord: false, error: e.message }))
    );
  }
  if (n.telegramBotToken && n.telegramChatId) {
    results.push(
      fetch(`https://api.telegram.org/bot${n.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: n.telegramChatId, text: `${title}\n${message}` }),
      }).then((r) => ({ telegram: r.ok })).catch((e) => ({ telegram: false, error: e.message }))
    );
  }
  if (!results.length) return { skipped: true, reason: 'inga kanaler konfigurerade' };
  return { sent: await Promise.all(results) };
}
