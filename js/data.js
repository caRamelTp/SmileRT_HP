/* ============================================================
   SmileRT LIVE Manager v3 — Data Layer
   ============================================================
   LocalStorage CRUD + CSV Import + Timetable Calculator
   Matches actual Google Forms + Spreadsheet structure
   ============================================================ */

const DB_KEY = 'smilert_v3';

// --- Discord Webhook (obfuscated) ---
const _WH_P = [
  'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3Mv',
  'MTQ5MDE4OTI5MDA0OTg5NjUxOC9H',
  'NF85Q292MVpHYUtfdDAxVUd2UGFPUFZW',
  'bm92NXBTd1lRc09rTXpnSzNCM2JyWGxoSWlETV8y',
  'eUhvWkFUcHdmNHhhcg=='
];
const DISCORD_WEBHOOK_URL = (function() { try { return atob(_WH_P.join('')); } catch(e) { return ''; } })();

// Debounce timer for Discord notifications (avoid spam from rapid inline edits)
let _discordDebounceTimer = null;
let _discordPendingChanges = null;

function _diffPerformer(oldP, newP) {
  if (!oldP || !newP) return '';
  const sections = [];

  // --- Profile changes ---
  const profileChanges = [];
  if ((oldP.name || '') !== (newP.name || '')) profileChanges.push(`名前: ${oldP.name || '(空)'} → ${newP.name || '(空)'}`);
  if ((oldP.discord || '') !== (newP.discord || '')) profileChanges.push('Discord を更新');
  if ((oldP.twitter || '') !== (newP.twitter || '')) profileChanges.push('X (Twitter) を更新');
  if ((oldP.cyalumeColor || '') !== (newP.cyalumeColor || '')) profileChanges.push(`サイリウムカラー → ${newP.cyalumeColor || '(空)'}`);
  if ((oldP.hoodie || '') !== (newP.hoodie || '')) profileChanges.push(`パーカーサイズ → ${newP.hoodie || '(空)'}`);
  if ((oldP.techRequests || '') !== (newP.techRequests || '')) profileChanges.push('技術リクエストを更新');
  if ((oldP.iconUrl || '') !== (newP.iconUrl || '')) profileChanges.push('アイコン素材URLを更新');
  if (profileChanges.length > 0) {
    sections.push('[プロフィール]\n' + profileChanges.map(c => `  ・${c}`).join('\n'));
  }

  // --- Song changes ---
  const oldSongs = oldP.songs || [];
  const newSongs = newP.songs || [];
  const oldSongMap = new Map(oldSongs.map(s => [s.id, s]));
  const newSongMap = new Map(newSongs.map(s => [s.id, s]));
  const newSongIndex = new Map(newSongs.map((s, i) => [s.id, i + 1]));

  // Modified songs (grouped by song number)
  for (const ns of newSongs) {
    const os = oldSongMap.get(ns.id);
    if (!os) continue;
    const changes = [];
    const songNum = newSongIndex.get(ns.id);
    if ((os.title || '') !== (ns.title || '')) changes.push(`曲名: ${os.title || '(空)'} → ${ns.title || '(空)'}`);
    if ((os.type || 'cover') !== (ns.type || 'cover')) changes.push(`種別 → ${ns.type === 'original' ? 'オリジナル' : 'カバー'}`);
    if ((os.duration || 0) !== (ns.duration || 0)) changes.push(`曲尺 → ${formatDuration(ns.duration) || '(空)'}`);
    if ((os.audioStatus || 'none') !== (ns.audioStatus || 'none')) changes.push('音源ステータスを更新');
    if ((os.audioUrl || '') !== (ns.audioUrl || '')) changes.push('音源URLを更新');
    if ((os.cue || '') !== (ns.cue || '')) changes.push('演出リクエストを更新');
    if ((os.remarks || '') !== (ns.remarks || '')) changes.push('備考を更新');
    if ((os.completedAudio || '') !== (ns.completedAudio || '')) changes.push(`完成音源 → ${ns.completedAudio || '(空)'}`);
    if ((os.audioConfirmed || false) !== (ns.audioConfirmed || false)) changes.push(`音源確認 → ${ns.audioConfirmed ? 'チェック' : '解除'}`);
    if ((os.audioConfirmedHaremu || false) !== (ns.audioConfirmedHaremu || false)) changes.push(`はれむぅ確認 → ${ns.audioConfirmedHaremu ? 'チェック' : '解除'}`);
    if ((os.promptNumber || '') !== (ns.promptNumber || '')) changes.push(`プロンプト → ${ns.promptNumber || '(空)'}`);
    if ((os.micCount || 1) !== (ns.micCount || 1)) changes.push(`マイク数 → ${ns.micCount}`);
    if ((os.key || '') !== (ns.key || '')) changes.push(`Key → ${ns.key || '(空)'}`);
    if ((os.count || '') !== (ns.count || '')) changes.push('カウントを更新');
    if (changes.length > 0) {
      sections.push(`[${songNum}曲目] ${ns.title || '曲名未入力'}\n` + changes.map(c => `  ・${c}`).join('\n'));
    }
  }

  // Added songs
  for (const ns of newSongs) {
    if (oldSongMap.has(ns.id)) continue;
    const songNum = newSongIndex.get(ns.id);
    const info = [ns.type === 'original' ? 'オリジナル' : 'カバー'];
    if (ns.duration) info.push(formatDuration(ns.duration));
    sections.push(`[${songNum}曲目 / 新規追加] ${ns.title || '曲名未入力'} (${info.join(', ')})`);
  }

  // Removed songs
  for (const os of oldSongs) {
    if (newSongMap.has(os.id)) continue;
    sections.push(`[削除] ${os.title || '曲名未入力'}`);
  }

  return sections.join('\n\n');
}

