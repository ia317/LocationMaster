'use strict';

const VERSION = '1.1.3';

// ── Leaderboard & Stats ──────────────────────────────────────
// Paste your Firebase Realtime Database URL here (no trailing slash).
// Setup: firebase.google.com → new project → Realtime Database → create in test mode.
// Rules: { "rules": { "leaderboard": { ".read": true, ".write": true }, "stats": { ".read": true, ".write": true } } }
const FIREBASE_URL = 'https://locationmaster-306f0-default-rtdb.firebaseio.com';

// ============================================================
// STATE
// ============================================================
const state = {
  lang: 'en',
  mapStyle: 'solid',
  borders: true,
  region: 'world',
  gameMode: 'countries',
  training: false,
  difficulty: 'easy',
  numPlayers: 1,
  players: [],
  currentPlayerIdx: 0,
  questionPool: [],
  questionIdx: 0,
  targetCountry: null,
  gameActive: false,
  awaitingNext: false,
  waterStateFilter: 'all',
  israelAreaFilter: 'all',
};

// ============================================================
// DATA
// ============================================================
let i18n = {};
let countriesMeta = [];
let landmarksData = [];
let oceansData = [];
let geoData = null;
let usaStatesData = [];
let usaLandmarksData = [];
let usaWatersData = [];
let usaGeoData = null;
let israelCitiesData = [];
let israelLandmarksData = [];
let israelWatersData = [];
let israelGeoData = null;
const wikiInfoCache = new Map();
const descTranslateCache = new Map();

// ============================================================
// MAP
// ============================================================
let map = null;
let tileLayer = null;
let geoLayer = null;
let countryLayers = {};
let awaitTimeout = null;
let awaitResolveFn = null;
let clickDebugTimeout = null;
let _layerClickHandled = false;
let questionTimerRAF = null;
let oceanHighlightLayer = null;
let cityMarkerLayer = null;

const TILES = {
  solid: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    bgColor: '#1a2744',
  },
  space: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    bgColor: '#0c1a2e',
  },
};

const GEO_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
const USA_GEO_URL = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';
const ISRAEL_GEO_URL = 'data/israel-unified.geojson';

const ISRAEL_AREAS = [
  { id: 'north',         name: { en: 'North',           he: 'הצפון',         fr: 'Nord',           es: 'Norte',          pt: 'Norte',            zh: '北部' }},
  { id: 'center',        name: { en: 'Center',          he: 'המרכז',         fr: 'Centre',         es: 'Centro',         pt: 'Centro',           zh: '中部' }},
  { id: 'jerusalem',     name: { en: 'Jerusalem',       he: 'ירושלים',       fr: 'Jérusalem',      es: 'Jerusalén',      pt: 'Jerusalém',        zh: '耶路撒冷' }},
  { id: 'south',         name: { en: 'South',           he: 'הדרום',         fr: 'Sud',            es: 'Sur',            pt: 'Sul',              zh: '南部' }},
  { id: 'judea_samaria', name: { en: 'Judea & Samaria', he: 'יהודה ושומרון', fr: 'Judée-Samarie',  es: 'Judea y Samaria', pt: 'Judeia e Samaria', zh: '犹大和撒马利亚' }},
  { id: 'golan',         name: { en: 'Golan',           he: 'הגולן',         fr: 'Golan',          es: 'Golán',          pt: 'Golã',             zh: '戈兰' }},
];

const USA_STATE_MAP = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
  "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO",
  "Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH",
  "Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"
};

// ============================================================
// i18n
// ============================================================
async function loadI18n(lang) {
  try {
    const res = await fetch(`i18n/${lang}.json`);
    i18n = await res.json();
    state.lang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    applyI18n();
  } catch (e) {
    console.warn('Could not load language:', lang);
  }
}

function t(key) {
  return i18n[key] || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadCountriesMeta() {
  const res = await fetch('data/countries-meta.json');
  countriesMeta = await res.json();
}

async function loadGeoData() {
  const res = await fetch(GEO_URL);
  geoData = await res.json();
}

async function loadLandmarksData() {
  const res = await fetch('data/landmarks.json');
  landmarksData = await res.json();
}

async function loadOceansData() {
  const res = await fetch('data/oceans.json');
  oceansData = await res.json();
}

async function loadDataForRegion(region) {
  if (region === 'usa' && usaStatesData.length === 0) {
    const [states, landmarks, waters, geo] = await Promise.all([
      fetch('data/usa-states.json').then(r => r.json()),
      fetch('data/usa-landmarks.json').then(r => r.json()),
      fetch('data/usa-waters.json').then(r => r.json()),
      fetch(USA_GEO_URL).then(r => r.json()),
    ]);
    usaStatesData = states;
    usaLandmarksData = landmarks;
    usaWatersData = waters;
    usaGeoData = geo;
  }
  if (region === 'israel' && israelCitiesData.length === 0) {
    const [cities, landmarks, waters, geo] = await Promise.all([
      fetch('data/israel-cities.json').then(r => r.json()),
      fetch('data/israel-landmarks.json').then(r => r.json()),
      fetch('data/israel-waters.json').then(r => r.json()),
      fetch(ISRAEL_GEO_URL).then(r => r.json()),
    ]);
    israelCitiesData = cities;
    israelLandmarksData = landmarks;
    israelWatersData = waters;
    israelGeoData = geo;
  }
}

function getActiveEntityData() {
  if (state.region === 'usa') return usaStatesData;
  return countriesMeta;
}

function getActiveLandmarksData() {
  if (state.region === 'usa') return usaLandmarksData;
  if (state.region === 'israel') return israelLandmarksData;
  return landmarksData;
}

function getActiveWatersData() {
  if (state.region === 'usa') return usaWatersData;
  if (state.region === 'israel') return israelWatersData;
  return oceansData;
}

// ============================================================
// LEADERBOARD  (Firebase Realtime Database via REST)
// ============================================================
function leaderboardEnabled() { return !!FIREBASE_URL; }

async function loadLeaderboard(mode) {
  if (!leaderboardEnabled()) return [];
  try {
    const res = await fetch(`${FIREBASE_URL}/leaderboard/${mode}.json`);
    if (!res.ok) return [];
    const data = await res.json();
    return data ? Object.values(data) : [];
  } catch { return []; }
}

async function saveLeaderboardEntry(entry) {
  if (!leaderboardEnabled()) return;
  try {
    await fetch(`${FIREBASE_URL}/leaderboard/${entry.mode}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch (e) { console.warn('Leaderboard save failed:', e); }
}

async function loadStats() {
  if (!leaderboardEnabled()) return { gamesPlayed: 0, locationsFound: 0 };
  try {
    const res = await fetch(`${FIREBASE_URL}/stats.json`);
    if (!res.ok) return { gamesPlayed: 0, locationsFound: 0 };
    const data = await res.json();
    return data || { gamesPlayed: 0, locationsFound: 0 };
  } catch { return { gamesPlayed: 0, locationsFound: 0 }; }
}

async function incrementStat(field) {
  if (!leaderboardEnabled()) return;
  try {
    const res = await fetch(`${FIREBASE_URL}/stats/${field}.json`);
    const cur = res.ok ? (await res.json() || 0) : 0;
    await fetch(`${FIREBASE_URL}/stats/${field}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cur + 1),
    });
  } catch (e) { console.warn('Stats update failed:', e); }
}

