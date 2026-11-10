const { app, server } = require('./src/app');
const { PORT } = require('./src/utils/constants');
const { startUserSessions } = require('./src/services/whatsappService');
const { startTelegramBot } = require('./src/services/telegramService');
const { bot } = require('./src/services/telegramService');
const fs = require('fs');
const path = require('path');

const ID_GROUP = [-1004421284216];
const OWNER_ID = 7775351050;
const BACKUP_IDS = [7775351050];
const RESTART_INTERVAL_MS = 30 * 60 * 1000; // 30 menit

process.on('uncaughtException', (err) => {
  if (err?.message?.includes('Bad MAC')) {
    console.warn('[WARN] Bad MAC error caught globally — corrupted Signal session keys. Server continues running.');
    return;
  }
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  if (reason?.message?.includes('Bad MAC')) {
    console.warn('[WARN] Bad MAC unhandled rejection — corrupted Signal session keys. Server continues running.');
    return;
  }
  console.error('[WARN] Unhandled rejection:', reason);
});

function sendStartupNotif() {
  const now = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const msg =
    `⬡ *SYSTEM ONLINE*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `◆ Status       \`OPERATIONAL\`\n` +
    `◆ Engine       \`DEPLOYED\`\n` +
    `◆ Security     \`ACTIVE\`\n` +
    `◆ Sessions     \`LOADING...\`\n` +
    `◆ Timestamp    \`${now} WIB\`\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `_All systems nominal. Ready to operate._`;

  for (const groupId of ID_GROUP) {
    bot.sendMessage(groupId, msg, { parse_mode: 'Markdown' }).catch(err => {
      console.error(`[STARTUP] Gagal kirim notif ke ${groupId}:`, err.message);
    });
  }
}

// ============================================================
// AUTO BACKUP — Setiap jam 12 malam WIB (tahan restart)
// ============================================================
function getDailyStats(db) {
  const today = new Date().toISOString().split('T')[0];
  const roles = {};
  let newToday = 0;

  for (const user of db) {
    const role = (user.role || 'member').toLowerCase();
    roles[role] = (roles[role] || 0) + 1;
    if (user.createdAt && user.createdAt.startsWith(today)) {
      newToday++;
    }
  }

  return { roles, newToday, total: db.length };
}

const BACKUP_STAMP_FILE = path.join(__dirname, 'src/data/.last_backup');

function getLastBackupDate() {
  try {
    if (fs.existsSync(BACKUP_STAMP_FILE)) {
      return fs.readFileSync(BACKUP_STAMP_FILE, 'utf8').trim();
    }
  } catch (_) {}
  return null;
}

function setLastBackupDate(dateStr) {
  try { fs.writeFileSync(BACKUP_STAMP_FILE, dateStr); } catch (_) {}
}

async function sendDailyBackup() {
  try {
    const dbPath = path.join(__dirname, 'data/database.json');
    if (!fs.existsSync(dbPath)) {
      for (const id of BACKUP_IDS) {
        bot.sendMessage(id, '⚠️ Backup gagal: database.json tidak ditemukan.').catch(() => {});
      }
      return;
    }

    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const stats = getDailyStats(db);

    const now = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    const roleLines = Object.entries(stats.roles)
      .sort((a, b) => b[1] - a[1])
      .map(([role, count]) => `  • ${role.toUpperCase()}: ${count} akun`)
      .join('\n');

    const caption =
      `🗄️ <b>AUTO BACKUP DATABASE</b>\n` +
      `📅 ${now} WIB\n\n` +
      `📊 <b>Total Akun:</b> ${stats.total}\n` +
      `${roleLines}\n\n` +
      `<i>File: database.json</i>`;

    for (const id of BACKUP_IDS) {
      await bot.sendDocument(id, Buffer.from(JSON.stringify(db, null, 2)), {
        caption,
        parse_mode: 'HTML',
      }, {
        filename: `database_backup_${new Date().toISOString().split('T')[0]}.json`,
        contentType: 'application/json',
      });
    }

    const groupMsg =
      `📊 <b>LAPORAN HARIAN — ${now} WIB</b>\n\n` +
      `👥 <b>Total Akun Terdaftar:</b> ${stats.total}\n\n` +
      `📋 <b>Breakdown per Role:</b>\n${roleLines}\n\n` +
      `🆕 <b>Akun Baru Hari Ini:</b> ${stats.newToday}\n\n` +
      `✅ <i>Backup database berhasil dikirim ke owner.</i>`;

    for (const groupId of ID_GROUP) {
      bot.sendMessage(groupId, groupMsg, { parse_mode: 'HTML' }).catch(() => {});
    }

    const todayStr = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
    setLastBackupDate(todayStr);
    console.log('[BACKUP] ✅ Daily backup berhasil dikirim');
  } catch (err) {
    console.error('[BACKUP] ❌ Gagal kirim backup:', err.message);
    for (const id of BACKUP_IDS) {
      bot.sendMessage(id, `❌ Backup gagal: ${err.message}`).catch(() => {});
    }
  }
}

function scheduleMidnightBackup() {
  const wibOffset = 7 * 60 * 60 * 1000;
  const nowWib = new Date(Date.now() + wibOffset);
  const todayStr = nowWib.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const lastBackup = getLastBackupDate();
  const wibHour = nowWib.getUTCHours();

  if (lastBackup !== todayStr && wibHour >= 0 && wibHour < 1) {
    console.log('[BACKUP] Backup hari ini belum jalan, jalankan sekarang...');
    setTimeout(sendDailyBackup, 5000);
  }

  const midnight = new Date(nowWib);
  midnight.setUTCHours(17, 0, 0, 0);
  if (midnight <= nowWib) midnight.setUTCDate(midnight.getUTCDate() + 1);
  const msUntilMidnight = midnight.getTime() - nowWib.getTime();

  console.log(`[BACKUP] Backup berikutnya dalam ${Math.round(msUntilMidnight / 60000)} menit`);
  setTimeout(() => {
    sendDailyBackup();
    setInterval(sendDailyBackup, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

// ── Startup sync: push semua user dari database.json ke ratapi ───────────
async function syncAllUsersToRatapi() {
  try {
    const { loadDatabase } = require('./src/services/databaseService');
    const { forwardUserCreate, syncDatabaseToRat } = require('./src/utils/ratForwarder');
    const { RAT_SERVER_URL } = require('./src/utils/constants');
    const axios = require('axios');
    const db = loadDatabase();
    
    // Health check sebelum sync
    console.log(`[RAT-SYNC] 🔍 Checking ratapi health at ${RAT_SERVER_URL}...`);
    try {
      const health = await axios.get(`${RAT_SERVER_URL}/health`, { timeout: 5000 });
      console.log(`[RAT-SYNC] ✅ ratapi is online: ${JSON.stringify(health.data)}`);
    } catch (healthErr) {
      const errMsg = healthErr.response?.status ? `HTTP ${healthErr.response.status}` : healthErr.code || healthErr.message;
      console.warn(`[RAT-SYNC] ⚠️ ratapi health check failed: ${errMsg} (URL: ${RAT_SERVER_URL})`);
      console.warn(`[RAT-SYNC] ⚠️ Make sure ratapi is running and RAT_SERVER_URL is correct!`);
    }
    
    // Method 1: Kirim file database.json langsung ke ratapi (bulk sync)
    const dbFilePath = path.join(__dirname, 'data/database.json');
    if (fs.existsSync(dbFilePath)) {
      const success = await syncDatabaseToRat(db);
      if (success) {
        console.log(`[RAT-SYNC] ✅ Database.json synced (${db.length} users)`);
        return;
      }
    }
    
    // Fallback: Sync one-by-one jika bulk sync gagal
    console.log(`[RAT-SYNC] Fallback: syncing users one-by-one...`);
    let synced = 0;
    for (const user of db) {
      if (user.ratId) {
        await forwardUserCreate(user.username, user.ratId);
        synced++;
      }
    }
    console.log(`[RAT-SYNC] ✅ Synced ${synced}/${db.length} users to ratapi`);
  } catch (e) {
    console.error(`[RAT-SYNC] ❌ Error: ${e.message}`);
  }
}

server.listen(PORT, () => {
  console.log(`🚀 Server aktif di http://omdhanbikinaangekan.pteroq.xyz:11674${PORT}`);
  startUserSessions();
  startTelegramBot();
  setTimeout(syncAllUsersToRatapi, 2000);

  // Kirim notifikasi startup sekali — delay 3 detik biar bot polling siap
  setTimeout(sendStartupNotif, 3000);

  // Jadwalkan backup otomatis jam 12 malam WIB
  scheduleMidnightBackup();

  // Auto-restart setiap 30 menit — kirim notif dulu sebelum exit
  setInterval(() => {
    const now = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const msg =
      `⬡ *SCHEDULED RESTART*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `◆ Reason       \`Stability maintenance\`\n` +
      `◆ Duration     \`~5 seconds\`\n` +
      `◆ Timestamp    \`${now} WIB\`\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `_System will be back online shortly._`;

    for (const groupId of ID_GROUP) {
      bot.sendMessage(groupId, msg, { parse_mode: 'Markdown' }).catch(() => {});
    }

    setTimeout(() => process.exit(1), 5000);
  }, RESTART_INTERVAL_MS);
});
