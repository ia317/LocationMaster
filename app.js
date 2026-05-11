'use strict';

const VERSION = '1.0.3';

// ============================================================
// STATE
// ============================================================
const state = {
  lang: 'en',
  mapStyle: 'solid',
  borders: true,
  gameMode: 'countries',
  difficulty: 'easy',
  numPlayers: 1,
  players: [],
  currentPlayerIdx: 0,
  questionPool: [],
  questionIdx: 0,
  targetCountry: null,
  gameActive: false,
  awaitingNext: false,
};

// ============================================================
// DATA
// ============================================================
let i18n = {};
let countriesMeta = [];
let landmarksData = [];
let geoData = null;
const wikiImageCache = new Map();

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

async function getWikiImage(title) {
  if (wikiImageCache.has(title)) return wikiImageCache.get(title);
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    const url = res.ok ? ((await res.json()).thumbnail?.source || null) : null;
    wikiImageCache.set(title, url);
    return url;
  } catch {
    wikiImageCache.set(title, null);
    return null;
  }
}

// ============================================================
// MAP INIT
// ============================================================
// Mercator-safe world bounds (poles cut off at ±85°)
const WORLD_BOUNDS = L.latLngBounds([[-85.051129, -180], [85.051129, 180]]);

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
    showFeedback('info', t('click_country'));
    setTimeout(hideFeedback, 1200);
  });
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

  geoLayer = L.geoJSON(geoData, {
    style: () => getDefaultStyle(),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const iso = p['ISO3166-1-Alpha-3'] || p.ISO_A3 || p.iso_a3 || p.ISO3 || p.iso3 || p.ADM0_A3;
      if (!iso || iso === '-99') return;
      countryLayers[iso] = layer;

      layer.options.bubblingMouseEvents = false;

      layer.on('click', (e) => {
        _layerClickHandled = true;
        const meta = countriesMeta.find(c => c.iso3 === iso);
        const countryName = meta ? (meta.name[state.lang] || meta.name.en) : iso;
        let result = 'inactive';
        if (state.gameActive && !state.awaitingNext && state.targetCountry) {
          result = iso === state.targetCountry.iso3 ? 'correct' : 'wrong';
        }
        showClickDebug(e.latlng, countryName, result);
        if (!state.gameActive) return;
        if (state.awaitingNext) { clickToSkip(); return; }
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
  const layer = countryLayers[iso];
  if (!layer) return;
  layer.setStyle({ fillColor: color, fillOpacity: 0.75, color: '#fff', weight: 2 });
  if (!permanent) {
    setTimeout(() => {
      if (geoLayer) geoLayer.resetStyle(layer);
    }, 1600);
  }
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
// PANELS / SCREENS
// ============================================================
function showPanel(name) {
  const panels = ['lang', 'home', 'setup', 'results', 'perfect'];
  panels.forEach(p => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.classList.add('hidden');
  });
  const hud = document.getElementById('hud');
  hud.classList.add('hidden');

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

  setupToggleGroup('tg-mode', val => { state.gameMode = val; });
  setupToggleGroup('tg-difficulty', val => { state.difficulty = val; });

  setupToggleGroup('tg-players', val => {
    state.numPlayers = parseInt(val);
    renderPlayerInputs();
  });

  renderPlayerInputs();
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
  map.fitBounds(WORLD_BOUNDS, { padding: [2, 2], animate: false });
  resetAllCountryStyles();
  applyBorders();
  setTileLayer(state.mapStyle);
  showPanel('game');
  updateScoreboard();
  nextQuestion();
}

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
  easy:   { lives: 3, points: 1 },
  medium: { lives: 2, points: 2 },
  hard:   { lives: 1, points: 3 },
};

function buildQuestionPool() {
  const w = DIFFICULTY_WEIGHTS[state.difficulty];
  if (state.gameMode === 'landmarks') {
    return weightedShuffle(landmarksData, c => w[c.difficulty] || 1);
  }
  const seen = new Set();
  return weightedShuffle(countriesMeta, c => w[c.difficulty] || 1)
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

  // Pre-fetch next landmark image while player answers current question
  if (state.gameMode === 'landmarks') {
    const next = state.questionPool[state.questionIdx];
    if (next) getWikiImage(next.wikipedia || next.name);
  }

  sounds.newQuestion();
  updatePromptCard();
  updateScoreboard();
  updateGameHeader();
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
  const player = state.players[state.currentPlayerIdx];
  player.score += DIFFICULTY_CONFIG[state.difficulty].points;

  sounds.correct();
  highlightCountry(state.targetCountry.iso3, '#22c55e');
  showFeedback('correct', `✅ ${t('correct')}!`);
  state.awaitingNext = true;

  scheduleNext(1500, () => {
    hideFeedback();
    advanceTurn();
  });
}

function handleWrong(clickedIso) {
  const player = state.players[state.currentPlayerIdx];
  player.strikes++;
  if (!player.wrongCountries.includes(state.targetCountry.iso3)) {
    player.wrongCountries.push(state.targetCountry.iso3);
  }

  // Show where they clicked (red) and correct answer (orange)
  highlightCountry(clickedIso, '#ef4444');
  highlightCountry(state.targetCountry.iso3, '#f97316');

  state.awaitingNext = true;

  if (player.strikes >= DIFFICULTY_CONFIG[state.difficulty].lives) {
    player.eliminated = true;
    sounds.eliminated();
    showFeedback('eliminated', `💀 ${player.name} ${t('eliminated')}!`);
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
    showFeedback('wrong', `❌ ${t('wrong')}! ${left} ${t('lives_left')}`);
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
  if (awaitTimeout) { clearTimeout(awaitTimeout); awaitTimeout = null; awaitResolveFn = null; }

  // Perfect single-player game
  if (state.numPlayers === 1 &&
      state.players[0].strikes === 0 &&
      reason === 'questions_done') {
    setTimeout(() => sounds.perfect(), 300);
    showPerfectScreen();
    return;
  }

  setTimeout(() => sounds.gameOver(), 300);
  showResultsScreen(reason);
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
    wrongList.innerHTML = allWrong.map(iso => {
      const meta = countriesMeta.find(c => c.iso3 === iso);
      const name = meta ? (meta.name[state.lang] || meta.name.en) : iso;
      return `<span class="wrong-tag">${escHtml(name)}</span>`;
    }).join('');

    // Highlight on map
    setTimeout(() => {
      allWrong.forEach(iso => highlightCountry(iso, '#ef4444', true));
    }, 400);
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

  if (state.gameMode === 'countries') {
    textEl.textContent = `${t('find_country')}: ${countryName}`;
  } else if (state.gameMode === 'flags') {
    flagEl.innerHTML = getFlagHtml(country.iso2);
    textEl.textContent = `${t('find_country')}: ${countryName}`;
  } else if (state.gameMode === 'capitals') {
    const cap = country.capital[lang] || country.capital.en;
    textEl.textContent = `${t('find_capital')}: ${cap} (${countryName})`;
  } else if (state.gameMode === 'landmarks') {
    const snapshot = country;
    flagEl.innerHTML = '<div class="landmark-img-placeholder"></div>';
    textEl.innerHTML = `<span class="landmark-name">${escHtml(country.name)}</span><span class="landmark-desc">${escHtml(country.description)}</span>`;
    getWikiImage(country.wikipedia || country.name).then(url => {
      if (state.targetCountry !== snapshot) return;
      flagEl.innerHTML = url
        ? `<img class="landmark-img" src="${url}" alt="${escHtml(snapshot.name)}">`
        : '';
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
      // First user gesture — init audio and start music
      sounds.startMusic();
      showPanel('home');
    });
  });

  // Home screen
  document.getElementById('btn-play').addEventListener('click', () => showPanel('setup'));
  document.getElementById('btn-lang').addEventListener('click', () => showPanel('lang'));

  // Setup screen
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-setup-home').addEventListener('click', () => showPanel('home'));

  // Results screen
  document.getElementById('btn-play-again').addEventListener('click', () => showPanel('setup'));
  document.getElementById('btn-results-home').addEventListener('click', () => {
    resetAllCountryStyles();
    showPanel('home');
  });

  // Perfect screen
  document.getElementById('btn-perfect-again').addEventListener('click', () => showPanel('setup'));
  document.getElementById('btn-perfect-home').addEventListener('click', () => {
    resetAllCountryStyles();
    showPanel('home');
  });

  // Finish game
  document.getElementById('btn-finish-game').addEventListener('click', () => {
    if (state.gameActive) endGame('manual');
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
