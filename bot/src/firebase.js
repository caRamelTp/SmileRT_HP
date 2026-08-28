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
  const results = [];
  for (const [key, val] of Object.entries(all)) {
    if (val && val.eventId === eventId) {
      results.push(val);
    }
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
    songs: [],
    techRequests: '',
    ...overrides,
  };
}

/**
 * Add a performer to an event in the smilert/events node
 */
async function addPerformerToEvent(eventId, performerData) {
  const snapshot = await db.ref('smilert/events').once('value');
  let events = snapshot.val();
  if (!events) return null;

  // Convert to array if Firebase stored as object
  if (!Array.isArray(events)) events = Object.values(events);
  events = events.filter(Boolean);

  // Find event index
  const eventIndex = events.findIndex(e => e && e.id === eventId);
  if (eventIndex === -1) return null;

  // Ensure performers array exists
  if (!events[eventIndex].performers) events[eventIndex].performers = [];
  if (!Array.isArray(events[eventIndex].performers)) {
    events[eventIndex].performers = Object.values(events[eventIndex].performers).filter(Boolean);
  }

  // Add performer
  events[eventIndex].performers.push(performerData);
  events[eventIndex].updatedAt = new Date().toISOString();

  // Write back
  await db.ref('smilert/events').set(events);

  return performerData;
}

/**
 * Find performers in an event by Discord user ID (via bot_mappings)
 * or by matching name
 */
async function findPerformerByDiscordId(eventId, discordUserId) {
  const mappings = await getMappingsByEvent(eventId);
  return mappings.find(m => m.discordUserId === discordUserId) || null;
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
  addPerformerToEvent,
  removePerformerFromEvent,
  findPerformerByDiscordId,
};

/**
 * Remove a performer from an event in the smilert/events node
 * Also removes the bot_mapping for that performer
 */
async function removePerformerFromEvent(eventId, performerId) {
  const snapshot = await db.ref('smilert/events').once('value');
  let events = snapshot.val();
  if (!events) return false;

  if (!Array.isArray(events)) events = Object.values(events);
  events = events.filter(Boolean);

  const eventIndex = events.findIndex(e => e && e.id === eventId);
  if (eventIndex === -1) return false;

  if (!events[eventIndex].performers) return false;
  if (!Array.isArray(events[eventIndex].performers)) {
    events[eventIndex].performers = Object.values(events[eventIndex].performers).filter(Boolean);
  }

  const before = events[eventIndex].performers.length;
  events[eventIndex].performers = events[eventIndex].performers.filter(p => p.id !== performerId);
  const after = events[eventIndex].performers.length;

  if (before === after) return false; // Not found

  events[eventIndex].updatedAt = new Date().toISOString();
  await db.ref('smilert/events').set(events);

  // Also remove mapping
  await deleteMapping(eventId, performerId);

  return true;
}
