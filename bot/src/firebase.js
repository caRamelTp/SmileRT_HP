/* ============================================================
   SmileRT Reminder Bot — Firebase Connection
   ============================================================
   Reads event/performer data from existing smilert node (read-only).
   Writes bot-specific data to bot_mappings / bot_reminders nodes.
   ============================================================ */

const admin = require('firebase-admin');
const path = require('path');
const config = require('./config');

// Initialize Firebase Admin SDK
const serviceAccount = require(path.resolve(config.firebaseServiceAccountPath));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: config.firebaseDatabaseUrl,
});

const db = admin.database();

// ─── Read: Existing SmileRT Data (read-only) ───

/**
 * Get all events from smilert/events
 */
async function getEvents() {
  const snapshot = await db.ref('smilert/events').once('value');
  const val = snapshot.val();
  if (!val) return [];
  // Firebase may store arrays as objects with numeric keys
  const events = Array.isArray(val) ? val : Object.values(val);
  return events.filter(Boolean).map(normalizeEvent);
}

/**
 * Get a specific event by ID
 */
async function getEvent(eventId) {
  const events = await getEvents();
  return events.find(e => e.id === eventId) || null;
}

/**
 * Find event by title (partial match, case-insensitive)
 */
async function findEventByTitle(title) {
  const events = await getEvents();
  const lower = title.toLowerCase();
  // Exact match first
  const exact = events.find(e => e.title && e.title.toLowerCase() === lower);
  if (exact) return exact;
  // Partial match
  return events.find(e => e.title && e.title.toLowerCase().includes(lower)) || null;
}

/**
 * Normalize event data (Firebase drops empty arrays)
 */
function normalizeEvent(e) {
  if (!e) return e;
  if (!Array.isArray(e.performers)) {
    e.performers = e.performers ? Object.values(e.performers) : [];
  }
  if (!Array.isArray(e.setlistOverrides)) {
    e.setlistOverrides = e.setlistOverrides ? Object.values(e.setlistOverrides) : [];
  }
  e.performers = e.performers.filter(Boolean);
  e.performers.forEach(p => {
    if (!Array.isArray(p.songs)) {
      p.songs = p.songs ? Object.values(p.songs) : [];
    }
    p.songs = p.songs.filter(Boolean);
  });
  return e;
}

// ─── Bot Mappings: Performer ↔ Discord User ───

/**
 * Get mapping for a specific performer in an event
 */
async function getMapping(eventId, performerId) {
  const key = `${eventId}_${performerId}`;
  const snapshot = await db.ref(`bot_mappings/${key}`).once('value');
  return snapshot.val();
}

/**
 * Get all mappings for an event
 */
async function getMappingsByEvent(eventId) {
  const snapshot = await db.ref('bot_mappings').once('value');
  const all = snapshot.val() || {};
  const event = await getEvent(eventId);
  const validIds = event ? new Set(event.performers.map(p => p.id)) : null;
  const results = [];
  for (const [key, val] of Object.entries(all)) {
    if (!val || val.eventId !== eventId) continue;
    // Orphan mapping (performer no longer exists) → clean up
    if (validIds && !validIds.has(val.performerId)) {
      console.log(`🧹 孤立リンクを削除: ${val.performerName} (@${val.discordUsername})`);
      await db.ref(`bot_mappings/${key}`).remove().catch(() => {});
      continue;
    }
    results.push(val);
  }
  return results;
}

/**
 * Find mapping by Discord user ID within an event
 */
async function getMappingByDiscordUser(eventId, discordUserId) {
  const mappings = await getMappingsByEvent(eventId);
  return mappings.find(m => m.discordUserId === discordUserId) || null;
}

/**
 * Save a mapping
 */
async function setMapping(eventId, performerId, data) {
  const key = `${eventId}_${performerId}`;
  await db.ref(`bot_mappings/${key}`).set({
    eventId,
    performerId,
    ...data,
    registeredAt: new Date().toISOString(),
  });
}

/**
 * Delete a mapping
 */
async function deleteMapping(eventId, performerId) {
  const key = `${eventId}_${performerId}`;
  await db.ref(`bot_mappings/${key}`).remove();
}

// ─── Bot Reminders: Track sent reminders ───

/**
 * Check if a reminder has already been sent
 * @param {string} eventId
 * @param {string} label - e.g. "72h", "24h", "3h", "override_performerId_24h"
 */
async function isReminderSent(eventId, label) {
  const snapshot = await db.ref(`bot_reminders/${eventId}/${label}`).once('value');
  return snapshot.val() === true;
}

