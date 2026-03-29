/* ══════════════════════════════════════════════
   FIREBASE
══════════════════════════════════════════════ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword,
  signOut as fbSignOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  getFirestore, collection, doc,
  addDoc, setDoc, deleteDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCfyn1WF-Gm5ii4jiOFqyRkk-8a-alLFAQ",
  authDomain: "moodex-812b1.firebaseapp.com",
  projectId: "moodex-812b1",
  storageBucket: "moodex-812b1.firebasestorage.app",
  messagingSenderId: "409905813575",
  appId: "1:409905813575:web:97e025803906678f94f962"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const MOODS = [
  { id:'happy',    emoji:'😊', icon:'fa-face-smile',       unicode:'\uf118', label:'Happy',    color:'#FFD93D' },
  { id:'excited',  emoji:'🤩', icon:'fa-face-grin-stars',  unicode:'\uf587', label:'Excited',  color:'#FF922B' },
  { id:'grateful', emoji:'🙏', icon:'fa-hands-praying',    unicode:'\ue4f9', label:'Grateful', color:'#FF6EB4' },
  { id:'calm',     emoji:'😌', icon:'fa-face-smile-beam',  unicode:'\uf5b8', label:'Calm',     color:'#6BCB77' },
  { id:'sad',      emoji:'😢', icon:'fa-face-sad-tear',    unicode:'\uf5b4', label:'Sad',      color:'#6C9BCF' },
  { id:'anxious',  emoji:'😰', icon:'fa-face-grimace',     unicode:'\uf57f', label:'Anxious',  color:'#A66CFF' },
  { id:'angry',    emoji:'😠', icon:'fa-face-angry',       unicode:'\uf556', label:'Angry',    color:'#FF6B6B' },
  { id:'tired',    emoji:'😴', icon:'fa-face-tired',       unicode:'\uf5c8', label:'Tired',    color:'#99A0AE' },
];
const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const PAGE_ORDER = ['log', 'track', 'settings'];

/* ══════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════ */
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Returns local YYYY-MM-DD for a Date object or ISO timestamp string
function localDateStr(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
let entries            = [];
let currentUser        = null;
let unsubscribeEntries = null;
let appInitialized     = false;

let pickedMoods  = new Map();
let curPage      = 'log';
let curTrackTab  = 'overview';
let calY, calM;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let _radarTween = null;

/* ══════════════════════════════════════════════
   SPLASH
══════════════════════════════════════════════ */
const _splashAnim = lottie.loadAnimation({
  container: document.getElementById('splash-lottie'),
  renderer: 'svg',
  loop: false,
  autoplay: true,
  path: 'assets/loading.json'
});
_splashAnim.setSpeed(4);

let _splashUsed  = false;
let _zoomStarted = false;
let _zoomDone    = false;
let _authReveal  = null;

function _maybeReveal() {
  if (!_zoomDone || !_authReveal) return;
  document.getElementById('splash-screen').style.display = 'none';
  _splashAnim.destroy();
  _authReveal();
}

function _startZoom() {
  if (_zoomStarted) return;
  _zoomStarted = true;
  if (reducedMotion) { _zoomDone = true; _maybeReveal(); return; }
  gsap.to(document.getElementById('splash-lottie'), {
    scale: 12, opacity: 0, duration: 0.55, ease: 'power2.in',
    onComplete: () => { _zoomDone = true; _maybeReveal(); }
  });
}

_splashAnim.addEventListener('enterFrame', e => {
  if ((e.currentTime / _splashAnim.totalFrames) >= 0.65) _startZoom();
});

// Fallback: if animation completes before enterFrame hits 65%
_splashAnim.addEventListener('complete', () => _startZoom());

function hideSplash(revealFn) {
  if (_splashUsed) { revealFn(); return; }
  _splashUsed = true;
  _authReveal = revealFn;
  _maybeReveal();
}

/* ══════════════════════════════════════════════
   AUTH — SCREEN MANAGEMENT
══════════════════════════════════════════════ */
function showLogin() {
  hideSplash(() => {
    document.getElementById('app').style.display = 'none';
    document.getElementById('bottomNav').style.display = 'none';
    document.getElementById('loginErr').textContent = '';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPass').value = '';

    const screen = document.getElementById('login-screen');
    screen.style.display = 'flex';

    const items = screen.querySelectorAll('.logo, .login-sub, .login-input, .login-err, .log-btn');
    gsap.fromTo(items,
      { opacity: 0, y: 32 },
      { opacity: 1, y: 0, duration: 0.75, ease: 'power2.out', stagger: 0.13, delay: 0.15 }
    );
  });
}

function showApp(user) {
  hideSplash(() => {
    document.getElementById('login-screen').style.display = 'none';

    if (!reducedMotion) {
      // Pre-hide before revealing to prevent flash-of-visible-content
      gsap.set('.app-header', { y: -20, opacity: 0 });
      gsap.set('#page-log .mood-btn', { y: 20, opacity: 0 });
      gsap.set('#page-log .journal-card, #logBtn', { y: 20, opacity: 0 });
    }

    document.getElementById('app').style.display = 'flex';
    document.getElementById('bottomNav').style.display = '';
    document.getElementById('userEmailSub').textContent = user.email;

    if (!reducedMotion) {
      gsap.to('.app-header', { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' });
      gsap.to('#page-log .mood-btn', { y: 0, opacity: 1, stagger: 0.04, duration: 0.4, delay: 0.15, ease: 'power2.out' });
      gsap.to('#page-log .journal-card, #logBtn', { y: 0, opacity: 1, stagger: 0.08, duration: 0.4, delay: 0.3, ease: 'power2.out', clearProps: 'all' });
    }
  });
}

async function doSignIn() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const btn   = document.getElementById('loginBtn');
  const err   = document.getElementById('loginErr');

  if (!email || !pass) { err.textContent = 'Please enter email and password.'; return; }

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  err.textContent = '';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    err.textContent = friendlyAuthError(e.code);
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function doSignOut() {
  if (unsubscribeEntries) { unsubscribeEntries(); unsubscribeEntries = null; }
  entries = [];
  await fbSignOut(auth);
}

function friendlyAuthError(code) {
  const map = {
    'auth/invalid-email':       'Invalid email address.',
    'auth/user-not-found':      'No account found with that email.',
    'auth/wrong-password':      'Incorrect password.',
    'auth/invalid-credential':  'Incorrect email or password.',
    'auth/too-many-requests':   'Too many attempts. Try again later.',
  };
  return map[code] || 'Sign in failed. Please try again.';
}

/* ══════════════════════════════════════════════
   FIRESTORE — ENTRIES
══════════════════════════════════════════════ */
function subscribeEntries(uid) {
  if (unsubscribeEntries) unsubscribeEntries();

  const q = query(
    collection(db, 'users', uid, 'entries'),
    orderBy('ts', 'desc')
  );

  unsubscribeEntries = onSnapshot(q, snapshot => {
    entries = snapshot.docs.map(d => ({ ...d.data(), _docId: d.id }));
    updateStreak();
    if (curPage === 'track') renderTrackPage();
  }, err => {
    console.error('Firestore sync error:', err);
    showToast('Sync error — check your connection.');
  });
}

async function migrateLocalStorage(uid) {
  const raw = localStorage.getItem('moodex');
  if (!raw) return;
  let localEntries;
  try { localEntries = JSON.parse(raw); } catch { return; }
  if (!localEntries.length) return;

  // Normalize legacy single-mood entries
  const normalized = localEntries.map(e => {
    if (e.moods) return e;
    return { id: e.id, moods: [{ id: e.mood, intensity: e.intensity }], note: e.note || '', ts: e.ts };
  });

  const colRef = collection(db, 'users', uid, 'entries');
  for (const entry of normalized) {
    await setDoc(doc(colRef, String(entry.id)), entry);
  }

  localStorage.removeItem('moodex');
  showToast(`Migrated ${normalized.length} entries to cloud ☁️`);
}

/* ══════════════════════════════════════════════
   AUTH STATE OBSERVER
══════════════════════════════════════════════ */
onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    showApp(user);
    migrateLocalStorage(user.uid);
    subscribeEntries(user.uid);
    if (!appInitialized) {
      initApp();
      appInitialized = true;
    }
  } else {
    currentUser = null;
    showLogin();
  }
});