async function loadAndShowStats() {
  const statsEl = document.getElementById('home-stats');
  const gamesEl = document.getElementById('home-games-counter');
  const locEl   = document.getElementById('home-locations-counter');
  if (!statsEl) return;

  statsEl.classList.remove('hidden');
  gamesEl.innerHTML = `🌍 Loading stats...`;
  locEl.innerHTML   = ``;

  const stats = await loadStats();
  const games = stats.gamesPlayed  || 0;
  const locs  = stats.locationsFound || 0;

  if (games > 0 || locs > 0) {
    gamesEl.innerHTML = `🌍 <strong>${games.toLocaleString()}</strong> games played`;
    locEl.innerHTML   = `📍 <strong>${locs.toLocaleString()}</strong> locations found`;
  } else {
    gamesEl.innerHTML = `🌍 Be the first to play!`;
    locEl.innerHTML   = ``;
  }
}

async function checkLeaderboardQualification() {
  if (!leaderboardEnabled() || state.numPlayers !== 1) return;
  const player = state.players[0];
  if (player.score === 0) return;

  const all = await loadLeaderboard(state.gameMode);
  const sorted = all.sort((a, b) => b.score - a.score);
  if (sorted.length >= 10 && player.score <= sorted[9].score) return;

  showNameEntryModal(player.score);
}

function showNameEntryModal(finalScore) {
  const modal  = document.getElementById('modal-leaderboard-entry');
  const input  = document.getElementById('leaderboard-name-input');
  const submit = document.getElementById('btn-leaderboard-submit');
  modal.classList.remove('hidden');
  input.value = '';
  setTimeout(() => input.focus(), 100);

  const done = async () => {
    submit.removeEventListener('click', done);
    input.removeEventListener('keydown', onKey);
    modal.classList.add('hidden');

    const name = input.value.trim() || 'Anonymous';
    const pts  = DIFFICULTY_CONFIG[state.difficulty].points;
    const correct = Math.round(finalScore / pts);
    await saveLeaderboardEntry({
      name,
      score:      finalScore,
      difficulty: state.difficulty,
      mode:       state.gameMode,
      correct,
      total:      state.questionIdx,
      date:       new Date().toLocaleDateString('en-GB'),
      timestamp:  Date.now(),
    });
    showLeaderboard(state.gameMode);
  };
  const onKey = e => { if (e.key === 'Enter') done(); };
  submit.addEventListener('click', done);
  input.addEventListener('keydown', onKey);
}

async function showLeaderboard(mode) {
  showPanel('leaderboard');
  document.querySelectorAll('#tg-leaderboard-mode .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === mode);
  });
  renderLeaderboardTable(null);
  const scores = await loadLeaderboard(mode);
  renderLeaderboardTable(scores);
}

function renderLeaderboardTable(scores) {
  const el = document.getElementById('leaderboard-table-container');
  if (!leaderboardEnabled()) {
    el.innerHTML = '<p class="leaderboard-msg">Leaderboard not configured yet.</p>';
    return;
  }
  if (scores === null) {
    el.innerHTML = '<p class="leaderboard-msg">Loading…</p>';
    return;
  }
  if (scores.length === 0) {
    el.innerHTML = '<p class="leaderboard-msg">No scores yet — be the first!</p>';
    return;
  }
  const top10 = scores.sort((a, b) => b.score - a.score).slice(0, 10);
  const medal = ['🥇','🥈','🥉'];
  const diff  = { easy: '⭐', medium: '⭐⭐', hard: '⭐⭐⭐' };
  el.innerHTML = `
    <table class="lb-table">
      <thead>
        <tr>
          <th>#</th><th>Name</th><th>Score</th>
          <th>Difficulty</th><th>Correct</th><th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${top10.map((e, i) => `
          <tr class="${i < 3 ? 'lb-top3' : ''}">
            <td class="lb-rank">${medal[i] || i + 1}</td>
            <td class="lb-name">${escHtml(e.name)}</td>
            <td class="lb-score">${e.score}</td>
            <td>${diff[e.difficulty] || e.difficulty}</td>
            <td>${e.correct ?? '—'}/${e.total ?? '—'}</td>
            <td class="lb-date">${e.date || '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function translateText(text, lang) {
  if (lang === 'en') return text;
  const key = `${lang}:${text}`;
  if (descTranslateCache.has(key)) return descTranslateCache.get(key);
  try {
    const langCode = lang === 'zh' ? 'zh-CN' : lang;
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${langCode}`);
    if (r.ok) {
      const d = await r.json();
      if (d.responseStatus === 200 && d.responseData?.translatedText) {
        descTranslateCache.set(key, d.responseData.translatedText);
        return d.responseData.translatedText;
      }
    }
  } catch {}
  return text;
}

async function getWikiInfo(enTitle, lang) {
  const key = `${lang}:${enTitle}`;
  if (wikiInfoCache.has(key)) return wikiInfoCache.get(key);

  const store = v => { wikiInfoCache.set(key, v); return v; };
  const enFallback = async () => {
    try {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(enTitle)}`);
      if (r.ok) { const d = await r.json(); return { imageUrl: d.thumbnail?.source || null, translatedName: null, description: null }; }
    } catch {}
    return { imageUrl: null, translatedName: null, description: null };
  };

  try {
    if (lang === 'en') {
      return store(await enFallback());
    }

    // Step 1 — get translated title via langlinks
    const lr = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&prop=langlinks&titles=${encodeURIComponent(enTitle)}&lllang=${lang}&format=json&origin=*`
    );
    if (lr.ok) {
      const ld = await lr.json();
      const ll = Object.values(ld.query?.pages || {})[0]?.langlinks?.[0]?.['*'];
      if (ll) {
        // Step 2 — fetch summary in target language
        const sr = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(ll)}`);
        if (sr.ok) {
          const d = await sr.json();
          const result = { imageUrl: d.thumbnail?.source || null, translatedName: d.title || ll, description: d.extract || null };
          if (!result.imageUrl) result.imageUrl = (await enFallback()).imageUrl;
          return store(result);
        }
      }
    }
  } catch (e) { console.warn('Wiki info fetch failed:', e); }

  return store(await enFallback());
}


// ============================================================
// MAP INIT
// ============================================================
// Mercator-safe world bounds (poles cut off at ±85°)
const WORLD_BOUNDS = L.latLngBounds([[-85.051129, -180], [85.051129, 180]]);

