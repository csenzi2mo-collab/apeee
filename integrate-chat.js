// integrate-chat.js — FINAL
// Bridge antara chat module + existing backend lu.
// Path import disesuaikan sama struktur lu:
//   ./services/databaseService.js  → loadKeyList
//   ./middleware/authMiddleware.js → activeKeys
// Kalo beda, edit 2 require di bawah.

const createChatRouter = require('./routers/chatRouter');
const { ChatSocketManager } = require('./models/chatWebSocket');

// ============================================================
// IMPORT auth existing lu
// ============================================================
let loadKeyList, activeKeys;
try {
  ({ loadKeyList } = require('./services/databaseService'));
  activeKeys = require('./middleware/authMiddleware').activeKeys;
  if (!loadKeyList || !activeKeys) {
    throw new Error('loadKeyList / activeKeys tidak ditemukan');
  }
} catch (e) {
  console.error('[integrate-chat] ❌ Gagal import auth module:', e.message);
  console.error('                 Cek path require di integrate-chat.js');
  throw e;
}

// ============================================================
// getUserFromKey — pake pattern sama kayak authMiddleware lu
// ============================================================
function getUserFromKey(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return null;

  // 1. Cek in-memory cache dulu
  const cached = activeKeys[sessionKey];
  if (cached) {
    if (Date.now() > cached.expires) {
      delete activeKeys[sessionKey];
      // fallthrough ke file lookup
    } else {
      return { username: cached.username };
    }
  }

  // 2. Fallback ke key list file
  try {
    const keyList = loadKeyList();
    if (!Array.isArray(keyList)) return null;

    const keyInfo = keyList.find((k) => k && k.sessionKey === sessionKey);
    if (!keyInfo || !keyInfo.username) return null;

    // Populate cache (TTL 10 menit, sama kayak authMiddleware)
    activeKeys[sessionKey] = {
      username: keyInfo.username,
      created: Date.now(),
      expires: Date.now() + 10 * 60 * 1000,
    };

    return { username: keyInfo.username };
  } catch (e) {
    console.error('[getUserFromKey] error:', e.message);
    return null;
  }
}

// ============================================================
// MOUNT FUNCTION
// Usage di index.js:
//   const { mountChat } = require('./integrate-chat');
//   mountChat(app, wss);
// ============================================================
function mountChat(app, wss) {
  if (!app || typeof app.use !== 'function') {
    throw new Error('[integrate-chat] app (express instance) required');
  }
  if (!wss || typeof wss.on !== 'function') {
    throw new Error('[integrate-chat] wss (WebSocket.Server instance) required');
  }

  const chatSockets = new ChatSocketManager(getUserFromKey);

  // Tambah listener — co-exist sama existing connection handler
  wss.on('connection', chatSockets.handleConnection);

  // Heartbeat
  const hbInterval = setInterval(chatSockets.heartbeat, 30000);
  if (hbInterval.unref) hbInterval.unref();

  // Mount REST
  app.use(
    '/api/chat',
    createChatRouter({
      getUserFromKey,
      broadcast: chatSockets.broadcast,
    })
  );

  // Expose ke app.locals kalo modul lain butuh
  app.locals.chatSockets = chatSockets;

  console.log('[chat] ✅ module mounted → /api/chat  + WS events: auth/typing/ping');
  return chatSockets;
}

module.exports = mountChat;
module.exports.mountChat = mountChat;
module.exports.getUserFromKey = getUserFromKey;