/* ══════════════════════════════════════════════
   INIT APP
══════════════════════════════════════════════ */
function getHeroGreeting() {
  const h = new Date().getHours();
  const pools = {
    deep_night: [
      "Still awake? Your feelings are too.",
      "3am called. It wants a check-in.",
      "Sleeping is overrated anyway.",
      "Night owls feel things hardest. Fact.",
      "The quiet hours found you.",
    ],
    morning: [
      "Good morning! How's the damage?",
      "You woke up and chose feelings. Bold.",
      "Rise and feel, bestie.",
      "Morning check-in. Be honest.",
      "The day is young. So are you (relatively).",
    ],
    afternoon: [
      "Midday check-in. No lies.",
      "How are we holding up, honestly?",
      "Afternoon feelings? Absolutely valid.",
      "Post-lunch emotional weather report.",
      "The day isn't done with you yet.",
    ],
    evening: [
      "Almost survived another one. How was it?",
      "Day complete. Debrief time.",
      "Evening feelings are the most honest.",
      "The day is winding down. Spill.",
      "End-of-day check-in. No filter.",
    ],
  };
  let pool;
  if (h < 5)       pool = pools.deep_night;
  else if (h < 12) pool = pools.morning;
  else if (h < 18) pool = pools.afternoon;
  else             pool = pools.evening;
  return pool[Math.floor(Math.random() * pool.length)];
}