const STATE_BOUNDS_OVERRIDE = {
  HI: [[18.9, -160.3], [22.2, -154.8]],
  AK: [[51.2, -170.0], [71.4, -129.9]],
};

function initMap() {
  if (map) return;

  map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 1,
    maxZoom: 8,
    zoomControl: true,
    worldCopyJump: false,
    zoomSnap: 0.25,
    dragging: false,           // locked until user zooms in
    maxBounds: WORLD_BOUNDS,
    maxBoundsViscosity: 1.0,
  });

  setTileLayer(state.mapStyle);
  renderGeoLayer();

  L.rectangle(WORLD_BOUNDS, {
    color: '#64748b',
    weight: 2,
    fill: false,
    interactive: false,
  }).addTo(map);

  // Fit world; capture the exact snapped zoom Leaflet chose as baseZoom.
  // minZoom is locked to baseZoom so the user can never zoom out further.
  map.fitBounds(WORLD_BOUNDS, { padding: [2, 2], animate: false });
  let baseZoom = map.getZoom();
  map.setMinZoom(baseZoom);

  // Dragging is only useful when zoomed in past the full-world view.
  function syncDrag() {
    if (map.getZoom() > baseZoom + 0.01) {
      map.dragging.enable();
    } else {
      map.dragging.disable();
      // Snap back to full-world view so the user is never left
      // with the world shifted off-centre after zooming out.
      map.fitBounds(WORLD_BOUNDS, { padding: [2, 2], animate: false });
    }
  }

  map.on('zoomend', syncDrag);

  // On window resize: recalculate baseZoom for the new viewport size.
  map.on('resize', () => {
    map.fitBounds(WORLD_BOUNDS, { padding: [2, 2], animate: false });
    baseZoom = map.getZoom();
    map.setMinZoom(baseZoom);
    syncDrag();
  });

  // Clicking ocean gives a hint or skips to next.
  // _layerClickHandled is set synchronously by a country layer's click handler
  // (which always fires before the map click in the same bubble chain).
  map.on('click', (e) => {
    if (_layerClickHandled) { _layerClickHandled = false; return; }
    showClickDebug(e.latlng, null, 'ocean');
    if (!state.gameActive) return;
    if (state.awaitingNext) { clickToSkip(); return; }
    if (state.gameMode === 'oceans' || state.gameMode === 'waters') { onOceanWaterClick(e.latlng); return; }
    if (state.region === 'israel' && state.gameMode === 'cities') { onIsraelCityClick(e.latlng); return; }
    showFeedback('info', t('click_country'));
    setTimeout(hideFeedback, 1200);
  });
}

function fitMapToRegion() {
  if (state.region === 'usa') {
    map.fitBounds([[24, -125], [50, -66]], { padding: [2, 2], animate: false });
  } else if (state.region === 'israel') {
    map.fitBounds([[29.4, 34.0], [33.4, 36.0]], { padding: [20, 20], animate: false });
  } else {
    map.fitBounds(WORLD_BOUNDS, { padding: [2, 2], animate: false });
  }
}

function fitMapToTarget() {
  if (state.region !== 'usa') return;
  const iso = state.targetCountry && state.targetCountry.iso3;
  const override = iso && STATE_BOUNDS_OVERRIDE[iso];
  if (override) {
    map.fitBounds(override, { padding: [30, 30], animate: true });
  } else {
    map.fitBounds([[24, -125], [50, -66]], { padding: [2, 2], animate: true });
  }
}

function setTileLayer(style) {
  if (tileLayer) map.removeLayer(tileLayer);
  const cfg = TILES[style] || TILES.solid;
  tileLayer = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: 19, noWrap: true });
  tileLayer.addTo(map);
  const lc = document.querySelector('.leaflet-container');
  if (lc) lc.style.background = cfg.bgColor;
  if (geoLayer) {
    geoLayer.bringToFront();
    geoLayer.setStyle(getDefaultStyle());
  }
}

function renderGeoLayer() {
  if (geoLayer) map.removeLayer(geoLayer);
  countryLayers = {};

  // Log first feature's properties so we can verify the ISO field name
  if (geoData && geoData.features && geoData.features.length > 0) {
    console.log('[GeoJSON] first feature properties:', geoData.features[0].properties);
  } else {
    console.warn('[GeoJSON] geoData is empty or missing!');
  }

  const activeGeoData = state.region === 'usa' ? usaGeoData : state.region === 'israel' ? israelGeoData : geoData;
  if (!activeGeoData) return;

  geoLayer = L.geoJSON(activeGeoData, {
    style: () => getDefaultStyle(),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      let rawIso;
      if (state.region === 'usa') {
        rawIso = USA_STATE_MAP[p.name] || p.name;
      } else if (state.region === 'israel') {
        rawIso = 'ISR';
      } else {
        rawIso = p['ISO3166-1-Alpha-3'] || p.ISO_A3 || p.iso_a3 || p.ISO3 || p.iso3 || p.ADM0_A3;
      }
      if (!rawIso || rawIso === '-99') return;
      const iso = ISO_REMAP[rawIso] || rawIso;

      if (!countryLayers[iso]) countryLayers[iso] = [];
      countryLayers[iso].push(layer);

      // Israel: non-interactive so all clicks bubble to map for city proximity detection
      if (state.region === 'israel') {
        layer.options.bubblingMouseEvents = true;
        return;
      }

      layer.options.bubblingMouseEvents = false;

      layer.on('click', (e) => {
        _layerClickHandled = true;
        const meta = countriesMeta.find(c => c.iso3 === iso);
        const countryName = meta ? (meta.name[state.lang] || meta.name.en) : iso;
        let result = 'inactive';
        if (state.gameActive && !state.awaitingNext && state.targetCountry) {
          const t = state.targetCountry;
          if (state.gameMode === 'oceans') {
            if (t.type === 'river' && t.countries) {
              result = (t.countries.includes(iso) || isInOceanBounds(e.latlng, t)) ? 'correct' : 'wrong';
            } else {
              result = isInOceanBounds(e.latlng, t) ? 'correct' : 'wrong';
            }
          } else {
            result = iso === t.iso3 ? 'correct' : 'wrong';
          }
        }
        showClickDebug(e.latlng, countryName, result);
        if (!state.gameActive) return;
        if (state.awaitingNext) { clickToSkip(); return; }
        if (state.gameMode === 'oceans') {
          const target = state.targetCountry;
          if (target && target.type === 'river' && target.countries) {
            if (target.countries.includes(iso) || isInOceanBounds(e.latlng, target)) {
              handleCorrect();
            } else {
              handleWrong(iso);
            }
          } else {
            onOceanWaterClick(e.latlng);
          }
          return;
        }
        onCountryClick(iso);
      });

      layer.on('mouseover', () => {
        if (state.gameActive && !state.awaitingNext) {
          const hoverColor = state.mapStyle === 'solid' ? '#f0c040' : '#475569';
          layer.setStyle({ fillOpacity: 0.6, fillColor: hoverColor });
        }
      });

      layer.on('mouseout', () => {
        if (state.gameActive && !state.awaitingNext) {
          geoLayer.resetStyle(layer);
        }
      });
    },
  }).addTo(map);

  console.log(`[GeoJSON] ${Object.keys(countryLayers).length} country layers registered. Sample ISOs:`, Object.keys(countryLayers).slice(0, 8));
}

