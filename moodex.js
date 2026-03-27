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
  addDoc, setDoc, onSnapshot, query, orderBy
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
  { id:'happy',    emoji:'😊', label:'Happy',    color:'#FFD93D' },
  { id:'excited',  emoji:'🤩', label:'Excited',  color:'#FF922B' },
  { id:'grateful', emoji:'🙏', label:'Grateful', color:'#FF6EB4' },
  { id:'calm',     emoji:'😌', label:'Calm',     color:'#6BCB77' },
  { id:'sad',      emoji:'😢', label:'Sad',      color:'#6C9BCF' },
  { id:'anxious',  emoji:'😰', label:'Anxious',  color:'#A66CFF' },
  { id:'angry',    emoji:'😠', label:'Angry',    color:'#FF6B6B' },
  { id:'tired',    emoji:'😴', label:'Tired',    color:'#99A0AE' },
];
const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const PAGE_ORDER = ['log', 'track', 'settings'];

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

/* ══════════════════════════════════════════════
   AUTH — SCREEN MANAGEMENT
══════════════════════════════════════════════ */
function showLogin() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('loginErr').textContent = '';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPass').value = '';
}

function showApp(user) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('userEmailSub').textContent = user.email;
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
    entries = snapshot.docs.map(d => d.data());
    updateStreak();
    if (curPage === 'track') renderTrackPage();
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
function initApp() {
  const now = new Date();
  calY = now.getFullYear(); calM = now.getMonth();

  document.getElementById('hDate').textContent =
    now.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });

  // Mood grid
  const grid = document.getElementById('moodGrid');
  MOODS.forEach(m => {
    const el = document.createElement('div');
    el.className = 'mood-btn';
    el.style.setProperty('--mc', m.color);
    el.dataset.id = m.id;
    el.innerHTML = `<span class="m-emoji">${m.emoji}</span><span class="m-label">${m.label}</span>
      <span class="m-check"><svg viewBox="0 0 10 8"><polyline points="1,4 4,7 9,1" fill="none"/></svg></span>`;
    el.addEventListener('click', () => toggleMood(m.id, el));
    grid.appendChild(el);
  });

  document.getElementById('journalTa').addEventListener('input', function() {
    document.getElementById('cCount').textContent = this.value.length;
  });

  document.getElementById('logBtn').addEventListener('click', doLog);
  document.getElementById('nav-log').addEventListener('click', () => goPage('log'));
  document.getElementById('nav-track').addEventListener('click', () => goPage('track'));
  document.getElementById('nav-settings').addEventListener('click', () => goPage('settings'));
  document.getElementById('trackTabs').addEventListener('click', e => {
    const t = e.target.dataset.tab; if (t) switchTrackTab(t);
  });
  document.getElementById('calPrev').addEventListener('click', () => { calM--; if(calM<0){calM=11;calY--;} buildCal(); feather.replace(); });
  document.getElementById('calNext').addEventListener('click', () => { calM++; if(calM>11){calM=0;calY++;} buildCal(); feather.replace(); });
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

  feather.replace();

  gsap.from('.app-header', { y: -20, opacity: 0, duration: 0.5, ease: 'power3.out' });
  gsap.from('#page-log .mood-btn', { y: 20, opacity: 0, stagger: 0.04, duration: 0.4, delay: 0.15, ease: 'power2.out' });
  gsap.from('.journal-card, .log-btn', { y: 20, opacity: 0, stagger: 0.08, duration: 0.4, delay: 0.3, ease: 'power2.out' });
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
  gsap.timeline()
    .to(el, { scale: 1.1, duration: 0.12, ease: 'power2.out' })
    .to(el, { scale: 1, duration: 0.2, ease: 'back.out(2)' });
  addIntRow(id);
  showIntLabel();
}

function deselect(id, el) {
  pickedMoods.delete(id);
  el.classList.remove('selected');
  removeIntRow(id);
  if (pickedMoods.size === 0) hideIntLabel();
}

function showIntLabel() {
  const lbl = document.getElementById('intLabel');
  if (lbl.style.display === 'none') {
    gsap.set(lbl, { height: 0, opacity: 0, marginTop: 0, marginBottom: 0, overflow: 'hidden' });
    lbl.style.display = 'block';
    gsap.to(lbl, {
      height: 'auto', opacity: 1, marginTop: 20, marginBottom: 10,
      duration: 0.25, ease: 'power3.out',
      clearProps: 'height,marginTop,marginBottom,overflow,opacity'
    });
  }
}

