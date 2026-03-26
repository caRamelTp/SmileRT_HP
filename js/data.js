/* ============================================================
   SmileRT LIVE Manager v3 — Data Layer
   ============================================================
   LocalStorage CRUD + CSV Import + Timetable Calculator
   Matches actual Google Forms + Spreadsheet structure
   ============================================================ */

const DB_KEY = 'smilert_v3';

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
  getEvents() {
    const data = this._load();
    return [...data.events].sort((a, b) => {
      if (a.date && b.date) return new Date(b.date) - new Date(a.date);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  getEvent(id) {
    return this._load().events.find(e => e.id === id) || null;
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
    return event ? event.performers.find(p => p.id === performerId) || null : null;
  }

  addPerformer(eventId, performer) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    event.performers.push(performer);
    this.saveEvent(event);
    return performer;
  }

  updatePerformer(eventId, performer) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const idx = event.performers.findIndex(p => p.id === performer.id);
    if (idx >= 0) { event.performers[idx] = performer; this.saveEvent(event); }
    return performer;
  }

  deletePerformer(eventId, performerId) {
    const event = this.getEvent(eventId);
    if (!event) return;
    event.performers = event.performers.filter(p => p.id !== performerId);
    this.saveEvent(event);
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
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('active'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('active'); document.body.style.overflow = ''; }
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
    document.body.style.overflow = '';
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => {
    m.classList.remove('active'); document.body.style.overflow = '';
  });
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