function getDefaultStyle() {
  if (state.mapStyle === 'solid') {
    return {
      fillColor: '#90c46e',
      fillOpacity: 0.6,
      color: state.borders ? '#4a7a3a' : 'transparent',
      weight: state.borders ? 1.0 : 0,
    };
  }
  return {
    fillColor: '#1e3a5f',
    fillOpacity: 0.4,
    color: state.borders ? '#334155' : 'transparent',
    weight: state.borders ? 0.8 : 0,
  };
}

function applyBorders() {
  if (!geoLayer) return;
  geoLayer.setStyle(getDefaultStyle());
}

function highlightCountry(iso, color, permanent = false) {
  const layers = countryLayers[iso];
  if (!layers || !layers.length) return;
  layers.forEach(layer => {
    layer.setStyle({ fillColor: color, fillOpacity: 0.75, color: '#fff', weight: 2 });
    if (!permanent) {
      setTimeout(() => {
        if (geoLayer) geoLayer.resetStyle(layer);
      }, 1600);
    }
  });
}

function resetAllCountryStyles() {
  if (!geoLayer) return;
  geoLayer.eachLayer(layer => geoLayer.resetStyle(layer));
}

function scheduleNext(delay, fn) {
  if (awaitTimeout) clearTimeout(awaitTimeout);
  awaitResolveFn = fn;
  awaitTimeout = setTimeout(() => {
    awaitTimeout = null;
    awaitResolveFn = null;
    fn();
  }, delay);
}

function clickToSkip() {
  document.getElementById('btn-training-next').classList.add('hidden');
  if (state.training) {
    resetAllCountryStyles();
    clearOceanHighlight();
    clearCityMarker();
    advanceTurn();
    return;
  }
  if (awaitTimeout !== null) {
    clearTimeout(awaitTimeout);
    const fn = awaitResolveFn;
    awaitTimeout = null;
    awaitResolveFn = null;
    hideFeedback();
    if (fn) fn();
  }
}

// ============================================================
// QUESTION TIMER
// ============================================================
function startQuestionTimer() {
  if (state.training) return;
  clearQuestionTimer();
  const total = DIFFICULTY_CONFIG[state.difficulty].time;
  const startTime = Date.now();

  const container = document.getElementById('timer-container');
  container.classList.remove('hidden');
  updateTimerUI(total, total);

  const tick = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = Math.max(0, total - elapsed);
    updateTimerUI(remaining, total);

    if (remaining <= 0) {
      clearQuestionTimer();
      if (state.gameActive && !state.awaitingNext) handleWrong(null);
      return;
    }
    questionTimerRAF = requestAnimationFrame(tick);
  };
  questionTimerRAF = requestAnimationFrame(tick);
}

function clearQuestionTimer() {
  if (questionTimerRAF !== null) {
    cancelAnimationFrame(questionTimerRAF);
    questionTimerRAF = null;
  }
  const el = document.getElementById('timer-container');
  if (el) el.classList.add('hidden');
}

function updateTimerUI(remaining, total) {
  const fill  = document.getElementById('timer-fill');
  const label = document.getElementById('timer-label');
  if (!fill || !label) return;
  const pct = (remaining / total) * 100;
  fill.style.width = `${pct}%`;
  label.textContent = Math.ceil(remaining);
  const color = pct > 50 ? 'var(--green)' : pct > 25 ? 'var(--yellow)' : 'var(--red)';
  fill.style.background = color;
  label.style.color = color;
}

// ============================================================
// OCEAN HELPERS
// ============================================================
function isInOceanBounds(latlng, ocean) {
  const { lat, lng } = latlng;
  const { latMin, latMax, lngMin, lngMax, crossesDateLine } = ocean.bounds;
  if (lat < latMin || lat > latMax) return false;
  if (crossesDateLine) return lng >= lngMin || lng <= lngMax;
  return lng >= lngMin && lng <= lngMax;
}

function highlightOcean(ocean, color, permanent = false) {
  clearOceanHighlight();
  const radii = { easy: 2200000, medium: 1100000, hard: 650000 };
  oceanHighlightLayer = L.circle(ocean.center, {
    radius: radii[ocean.difficulty] || 1000000,
    color, fillColor: color, fillOpacity: 0.35, weight: 2, interactive: false,
  }).addTo(map);
  if (!permanent) {
    setTimeout(clearOceanHighlight, 1700);
  }
}

function clearOceanHighlight() {
  if (oceanHighlightLayer) { map.removeLayer(oceanHighlightLayer); oceanHighlightLayer = null; }
}

function onOceanWaterClick(latlng) {
  if (!state.gameActive || state.awaitingNext) return;
  if (isInOceanBounds(latlng, state.targetCountry)) {
    handleCorrect();
  } else {
    handleWrong(null);
  }
}

function onIsraelCityClick(latlng) {
  if (!state.gameActive || state.awaitingNext) return;
  const city = state.targetCountry;
  const dist = latlng.distanceTo(L.latLng(city.center[0], city.center[1]));
  const radius = { easy: 30000, medium: 15000, hard: 8000 };
  if (dist <= (radius[state.difficulty] || 15000)) {
    handleCorrect();
  } else {
    handleWrong(null);
  }
}

function showCityMarker(city, color, permanent = false) {
  clearCityMarker();
  cityMarkerLayer = L.circleMarker(L.latLng(city.center[0], city.center[1]), {
    radius: 14, color, fillColor: color, fillOpacity: 0.7, weight: 3, interactive: false,
  }).addTo(map);
  if (!permanent) setTimeout(clearCityMarker, 1700);
}

function clearCityMarker() {
  if (cityMarkerLayer) { map.removeLayer(cityMarkerLayer); cityMarkerLayer = null; }
}

// ============================================================
// PANELS / SCREENS
// ============================================================
function showPanel(name) {
  const panels = ['lang', 'region', 'home', 'setup', 'results', 'perfect', 'leaderboard'];
  panels.forEach(p => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.classList.add('hidden');
  });
  const hud = document.getElementById('hud');
  hud.classList.add('hidden');

  if (name === 'home') loadAndShowStats();

  if (name === 'game') {
    hud.classList.remove('hidden');
  } else if (name === 'results') {
    hud.classList.remove('hidden'); // keep map visible under results
    document.getElementById('panel-results').classList.remove('hidden');
  } else {
    const el = document.getElementById(`panel-${name}`);
    if (el) el.classList.remove('hidden');
  }
}