function initApp() {
  const now = new Date();
  calY = now.getFullYear(); calM = now.getMonth();

  document.getElementById('logHero').textContent = getHeroGreeting();

  // Mood grid
  const grid = document.getElementById('moodGrid');
  MOODS.forEach(m => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'mood-btn';
    el.style.setProperty('--mc', m.color);
    el.dataset.id = m.id;
    el.setAttribute('aria-pressed', 'false');
    el.innerHTML = `<span class="m-icon" aria-hidden="true"><i class="fa-solid ${m.icon}"></i></span><span class="m-label">${m.label}</span>
      <span class="m-check" aria-hidden="true"><svg viewBox="0 0 10 8"><polyline points="1,4 4,7 9,1" fill="none"/></svg></span>`;
    el.addEventListener('click', () => toggleMood(m.id, el));
    grid.appendChild(el);
  });

  document.getElementById('journalTa').addEventListener('input', function() {
    document.getElementById('cCount').textContent = this.value.length;
  });

  document.getElementById('editJournalTa').addEventListener('input', function() {
    document.getElementById('editCCount').textContent = this.value.length;
  });
  document.getElementById('editModalClose').addEventListener('click', closeEditModal);
  document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('editSaveBtn').addEventListener('click', saveEdit);
  document.getElementById('editModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('editModalOverlay')) closeEditModal();
  });

  document.getElementById('logBtn').addEventListener('click', doLog);
  document.getElementById('nav-log').addEventListener('click', () => goPage('log'));
  document.getElementById('nav-track').addEventListener('click', () => goPage('track'));
  document.getElementById('nav-settings').addEventListener('click', () => goPage('settings'));
  document.addEventListener('click', e => {
    if (!e.target.closest('.entry-menu-wrap')) closeAllMenus();
  });
  document.getElementById('trackTabs').addEventListener('click', e => {
    const t = e.target.dataset.tab; if (t) switchTrackTab(t);
  });
  document.getElementById('calPrev').addEventListener('click', () => { calM--; if(calM<0){calM=11;calY--;} buildCal(); });
  document.getElementById('calNext').addEventListener('click', () => { calM++; if(calM>11){calM=0;calY++;} buildCal(); });
  document.getElementById('signOutRow').addEventListener('click', doSignOut);

  // Load saved theme
  if (localStorage.getItem('moodex_theme') === 'light') {
    document.body.classList.add('light');
    document.getElementById('themeCheck').checked = true;
    applyThemeIcon(true);
    document.getElementById('themeSub').textContent = 'Light mode';
  }

  document.getElementById('themeCheck').addEventListener('change', function() {
    toggleTheme(this.checked);
  });

  let _radarResizeTimer;
  new ResizeObserver(() => {
    clearTimeout(_radarResizeTimer);
    _radarResizeTimer = setTimeout(() => {
      if (curPage === 'track' && curTrackTab === 'overview') renderRadar();
    }, 100);
  }).observe(document.getElementById('radarCanvas'));

  document.fonts.load('900 1em "Font Awesome 6 Free"').then(() => {
    if (curPage === 'track' && curTrackTab === 'overview') renderRadar();
  });

  // Entry animations deferred — fired in showApp after splash exits
}

/* ══════════════════════════════════════════════
   MULTI-MOOD SELECTION
══════════════════════════════════════════════ */
function toggleMood(id, el) {
  if (pickedMoods.has(id)) {
    deselect(id, el);
  } else {
    select(id, el);
  }
}

function select(id, el) {
  pickedMoods.set(id, 5);
  el.classList.add('selected');
  el.setAttribute('aria-pressed', 'true');
  if (!reducedMotion) {
    gsap.killTweensOf(el, 'scale');
    gsap.timeline()
      .to(el, { scale: 1.1, duration: 0.12, ease: 'power2.out' })
      .to(el, { scale: 1, duration: 0.2, ease: 'back.out(2)' });
  }
  addIntRow(id);
  showIntLabel();
}

function deselect(id, el) {
  pickedMoods.delete(id);
  el.classList.remove('selected');
  el.setAttribute('aria-pressed', 'false');
  if (!reducedMotion) {
    gsap.killTweensOf(el, 'scale');
    gsap.fromTo(el, { scale: 0.93 }, { scale: 1, duration: 0.18, ease: 'power2.out' });
  }
  removeIntRow(id);
  if (pickedMoods.size === 0) hideIntLabel();
}

function showIntLabel() {
  document.getElementById('intSection').classList.add('int-open');
}

function hideIntLabel() {
  document.getElementById('intSection').classList.remove('int-open');
}

function addIntRow(moodId) {
  const m = MOODS.find(m => m.id === moodId);
  const val = 5;
  const pct = ((val - 1) / 9 * 100).toFixed(1) + '%';

  const row = document.createElement('div');
  row.className = 'int-row';
  row.id = 'irow-' + moodId;
  row.style.setProperty('--mc', m.color);
  row.innerHTML = `
    <div class="ir-header">
      <span class="ir-icon"><i class="fa-solid ${m.icon}"></i></span>
      <span class="ir-name">${m.label}</span>
      <span class="ir-val">${val}</span>
      <span class="ir-unit">/10</span>
      <button class="ir-remove" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <input type="range" class="mood-slider" min="1" max="10" value="${val}">`;

  const slider = row.querySelector('.mood-slider');
  const valEl  = row.querySelector('.ir-val');
  slider.style.setProperty('--pct', pct);
  slider.addEventListener('input', () => {
    const v = +slider.value;
    pickedMoods.set(moodId, v);
    valEl.textContent = v;
    slider.style.setProperty('--pct', ((v - 1) / 9 * 100).toFixed(1) + '%');
    gsap.fromTo(valEl, { scale: 1.3 }, { scale: 1, duration: 0.2, ease: 'back.out(2)' });
  });

  row.querySelector('.ir-remove').addEventListener('click', () => {
    deselect(moodId, document.querySelector(`.mood-btn[data-id="${moodId}"]`));
  });

  document.getElementById('moodIntRows').appendChild(row);
  if (!reducedMotion) {
    gsap.set(row, { opacity: 0, y: -10 });
    gsap.to(row, { opacity: 1, y: 0, duration: 0.28, ease: 'power3.out', clearProps: 'opacity,transform' });
  }
}

function removeIntRow(moodId) {
  const row = document.getElementById('irow-' + moodId);
  if (!row) return;
  if (reducedMotion) { row.remove(); return; }
  gsap.to(row, {
    opacity: 0, y: -6,
    duration: 0.2, ease: 'power2.in',
    onComplete: () => row.remove()
  });
}

