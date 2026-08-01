/* ============================================================
   SmileRT Reminder Bot — Configuration
   ============================================================ */

require('dotenv').config();

const config = {
  // Discord
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,

  // Channel IDs
  channels: {
    admin: process.env.CHANNEL_ADMIN,
    register: process.env.CHANNEL_REGISTER,
    remind: process.env.CHANNEL_REMIND,
  },

  // Firebase
  firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL,
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json',

  // Reminder settings
  remindHours: (process.env.REMIND_HOURS || '168,72,24,3')
    .split(',')
    .map(h => parseFloat(h.trim()))
    .filter(h => !isNaN(h) && h > 0)
    .sort((a, b) => b - a), // descending: [168, 72, 24, 3]
};

// Validation
const required = ['token', 'clientId', 'guildId'];
for (const key of required) {
  if (!config[key]) {
    console.error(`❌ .env に ${key.toUpperCase()} が設定されていません`);
    process.exit(1);
  }
}

module.exports = config;