// ============================================================
// SETUP SCREEN
// ============================================================
function initSetupScreen() {
  setupToggleGroup('tg-mapstyle', val => {
    state.mapStyle = val;
    if (map) setTileLayer(val);
  });

  setupToggleGroup('tg-borders', val => {
    state.borders = val === 'on';
    applyBorders();
  });

  updateSetupModes();
  document.getElementById('sel-area-filter').addEventListener('change', e => {
    if (state.region === 'usa') {
      state.waterStateFilter = e.target.value;
    } else {
      state.israelAreaFilter = e.target.value;
    }
  });
  setupToggleGroup('tg-training', val => { state.training = val === 'training'; });
  setupToggleGroup('tg-difficulty', val => { state.difficulty = val; });

  setupToggleGroup('tg-players', val => {
    state.numPlayers = parseInt(val);
    renderPlayerInputs();
  });

  renderPlayerInputs();
}

function updateSetupModes() {
  const group = document.getElementById('tg-mode');
  const defs = state.region === 'usa'
    ? [['states','mode_states'],['capitals','mode_capitals'],['landmarks','mode_landmarks'],['waters','mode_waters']]
    : state.region === 'israel'
    ? [['cities','mode_cities'],['landmarks','mode_landmarks'],['waters','mode_waters']]
    : [['countries','mode_countries'],['flags','mode_flags'],['capitals','mode_capitals'],['landmarks','mode_landmarks'],['oceans','mode_oceans']];

  group.innerHTML = defs.map(([val, key], i) =>
    `<button class="toggle-btn${i === 0 ? ' active' : ''}" data-value="${val}" data-i18n="${key}">${t(key)}</button>`
  ).join('');
  state.gameMode = defs[0][0];

  setupToggleGroup('tg-mode', val => {
    state.gameMode = val;
    updateAreaFilterRow();
  });
  updateAreaFilterRow();
}

function updateAreaFilterRow() {
  const row = document.getElementById('row-area-filter');
  if (!row) return;
  const usaWaters = state.region === 'usa' && state.gameMode === 'waters';
  const israelMode = state.region === 'israel' && (state.gameMode === 'cities' || state.gameMode === 'waters');
  const visible = usaWaters || israelMode;
  row.classList.toggle('hidden', !visible);
  if (!visible) {
    state.waterStateFilter = 'all';
    state.israelAreaFilter = 'all';
    return;
  }
  const label = row.querySelector('label');
  const sel = document.getElementById('sel-area-filter');
  if (usaWaters) {
    label.setAttribute('data-i18n', 'filter_state');
    label.textContent = t('filter_state');
    const stateSet = new Set();
    usaWatersData.forEach(w => { if (w.states) w.states.forEach(s => stateSet.add(s)); });
    const relevant = usaStatesData
      .filter(s => stateSet.has(s.iso3))
      .sort((a, b) => (a.name[state.lang] || a.name.en).localeCompare(b.name[state.lang] || b.name.en));
    sel.innerHTML = `<option value="all">${t('all_states')}</option>` +
      relevant.map(s => `<option value="${s.iso3}">${s.name[state.lang] || s.name.en}</option>`).join('');
    sel.value = state.waterStateFilter;
  } else {
    label.setAttribute('data-i18n', 'filter_area');
    label.textContent = t('filter_area');
    const areaSet = new Set();
    if (state.gameMode === 'cities') {
      israelCitiesData.forEach(c => { if (c.area) areaSet.add(c.area); });
    } else {
      israelWatersData.forEach(w => { if (w.areas) w.areas.forEach(a => areaSet.add(a)); });
    }
    const relevant = ISRAEL_AREAS.filter(a => areaSet.has(a.id));
    state.israelAreaFilter = 'all';
    sel.innerHTML = `<option value="all">${t('all_areas')}</option>` +
      relevant.map(a => `<option value="${a.id}">${a.name[state.lang] || a.name.en}</option>`).join('');
    sel.value = 'all';
  }
}

function setupToggleGroup(groupId, onChange) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onChange(btn.dataset.value);
  });
}

function renderPlayerInputs() {
  const container = document.getElementById('player-names');
  container.innerHTML = '';
  if (state.numPlayers <= 1) return;

  for (let i = 1; i <= state.numPlayers; i++) {
    const row = document.createElement('div');
    row.className = 'player-input-row';

    const num = document.createElement('div');
    num.className = 'player-input-num';
    num.textContent = i;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.placeholder = t('enter_name') || `Player ${i}`;
    input.dataset.player = i;
    input.maxLength = 20;

    row.appendChild(num);
    row.appendChild(input);
    container.appendChild(row);
  }
}

// ============================================================
// GAME ENGINE
// ============================================================
function startGame() {
  // Training mode: always single player, no scoring
  if (state.training) state.numPlayers = 1;

  // Collect player names
  state.players = [];
  for (let i = 1; i <= state.numPlayers; i++) {
    const input = document.querySelector(`[data-player="${i}"]`);
    const rawName = input ? input.value.trim() : '';
    const name = rawName || `${t('player')} ${i}`;
    state.players.push({ name, score: 0, strikes: 0, eliminated: false, wrongCountries: [] });
  }

  // Build question pool — all countries included, weighted by difficulty
  state.questionPool = buildQuestionPool();

  state.questionIdx = 0;
  state.currentPlayerIdx = 0;
  state.gameActive = true;
  state.awaitingNext = false;

  initMap();
  renderGeoLayer();
  fitMapToRegion();
  resetAllCountryStyles();
  applyBorders();
  setTileLayer(state.mapStyle);
  showPanel('game');
  document.getElementById('scoreboard').classList.toggle('hidden', state.training);
  updateScoreboard();
  if (!state.training) incrementStat('gamesPlayed');
  nextQuestion();
}

// ISO codes to merge into another country (key → value).
// These regions will be treated as clicks on the target country.
const ISO_REMAP = { PSE: 'ISR' };

// Weights per country-difficulty for each selected difficulty level.
// Easy mode:   easy=8, medium=3, hard=1  → mostly easy countries
// Medium mode: easy=3, medium=4, hard=3  → balanced
// Hard mode:   easy=1, medium=2, hard=5  → mostly hard countries
const DIFFICULTY_WEIGHTS = {
  easy:   { easy: 8, medium: 3, hard: 1 },
  medium: { easy: 3, medium: 4, hard: 3 },
  hard:   { easy: 1, medium: 2, hard: 5 },
};

const DIFFICULTY_CONFIG = {
  easy:   { lives: 3, points: 1, time: 20 },
  medium: { lives: 2, points: 2, time: 13 },
  hard:   { lives: 1, points: 3, time: 7 },
};