function _sendDiscordNotification(eventTitle, performerName, changeText, type) {
  if (!DISCORD_WEBHOOK_URL) return;

  const now = new Date();
  const timestamp = `${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  let title = 'セトリ更新';
  if (type === 'add') title = '新規登録';
  if (type === 'delete') title = '出演者削除';


  const message = [
    '\u200B',  // 空白文字で前の通知との間にスペースを作る
    `@everyone **【${title}】** ${performerName || '不明'} ── ${eventTitle || ''}`,
    changeText ? `\`\`\`\n${changeText}\n\`\`\`` : '',
    `${timestamp}`
  ].filter(Boolean).join('\n');

  fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message })
  }).catch(err => console.error('Discord notification error:', err));
}

// Debounced notification — batches rapid inline edits (e.g. admin timetable fields)
function _scheduleDiscordNotification(eventTitle, performerName, changeText, type) {
  if (!changeText) return;

  // If there's a pending notification for a different performer, send it now
  if (_discordPendingChanges && (_discordPendingChanges.performerName !== performerName || _discordPendingChanges.eventTitle !== eventTitle)) {
    _sendDiscordNotification(_discordPendingChanges.eventTitle, _discordPendingChanges.performerName, _discordPendingChanges.changeText, _discordPendingChanges.type);
  }
  // Always keep the latest diff (it includes all cumulative changes from snapshot)
  _discordPendingChanges = { eventTitle, performerName, changeText, type };

  clearTimeout(_discordDebounceTimer);
  _discordDebounceTimer = setTimeout(() => {
    if (_discordPendingChanges) {
      _sendDiscordNotification(_discordPendingChanges.eventTitle, _discordPendingChanges.performerName, _discordPendingChanges.changeText, _discordPendingChanges.type);
      _discordPendingChanges = null;
    }
  }, 3000); // 3-second debounce
}

// --- Utility ---
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseDuration(str) {
  if (!str) return 0;
  str = str.trim();
  // Handle "4分22秒", "4:22", "4分38秒", "3:49"
  const jpMatch = str.match(/(\d+)\s*分\s*(\d+)?\s*秒?/);
  if (jpMatch) return parseInt(jpMatch[1]) * 60 + (parseInt(jpMatch[2]) || 0);
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n * 60;
}

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return '';
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(date) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function parseTime(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date(2026, 0, 1);
  d.setHours(h, m, 0, 0);
  return d;
}

// --- Data Models ---
function createSong(overrides = {}) {
  return {
    id: generateId(),
    title: '',
    type: 'cover',           // 'cover' | 'original'
    duration: 0,              // seconds
    audioStatus: 'none',      // 'none' | 'uploaded' | 'confirmed'
    audioUrl: '',
    micCount: 1,
    prompt: false,
    promptNumber: '',
    cue: '',                  // きっかけ・照明・音響
    remarks: '',              // 備考・要望
    key: '',
    count: '',                // カウント
    completedAudio: '',       // 完成済み音源
    audioConfirmed: false,    // 音源確認済み
    audioConfirmedHaremu: false, // 音源確認 はれむ用
    slotType: 'song',         // 'song' | 'mc' | 'break' | 'exchange'
    ...overrides
  };
}