/**
 * Mark a reminder as sent
 */
async function markReminderSent(eventId, label) {
  await db.ref(`bot_reminders/${eventId}/${label}`).set(true);
}

// ─── Registration Message ID tracking ───

/**
 * Save the Discord message ID for a registration message
 */
async function setRegistrationMessageId(eventId, messageId) {
  await db.ref(`bot_registration_messages/${eventId}`).set(messageId);
}

/**
 * Get the Discord message ID for a registration message
 */
async function getRegistrationMessageId(eventId) {
  const snapshot = await db.ref(`bot_registration_messages/${eventId}`).once('value');
  return snapshot.val();
}

// ─── Write: Add performer to event (smilert/events) ───

/**
 * Generate an ID matching the frontend format
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Create a performer object matching the frontend data model
 */
function createPerformer(overrides = {}) {
  return {
    id: generateId(),
    name: '',
    discord: '',
    twitter: '',
    cyalumeColor: '#ff6b9d',
    iconUrl: '',
    hoodie: '',
    photoPermission: 'none',  // 写真投稿許可: 'ok' | 'none'
    photoNote: '',            // カメラマンへの一言コメント
    songs: [],
    techRequests: '',
    ...overrides,
  };
}

/**
 * Safely mutate a single event inside smilert/events using a transaction.
 * Prevents overwriting concurrent edits made from the website.
 * @param {Function} fn - (event) => boolean  return false to abort
 * @returns {Promise<boolean>} committed
 */
async function mutateEvent(eventId, fn) {
  let applied = false;
  const result = await db.ref('smilert/events').transaction(current => {
    applied = false;
    // First run may receive null from local cache — return as-is so Firebase retries with server data
    if (current === null) return current;
    const isArray = Array.isArray(current);
    const entries = isArray ? current.map((e, i) => [i, e]) : Object.entries(current);
    const hit = entries.find(([, e]) => e && e.id === eventId);
    if (!hit) return; // abort
    const ev = hit[1];
    if (!ev.performers) ev.performers = [];
    if (!Array.isArray(ev.performers)) ev.performers = Object.values(ev.performers);
    ev.performers = ev.performers.filter(Boolean);
    const ok = fn(ev);
    if (ok === false) return; // abort
    ev.updatedAt = new Date().toISOString();
    applied = true;
    return current;
  });
  return result.committed && applied;
}

/**
 * Add a performer to an event in the smilert/events node
 */
async function addPerformerToEvent(eventId, performerData) {
  const ok = await mutateEvent(eventId, ev => { ev.performers.push(performerData); });
  return ok ? performerData : null;
}

/**
 * Find performers in an event by Discord user ID (via bot_mappings)
 */
async function findPerformerByDiscordId(eventId, discordUserId) {
  const mappings = await getMappingsByEvent(eventId);
  return mappings.find(m => m.discordUserId === discordUserId) || null;
}

// ─── Admin notices (send once) ───

async function hasNotice(eventId, key) {
  const s = await db.ref(`bot_notices/${eventId}/${key}`).once('value');
  return !!s.val();
}
async function markNotice(eventId, key) {
  await db.ref(`bot_notices/${eventId}/${key}`).set(new Date().toISOString());
}

module.exports = {
  getEvents,
  getEvent,
  findEventByTitle,
  getMapping,
  getMappingsByEvent,
  getMappingByDiscordUser,
  setMapping,
  deleteMapping,
  isReminderSent,
  markReminderSent,
  setRegistrationMessageId,
  getRegistrationMessageId,
  generateId,
  createPerformer,
  mutateEvent,
  addPerformerToEvent,
  removePerformerFromEvent,
  findPerformerByDiscordId,
  hasNotice,
  markNotice,
};

/**
 * Remove a performer from an event in the smilert/events node
 * Also removes the bot_mapping for that performer
 */
async function removePerformerFromEvent(eventId, performerId) {
  const ok = await mutateEvent(eventId, ev => {
    const before = ev.performers.length;
    ev.performers = ev.performers.filter(p => p && p.id !== performerId);
    if (ev.performers.length === before) return false; // not found → abort
    if (ev.setlistOverrides) {
      const ov = Array.isArray(ev.setlistOverrides) ? ev.setlistOverrides : Object.values(ev.setlistOverrides);
      ev.setlistOverrides = ov.filter(o => o && o.performerId !== performerId);
    }
  });
  if (!ok) return false;

  await deleteMapping(eventId, performerId);
  return true;
}