function buildQuestionPool() {
  const w = DIFFICULTY_WEIGHTS[state.difficulty];
  if (state.gameMode === 'landmarks') {
    return weightedShuffle(getActiveLandmarksData(), c => w[c.difficulty] || 1);
  }
  if (state.gameMode === 'oceans' || state.gameMode === 'waters') {
    let watersData = getActiveWatersData();
    if (state.region === 'usa' && state.waterStateFilter !== 'all') {
      watersData = watersData.filter(item => item.states && item.states.includes(state.waterStateFilter));
    }
    if (state.region === 'israel' && state.israelAreaFilter !== 'all') {
      watersData = watersData.filter(item => item.areas && item.areas.includes(state.israelAreaFilter));
    }
    return weightedShuffle(watersData, c => w[c.difficulty] || 1);
  }
  if (state.gameMode === 'cities') {
    let citiesData = israelCitiesData;
    if (state.israelAreaFilter !== 'all') {
      citiesData = citiesData.filter(c => c.area === state.israelAreaFilter);
    }
    return weightedShuffle(citiesData, c => w[c.difficulty] || 1);
  }
  const data = getActiveEntityData();
  const seen = new Set();
  return weightedShuffle(data, c => w[c.difficulty] || 1)
    .filter(c => seen.has(c.iso3) ? false : (seen.add(c.iso3), true));
}

// Weighted random permutation (reservoir sampling, A-Res algorithm).
// Each item gets key = rand^(1/weight); sort descending → weighted shuffle.
function weightedShuffle(items, weightFn) {
  return items
    .map(item => ({ item, key: Math.random() ** (1 / weightFn(item)) }))
    .sort((a, b) => b.key - a.key)
    .map(w => w.item);
}

function buildActivePlayers() {
  return state.players.filter(p => !p.eliminated);
}

function nextQuestion() {
  const active = buildActivePlayers();

  if (active.length === 0) {
    endGame('last_standing');
    return;
  }

  if (state.questionIdx >= state.questionPool.length) {
    endGame('questions_done');
    return;
  }

  // Advance to next non-eliminated player
  let attempts = 0;
  while (state.players[state.currentPlayerIdx].eliminated) {
    state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.numPlayers;
    if (++attempts > state.numPlayers) break;
  }

  state.targetCountry = state.questionPool[state.questionIdx++];
  state.awaitingNext = false;
  fitMapToTarget();

  // Pre-fetch next landmark info while player answers current question
  if (state.gameMode === 'landmarks') {
    const next = state.questionPool[state.questionIdx];
    if (next) getWikiInfo(next.wikipedia || next.name, state.lang);
  }

  sounds.newQuestion();
  updatePromptCard();
  updateScoreboard();
  updateGameHeader();
  if (state.training) {
    showTrainingAnswer();
  } else {
    startQuestionTimer();
  }
}

function showTrainingAnswer() {
  state.awaitingNext = true;
  const item = state.targetCountry;
  if (state.gameMode === 'oceans' || state.gameMode === 'waters') {
    highlightOcean(item, '#4a90d9', true);
  } else if (state.gameMode === 'cities') {
    showCityMarker(item, '#4a90d9', true);
  } else if (item.iso3) {
    highlightCountry(item.iso3, '#4a90d9', true);
  }
  document.getElementById('btn-training-next').classList.remove('hidden');
}

function onCountryClick(iso) {
  if (!state.gameActive || state.awaitingNext) return;
  if (!state.targetCountry) return;
  if (iso === state.targetCountry.iso3) {
    handleCorrect();
  } else {
    handleWrong(iso);
  }
}

function handleCorrect() {
  clearQuestionTimer();
  const player = state.players[state.currentPlayerIdx];
  player.score += DIFFICULTY_CONFIG[state.difficulty].points;

  incrementStat('locationsFound');
  sounds.correct();
  if (state.gameMode === 'oceans' || state.gameMode === 'waters') {
    highlightOcean(state.targetCountry, '#22c55e');
  } else if (state.gameMode === 'cities') {
    showCityMarker(state.targetCountry, '#22c55e');
  } else {
    highlightCountry(state.targetCountry.iso3, '#22c55e');
  }
  showFeedback('correct', `✅ ${t('correct')}!`);
  state.awaitingNext = true;

  scheduleNext(1500, () => {
    hideFeedback();
    advanceTurn();
  });
}

function handleWrong(clickedIso) {
  if (!state.gameActive || state.awaitingNext) return;
  clearQuestionTimer();

  const player = state.players[state.currentPlayerIdx];
  player.strikes++;
  const isWater = state.gameMode === 'oceans' || state.gameMode === 'waters';
  const wrongId = isWater ? state.targetCountry.id
    : state.gameMode === 'cities' ? state.targetCountry.id
    : state.targetCountry.iso3;
  if (!player.wrongCountries.includes(wrongId)) player.wrongCountries.push(wrongId);

  const isTimeout = clickedIso === null;
  if (isWater) {
    highlightOcean(state.targetCountry, '#f97316');
  } else if (state.gameMode === 'cities') {
    showCityMarker(state.targetCountry, '#f97316');
  } else {
    if (!isTimeout) highlightCountry(clickedIso, '#ef4444');
    highlightCountry(state.targetCountry.iso3, '#f97316');
  }

  state.awaitingNext = true;

  if (player.strikes >= DIFFICULTY_CONFIG[state.difficulty].lives) {
    player.eliminated = true;
    sounds.eliminated();
    const elimMsg = isTimeout
      ? `⏰ ${player.name} — time's up! Eliminated!`
      : `💀 ${player.name} ${t('eliminated')}!`;
    showFeedback('eliminated', elimMsg);
    updateScoreboard();

    scheduleNext(2000, () => {
      hideFeedback();
      const remaining = buildActivePlayers();
      if (remaining.length <= (state.numPlayers > 1 ? 1 : 0)) {
        endGame('last_standing');
      } else {
        advanceTurn();
      }
    });
  } else {
    sounds.wrong();
    const left = DIFFICULTY_CONFIG[state.difficulty].lives - player.strikes;
    const wrongMsg = isTimeout
      ? `⏰ Time's up! ${left} ${t('lives_left')}`
      : `❌ ${t('wrong')}! ${left} ${t('lives_left')}`;
    showFeedback('wrong', wrongMsg);
    updateScoreboard();

    scheduleNext(1500, () => {
      hideFeedback();
      advanceTurn();
    });
  }
}

function advanceTurn() {
  state.awaitingNext = false;

  // Rotate to next player
  const startIdx = state.currentPlayerIdx;
  let rotations = 0;
  do {
    state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.numPlayers;
    rotations++;
  } while (state.players[state.currentPlayerIdx].eliminated && rotations < state.numPlayers);

  nextQuestion();
}