function hideIntLabel() {
  const lbl = document.getElementById('intLabel');
  gsap.to(lbl, {
    height: 0, opacity: 0, marginTop: 0, marginBottom: 0,
    duration: 0.25, ease: 'power2.in',
    onComplete: () => {
      lbl.style.display = 'none';
      gsap.set(lbl, { clearProps: 'height,marginTop,marginBottom,opacity' });
    }
  });
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
      <span class="ir-emoji">${m.emoji}</span>
      <span class="ir-name">${m.label}</span>
      <span class="ir-val">${val}</span>
      <span class="ir-unit">/10</span>
      <button class="ir-remove" aria-label="Remove"><i data-feather="x"></i></button>
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

  gsap.set(row, { height: 0, opacity: 0, marginBottom: 0 });
  document.getElementById('moodIntRows').appendChild(row);
  feather.replace();
  gsap.to(row, { height: 'auto', opacity: 1, marginBottom: 8, duration: 0.3, ease: 'power3.out', clearProps: 'height,marginBottom,opacity' });
}

function removeIntRow(moodId) {
  const row = document.getElementById('irow-' + moodId);
  if (!row) return;
  gsap.to(row, {
    height: 0, opacity: 0, marginBottom: 0,
    duration: 0.25, ease: 'power2.in', onComplete: () => row.remove()
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

  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'entries'), entry);
  } catch {
    showToast('Failed to save. Check your connection.');
    return;
  }

  // Success animation
  const firstMood = MOODS.find(m => m.id === moodsArr[0].id);
  const ring    = document.getElementById('successRing');
  const overlay = document.getElementById('successOverlay');
  ring.textContent = moodsArr.length > 1
    ? moodsArr.slice(0, 3).map(m => MOODS.find(x => x.id === m.id).emoji).join('')
    : firstMood.emoji;
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

  gsap.set(to, { x: dir * 55, opacity: 0 });
  to.classList.remove('hidden');
  gsap.timeline()
    .to(from, { x: -dir * 55, opacity: 0, duration: 0.3, ease: 'power2.inOut' })
    .to(to,   { x: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, '<0.08')
    .call(() => { from.classList.add('hidden'); gsap.set(from, { x: 0 }); });

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
  feather.replace();
}

