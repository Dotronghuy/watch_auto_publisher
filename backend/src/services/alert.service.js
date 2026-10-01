import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const alertsEnabled = process.env.TELEGRAM_ALERTS_ENABLED !== 'false';

const ALERT_ICONS = {
    captcha: '🤖🚧',
    login: '🔑',
    'ui-change': '🖥️⚠️',
    'publish-error': '❌',
    'content-invalid': '📝🚫',
    system: '⚙️',
};

// Chống spam: mỗi (type + title) chỉ gửi 1 lần trong dedupeMinutes phút
const recentAlerts = new Map();

const sendTelegramRaw = async (text, photoPath) => {
    if (!token || !chatId) return false;
    try {
        if (photoPath && fs.existsSync(photoPath)) {
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('caption', text);
            form.append('photo', new Blob([fs.readFileSync(photoPath)]), 'screenshot.png');
            const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                method: 'POST',
                body: form,
            });
            return res.ok;
        }
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
        return res.ok;
    } catch (error) {
        console.error('Lỗi gửi cảnh báo Telegram:', error.message);
        return false;
    }
};

export const sendAlert = async ({ type = 'system', title, details = '', photoPath = null, dedupeMinutes = 15 }) => {
    if (!alertsEnabled || !token || !chatId) return false;
    const key = `${type}:${(title || '').slice(0, 100)}`;
    const now = Date.now();
    if (recentAlerts.has(key) && now - recentAlerts.get(key) < dedupeMinutes * 60_000) {
        return false;
    }
    recentAlerts.set(key, now);
    const icon = ALERT_ICONS[type] || '⚠️';
    const time = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const text = `${icon} <b>${title}</b>\n${details}\n<i>${time}</i>`.slice(0, 4000);
    console.log(`🔔 [Alert] ${type}: ${title}`);
    return await sendTelegramRaw(text, photoPath);
};