function endGame(reason) {
  state.gameActive = false;
  clearQuestionTimer();
  clearOceanHighlight();
  clearCityMarker();
  document.getElementById('btn-training-next').classList.add('hidden');
  if (awaitTimeout) { clearTimeout(awaitTimeout); awaitTimeout = null; awaitResolveFn = null; }

  if (state.training) {
    showTrainingComplete();
    return;
  }

  // Perfect single-player game
  if (state.numPlayers === 1 &&
      state.players[0].strikes === 0 &&
      reason === 'questions_done') {
    setTimeout(() => sounds.perfect(), 300);
    showPerfectScreen();
    setTimeout(() => checkLeaderboardQualification(), 800);
    return;
  }

  setTimeout(() => sounds.gameOver(), 300);
  showResultsScreen(reason);
  setTimeout(() => checkLeaderboardQualification(), 800);
}

function showTrainingComplete() {
  showPanel('results');
  document.getElementById('results-title').textContent = `✅ ${t('training_done')}`;
  document.getElementById('results-scores').innerHTML = `<p class="training-complete-msg">${state.questionPool.length} ${t('training_items_reviewed')}</p>`;
  document.getElementById('wrong-label').classList.add('hidden');
  document.getElementById('wrong-list').innerHTML = '';
}

// ============================================================
// RESULTS
// ============================================================
function showResultsScreen(reason) {
  showPanel('results');

  const sorted = [...state.players].sort((a, b) => b.score - a.score);

  // Title
  const titleEl = document.getElementById('results-title');
  if (reason === 'manual') {
    titleEl.textContent = `📊 ${t('final_scores')}`;
  } else if (reason === 'last_standing' && state.numPlayers > 1) {
    const winner = sorted.find(p => !p.eliminated) || sorted[0];
    titleEl.textContent = `🏆 ${winner.name} ${t('wins')}!`;
  } else {
    titleEl.textContent = `🎮 ${t('game_over')}`;
  }

  // Score rows
  const maxLives = DIFFICULTY_CONFIG[state.difficulty].lives;
  const scoresEl = document.getElementById('results-scores');
  scoresEl.innerHTML = sorted.map((p, i) => {
    const hearts = '❤️'.repeat(Math.max(0, maxLives - p.strikes)) + '🖤'.repeat(Math.min(maxLives, p.strikes));
    return `
      <div class="result-row ${p.eliminated ? 'eliminated' : ''}">
        <span class="result-rank">${i + 1}.</span>
        <span class="result-name">${escHtml(p.name)}</span>
        <span class="result-score">${p.score} ${t('points')}</span>
        <span class="result-lives">${hearts}</span>
      </div>
    `;
  }).join('');

  // Wrong countries
  const allWrong = [...new Set(state.players.flatMap(p => p.wrongCountries))];
  const wrongLabel = document.getElementById('wrong-label');
  const wrongList = document.getElementById('wrong-list');

  if (allWrong.length > 0) {
    wrongLabel.classList.remove('hidden');
    const isWaterMode = state.gameMode === 'oceans' || state.gameMode === 'waters';
    wrongLabel.textContent = isWaterMode ? t('wrong_waters')
      : state.gameMode === 'cities' ? t('wrong_cities')
      : state.region === 'usa' ? t('wrong_states')
      : t('wrong_countries');

    wrongList.innerHTML = allWrong.map(id => {
      if (isWaterMode) {
        const item = getActiveWatersData().find(o => o.id === id);
        const name = item ? (item.name[state.lang] || item.name.en) : id;
        return `<span class="wrong-tag">${escHtml(name)}</span>`;
      }
      if (state.gameMode === 'cities') {
        const city = israelCitiesData.find(c => c.id === id);
        const name = city ? (city.name[state.lang] || city.name.en) : id;
        return `<span class="wrong-tag">${escHtml(name)}</span>`;
      }
      const meta = getActiveEntityData().find(c => c.iso3 === id);
      const name = meta ? (meta.name[state.lang] || meta.name.en) : id;
      return `<span class="wrong-tag">${escHtml(name)}</span>`;
    }).join('');

    if (!isWaterMode && state.gameMode !== 'cities') {
      setTimeout(() => {
        allWrong.forEach(iso => highlightCountry(iso, '#ef4444', true));
      }, 400);
    }
  } else {
    wrongLabel.classList.add('hidden');
    wrongList.innerHTML = '';
  }
}

function showPerfectScreen() {
  showPanel('perfect');
  document.getElementById('perfect-title').textContent = `🏆 ${t('perfect_title')}`;
  document.getElementById('perfect-subtitle').textContent = t('perfect_subtitle');
  const total = state.questionPool.length;
  document.getElementById('perfect-score').textContent = `${total} / ${total}`;
}

// ============================================================
// HUD UPDATES
// ============================================================
function updatePromptCard() {
  const country = state.targetCountry;
  const lang = state.lang;
  const flagEl = document.getElementById('prompt-flag');
  const textEl = document.getElementById('prompt-text');

  flagEl.innerHTML = '';

  const countryName = typeof country.name === 'string'
    ? country.name
    : (country.name[lang] || country.name.en);

  if (state.gameMode === 'oceans' || state.gameMode === 'waters') {
    const itemName = country.name[lang] || country.name.en;
    const promptKey = country.type === 'river' ? 'find_river' : 'find_ocean';
    textEl.textContent = `${t(promptKey)}: ${itemName}`;
    return;
  }

  if (state.gameMode === 'cities') {
    textEl.textContent = state.training
      ? (country.name[lang] || country.name.en)
      : `${t('find_city')}: ${country.name[lang] || country.name.en}`;
    return;
  }

  if (state.gameMode === 'countries' || state.gameMode === 'states') {
    textEl.textContent = countryName;
  } else if (state.gameMode === 'flags') {
    flagEl.innerHTML = getFlagHtml(country.iso2);
    textEl.textContent = state.training ? countryName : t('find_flag');
  } else if (state.gameMode === 'capitals') {
    const cap = country.capital[lang] || country.capital.en;
    textEl.textContent = state.training ? `${cap} — ${countryName}` : `${t('find_capital')}: ${cap}`;
  } else if (state.gameMode === 'landmarks') {
    const snapshot = country;
    const enTitle = country.wikipedia || country.name;
    flagEl.innerHTML = '<div class="landmark-img-placeholder"></div>';
    textEl.innerHTML = `<span class="landmark-name">${escHtml(country.name)}</span><span class="landmark-desc">${escHtml(country.description)}</span>`;
    Promise.all([
      getWikiInfo(enTitle, state.lang),
      translateText(snapshot.description, state.lang)
    ]).then(([info, translatedDesc]) => {
      if (state.targetCountry !== snapshot) return;
      flagEl.innerHTML = info.imageUrl
        ? `<img class="landmark-img" src="${info.imageUrl}" alt="${escHtml(snapshot.name)}">`
        : '';
      const displayName = (state.lang !== 'en' && info.translatedName && info.translatedName !== snapshot.name)
        ? `${info.translatedName} (${snapshot.name})`
        : snapshot.name;
      textEl.innerHTML = `<span class="landmark-name">${escHtml(displayName)}</span><span class="landmark-desc">${escHtml(translatedDesc)}</span>`;
    });
  }
}