function switchTrackTab(tab) {
  if (tab === curTrackTab) return;
  curTrackTab = tab;
  document.querySelectorAll('.ttab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
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
  if (tab === 'calendar') { buildCal(); feather.replace(); }
  if (tab === 'history')  renderHistory();
}

/* ── Overview ── */
function renderOverview() {
  renderWeekBars();
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

function renderRadar(progress = 1) {
  const canvas = document.getElementById('radarCanvas');
  const dpr    = window.devicePixelRatio || 1;
  const size   = canvas.parentElement.clientWidth - 32;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const R  = size / 2 - 62;
  const N  = MOODS.length;
  const avgs = moodAverages();

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

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  MOODS.forEach((m, i) => {
    const a  = ang(i);
    const lR = R + 26;
    const lx = cx + lR * Math.cos(a);
    const ly = cy + lR * Math.sin(a);
    ctx.font = '16px serif';
    ctx.fillStyle = c.label;
    ctx.fillText(m.emoji, lx, ly - 7);
    ctx.font = '600 9px -apple-system, sans-serif';
    ctx.fillStyle = avgs[m.id] > 0 ? m.color : c.hint;
    ctx.fillText(m.label, lx, ly + 7);
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
  const obj = { t: 0 };
  gsap.to(obj, {
    t: 1, duration: 1, ease: 'power2.out',
    onUpdate() { renderRadar(obj.t); }
  });
}

/* ── Week Bars ── */
function renderWeekBars() {
  const wrap = document.getElementById('barsWrap');
  wrap.innerHTML = '';
  const dayAbbr = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d;
  });
  days.forEach((d, i) => {
    const ds   = d.toISOString().split('T')[0];
    const dayE = entries.filter(e => e.ts.split('T')[0] === ds);
    const col  = document.createElement('div');
    col.className = 'bar-col';

    let color = 'var(--surface2)', pct = 6;
    if (dayE.length) {
      const allMoods = dayE.flatMap(e => e.moods);
      const avgInt   = allMoods.reduce((s, m) => s + m.intensity, 0) / allMoods.length;
      const m        = MOODS.find(m => m.id === dayE[0].moods[0].id);
      color = m ? m.color : '#888';
      pct   = avgInt / 10 * 100;
    }

    col.innerHTML = `<div class="bar-body" style="background:${color};height:${dayE.length ? 0 : pct}%"></div>
                     <div class="bar-day">${dayAbbr[d.getDay()]}</div>`;
    wrap.appendChild(col);

    if (dayE.length) {
      gsap.to(col.querySelector('.bar-body'), { height: pct + '%', duration: 0.5, delay: i * 0.055, ease: 'power2.out' });
    }
  });
}

/* ── Distribution ── */
function renderDistribution() {
  const wrap = document.getElementById('distWrap');
  if (!entries.length) { wrap.innerHTML = '<div class="empty-state">No entries yet.</div>'; return; }

  const counts = {};
  entries.forEach(e => e.moods.forEach(({ id }) => counts[id] = (counts[id] || 0) + 1));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top   = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  wrap.innerHTML = top.map(([id, cnt]) => {
    const m   = MOODS.find(m => m.id === id);
    const pct = Math.round(cnt / total * 100);
    return `<div class="dist-row">
      <div class="dist-top">
        <div class="dist-name-wrap">
          <span class="dist-emoji">${m.emoji}</span>
          <span class="dist-name">${m.label}</span>
        </div>
        <span class="dist-count">${cnt} log${cnt > 1 ? 's' : ''} · ${pct}%</span>
      </div>
      <div class="dist-track">
        <div class="dist-fill" data-w="${pct}%" style="background:${m.color}"></div>
      </div>
    </div>`;
  }).join('');

  requestAnimationFrame(() => {
    wrap.querySelectorAll('.dist-fill').forEach(f =>
      gsap.to(f, { width: f.dataset.w, duration: 0.65, ease: 'power2.out' })
    );
  });
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
}

/* ── History ── */
function renderHistory() {
  const list = document.getElementById('historyList');
  if (!entries.length) { list.innerHTML = '<div class="empty-state">No entries yet.</div>'; return; }
  list.innerHTML = entries.map(entryHTML).join('');
}

/* ── Entry HTML ── */
function entryHTML(e) {
  const d          = new Date(e.ts);
  const t          = d.toLocaleDateString('en-US', { month:'short', day:'numeric' }) + ' · ' +
                     d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  const firstColor = (MOODS.find(m => m.id === e.moods[0].id) || {}).color || '#888';
  const chips      = e.moods.map(({ id, intensity }) => {
    const m = MOODS.find(m => m.id === id);
    if (!m) return '';
    return `<span class="mood-chip" style="background:${m.color}20;color:${m.color}">${m.emoji} ${intensity}</span>`;
  }).join('');
  return `<div class="entry-item" style="border-left-color:${firstColor}">
    <div class="entry-chips">${chips}</div>
    <div class="entry-time">${t}</div>
    ${e.note ? `<div class="entry-note">${e.note}</div>` : ''}
  </div>`;
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

  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement('div'); e.className = 'cal-cell empty'; grid.appendChild(e);
  }
  for (let d = 1; d <= daysInM; d++) {
    const ds   = `${calY}-${String(calM + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayE = entries.filter(e => e.ts.split('T')[0] === ds);
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
}

function showDayDetail(ds, dayE, cell) {
  document.querySelectorAll('.cal-cell.sel-day').forEach(c => c.classList.remove('sel-day'));
  cell.classList.add('sel-day');
  const date   = new Date(ds + 'T12:00:00');
  const label  = date.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const detail = document.getElementById('calDetail');
  detail.innerHTML = `<div class="section-label">${label}</div>
    <div class="entry-list">${dayE.map(entryHTML).join('')}</div>`;
  gsap.fromTo(detail, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25 });
}

/* ══════════════════════════════════════════════
   STREAK
══════════════════════════════════════════════ */
function updateStreak() {
  if (!entries.length) { document.getElementById('hStreak').textContent = ''; return; }
  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = d.toISOString().split('T')[0];
    if (entries.some(e => e.ts.split('T')[0] === ds)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  document.getElementById('hStreak').textContent = streak > 1 ? `🔥 ${streak} day streak` : '';
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
    wrap.innerHTML = '<i data-feather="sun" style="color:#FFD93D"></i>';
  } else {
    wrap.style.background = '#A66CFF33';
    wrap.innerHTML = '<i data-feather="moon" style="color:#A66CFF"></i>';
  }
  feather.replace();
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
document.getElementById('loginPass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSignIn();
});