function createPerformer(overrides = {}) {
  return {
    id: generateId(),
    name: '',
    discord: '',
    twitter: '',
    cyalumeColor: '#ff6b9d',
    iconUrl: '',
    hoodie: '',               // パーカーサイズ
    songs: [],
    techRequests: '',
    ...overrides
  };
}

function createEvent(overrides = {}) {
  return {
    id: generateId(),
    title: '',
    date: '',
    venue: '',
    startTime: '17:00',
    schedule: {
      venueEntry: '',         // 会場入り
      rehearsalStart: '',     // リハ開始
      rehearsalEnd: '',       // リハ終了
      doorsOpen: '',          // オープン
      meetGreet: '',          // 顔合わせ
      mc: '',                 // MC
      exchangeStart: '',      // 交流会開始
      exchangeEnd: '',        // 交流会終了
      fullClear: ''           // 完全撤収
    },
    performers: [],
    specialSlots: [],         // 休憩・交流会等の特殊スロット
    notes: '',                // 全体メモ (ショーケースXX分等)
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

// --- Database ---
class SmileRTDatabase {
  constructor() {
    this._data = null;
    this._ready = false;
    this._onChangeCallbacks = [];
    this._useFirebase = typeof firebase !== 'undefined' && typeof firebaseDB !== 'undefined';
    this._performerSnapshots = new Map(); // Snapshots for Discord change detection
  }

  // Initialize database (call this before using db)
  init() {
    return new Promise((resolve) => {
      // Load from localStorage first (fast startup)
      this._loadLocal();

      if (this._useFirebase) {
        // Listen for realtime changes from Firebase
        const ref = firebaseDB.ref('smilert');
        ref.on('value', (snapshot) => {
          const val = snapshot.val();
          if (val) {
            this._data = val;
            if (!this._data.events) this._data.events = [];
            if (!this._data.settings) this._data.settings = {};
          }
          // Save to localStorage as cache
          this._saveLocal();
          this._performerSnapshots.clear(); // Reset snapshots on remote data sync
          this._ready = true;
          this._fireChange();
          resolve();
        }, (error) => {
          console.error('Firebase read error:', error);
          this._useFirebase = false;
          this._ready = true;
          resolve();
        });
      } else {
        this._ready = true;
        resolve();
      }
    });
  }

  // Register callback for data changes (for realtime UI updates)
  onChange(callback) {
    this._onChangeCallbacks.push(callback);
  }

  _fireChange() {
    this._onChangeCallbacks.forEach(cb => {
      try { cb(); } catch (e) { console.error('onChange callback error:', e); }
    });
  }

  _loadLocal() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(DB_KEY);
      this._data = raw ? JSON.parse(raw) : { events: [], settings: {} };
    } catch (e) {
      console.error('DB load error:', e);
      this._data = { events: [], settings: {} };
    }
    return this._data;
  }

  _saveLocal() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(this._data));
    } catch (e) {
      console.error('localStorage save error:', e);
    }
  }

  _load() {
    if (this._data) return this._data;
    return this._loadLocal();
  }

  _save() {
    // Always save to localStorage
    this._saveLocal();
    // Also push to Firebase if available
    if (this._useFirebase) {
      firebaseDB.ref('smilert').set(this._data).catch(e => {
        console.error('Firebase save error:', e);
      });
    }
  }

  // --- Events ---
  // Normalize event data (Firebase drops empty arrays)
  _normalizeEvent(e) {
    if (!e) return e;
    if (!Array.isArray(e.performers)) e.performers = e.performers ? Object.values(e.performers) : [];
    if (!Array.isArray(e.specialSlots)) e.specialSlots = e.specialSlots ? Object.values(e.specialSlots) : [];
    if (!Array.isArray(e.timetableOrder)) e.timetableOrder = e.timetableOrder ? Object.values(e.timetableOrder) : [];
    e.performers.forEach(p => {
      if (!Array.isArray(p.songs)) p.songs = p.songs ? Object.values(p.songs) : [];
    });
    return e;
  }

  getEvents() {
    const data = this._load();
    if (!Array.isArray(data.events)) data.events = data.events ? Object.values(data.events) : [];
    data.events.forEach(e => this._normalizeEvent(e));
    return [...data.events].sort((a, b) => {
      if (a.date && b.date) return new Date(b.date) - new Date(a.date);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  getEvent(id) {
    const data = this._load();
    if (!Array.isArray(data.events)) data.events = data.events ? Object.values(data.events) : [];
    const e = data.events.find(e => e.id === id) || null;
    return this._normalizeEvent(e);
  }

  saveEvent(event) {
    const data = this._load();
    const idx = data.events.findIndex(e => e.id === event.id);
    event.updatedAt = new Date().toISOString();
    if (idx >= 0) data.events[idx] = event;
    else data.events.push(event);
    this._save();
    return event;
  }

  deleteEvent(id) {
    const data = this._load();
    data.events = data.events.filter(e => e.id !== id);
    this._save();
  }

  // --- Performers ---
  getPerformer(eventId, performerId) {
    const event = this.getEvent(eventId);
    const p = event ? event.performers.find(p => p.id === performerId) || null : null;
    // Only store snapshot if none exists (preserve baseline for change detection)
    if (p && !this._performerSnapshots.has(p.id)) {
      this._performerSnapshots.set(p.id, JSON.parse(JSON.stringify(p)));
    }
    return p;
  }

  addPerformer(eventId, performer) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    event.performers.push(performer);
    this.saveEvent(event);
    // Discord notification for new performer
    if (performer.name) {
      const songList = (performer.songs || []).filter(s => s.title).map((s, i) => `${i+1}. ${s.title}`).join('\n');
      const changeText = songList ? `セットリスト:\n${songList}` : '';
      _sendDiscordNotification(event.title, performer.name, changeText, 'add');
    }
    return performer;
  }

  updatePerformer(eventId, performer) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const idx = event.performers.findIndex(p => p.id === performer.id);
    if (idx >= 0) {
      // Use snapshot taken at getPerformer() time (before caller modified the reference)
      const oldPerformer = this._performerSnapshots.get(performer.id) || null;
      event.performers[idx] = performer;
      this.saveEvent(event);
      // Detect changes and notify Discord
      if (oldPerformer) {
        const changeText = _diffPerformer(oldPerformer, performer);
        if (changeText) {
          _scheduleDiscordNotification(event.title, performer.name || oldPerformer.name, changeText, 'update');
        }
      }
      // Update snapshot to current state
      this._performerSnapshots.set(performer.id, JSON.parse(JSON.stringify(performer)));
    }
    return performer;
  }

  deletePerformer(eventId, performerId) {
    const event = this.getEvent(eventId);
    if (!event) return;
    const deletedPerformer = event.performers.find(p => p.id === performerId);
    event.performers = event.performers.filter(p => p.id !== performerId);
    this.saveEvent(event);
    // Discord notification for deleted performer
    if (deletedPerformer && deletedPerformer.name) {
      _sendDiscordNotification(event.title, deletedPerformer.name, '', 'delete');
    }
  }

  reorderPerformers(eventId, orderedIds) {
    const event = this.getEvent(eventId);
    if (!event) return;
    const map = new Map(event.performers.map(p => [p.id, p]));
    event.performers = orderedIds.map(id => map.get(id)).filter(Boolean);
    this.saveEvent(event);
  }

  // --- Timetable Calculator ---
  calculateTimetable(event) {
    if (!event) return [];
    let currentTime = parseTime(event.startTime || '17:00');
    if (!currentTime) return [];

    const timeline = [];
    const allItems = this._buildOrderedItems(event);

    allItems.forEach((item) => {
      const startTime = new Date(currentTime);
      const durationSec = item.duration || 300; // default 5 min
      currentTime = new Date(currentTime.getTime() + durationSec * 1000);

      timeline.push({
        order: timeline.length + 1,
        timeRange: `${formatTime(startTime)}〜${formatTime(currentTime)}`,
        startTime: formatTime(startTime),
        endTime: formatTime(currentTime),
        performerName: item.performerName || '',
        performerId: item.performerId || '',
        songTitle: item.title || '',
        songId: item.songId || '',
        slotType: item.slotType || 'song',
        duration: durationSec,
        durationStr: formatDuration(durationSec),
        micCount: item.micCount || 0,
        prompt: item.prompt || false,
        promptNumber: item.promptNumber || '',
        cue: item.cue || '',
        remarks: item.remarks || '',
        key: item.key || '',
        count: item.count || '',
        type: item.type || '',
        audioStatus: item.audioStatus || 'none',
        audioUrl: item.audioUrl || '',
        completedAudio: item.completedAudio || '',
        audioConfirmed: item.audioConfirmed || false,
        audioConfirmedHaremu: item.audioConfirmedHaremu || false,
        cyalumeColor: item.cyalumeColor || '',
        performerIndex: item.performerIndex,
        songIndex: item.songIndex
      });
    });

    return timeline;
  }

  _buildOrderedItems(event) {
    this._ensureTimetableOrder(event);
    const items = [];
    const performerMap = new Map(event.performers.map(p => [p.id, p]));
    const slotMap = new Map((event.specialSlots || []).map(s => [s.id, s]));

    for (const entry of event.timetableOrder) {
      if (entry.type === 'song') {
        const performer = performerMap.get(entry.performerId);
        if (!performer) continue;
        const song = performer.songs.find(s => s.id === entry.songId);
        if (!song) continue;
        const sIdx = performer.songs.indexOf(song);
        items.push({
          ...song,
          performerName: performer.name,
          performerId: performer.id,
          songId: song.id,
          cyalumeColor: performer.cyalumeColor,
          performerIndex: event.performers.indexOf(performer),
          songIndex: sIdx
        });
      } else {
        const slot = slotMap.get(entry.slotId);
        if (!slot) continue;
        items.push({
          title: slot.title || '休憩',
          slotType: slot.slotType || 'break',
          duration: slot.duration || 600,
          performerName: '',
          performerId: '',
          songId: slot.id,
          micCount: 0, prompt: false, promptNumber: '',
          cue: '', remarks: '', key: '', count: ''
        });
      }
    }
    return items;
  }

  // Build or sync timetableOrder with actual performer/slot data
  _ensureTimetableOrder(event) {
    if (!event.timetableOrder) event.timetableOrder = [];
    const order = event.timetableOrder;

    // Collect all valid song IDs and slot IDs
    const allSongs = new Set();
    const allSlots = new Set((event.specialSlots || []).map(s => s.id));
    const songToPerformer = new Map();
    event.performers.forEach(p => {
      p.songs.forEach(s => {
        allSongs.add(s.id);
        songToPerformer.set(s.id, p.id);
      });
    });

    // Remove stale entries (deleted songs/slots)
    event.timetableOrder = order.filter(entry => {
      if (entry.type === 'song') return allSongs.has(entry.songId);
      return allSlots.has(entry.slotId);
    });

    // Track what's already in order
    const existingSongIds = new Set(event.timetableOrder.filter(e => e.type === 'song').map(e => e.songId));
    const existingSlotIds = new Set(event.timetableOrder.filter(e => e.type !== 'song').map(e => e.slotId));

    // Add new songs (from new performers or newly added songs)
    event.performers.forEach(p => {
      p.songs.forEach(s => {
        if (!existingSongIds.has(s.id)) {
          event.timetableOrder.push({ type: 'song', performerId: p.id, songId: s.id });
        }
      });
    });

    // Add new special slots
    (event.specialSlots || []).forEach(s => {
      if (!existingSlotIds.has(s.id)) {
        event.timetableOrder.push({ type: 'special', slotId: s.id });
      }
    });

    // Fix performerId references (in case songs were moved between performers)
    event.timetableOrder.forEach(entry => {
      if (entry.type === 'song' && songToPerformer.has(entry.songId)) {
        entry.performerId = songToPerformer.get(entry.songId);
      }
    });
  }

  // --- Special Slots (break, exchange, MC) ---
  addSpecialSlot(eventId, afterRowIndex, slot) {
    const event = this.getEvent(eventId);
    if (!event) return;
    if (!event.specialSlots) event.specialSlots = [];
    const newSlot = {
      id: generateId(),
      title: slot.title || '休憩',
      slotType: slot.slotType || 'break',
      duration: slot.duration || 600,
      ...slot
    };
    // Remove legacy afterPerformerIndex if present
    delete newSlot.afterPerformerIndex;
    event.specialSlots.push(newSlot);
    // Ensure order exists, then insert at desired position
    this._ensureTimetableOrder(event);
    // The slot was auto-appended by _ensureTimetableOrder, but we may want it at a specific position
    // Remove from end and insert at desired position
    const lastEntry = event.timetableOrder.pop(); // the newly added one
    if (afterRowIndex >= 0 && afterRowIndex < event.timetableOrder.length) {
      event.timetableOrder.splice(afterRowIndex + 1, 0, lastEntry);
    } else {
      // Insert at the middle by default
      const mid = Math.floor(event.timetableOrder.length / 2);
      event.timetableOrder.splice(mid, 0, lastEntry);
    }
    this.saveEvent(event);
  }

  removeSpecialSlot(eventId, slotId) {
    const event = this.getEvent(eventId);
    if (!event) return;
    if (event.specialSlots) {
      event.specialSlots = event.specialSlots.filter(s => s.id !== slotId);
    }
    if (event.timetableOrder) {
      event.timetableOrder = event.timetableOrder.filter(e => !(e.type !== 'song' && e.slotId === slotId));
    }
    this.saveEvent(event);
  }

  // --- Swap Timetable Rows ---
  swapTimetableRows(eventId, rowIdx1, rowIdx2) {
    const event = this.getEvent(eventId);
    if (!event) return false;
    this._ensureTimetableOrder(event);
    const order = event.timetableOrder;
    if (rowIdx1 < 0 || rowIdx2 < 0 || rowIdx1 >= order.length || rowIdx2 >= order.length) return false;
    // Simply swap the two entries in the order array
    const tmp = order[rowIdx1];
    order[rowIdx1] = order[rowIdx2];
    order[rowIdx2] = tmp;
    this.saveEvent(event);
    return true;
  }


  // --- CSV Export ---
  exportCSV(eventId) {
    const event = this.getEvent(eventId);
    if (!event) return;
    const timeline = this.calculateTimetable(event);
    const headers = ['曲順', '時間', '演者名', '曲名', '種別', '曲尺', 'プロンプト', 'きっかけ・照明・音響', '備考', 'マイク', 'カウント', 'Key', '完成音源', '音源確認', 'はれむぅ確認'];
    const csvEsc = v => {
      const s = String(v || '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = [headers.map(csvEsc).join(',')];
    timeline.forEach(t => {
      if (t.slotType !== 'song') {
        rows.push([csvEsc(t.songTitle || t.slotType), csvEsc(t.timeRange), '', '', '', csvEsc(t.durationStr), '', '', '', '', '', '', '', '', ''].join(','));
      } else {
        rows.push([
          csvEsc(t.order), csvEsc(t.timeRange), csvEsc(t.performerName), csvEsc(t.songTitle),
          csvEsc(t.type === 'original' ? 'オリジナル' : 'カバー'), csvEsc(t.durationStr),
          csvEsc(t.promptNumber), csvEsc(t.cue), csvEsc(t.remarks),
          csvEsc(t.micCount), csvEsc(t.count), csvEsc(t.key),
          csvEsc(t.completedAudio),
          csvEsc(t.audioConfirmed ? '✓' : ''), csvEsc(t.audioConfirmedHaremu ? '✓' : '')
        ].join(','));
      }
    });
    const bom = '\uFEFF';
    const blob = new Blob([bom + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${event.title || 'timetable'}_${event.date || 'export'}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  // --- TSV Export (for Google Sheets clipboard paste) ---
  exportTSV(eventId) {
    const event = this.getEvent(eventId);
    if (!event) return '';
    const timeline = this.calculateTimetable(event);
    const headers = ['曲順', '時間', '演者名', '曲名', '種別', '曲尺', 'プロンプト', 'きっかけ・照明・音響', '備考', 'マイク', 'カウント', 'Key', '完成音源', '音源確認', 'はれむぅ確認'];
    const rows = [headers.join('\t')];
    timeline.forEach(t => {
      if (t.slotType !== 'song') {
        rows.push([t.songTitle || t.slotType, t.timeRange, '', '', '', t.durationStr, '', '', '', '', '', '', '', '', ''].join('\t'));
      } else {
        rows.push([
          t.order, t.timeRange, t.performerName, t.songTitle,
          t.type === 'original' ? 'オリジナル' : 'カバー', t.durationStr,
          t.promptNumber, t.cue, t.remarks,
          t.micCount, t.count, t.key,
          t.completedAudio,
          t.audioConfirmed ? '✓' : '', t.audioConfirmedHaremu ? '✓' : ''
        ].join('\t'));
      }
    });
    return rows.join('\n');
  }

  // --- HTML Table Export (for Excel clipboard paste with formatting) ---
  exportHTMLTable(eventId) {
    const event = this.getEvent(eventId);
    if (!event) return '';
    const timeline = this.calculateTimetable(event);
    const thStyle = 'background:#f0f0f0;font-weight:bold;border:1px solid #ccc;padding:4px 8px;font-size:12px;text-align:center;';
    const tdStyle = 'border:1px solid #ddd;padding:4px 8px;font-size:12px;';
    const headers = ['曲順', '時間', '演者名', '曲名', '種別', '曲尺', 'プロンプト', 'きっかけ・照明・音響', '備考', 'マイク', 'カウント', 'Key', '完成音源', '音源確認', 'はれむぅ確認'];
    
    let html = `<table style="border-collapse:collapse;font-family:sans-serif;">`;
    html += `<thead><tr>${headers.map(h => `<th style="${thStyle}">${h}</th>`).join('')}</tr></thead><tbody>`;
    
    timeline.forEach(t => {
      if (t.slotType !== 'song') {
        html += `<tr style="background:#fff8e1;"><td style="${tdStyle}font-weight:bold;color:#b8860b;" colspan="15">${t.songTitle || t.slotType}　${t.timeRange}　(${t.durationStr})</td></tr>`;
      } else {
        const doneColor = t.completedAudio === '完成済み' ? 'color:#16a34a;font-weight:bold;' : t.completedAudio === '受け取り済み' ? 'color:#d97706;font-weight:bold;' : '';
        html += `<tr>
          <td style="${tdStyle}text-align:center;">${t.order}</td>
          <td style="${tdStyle}font-family:monospace;">${t.timeRange}</td>
          <td style="${tdStyle}">${t.performerName}</td>
          <td style="${tdStyle}font-weight:600;">${t.songTitle}</td>
          <td style="${tdStyle}text-align:center;">${t.type === 'original' ? 'オリジナル' : 'カバー'}</td>
          <td style="${tdStyle}text-align:center;font-family:monospace;">${t.durationStr}</td>
          <td style="${tdStyle}text-align:center;">${t.promptNumber}</td>
          <td style="${tdStyle}">${t.cue}</td>
          <td style="${tdStyle}">${t.remarks}</td>
          <td style="${tdStyle}text-align:center;">${t.micCount || 0}</td>
          <td style="${tdStyle}text-align:center;">${t.count}</td>
          <td style="${tdStyle}text-align:center;">${t.key}</td>
          <td style="${tdStyle}text-align:center;${doneColor}">${t.completedAudio}</td>
          <td style="${tdStyle}text-align:center;">${t.audioConfirmed ? '✓' : ''}</td>
          <td style="${tdStyle}text-align:center;">${t.audioConfirmedHaremu ? '✓' : ''}</td>
        </tr>`;
      }
    });
    html += '</tbody></table>';
    return html;
  }

  // --- CSV Import (Google Forms) ---
  importCSV(eventId, csvText) {
    const event = this.getEvent(eventId);
    if (!event) return { success: false, error: 'イベントが見つかりません' };

    try {
      const rows = this._parseCSV(csvText);
      if (rows.length < 2) return { success: false, error: 'データが見つかりません' };

      const headers = rows[0];
      const dataRows = rows.slice(1);
      let importCount = 0;

      // Detect column positions
      const colMap = this._detectColumns(headers);

      for (const row of dataRows) {
        if (row.length < 5) continue;

        const name = (row[colMap.name] || '').trim();
        if (!name) continue;

        const performer = createPerformer({
          name,
          discord: (row[colMap.discord] || '').trim(),
          twitter: (row[colMap.twitter] || '').trim(),
          cyalumeColor: (row[colMap.cyalume] || '').trim() || '#ff6b9d',
          iconUrl: (row[colMap.icon] || '').trim(),
          hoodie: (row[colMap.hoodie] || '').trim()
        });

        // Parse songs (7-column repeating groups)
        const songStart = colMap.firstSong;
        const songGroupSize = 7;

        for (let i = songStart; i < row.length; i += songGroupSize) {
          const title = (row[i] || '').trim();
          if (!title) continue;

          const song = createSong({
            title,
            type: (row[i + 1] || '').includes('オリジナル') ? 'original' : 'cover',
            duration: parseDuration(row[i + 2] || ''),
            audioStatus: (row[i + 3] || '').includes('あり') ? 'uploaded' : 'none',
            audioUrl: (row[i + 4] || '').trim(),
            cue: (row[i + 5] || '').trim()
          });
          performer.songs.push(song);

          // Check "次の曲を追加しますか？" column
          const addNext = (row[i + 6] || '').trim();
          if (addNext === 'いいえ' || addNext === '') break;
        }

        // Check if performer already exists
        const existing = event.performers.find(p => p.name === performer.name);
        if (existing) {
          existing.songs.push(...performer.songs);
          if (performer.discord) existing.discord = performer.discord;
          if (performer.twitter) existing.twitter = performer.twitter;
          if (performer.cyalumeColor !== '#ff6b9d') existing.cyalumeColor = performer.cyalumeColor;
          if (performer.iconUrl) existing.iconUrl = performer.iconUrl;
          if (performer.hoodie) existing.hoodie = performer.hoodie;
        } else {
          event.performers.push(performer);
        }
        importCount++;
      }

      this.saveEvent(event);
      return { success: true, count: importCount };
    } catch (e) {
      console.error('CSV Import error:', e);
      return { success: false, error: e.message };
    }
  }

  _detectColumns(headers) {
    const find = (keywords) => {
      for (let i = 0; i < headers.length; i++) {
        const h = (headers[i] || '').toLowerCase();
        if (keywords.some(k => h.includes(k.toLowerCase()))) return i;
      }
      return -1;
    };

    const nameCol = find(['出演者名', 'performer']);
    const discordCol = find(['discord']);
    const twitterCol = find(['x(旧', 'twitter', 'x id']);
    const cyalumeCol = find(['サイリウム', 'cyalume']);
    const iconCol = find(['フライヤー', 'アイコン']);
    const hoodieCol = find(['パーカー', 'hoodie', 'サイズ']);

    // First song column: look for "楽曲名"
    let firstSong = find(['楽曲名']);
    if (firstSong === -1) {
      // Fallback: assume after hoodie column
      firstSong = Math.max(nameCol, discordCol, twitterCol, cyalumeCol, iconCol, hoodieCol) + 1;
    }

    return {
      name: nameCol >= 0 ? nameCol : 2,
      discord: discordCol >= 0 ? discordCol : 3,
      twitter: twitterCol >= 0 ? twitterCol : 4,
      cyalume: cyalumeCol >= 0 ? cyalumeCol : 5,
      icon: iconCol >= 0 ? iconCol : 6,
      hoodie: hoodieCol >= 0 ? hoodieCol : 7,
      firstSong: firstSong >= 0 ? firstSong : 8
    };
  }

  _parseCSV(text) {
    const rows = [];
    let current = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { current.push(field); field = ''; }
        else if (c === '\n' || (c === '\r' && next === '\n')) {
          current.push(field); field = '';
          if (current.some(f => f.trim())) rows.push(current);
          current = [];
          if (c === '\r') i++;
        } else { field += c; }
      }
    }
    current.push(field);
    if (current.some(f => f.trim())) rows.push(current);
    return rows;
  }

  // --- Export / Import JSON ---
  exportEvent(eventId) {
    const event = this.getEvent(eventId);
    return event ? JSON.stringify(event, null, 2) : null;
  }

  importEvent(jsonText) {
    try {
      const event = JSON.parse(jsonText);
      event.id = generateId();
      event.createdAt = new Date().toISOString();
      event.updatedAt = new Date().toISOString();
      this._load().events.push(event);
      this._save();
      return { success: true, event };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

// --- Singleton ---
const db = new SmileRTDatabase();

// --- Toast ---
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- Modal Helpers ---
let _modalScrollY = 0;
function _lockBody() {
  if (!document.body.classList.contains('modal-open')) {
    _modalScrollY = window.scrollY;
    document.body.classList.add('modal-open');
    document.body.style.top = `-${_modalScrollY}px`;
  }
}
function _unlockBody() {
  if (document.body.classList.contains('modal-open')) {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, _modalScrollY);
  }
}
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('active'); _lockBody(); }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('active'); }
  // Only unlock if no other modals are active
  if (!document.querySelector('.modal-overlay.active')) { _unlockBody(); }
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) { _unlockBody(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    _unlockBody();
  }
});

// --- URL Params ---
function getParam(key) { return new URLSearchParams(window.location.search).get(key); }
function setParams(params) {
  const url = new URL(window.location);
  Object.entries(params).forEach(([k, v]) => {
    if (v == null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  });
  window.history.replaceState({}, '', url);
}

// --- HTML Escape ---
function escHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