/* ══════════════════════════════════════════════
   LOG
══════════════════════════════════════════════ */
async function doLog() {
  if (pickedMoods.size === 0) {
    showToast('Pick at least one mood 👆');
    gsap.to('#moodGrid', { keyframes: { x: [-8, 8, -5, 5, 0] }, duration: 0.35 });
    return;
  }

  const moodsArr = Array.from(pickedMoods.entries()).map(([id, intensity]) => ({ id, intensity }));
  const entry = {
    id: Date.now(),
    moods: moodsArr,
    note: document.getElementById('journalTa').value.trim(),
    ts: new Date().toISOString(),
  };

  const btn = document.getElementById('logBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  const loadPulse = reducedMotion ? null : gsap.to(btn, { opacity: 0.65, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });

  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'entries'), entry);
  } catch {
    loadPulse?.kill();
    gsap.set(btn, { opacity: 1 });
    btn.disabled = false;
    btn.textContent = 'Log Mood';
    showToast('Failed to save. Check your connection.');
    return;
  }

  loadPulse?.kill();
  gsap.set(btn, { opacity: 1 });
  btn.disabled = false;
  btn.textContent = 'Log Mood';

  // Success animation
  const firstMood = MOODS.find(m => m.id === moodsArr[0].id);
  const ring    = document.getElementById('successRing');
  const overlay = document.getElementById('successOverlay');
  ring.innerHTML = moodsArr.length > 1
    ? moodsArr.slice(0, 3).map(m => `<i class="fa-solid ${MOODS.find(x => x.id === m.id).icon}"></i>`).join('')
    : `<i class="fa-solid ${firstMood.icon}"></i>`;
  ring.style.color  = firstMood.color;
  ring.style.background = firstMood.color + '44';
  overlay.style.opacity = 1;
  overlay.style.pointerEvents = 'all';

  gsap.timeline()
    .to(ring, { scale: 1, duration: 0.45, ease: 'back.out(1.8)' })
    .to(ring, { scale: 0, opacity: 0, duration: 0.3, ease: 'power2.in', delay: 0.6 })
    .to(overlay, { opacity: 0, duration: 0.2, onComplete: () => {
      overlay.style.pointerEvents = 'none';
      gsap.set(ring, { scale: 0, opacity: 1 });
    }});

  // Reset form
  [...pickedMoods.keys()].forEach(id => {
    const btn = document.querySelector(`.mood-btn[data-id="${id}"]`);
    if (btn) btn.classList.remove('selected');
  });
  pickedMoods.clear();
  document.getElementById('moodIntRows').innerHTML = '';
  document.getElementById('journalTa').value = '';
  document.getElementById('cCount').textContent = 0;
  hideIntLabel();
  gsap.to('#logBtn', { scale: 0.94, duration: 0.1, yoyo: true, repeat: 1 });
}


/* ══════════════════════════════════════════════
   PAGE NAVIGATION
══════════════════════════════════════════════ */
function goPage(name) {
  if (name === curPage) return;
  const from = document.getElementById('page-' + curPage);
  const to   = document.getElementById('page-' + name);
  const dir  = PAGE_ORDER.indexOf(name) > PAGE_ORDER.indexOf(curPage) ? 1 : -1;

  to.classList.remove('hidden');
  if (reducedMotion) {
    gsap.set(from, { opacity: 0 });
    gsap.set(to,   { opacity: 1, x: 0 });
    from.classList.add('hidden');
    gsap.set(from, { x: 0 });
  } else {
    gsap.set(to, { x: dir * 55, opacity: 0 });
    gsap.timeline()
      .to(from, { x: -dir * 55, opacity: 0, duration: 0.3, ease: 'power2.inOut', overwrite: 'auto' })
      .to(to,   { x: 0, opacity: 1, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }, '<0.08')
      .call(() => { from.classList.add('hidden'); gsap.set(from, { x: 0 }); });
  }

  document.getElementById('nav-log').classList.toggle('active',      name === 'log');
  document.getElementById('nav-track').classList.toggle('active',    name === 'track');
  document.getElementById('nav-settings').classList.toggle('active', name === 'settings');
  curPage = name;
  if (name === 'track') renderTrackPage();
}

/* ══════════════════════════════════════════════
   TRACK PAGE
══════════════════════════════════════════════ */
function renderTrackPage() {
  if (curTrackTab === 'overview') renderOverview();
  if (curTrackTab === 'calendar') buildCal();
  if (curTrackTab === 'history')  renderHistory();
}

function switchTrackTab(tab) {
  if (tab === curTrackTab) return;
  curTrackTab = tab;
  document.querySelectorAll('.ttab').forEach(t => {
    const isActive = t.dataset.tab === tab;
    t.classList.toggle('active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  ['overview','calendar','history'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (v === tab) {
      el.style.display = 'block';
      gsap.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.25 });
    } else {
      el.style.display = 'none';
    }
  });
  if (tab === 'overview') renderOverview();
  if (tab === 'calendar') { buildCal(); }
  if (tab === 'history')  renderHistory();
}

/* ── Overview ── */
function renderOverview() {
  renderDistribution();
  renderRecent();
  requestAnimationFrame(() => animateRadar());
}

