const path = require('path');
const fs = require('fs');

const DB_CONFIG = {
  database: {
    path: path.join(__dirname, '../data/database.json'),
    default: []
  },
  keyList: {
    path: path.join(__dirname, '../data/keyList.json'),
    default: []
  },
  vps: {
    path: path.join(__dirname, '../data/vps.json'),
    default: []
  },
  logUser: {
    path: path.join(__dirname, '../logs/logUser.txt'),
    default: ''
  }
};

// Ensure directories exist
const DATA_DIR = path.dirname(DB_CONFIG.database.path);
const LOGS_DIR = path.dirname(DB_CONFIG.logUser.path);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Initialize files if they don't exist
Object.values(DB_CONFIG).forEach(config => {
  if (!fs.existsSync(config.path)) {
    if (config.path.endsWith('.json')) {
      fs.writeFileSync(config.path, JSON.stringify(config.default, null, 2));
    } else {
      fs.writeFileSync(config.path, config.default);
    }
  }
});

module.exports = DB_CONFIG;