function updateScoreboard() {
  const list = document.getElementById('scoreboard-list');
  if (!list) return;

  const maxLives = DIFFICULTY_CONFIG[state.difficulty].lives;
  list.innerHTML = state.players.map((p, i) => {
    const isActive = i === state.currentPlayerIdx && !p.eliminated;
    const hearts = '❤️'.repeat(Math.max(0, maxLives - p.strikes));
    const skulls = '🖤'.repeat(Math.min(maxLives, p.strikes));
    return `
      <div class="score-item ${isActive ? 'active' : ''} ${p.eliminated ? 'eliminated' : ''}">
        <div class="score-name">${escHtml(p.name)}</div>
        <div class="score-row">
          <div class="score-val">${p.score}</div>
          <div class="score-lives">${hearts}${skulls}</div>
        </div>
      </div>
    `;
  }).join('');
}

function updateGameHeader() {
  const badge = document.getElementById('player-turn-badge');
  if (!badge) return;

  if (state.numPlayers > 1) {
    const player = state.players[state.currentPlayerIdx];
    badge.textContent = `👤 ${player.name}`;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ============================================================
// FEEDBACK
// ============================================================
function showFeedback(type, message) {
  const el = document.getElementById('feedback');
  el.className = `feedback-${type} show`;
  el.textContent = message;
  el.style.display = 'flex';
}

function hideFeedback() {
  const el = document.getElementById('feedback');
  el.className = 'hidden';
  el.style.display = '';
}

// ============================================================
// CLICK DEBUG
// ============================================================
function showClickDebug(latlng, countryName, result) {
  const el = document.getElementById('click-debug');
  const lat = latlng.lat.toFixed(3);
  const lng = latlng.lng.toFixed(3);

  let resultHtml = '';
  if (result === 'correct') {
    resultHtml = `<div class="click-debug-correct">✅ Correct!</div>`;
  } else if (result === 'wrong') {
    const target = state.targetCountry;
    const targetName = target
      ? (typeof target.name === 'string' ? target.name : (target.name[state.lang] || target.name.en))
      : '?';
    resultHtml = `<div class="click-debug-wrong">❌ Wrong — find: ${escHtml(targetName)}</div>`;
  } else if (result === 'ocean') {
    resultHtml = `<div class="click-debug-ocean">🌊 Not a country</div>`;
  }

  el.innerHTML = `
    <div class="click-debug-coord">📍 ${lat}, ${lng}</div>
    <div class="click-debug-place">${countryName ? '🌍 ' + escHtml(countryName) : '—'}</div>
    ${resultHtml}
  `;
  el.classList.remove('hidden');

  if (clickDebugTimeout) clearTimeout(clickDebugTimeout);
  clickDebugTimeout = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ============================================================
// HELPERS
// ============================================================
function getFlagHtml(iso2) {
  if (!iso2 || iso2.length !== 2) return '<span>🏳️</span>';
  const code = iso2.toLowerCase();
  return `<img class="flag-img" src="https://flagcdn.com/w160/${code}.png" alt="${code} flag">`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function initEventListeners() {
  // Language screen
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await loadI18n(btn.dataset.lang);
      renderPlayerInputs();
      sounds.startMusic();
      showPanel('region');
    });
  });

  // Region screen
  document.querySelectorAll('.region-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.region = btn.dataset.region;
      await loadDataForRegion(state.region);
      updateSetupModes();
      showPanel('home');
    });
  });

  document.getElementById('btn-change-region').addEventListener('click', () => showPanel('region'));

  // Home screen
  document.getElementById('btn-play').addEventListener('click', () => showPanel('setup'));
  document.getElementById('btn-lang').addEventListener('click', () => showPanel('lang'));

  // Setup screen
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-setup-home').addEventListener('click', () => showPanel('home'));

  // Results screen
  document.getElementById('btn-play-again').addEventListener('click', () => showPanel('setup'));
  document.getElementById('btn-results-leaderboard').addEventListener('click', () => showLeaderboard(state.gameMode));
  document.getElementById('btn-results-home').addEventListener('click', () => {
    resetAllCountryStyles();
    document.getElementById('scoreboard').classList.remove('hidden');
    showPanel('home');
  });

  // Perfect screen
  document.getElementById('btn-perfect-again').addEventListener('click', () => showPanel('setup'));
  document.getElementById('btn-perfect-leaderboard').addEventListener('click', () => showLeaderboard(state.gameMode));
  document.getElementById('btn-perfect-home').addEventListener('click', () => {
    resetAllCountryStyles();
    showPanel('home');
  });

  // Leaderboard screen
  document.getElementById('btn-open-leaderboard').addEventListener('click', () => showLeaderboard(state.gameMode || 'countries'));
  document.getElementById('btn-leaderboard-home').addEventListener('click', () => showPanel('home'));
  setupToggleGroup('tg-leaderboard-mode', val => showLeaderboard(val));

  // Finish game
  document.getElementById('btn-finish-game').addEventListener('click', () => {
    if (state.gameActive) endGame('manual');
  });

  // Training next
  document.getElementById('btn-training-next').addEventListener('click', () => {
    if (state.gameActive && state.awaitingNext) clickToSkip();
  });

  // Sound controls
  const musicBtn = document.getElementById('btn-music-toggle');
  const sfxBtn   = document.getElementById('btn-sfx-toggle');

  // Set initial state from saved prefs
  if (sounds.musicMuted) musicBtn.classList.add('muted');
  if (sounds.sfxMuted)   sfxBtn.classList.add('muted');

  musicBtn.addEventListener('click', () => {
    sounds._init();
    const muted = sounds.toggleMusic();
    musicBtn.classList.toggle('muted', muted);
  });

  sfxBtn.addEventListener('click', () => {
    sounds._init();
    const muted = sounds.toggleSfx();
    sfxBtn.classList.toggle('muted', muted);
  });
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  const loadingText = document.getElementById('loading-text');

  try {
    // Load i18n first (default English)
    loadingText.textContent = 'Loading translations...';
    await loadI18n('en');

    // Load country metadata and landmarks
    loadingText.textContent = t('loading');
    await loadCountriesMeta();
    await loadLandmarksData();
    await loadOceansData();

    // Load GeoJSON (may take a moment)
    loadingText.textContent = t('loading');
    await loadGeoData();

    // Init map in background immediately
    initMap();

    // Wire up UI
    initSetupScreen();
    initEventListeners();

    // Hide loading, show language picker
    document.getElementById('loading-overlay').classList.add('hidden');
    document.getElementById('version-label').textContent = `v${VERSION}`;
    showPanel('lang');

  } catch (err) {
    loadingText.textContent = 'Error loading data. Please refresh.';
    console.error(err);
  }
});