/* ══════════════════════════════════════════════
   RADAR / SPIDER CHART
══════════════════════════════════════════════ */
function moodAverages() {
  const sums = {}, counts = {};
  MOODS.forEach(m => { sums[m.id] = 0; counts[m.id] = 0; });
  entries.forEach(entry => {
    entry.moods.forEach(({ id, intensity }) => {
      if (id in sums) { sums[id] += intensity; counts[id]++; }
    });
  });
  const avgs = {};
  MOODS.forEach(m => { avgs[m.id] = counts[m.id] > 0 ? sums[m.id] / counts[m.id] : 0; });
  return avgs;
}

function renderRadar(progress = 1, _avgs, _faReady) {
  const canvas = document.getElementById('radarCanvas');
  const dpr    = window.devicePixelRatio || 1;
  const size   = canvas.parentElement.clientWidth;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const R  = size / 2 - 62;
  const N  = MOODS.length;
  const avgs = _avgs !== undefined ? _avgs : moodAverages();

  const ang = i => -Math.PI / 2 + i * (2 * Math.PI / N);
  const pt  = (angle, frac) => ({
    x: cx + R * frac * Math.cos(angle),
    y: cy + R * frac * Math.sin(angle),
  });

  ctx.clearRect(0, 0, size, size);

  const light = document.body.classList.contains('light');
  const c = {
    ring:      light ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.07)',
    ringOuter: light ? 'rgba(0,0,0,0.14)'   : 'rgba(255,255,255,0.14)',
    spoke:     light ? 'rgba(0,0,0,0.09)'   : 'rgba(255,255,255,0.1)',
    tick:      light ? 'rgba(0,0,0,0.18)'   : 'rgba(255,255,255,0.15)',
    outline:   light ? 'rgba(0,0,0,0.35)'   : 'rgba(255,255,255,0.55)',
    label:     light ? 'rgba(20,20,40,0.9)' : 'rgba(255,255,255,0.9)',
    hint:      light ? 'rgba(80,80,120,0.6)': 'rgba(119,119,160,0.7)',
  };

  for (let r = 1; r <= 5; r++) {
    const frac = r / 5;
    ctx.beginPath();
    MOODS.forEach((_, i) => {
      const p = pt(ang(i), frac);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.strokeStyle = r === 5 ? c.ringOuter : c.ring;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  MOODS.forEach((m, i) => {
    const a   = ang(i);
    const tip = pt(a, 1);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.strokeStyle = c.spoke;
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let f = 0.2; f <= 0.8; f += 0.2) {
      const tp = pt(a, f);
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = c.tick;
      ctx.fill();
    }
  });

  const dataPts = MOODS.map((m, i) => {
    const v = (avgs[m.id] || 0) * progress;
    return pt(ang(i), v > 0 ? v / 10 : 0);
  });

  MOODS.forEach((m, i) => {
    const next = (i + 1) % N;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(dataPts[i].x, dataPts[i].y);
    ctx.lineTo(dataPts[next].x, dataPts[next].y);
    ctx.closePath();
    ctx.fillStyle = m.color + '38';
    ctx.fill();
  });

  ctx.beginPath();
  dataPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  MOODS.forEach((m, i) => {
    if (avgs[m.id] > 0) {
      const p = dataPts[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = m.color + '30';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  const faReady = _faReady !== undefined ? _faReady : document.fonts.check('900 1em "Font Awesome 6 Free"');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  MOODS.forEach((m, i) => {
    const a  = ang(i);
    const lR = R + 32;
    const lx = cx + lR * Math.cos(a);
    const ly = cy + lR * Math.sin(a);
    if (faReady) {
      ctx.font = '900 20px "Font Awesome 6 Free"';
      ctx.fillStyle = avgs[m.id] > 0 ? m.color : c.hint;
      ctx.fillText(m.unicode, lx, ly - 8);
    } else {
      ctx.font = '20px serif';
      ctx.fillStyle = c.label;
      ctx.fillText(m.emoji, lx, ly - 8);
    }
    ctx.font = '600 10px -apple-system, sans-serif';
    ctx.fillStyle = avgs[m.id] > 0 ? m.color : c.hint;
    ctx.fillText(m.label, lx, ly + 11);
  });

  const totalLogged = MOODS.filter(m => avgs[m.id] > 0).length;
  if (totalLogged === 0) {
    ctx.font = '600 12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = c.hint;
    ctx.fillText('Log moods to see your spider', cx, cy);
  }
}

function animateRadar() {
  if (_radarTween) { _radarTween.kill(); _radarTween = null; }
  if (reducedMotion) { renderRadar(1); return; }
  const avgs    = moodAverages();
  const faReady = document.fonts.check('900 1em "Font Awesome 6 Free"');
  const obj = { t: 0 };
  _radarTween = gsap.to(obj, {
    t: 1, duration: 1, ease: 'power2.out',
    onUpdate() { renderRadar(obj.t, avgs, faReady); },
    onComplete() { _radarTween = null; }
  });
}

/* ── Distribution ── */
function renderDistribution() {
  const wrap = document.getElementById('distWrap');
  if (!entries.length) { wrap.innerHTML = '<div class="empty-state">Log your first mood to see patterns here.</div>'; return; }

  const counts = {};
  entries.forEach(e => e.moods.forEach(({ id }) => counts[id] = (counts[id] || 0) + 1));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  wrap.innerHTML = `<div class="dist-chip-grid">${sorted.map(([id, cnt]) => {
    const m   = MOODS.find(m => m.id === id);
    const pct = Math.round(cnt / total * 100);
    return `<div class="dist-chip" style="--mc:${m.color}">
      <div class="dist-chip-head">
        <span class="dist-chip-icon"><i class="fa-solid ${m.icon}"></i></span>
        <span class="dist-chip-name">${m.label}</span>
      </div>
      <div class="dist-chip-pct">${pct}%</div>
      <div class="dist-chip-cnt">${cnt} log${cnt > 1 ? 's' : ''}</div>
    </div>`;
  }).join('')}</div>`;

  if (!reducedMotion) {
    requestAnimationFrame(() =>
      gsap.fromTo(wrap.querySelectorAll('.dist-chip'),
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.25, ease: 'power2.out', clearProps: 'opacity,transform' }
      )
    );
  }
}

/* ── Recent ── */
function renderRecent() {
  const list   = document.getElementById('recentList');
  const recent = entries.slice(0, 4);
  if (!recent.length) {
    list.innerHTML = '<div class="empty-state">No moods logged yet.<br>Start by logging your first mood!</div>';
    return;
  }
  list.innerHTML = recent.map(entryHTML).join('');
  gsap.fromTo(list.querySelectorAll('.entry-item'),
    { opacity: 0, y: 8 }, { opacity: 1, y: 0, stagger: 0.06, duration: 0.28 });
  attachEntryListeners(list);
}

/* ── History ── */
function renderHistory() {
  const list = document.getElementById('historyList');
  if (!entries.length) { list.innerHTML = '<div class="empty-state">Your full history will appear here once you start logging.</div>'; return; }
  list.innerHTML = entries.map(entryHTML).join('');
  if (!reducedMotion) {
    gsap.fromTo(list.querySelectorAll('.entry-item'),
      { opacity: 0, y: 8 }, { opacity: 1, y: 0, stagger: 0.05, duration: 0.28, ease: 'power2.out', clearProps: 'opacity,transform' });
  }
  attachEntryListeners(list);
}

/* ── Entry HTML ── */
function entryHTML(e) {
  const d          = new Date(e.ts);
  const date       = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time       = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const firstColor = (MOODS.find(m => m.id === e.moods[0].id) || {}).color || '#888';
  const docid      = e._docId || '';
  const chips      = e.moods.map(({ id, intensity }) => {
    const m = MOODS.find(m => m.id === id);
    if (!m) return '';
    return `<span class="mood-chip" style="background:${m.color}22;color:${m.color}"><i class="fa-solid ${m.icon}"></i>${m.label}<span class="chip-dot">•</span>${intensity}</span>`;
  }).join('');
  return `<div class="entry-item" style="border-left-color:${firstColor}" tabindex="0" data-docid="${docid}">
    <div class="entry-row1">
      <div class="entry-chips">${chips}</div>
      <div class="entry-meta">
        <span class="entry-date">${date}</span>
        <span class="entry-time">${time}</span>
        <div class="entry-menu-wrap">
          <div class="entry-menu-actions">
            <button class="entry-delete" type="button" aria-label="Delete entry" data-docid="${docid}"><i class="fa-solid fa-trash-can"></i></button>
            <button class="entry-edit" type="button" aria-label="Edit entry" data-docid="${docid}"><i class="fa-solid fa-pen"></i></button>
          </div>
          <button class="entry-menu-btn" type="button" aria-label="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        </div>
        ${e.note ? `<button class="entry-expand-btn" type="button" aria-label="Expand note"><i class="fa-solid fa-chevron-down"></i></button>` : ''}
      </div>
    </div>
    ${e.note ? `<div class="entry-note">${escapeHtml(e.note)}</div>` : ''}
  </div>`;
}

/* ── Close all open menus ── */
function closeAllMenus() {
  document.querySelectorAll('.entry-menu-wrap.menu-open').forEach(w => w.classList.remove('menu-open'));
}

/* ── Attach entry list click/keyboard listeners ── */
function attachEntryListeners(list) {
  list.onclick = e => {
    const del = e.target.closest('.entry-delete');
    if (del) { deleteEntry(del.dataset.docid); return; }

    const edit = e.target.closest('.entry-edit');
    if (edit) { const en = entries.find(x => x._docId === edit.dataset.docid); if (en) openEditModal(en); return; }

    const menuBtn = e.target.closest('.entry-menu-btn');
    if (menuBtn) {
      const wrap = menuBtn.closest('.entry-menu-wrap');
      const wasOpen = wrap.classList.contains('menu-open');
      closeAllMenus();
      if (!wasOpen) wrap.classList.add('menu-open');
      e.stopPropagation();
      return;
    }

    const expandBtn = e.target.closest('.entry-expand-btn');
    if (expandBtn) {
      const item = expandBtn.closest('.entry-item');
      if (item) toggleEntry(item);
      e.stopPropagation();
      return;
    }

    closeAllMenus();
  };
  list.onkeydown = e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('entry-expand-btn')) {
      e.preventDefault();
      const item = e.target.closest('.entry-item');
      if (item) toggleEntry(item);
    }
  };
}

/* ── Entry expand/collapse ── */
function toggleEntry(item) {
  item.classList.toggle('open');
}

/* ══════════════════════════════════════════════
   EDIT MODAL
══════════════════════════════════════════════ */
let editPickedMoods = new Map();
let editDocId       = null;
let editEntryTs     = null;
let editEntryId     = null;

function openEditModal(entry) {
  editDocId      = entry._docId;
  editEntryTs    = entry.ts;
  editEntryId    = entry.id;
  editPickedMoods = new Map(entry.moods.map(m => [m.id, m.intensity]));

  // Build mood grid
  const grid = document.getElementById('editMoodGrid');
  grid.innerHTML = '';
  MOODS.forEach(m => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'mood-btn';
    el.style.setProperty('--mc', m.color);
    el.dataset.id = m.id;
    const isSelected = editPickedMoods.has(m.id);
    el.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    if (isSelected) el.classList.add('selected');
    el.innerHTML = `<span class="m-icon" aria-hidden="true"><i class="fa-solid ${m.icon}"></i></span><span class="m-label">${m.label}</span>
      <span class="m-check" aria-hidden="true"><svg viewBox="0 0 10 8"><polyline points="1,4 4,7 9,1" fill="none"/></svg></span>`;
    el.addEventListener('click', () => editToggleMood(m.id, el));
    grid.appendChild(el);
  });

  // Build intensity rows
  const rowsEl = document.getElementById('editMoodIntRows');
  rowsEl.innerHTML = '';
  entry.moods.forEach(({ id, intensity }) => editAddIntRow(id, intensity));

  document.getElementById('editIntSection').style.display = editPickedMoods.size > 0 ? 'block' : 'none';

  const ta = document.getElementById('editJournalTa');
  ta.value = entry.note || '';
  document.getElementById('editCCount').textContent = ta.value.length;

  const overlay = document.getElementById('editModalOverlay');
  const modal   = document.getElementById('editModal');
  overlay.style.display = 'flex';
  if (!reducedMotion) {
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.2 });
    gsap.fromTo(modal,   { y: 60 }, { y: 0, duration: 0.32, ease: 'power3.out' });
  }
}

function closeEditModal() {
  const overlay = document.getElementById('editModalOverlay');
  const modal   = document.getElementById('editModal');
  if (!reducedMotion) {
    gsap.timeline()
      .to(modal,   { y: 60, duration: 0.22, ease: 'power2.in' })
      .to(overlay, { opacity: 0, duration: 0.15, onComplete: () => { overlay.style.display = 'none'; gsap.set(overlay, { opacity: 1 }); } }, '<0.08');
  } else {
    overlay.style.display = 'none';
  }
  editDocId = null;
  editPickedMoods = new Map();
}

function editToggleMood(id, el) {
  if (editPickedMoods.has(id)) {
    editPickedMoods.delete(id);
    el.classList.remove('selected');
    el.setAttribute('aria-pressed', 'false');
    editRemoveIntRow(id);
    if (editPickedMoods.size === 0) document.getElementById('editIntSection').style.display = 'none';
  } else {
    editPickedMoods.set(id, 5);
    el.classList.add('selected');
    el.setAttribute('aria-pressed', 'true');
    editAddIntRow(id, 5);
    document.getElementById('editIntSection').style.display = 'block';
  }
}

function editAddIntRow(moodId, initialVal = 5) {
  const m   = MOODS.find(m => m.id === moodId);
  const val = initialVal;
  const pct = ((val - 1) / 9 * 100).toFixed(1) + '%';

  const row = document.createElement('div');
  row.className = 'int-row';
  row.id = 'edit-irow-' + moodId;
  row.style.setProperty('--mc', m.color);
  row.innerHTML = `
    <div class="ir-header">
      <span class="ir-icon"><i class="fa-solid ${m.icon}"></i></span>
      <span class="ir-name">${m.label}</span>
      <span class="ir-val">${val}</span>
      <span class="ir-unit">/10</span>
      <button class="ir-remove" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <input type="range" class="mood-slider" min="1" max="10" value="${val}">`;

  const slider = row.querySelector('.mood-slider');
  const valEl  = row.querySelector('.ir-val');
  slider.style.setProperty('--pct', pct);
  slider.addEventListener('input', () => {
    const v = +slider.value;
    editPickedMoods.set(moodId, v);
    valEl.textContent = v;
    slider.style.setProperty('--pct', ((v - 1) / 9 * 100).toFixed(1) + '%');
    if (!reducedMotion) gsap.fromTo(valEl, { scale: 1.3 }, { scale: 1, duration: 0.2, ease: 'back.out(2)' });
  });

  row.querySelector('.ir-remove').addEventListener('click', () => {
    editPickedMoods.delete(moodId);
    const moodBtn = document.querySelector(`#editMoodGrid .mood-btn[data-id="${moodId}"]`);
    if (moodBtn) { moodBtn.classList.remove('selected'); moodBtn.setAttribute('aria-pressed', 'false'); }
    editRemoveIntRow(moodId);
    if (editPickedMoods.size === 0) document.getElementById('editIntSection').style.display = 'none';
  });

  document.getElementById('editMoodIntRows').appendChild(row);
}

function editRemoveIntRow(moodId) {
  document.getElementById('edit-irow-' + moodId)?.remove();
}

async function saveEdit() {
  if (editPickedMoods.size === 0) {
    showToast('Pick at least one mood 👆');
    return;
  }

  const btn = document.getElementById('editSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const moodsArr = Array.from(editPickedMoods.entries()).map(([id, intensity]) => ({ id, intensity }));
  const note     = document.getElementById('editJournalTa').value.trim();

  try {
    await setDoc(
      doc(db, 'users', currentUser.uid, 'entries', editDocId),
      { id: editEntryId, moods: moodsArr, note, ts: editEntryTs }
    );
    closeEditModal();
    showToast('Entry updated.');
  } catch {
    showToast('Could not save. Check your connection.');
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

/* ── Entry delete ── */
async function deleteEntry(docId) {
  const item = document.querySelector(`.entry-item[data-docid="${docId}"]`);
  if (item && !reducedMotion) {
    const h = item.offsetHeight;
    await new Promise(resolve =>
      gsap.timeline()
        .to(item, { opacity: 0, x: 18, duration: 0.18, ease: 'power2.in' })
        .to(item, { height: 0, paddingTop: 0, paddingBottom: 0, marginBottom: 0, duration: 0.18, ease: 'power2.in', onComplete: resolve })
    );
  }
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'entries', docId));
    showToast('Entry deleted.');
  } catch {
    showToast('Could not delete. Check your connection.');
  }
}

/* ══════════════════════════════════════════════
   CALENDAR
══════════════════════════════════════════════ */
function buildCal() {
  document.getElementById('calTitle').textContent = `${MONTHS[calM]} ${calY}`;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  const firstDay = new Date(calY, calM, 1).getDay();
  const daysInM  = new Date(calY, calM + 1, 0).getDate();
  const today    = new Date();

  const prefix = `${calY}-${String(calM + 1).padStart(2,'0')}-`;
  const monthMap = {};
  entries.forEach(e => {
    const ds = localDateStr(e.ts);
    if (ds.startsWith(prefix)) (monthMap[ds] = monthMap[ds] || []).push(e);
  });

  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement('div'); e.className = 'cal-cell empty'; grid.appendChild(e);
  }
  for (let d = 1; d <= daysInM; d++) {
    const ds   = `${prefix}${String(d).padStart(2,'0')}`;
    const dayE = monthMap[ds] || [];
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.textContent = d;

    if (today.getFullYear() === calY && today.getMonth() === calM && today.getDate() === d)
      cell.classList.add('today');

    if (dayE.length) {
      const m = MOODS.find(m => m.id === dayE[0].moods[0].id);
      cell.classList.add('has-mood');
      if (m) {
        cell.style.background = m.color + '28';
        const dot = document.createElement('div');
        dot.className = 'mood-dot';
        dot.style.background = m.color;
        cell.appendChild(dot);
        cell.addEventListener('click', () => showDayDetail(ds, dayE, cell));
      }
    }
    grid.appendChild(cell);
  }

  if (!reducedMotion) {
    gsap.fromTo(grid.querySelectorAll('.cal-cell:not(.empty)'),
      { opacity: 0, scale: 0.82 },
      { opacity: 1, scale: 1, stagger: { each: 0.012, from: 'start' }, duration: 0.22, ease: 'power2.out', clearProps: 'opacity,transform' }
    );
  }
}

function showDayDetail(ds, dayE, cell) {
  document.querySelectorAll('.cal-cell.sel-day').forEach(c => c.classList.remove('sel-day'));
  cell.classList.add('sel-day');
  const date   = new Date(ds + 'T12:00:00');
  const label  = date.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const detail = document.getElementById('calDetail');
  detail.innerHTML = `<div class="section-label">${label}</div>
    <div class="entry-list" id="calDetailList">${dayE.map(entryHTML).join('')}</div>`;
  const calList = detail.querySelector('#calDetailList');
  attachEntryListeners(calList);
  gsap.fromTo(detail, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25 });
}

/* ══════════════════════════════════════════════
   STREAK
══════════════════════════════════════════════ */
function updateStreak() {
  if (!entries.length) { document.getElementById('hStreak').textContent = ''; return; }
  const dates = new Set(entries.map(e => localDateStr(e.ts)));
  let streak = 0;
  const d = new Date();
  while (dates.has(localDateStr(d))) { streak++; d.setDate(d.getDate() - 1); }
  document.getElementById('hStreak').innerHTML = streak > 1 ? `<i class="fa-solid fa-fire-flame-curved"></i>${streak} day streak` : '';
}

/* ══════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════ */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  gsap.killTweensOf(t);
  gsap.timeline()
    .to(t, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' })
    .to(t, { opacity: 0, y: 8, duration: 0.2, delay: 1.7, ease: 'power2.in' });
}

/* ══════════════════════════════════════════════
   THEME
══════════════════════════════════════════════ */
function applyThemeIcon(isLight) {
  const wrap = document.getElementById('themeIconWrap');
  if (isLight) {
    wrap.style.background = '#FFD93D33';
    wrap.innerHTML = '<i class="fa-solid fa-sun" style="color:#FFD93D"></i>';
  } else {
    wrap.style.background = '#A66CFF33';
    wrap.innerHTML = '<i class="fa-solid fa-moon" style="color:#A66CFF"></i>';
  }
}

function toggleTheme(isLight) {
  document.body.classList.add('theme-transition');
  setTimeout(() => document.body.classList.remove('theme-transition'), 350);

  document.body.classList.toggle('light', isLight);
  localStorage.setItem('moodex_theme', isLight ? 'light' : 'dark');

  document.getElementById('themeSub').textContent = isLight ? 'Light mode' : 'Dark mode';
  applyThemeIcon(isLight);

  if (curPage === 'track' && curTrackTab === 'overview') renderRadar();
}

/* ══════════════════════════════════════════════
   LOGIN — set up listeners outside initApp so
   they work before the app is ever initialized
══════════════════════════════════════════════ */
document.getElementById('loginBtn').addEventListener('click', doSignIn);
document.getElementById('loginEmail').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loginPass').focus();
});
document.getElementById('loginPass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSignIn();
});


