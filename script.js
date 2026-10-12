// ============================================================ FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyBQXDEFuilbYDsry-ktqWylIzqgPZNbUWQ",
  authDomain: "mr-techlabe.firebaseapp.com",
  databaseURL: "https://mr-techlabe-default-rtdb.firebaseio.com",
  projectId: "mr-techlabe",
  storageBucket: "mr-techlabe.firebasestorage.app",
  messagingSenderId: "172436004844",
  appId: "1:172436004844:web:466012505fa13297eb2ac9",
  measurementId: "G-E64JT771TM"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const SV = firebase.database.ServerValue;
const auth = firebase.auth();

// ============================================================ HELPERS
const $ = id => document.getElementById(id);
const SITE_NAME = 'MR TECHLABE STUDIO';
// ডিফল্ট লোগো: logo.png ফাইলটা অ্যাপের রুট ফোল্ডারে (index.html এর পাশে) রাখবে।
// অ্যাডমিন থেকে লোগো/ছবি না এলে বা লোড না হলে সব জায়গায় এই logo.png দেখাবে।
const DEFAULT_LOGO = 'logo.png';

// ============================================================ DEV INFO লিংক (এখানে নিজে বসাও)
// ➜ নিচের '' এর ভেতরে তোমার Dev Info লিংকটা বসাও, যেমন: 'https://example.com'
// ➜ এই লিংক অ্যাডমিন প্যানেল থেকে আসবে না, শুধু এই ফাইল থেকেই কাজ করবে।
// ➜ লিংক ফাঁকা থাকলে হোম স্ক্রিনে Dev Info বাটনটা দেখাবে না।
const DEV_INFO_LINK = '';
const TS = () => SV.TIMESTAMP;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function safeUrl(u) { try { const x = new URL(String(u || '').trim(), location.href); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : ''; } catch (e) { return ''; } }
function errText(e) { if (e && /permission.?denied/i.test((e.code || '') + ' ' + (e.message || ''))) return 'Permission denied. Please try again or contact support.'; return (e && e.message) ? e.message : String(e); }
function maskName(v) { let b = String(v || 'Customer'); if (b.includes('@')) b = b.split('@')[0]; b = b.trim() || 'Customer'; return b.slice(0, 3) + '***'; }
function toast(t, icon) { Swal.fire({ toast: true, position: 'top', icon: icon || 'success', title: t, showConfirmButton: false, timer: 1600 }); }
function tsMs(d) { return Number(d) || Date.now(); }
function fmtDate(d) { return new Date(tsMs(d)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); }
// ---------- Realtime Database helpers ----------
function rows(snap) { const a = []; snap.forEach(c => { const v = c.val(); a.push(v && typeof v === 'object' ? { id: c.key, ...v } : { id: c.key, value: v }); }); return a; }
function listen(q, cb, err) { const h = q.on('value', cb, err); return () => q.off('value', h); }
function ytId(v) { v = String(v || '').trim(); const m = v.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{6,20})/); if (m) return m[1]; return /^[\w-]{6,20}$/.test(v) ? v : ''; }
function imgTag(url, cls) { return `<img ${cls ? `class="${cls}"` : ''} src="${esc(safeUrl(url) || DEFAULT_LOGO)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${DEFAULT_LOGO}'">`; }
function setLogo(url) {
  const ids = ['logo-top', 'logo-auth'];
  ids.forEach(id => { const el = $(id); el.onerror = () => { el.onerror = null; el.src = DEFAULT_LOGO; }; if (!el.getAttribute('src')) el.src = DEFAULT_LOGO; });
  const u = safeUrl(url); if (!u) return;
  const im = new Image();
  im.onload = () => {            // show the uploaded logo only after it has fully loaded; until then logo.png stays
    ids.forEach(id => { $(id).src = u; });
    let fav = document.querySelector('link[rel=icon]');
    if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav); }
    fav.href = u;
  };
  im.src = u;
}
setLogo('');

// ============================================================ STATE
const S = { user: null, balance: 0, games: {}, cats: [], filterCat: 'all', query: '', gameId: null, products: {}, product: null,
  orders: [], busy: false, method: null, payNumbers: {}, offers: [] };
S.blocked = false; S.blockReason = ''; S.notifs = []; S.notifSeen = 0; S.support = {}; S.banners = [];
S.payMode = 'wallet'; S.reqMethod = null;   // payMode: wallet | offer (Instant Pay)
const IMGBB_API_KEY = '6658b0081293e86ee34fcc270064fbfa';   // profile photo upload (ImgBB)
let unsubs = [];

// ============================================================ NAVIGATION
const SECS = ['home', 'history', 'addmoney', 'tutorial', 'account', 'auth', 'topup'];
function showSec(id, fromPop) {
  if (['history', 'account', 'addmoney'].includes(id) && !S.user) { id = 'auth'; }
  SECS.forEach(s => $(s + '-sec').classList.toggle('hidden', s !== id));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.sec === id));
  if (!fromPop && (history.state || {}).sec !== id) history.pushState({ sec: id }, '');
  window.scrollTo(0, 0);
  if (id === 'addmoney') resetAddMoney();
}
history.replaceState({ sec: 'home' }, '');
window.addEventListener('popstate', e => showSec((e.state && e.state.sec) || 'home', true));

// ============================================================ SETTINGS
function loadSettings() {
  listen(db.ref('settings/general'), snap => {
    const d = snap.val() || {};
    const name = d.siteName || SITE_NAME;
    setLogo(d.logoUrl);
    $('name-top').textContent = name; $('name-auth').textContent = name; document.title = name;
    $('foot-text').textContent = '© 2026 ' + name + ' · All Rights Reserved';
    const notice = String(d.notice || '').trim();
    $('notice-bar').classList.toggle('hidden', !notice);
    $('notice-text').textContent = notice;

    const wa = String(d.whatsapp || '').replace(/\D/g, '');
    S.support = { wa, tg: safeUrl(d.telegram) }; if (S.blocked) showBlock();
    const L = [
      ['fab fa-whatsapp', '#25D366', 'WhatsApp', wa ? 'https://wa.me/' + wa : ''],
      ['fab fa-telegram', '#29a9eb', 'Telegram', safeUrl(d.telegram)],
      ['fab fa-facebook-f', '#1877F2', 'Facebook', safeUrl(d.facebook)],
      ['fab fa-youtube', '#ff0000', 'YouTube', safeUrl(d.youtube)],
      ['fab fa-instagram', '#E1306C', 'Instagram', safeUrl(d.instagram)],
      ['fas fa-user-tie', '#c4b5fd', 'Dev Info', safeUrl(DEV_INFO_LINK)]   // আইকন: ডেভেলপার/মানুষ; লিংক উপরের DEV_INFO_LINK থেকে
    ].filter(x => x[3]);
    $('social-links').innerHTML = L.length ? L.map(x => `<a class="lk" href="${esc(x[3])}" target="_blank" rel="noopener"><i class="${x[0]}" style="color:${x[1]}"></i>${x[2]}</a>`).join('')
      : '<div class="empty" style="grid-column:1/-1">No contact links yet</div>';
  }, e => console.error('settings', e));

  db.ref('settings/videos').once('value').then(snap => {
    const id = ytId((snap.val() || {}).howToAddMoney);
    $('am-video').classList.toggle('hidden', !id);
    if (id) $('am-iframe').src = 'https://www.youtube.com/embed/' + id;
  }).catch(() => { });
}

// ============================================================ BANNERS
let sliderTimer = null;
function openBanner(i) {
  const b = S.banners[i]; const u = b && safeUrl(b.link);
  if (u) window.open(u, '_blank', 'noopener');
}
function loadBanners() {
  listen(db.ref('banners'), snap => {
    const track = $('slider-track'), dots = $('slider-dots');
    clearInterval(sliderTimer);
    S.banners = rows(snap).map(b => ({ img: safeUrl(b.image), link: b.link || '' })).filter(b => b.img);
    const imgs = S.banners;
    track.style.transform = 'translateX(0)';
    if (!imgs.length) { track.innerHTML = `<div class="hero-fallback"><b>${esc($('name-top').textContent)}</b></div>`; dots.innerHTML = ''; return; }
    track.innerHTML = imgs.map((b, i) => `<img src="${esc(b.img)}" alt="" ${safeUrl(b.link) ? `style="cursor:pointer" onclick="openBanner(${i})"` : ''}>`).join('');
    dots.innerHTML = imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('');
    if (imgs.length < 2) return;
    let i = 0;
    sliderTimer = setInterval(() => {
      i = (i + 1) % imgs.length;
      track.style.transform = `translateX(-${i * 100}%)`;
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    }, 3500);
  }, e => console.error('banners', e));
}

// ============================================================ OFFERS
function loadOffers() {
  listen(db.ref('offers'), snap => {
    S.offers = rows(snap).filter(o => o.active !== false)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    renderOffers(); renderGames();
  }, e => console.error('offers', e));
}
function offerLive(o) { const e = Number(o.endsAt) || 0; return !e || e > Date.now(); }
function offerCard(o) {
  const end = Number(o.endsAt) || 0, go = o.gameId && S.games[o.gameId];
  return `<div class="offer" ${go ? `onclick="offerGo('${esc(o.id)}')"` : 'style="cursor:default"'}>
    ${safeUrl(o.image) ? `<img src="${esc(safeUrl(o.image))}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
    ${o.badge ? `<span class="offer-badge">${esc(o.badge)}</span>` : ''}
    ${end ? `<span class="offer-cd"><i class="far fa-clock"></i><span data-end="${end}">--:--:--</span></span>` : ''}
    <div class="offer-in"><h4>${esc(o.title)}</h4>${o.subtitle ? `<p>${esc(o.subtitle)}</p>` : ''}${go ? '<span class="go">Grab now <i class="fas fa-arrow-right"></i></span>' : ''}</div></div>`;
}
function renderOffers() {
  const list = S.offers.filter(o => !o.categoryId && offerLive(o));
  $('offers-block').classList.toggle('hidden', !list.length);
  $('offers-rail').innerHTML = list.map(offerCard).join('');
  tickOffers();
}
function offerGo(id) { const o = S.offers.find(x => x.id === id); if (o && o.gameId && S.games[o.gameId]) openGame(o.gameId); }
function tickOffers() {
  let expired = false;
  document.querySelectorAll('[data-end]').forEach(el => {
    const ms = Number(el.dataset.end) - Date.now();
    if (ms <= 0) { expired = true; return; }
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    const p = n => String(n).padStart(2, '0');
    el.textContent = (d ? d + 'd ' : '') + p(h) + ':' + p(m) + ':' + p(x);
  });
  if (expired) { renderOffers(); renderGames(); }
}
setInterval(tickOffers, 1000);

// ============================================================ GAMES & CATEGORIES
const TYPE_TAG = { code: 'Voucher', 'auto-topup': 'Auto' };
async function loadGames() {
  try {
    const [cs, gs] = await Promise.all([db.ref('categories').once('value'), db.ref('services').once('value')]);
    S.cats = rows(cs).sort((a, b) => (Number(a.slot) || 0) - (Number(b.slot) || 0));
    S.games = {};
    gs.forEach(d => { S.games[d.key] = { id: d.key, ...d.val() }; });
    renderChips(); renderGames(); renderOffers();
  } catch (e) {
    console.error(e);
    $('services-list').innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i>Failed to load games. Pull to refresh.</div>';
  }
}
function renderChips() {
  const hasOthers = Object.values(S.games).some(g => !g.categoryId || !S.cats.find(c => c.id === g.categoryId));
  const items = [['all', 'All'], ...S.cats.filter(c => Object.values(S.games).some(g => g.categoryId === c.id)).map(c => [c.id, c.name])];
  if (hasOthers) items.push(['others', 'Others']);
  if (!items.find(i => i[0] === S.filterCat)) S.filterCat = 'all';
  $('cat-chips').innerHTML = items.map(([id, n]) => `<button class="chip ${S.filterCat === id ? 'on' : ''}" onclick="setCat('${esc(id)}')">${esc(n)}</button>`).join('');
}
function setCat(id) { S.filterCat = id; renderChips(); renderGames(); }
function onSearch(v) { S.query = v; renderGames(); }
function gameCard(g) {
  return `<div class="game" onclick="openGame('${esc(g.id)}')">
    ${TYPE_TAG[g.type] ? `<span class="tag">${TYPE_TAG[g.type]}</span>` : ''}
    <div class="im">${imgTag(g.image)}</div><div class="nm">${esc(g.name)}</div></div>`;
}
function renderGames() {
  const q = S.query.trim().toLowerCase();
  const map = new Map(S.cats.map(c => [c.id, { ...c, games: [] }]));
  const others = [];
  Object.values(S.games).forEach(g => {
    if (q && !String(g.name || '').toLowerCase().includes(q)) return;
    if (g.categoryId && map.has(g.categoryId)) map.get(g.categoryId).games.push(g); else others.push(g);
  });
  let html = '';
  const block = (title, games, catId) => { const co = catId ? S.offers.filter(o => o.categoryId === catId && offerLive(o)) : []; return `<div class="cat-block"><div class="cat-title">${esc(title)}<em>${games.length}</em></div>${co.length ? `<div class="rail cat-rail">${co.map(offerCard).join('')}</div>` : ''}<div class="grid3">${games.map(gameCard).join('')}</div></div>`; };
  map.forEach(c => { if (c.games.length && (S.filterCat === 'all' || S.filterCat === c.id)) html += block(c.name, c.games, c.id); });
  if (others.length && (S.filterCat === 'all' || S.filterCat === 'others')) html += block('Others', others);
  $('services-list').innerHTML = html || '<div class="empty"><i class="fas fa-gamepad"></i>No games found</div>';
}

// ============================================================ LATEST ORDERS (public feed)
function loadFeed() {
  listen(db.ref('feed').orderByChild('d').limitToLast(5), snap => {
    const arr = rows(snap).sort((a, b) => (Number(b.d) || 0) - (Number(a.d) || 0));
    if (!arr.length) { $('latest-orders-list').innerHTML = '<div class="empty" style="padding:14px">No recent orders</div>'; return; }
    $('latest-orders-list').innerHTML = arr.map(d => {
      const n = esc(d.n || 'Cus***');
      const st = String(d.s || 'pending').toLowerCase();
      const pill = ['success', 'complete', 'completed'].includes(st) ? '<span class="pill ok">Completed</span>' : ['pending', 'processing'].includes(st) ? '<span class="pill wait">Processing</span>' : st === 'refunded' ? '<span class="pill ref">Refunded</span>' : '<span class="pill bad">Cancelled</span>';
      return `<div class="feed"><div class="av">${n.charAt(0).toUpperCase()}</div><div class="tx"><b>${n}</b><span class="s">${esc(d.p)} · ৳${Number(d.a) || 0}</span></div>${pill}</div>`;
    }).join('');
  }, () => { $('latest-orders-list').innerHTML = '<div class="empty" style="padding:14px">No recent orders</div>'; });
}

// ============================================================ AUTH
function authTab(t) {
  $('login-view').classList.toggle('hidden', t !== 'login'); $('reg-view').classList.toggle('hidden', t === 'login');
  $('seg-login').classList.toggle('on', t === 'login'); $('seg-reg').classList.toggle('on', t !== 'login');
}
function handleRegister() {
  const name = $('reg-name').value.trim(), phone = $('reg-phone').value.trim(), email = $('reg-email').value.trim(), pass = $('reg-pass').value;
  if (!name || !email || !pass) return Swal.fire('Error', 'Please fill all fields', 'error');
  if (pass.length < 6) return Swal.fire('Error', 'Password must be at least 6 characters', 'error');
  if (phone && !/^[0-9+]{10,15}$/.test(phone)) return Swal.fire('Error', 'Phone number is not valid', 'error');
  Swal.fire({ title: 'Creating account...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  auth.createUserWithEmailAndPassword(email, pass)
    .then(c => db.ref('users/' + c.user.uid).set({ name: name.slice(0, 60), email: email, phone: phone, balance: 0, createdAt: TS() }))
    .then(() => { Swal.close(); toast('Account created'); showSec('home'); })
    .catch(e => Swal.fire('Error', errText(e), 'error'));
}
function handleLogin() {
  const email = $('login-email').value.trim(), pass = $('login-pass').value;
  if (!email || !pass) return Swal.fire('Error', 'Enter email and password', 'warning');
  Swal.fire({ title: 'Signing in...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  auth.signInWithEmailAndPassword(email, pass).then(() => { Swal.close(); showSec('home'); })
    .catch(e => Swal.fire('Login Failed', errText(e), 'error'));
}
function handleGoogleLogin() {
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).then(async r => {
    const u = r.user, ref = db.ref('users/' + u.uid);
    const s = await ref.once('value');
    if (!s.exists()) await ref.set({ name: (u.displayName || 'User').slice(0, 60), email: u.email || '', phone: '', balance: 0, createdAt: TS(), photoURL: u.photoURL || '' });
    showSec('home'); toast('Logged in');
  }).catch(e => { if (e && e.code === 'auth/popup-closed-by-user') return; Swal.fire('Error', errText(e), 'error'); });
}
function handleLogout() { auth.signOut().then(() => showSec('home')); }

auth.onAuthStateChanged(user => {
  stopListeners();
  S.user = user || null;
  $('wallet-chip').classList.toggle('hidden', !user);
  $('login-btn').classList.toggle('hidden', !!user);
  $('bell-btn').classList.toggle('hidden', !user);
  if (user) {
    if (!$('auth-sec').classList.contains('hidden')) showSec('home');
    startListeners(user.uid);
  } else {
    S.balance = 0; S.orders = []; $('bal-top').textContent = '0';
    S.blocked = false; S.notifs = []; S.notifSeen = 0; hideBlock(); closeNotifs();
    if (!$('account-sec').classList.contains('hidden') || !$('history-sec').classList.contains('hidden') || !$('addmoney-sec').classList.contains('hidden')) showSec('home');
  }
});
function stopListeners() { unsubs.forEach(u => u()); unsubs = []; }
function startListeners(uid) {
  const ref = db.ref('users/' + uid);
  unsubs.push(listen(ref, snap => {
    if (!snap.exists()) {
      setTimeout(async () => {
        try { const s = await ref.once('value'); if (!s.exists() && S.user && S.user.uid === uid) await ref.set({ name: (S.user.displayName || 'User').slice(0, 60), email: S.user.email || '', phone: '', balance: 0, createdAt: TS() }); } catch (e) { }
      }, 1800);
      return;
    }
    const d = snap.val();
    S.blocked = d.blocked === true; S.blockReason = d.blockReason || ''; S.notifSeen = Number(d.notifSeen) || 0;
    if (S.blocked) showBlock(); else hideBlock();
    renderBell();
    S.balance = Number(d.balance) || 0;
    $('bal-top').textContent = S.balance; $('tp-bal').textContent = S.balance.toFixed(2); $('acc-bal').textContent = S.balance.toFixed(2);
    const name = d.name || 'User', photo = safeUrl(d.photoURL);
    $('acc-pic').innerHTML = photo ? `<img src="${esc(photo)}" alt="">` : `<span>${esc(name.charAt(0).toUpperCase())}</span>`;
    $('acc-name').textContent = name; $('acc-email').textContent = d.email || '';
    $('inf-name').textContent = name; $('inf-email').textContent = d.email || '-'; $('inf-phone').textContent = d.phone || 'Not available';
    $('st-pin').textContent = uid.substring(0, 6).toUpperCase();
    S.phone = d.phone || '';
    const cover = safeUrl(d.coverURL), ci = $('acc-cover-img');   // কভার ফটো
    if (cover) { ci.src = cover; ci.classList.remove('hidden'); } else { ci.classList.add('hidden'); ci.removeAttribute('src'); }
  }, e => console.error('user', e)));
  startNotifs(uid);
  unsubs.push(listen(db.ref('userOrders/' + uid).limitToLast(200), snap => {
    S.orders = rows(snap).sort((a, b) => tsMs(b.date) - tsMs(a.date));
    renderHistory(); renderStats();
  }, e => { $('history-list').innerHTML = `<div class="empty"><i class="fas fa-triangle-exclamation"></i>${esc(errText(e))}</div>`; }));
  unsubs.push(listen(db.ref('userDeposits/' + uid).limitToLast(50), snap => {
    const arr = rows(snap).sort((a, b) => tsMs(b.date) - tsMs(a.date));
    $('dep-list').innerHTML = arr.length ? arr.map(d => {
      const pill = d.status === 'approved' ? '<span class="pill ok">Approved</span>' : d.status === 'rejected' ? '<span class="pill bad">Rejected</span>' : '<span class="pill wait">Pending</span>';
      return `<div class="dep"><div><b>৳${Number(d.amount) || 0}</b><small>${esc(String(d.method || '').replace(' (Auto)', ''))} · ${esc(d.trxId)} · ${esc(fmtDate(d.date))}</small></div>${pill}</div>`;
    }).join('') : '<div class="empty"><i class="fas fa-receipt"></i>No deposits yet</div>';
  }, () => { }));
}

// ============================================================ ORDERS / ACCOUNT STATS
function statusMeta(s) {
  s = String(s || 'pending').toLowerCase();
  if (['success', 'complete', 'completed'].includes(s)) return ['ok', 'Completed', 'fa-circle-check'];
  if (['cancel', 'cancelled', 'rejected', 'failed'].includes(s)) return ['bad', 'Cancelled', 'fa-circle-xmark'];
  if (s === 'refunded') return ['ref', 'Refunded', 'fa-rotate-left'];
  return ['wait', 'Processing', 'fa-clock'];
}
function renderHistory() {
  const box = $('history-list');
  if (!S.orders.length) { box.innerHTML = '<div class="empty"><i class="fas fa-bag-shopping"></i>No orders yet</div>'; return; }
  box.innerHTML = S.orders.map(d => {
    const [cls, label, ic] = statusMeta(d.status);
    const det = d.redeemCode ? `<div class="code"><small>Your voucher code</small><b>${esc(d.redeemCode)}${cpb(d.redeemCode)}</b></div>`
      : `<span class="muted">Player ID:</span> <b class="mono sel">${esc(d.playerId)}</b>${cpb(d.playerId)}`;
    return `<div class="ord"><div class="r1"><div><h4>${esc(d.gameName)}</h4><small>${esc(fmtDate(d.date))}</small></div>
      <div class="pr"><b>৳${Number(d.price) || 0}</b><span class="pill ${cls}"><i class="fas ${ic}"></i>${label}</span></div></div>
      <div class="ft"><div style="margin-bottom:6px;font-weight:600">${esc(d.productName)}</div>${det}</div></div>`;
  }).join('');
}
function renderStats() {
  const week = Date.now() - 7 * 864e5; let total = 0, wk = 0;
  S.orders.forEach(o => {
    if (!['success', 'complete', 'completed', 'pending', 'processing'].includes(String(o.status || '').toLowerCase())) return;
    const p = Number(o.price) || 0; total += p; if (tsMs(o.date) >= week) wk += p;
  });
  $('st-orders').textContent = S.orders.length; $('st-total').textContent = total; $('st-week').textContent = wk;
}

// ============================================================ TUTORIALS
function loadTutorials() {
  listen(db.ref('tutorials'), snap => {
    if (!snap.exists()) { $('tutorial-list').innerHTML = '<div class="empty"><i class="fas fa-video"></i>No tutorials yet</div>'; return; }
    $('tutorial-list').innerHTML = rows(snap).map(d => {
      const id = ytId(d.link);
      if (id) return `<div class="card tut" style="padding:0;overflow:hidden"><div class="vid"><iframe src="https://www.youtube.com/embed/${esc(id)}?rel=0&playsinline=1" title="${esc(d.title)}" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div><div class="tt">${esc(d.title)}</div></div>`;
      const link = esc(safeUrl(d.link));
      return `<div class="card tut" style="padding:0;overflow:hidden"><div style="position:relative;aspect-ratio:16/9;background:var(--s3);cursor:pointer" data-link="${link}" onclick="if(this.dataset.link)window.open(this.dataset.link,'_blank','noopener')">
        ${safeUrl(d.thumbnail) ? `<img src="${esc(safeUrl(d.thumbnail))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">` : ''}
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3)"><div style="width:54px;height:54px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center"><i class="fas fa-play"></i></div></div></div>
        <div class="tt">${esc(d.title)}</div></div>`;
    }).join('');
  }, e => console.error('tutorials', e));
}

// ============================================================ TOP-UP PAGE
async function openGame(id) {
  const g = S.games[id]; if (!g) return;
  S.gameId = id; S.product = null; S.products = {};
  const type = g.type || 'uid';
  $('tp-img').src = safeUrl(g.image) || DEFAULT_LOGO; $('tp-name').textContent = g.name;
  $('tp-sub').textContent = type === 'code' ? 'Instant voucher delivery' : type === 'auto-topup' ? 'Automatic delivery to your Player ID' : 'Top-up to your Player ID';
  $('pid-card').classList.toggle('hidden', type === 'code'); $('pay-step-n').textContent = type === 'code' ? '2' : '3';
  $('player-id').value = ''; updateBuyBar(); resetReqForm();
  const rules = String(g.rules || '').split('\n').map(s => s.trim()).filter(Boolean);
  $('rules-card').classList.toggle('hidden', !rules.length);
  $('rules-text').innerHTML = rules.map(r => `<p>${esc(r)}</p>`).join('');
  showSec('topup');
  const grid = $('pk-grid');
  grid.innerHTML = '<div class="skel" style="height:78px"></div><div class="skel" style="height:78px"></div>';
  try {
    const snap = await db.ref('products/' + id).once('value');
    if (S.gameId !== id) return;
    if (!snap.exists()) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No packages available</div>'; return; }
    grid.innerHTML = rows(snap).sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0)).map(p => {
      const doc = { id: p.id }; S.products[p.id] = p;
      const out = p.stockCount !== undefined && Number(p.stockCount) <= 0;
      const old = Number(p.oldPrice) || 0, price = Number(p.price) || 0;
      const off = old > price ? Math.round((old - price) / old * 100) : 0;
      return `<div class="pk ${out ? 'off' : ''}" data-id="${esc(doc.id)}" onclick="pickProduct('${esc(doc.id)}')">
        ${out ? '<span class="off-t">Stock out</span>' : off ? `<span class="disc">-${off}%</span>` : ''}
        <span class="n">${esc(p.name)}</span><span class="p"><b>৳${price}</b>${old > price ? `<s>৳${old}</s>` : ''}</span></div>`;
    }).join('');
  } catch (e) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(errText(e))}</div>`; }
}
function pickProduct(id) {
  S.product = S.products[id];
  document.querySelectorAll('.pk').forEach(el => el.classList.toggle('on', el.dataset.id === id));
  updateBuyBar();
}
function updateBuyBar() {
  $('bb-name').textContent = S.product ? S.product.name : 'Select a package';
  $('bb-price').textContent = S.product ? (Number(S.product.price) || 0) : 0;
  renderReqSummary();
}
// Buy Now বার শুধু টপ-আপ পেজে আর Wallet মোডে দেখাবে
function syncBuyBar() { $('buybar').classList.toggle('hidden', $('topup-sec').classList.contains('hidden') || S.payMode !== 'wallet'); }
new MutationObserver(syncBuyBar).observe($('topup-sec'), { attributes: true, attributeFilter: ['class'] });
$('buybar').classList.add('hidden');

function buyNow() {
  if (S.blocked) return showBlock();
  const g = S.games[S.gameId]; if (!g) return;
  if (!S.user) {
    return Swal.fire({ title: 'Login required', text: 'Please login to purchase.', icon: 'info', showCancelButton: true, confirmButtonText: 'Login' })
      .then(r => { if (r.isConfirmed) showSec('auth'); });
  }
  if (!S.product) return Swal.fire({ icon: 'warning', title: 'Select a package' });
  const type = g.type || 'uid';
  let pid = 'Voucher Request';
  if (type !== 'code') {
    pid = $('player-id').value.trim();
    if (!pid) return Swal.fire({ icon: 'warning', title: 'Missing ID', text: 'Please enter your Player ID.' });
    if (!/^[\w\-.@# ]{3,40}$/.test(pid)) return Swal.fire({ icon: 'warning', title: 'Invalid ID', text: 'Player ID is not valid.' });
  }
  const price = Number(S.product.price) || 0;
  if (S.balance < price) {
    return Swal.fire({ icon: 'error', title: 'Low balance', text: 'Please add money to your wallet first.', showCancelButton: true, confirmButtonText: 'Add money' })
      .then(r => { if (r.isConfirmed) showSec('addmoney'); });
  }
  Swal.fire({ title: 'Confirm purchase?', html: `${esc(g.name)}<br><b>${esc(S.product.name)}</b><br>Price: ৳${price}`, icon: 'question', showCancelButton: true, confirmButtonText: 'Yes, buy now' })
    .then(r => { if (r.isConfirmed) placeOrder(pid); });
}

async function getAutoTopUpConfig() {
  let c = {};
  try { c = (await db.ref('settings/private').once('value')).val() || {}; } catch (e) { }
  const apiUrl = safeUrl(c.autoTopUpApiUrl);
  if (!c.autoTopUpApiKey || !apiUrl || !c.autoTopUpCallbackUrl) throw new Error('Auto top-up is not configured. Please contact support.');
  return { apiKey: c.autoTopUpApiKey, apiUrl, callbackUrl: c.autoTopUpCallbackUrl };
}

// Purchase flow: stock is claimed atomically, wallet is deducted atomically, then order + public feed are written together.
async function placeOrder(playerId) {
  if (S.blocked) return showBlock();
  if (S.busy || !S.user || !S.product || !S.gameId) return;
  S.busy = true;
  Swal.fire({ title: 'Processing...', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
  const g = S.games[S.gameId], type = g.type || 'uid', uid = S.user.uid, gameId = S.gameId, prodId = S.product.id;
  const needStock = (type === 'code' || type === 'auto-topup');
  const feedName = maskName(S.user.displayName || S.user.email);
  const orderId = db.ref('orders').push().key;
  const stockBase = 'stock/' + gameId + '/' + prodId;
  let stockKey = null, code = null, deducted = false;
  try {
    const cfg = type === 'auto-topup' ? await getAutoTopUpConfig() : null;
    const p = (await db.ref('products/' + gameId + '/' + prodId).once('value')).val();
    if (!p) throw new Error('This package is no longer available.');
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price.');
    if (!needStock && p.stockCount !== undefined && Number(p.stockCount) <= 0) throw new Error('This package is out of stock.');
    const bal = Number((await db.ref('users/' + uid + '/balance').once('value')).val()) || 0;
    if (bal < price) throw new Error('Insufficient balance');

    if (needStock) {
      for (let attempt = 0; attempt < 3 && !stockKey; attempt++) {
        const q = await db.ref(stockBase).orderByChild('status').equalTo('available').limitToFirst(1).once('value');
        if (!q.exists()) throw new Error('Sorry, this product is currently out of stock.');
        let key = null; q.forEach(c => { key = c.key; });
        const r = await db.ref(stockBase + '/' + key).transaction(cur => (cur && cur.status === 'available') ? { ...cur, status: 'sold', orderId, soldTo: uid, soldAt: Date.now() } : undefined);
        if (r.committed) { stockKey = key; code = r.snapshot.val().code; }
      }
      if (!stockKey) throw new Error('Please try again in a moment.');
    }
    const release = () => stockKey ? db.ref(stockBase + '/' + stockKey).update({ status: 'available', orderId: null, soldTo: null, soldAt: null }).catch(() => { }) : null;

    const rb = await db.ref('users/' + uid + '/balance').transaction(b => { const x = Number(b) || 0; return x >= price ? x - price : undefined; });
    if (!rb.committed) { await release(); throw new Error('Insufficient balance'); }
    deducted = true;

    const status = type === 'code' ? 'success' : 'pending';
    const order = { userId: uid, userName: S.user.email || '', gameName: g.name, gameId, productId: prodId, productName: p.name || '', price, playerId, type, status, date: TS() };
    if (type === 'code') order.redeemCode = code;
    if (type === 'auto-topup') order.usedUniPinCode = code;
    const up = {};
    up['orders/' + orderId] = order; up['userOrders/' + uid + '/' + orderId] = order;
    up['feed/' + orderId] = { n: feedName, p: order.productName, a: price, s: status, d: TS() };
    up['users/' + uid + '/lastTx'] = orderId;
    try { await db.ref().update(up); } catch (e) { await db.ref().update(up); }
    if (stockKey) db.ref('products/' + gameId + '/' + prodId + '/stockCount').transaction(c => Math.max(0, (Number(c) || 0) - 1)).catch(() => { });

    if (type === 'auto-topup') {
      fetch(cfg.apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api: cfg.apiKey, playerid: playerId, code, orderid: orderId, url: cfg.callbackUrl }) })
        .catch(err => console.error('Auto top-up API error:', err));
      await Swal.fire({ icon: 'success', title: 'Order placed', text: 'Your top-up is being processed. Check Orders for live status.' });
    } else if (type === 'code') {
      await Swal.fire({ icon: 'success', title: 'Voucher purchased!', html: `<div style="font-size:12px;opacity:.8;margin-bottom:6px">Your code</div><div style="font-family:monospace;font-weight:700;font-size:16px;word-break:break-all;user-select:text">${esc(code)}</div>` });
    } else {
      await Swal.fire('Success', 'Order placed successfully!', 'success');
    }
    S.product = null; showSec('history');
  } catch (e) {
    Swal.fire('Order failed', deducted ? errText(e) + ' — if money was deducted, contact support with order ID ' + orderId : errText(e), 'error');
  } finally { S.busy = false; }
}

// ============================================================ ADD MONEY (manual, admin approved)
const METHODS = {
  bKash: { c: '#e2136e', logo: 'https://i.ibb.co.com/7N6nH6P6/images.png' },
  Nagad: { c: '#f7941d', logo: 'https://i.ibb.co.com/LDLfDhC9/images.jpg' },
  Rocket: { c: '#8c3494', logo: 'https://i.ibb.co.com/mr7Hs740/images-1.png' }
};
function setAmt(n) { $('am-amount').value = n; }
function resetAddMoney() {
  $('am-form').classList.remove('hidden'); $('am-pay').classList.add('hidden'); S.method = null;
  db.ref('admin/payment').once('value').then(snap => {
    S.payNumbers = snap.val() || {};
    const avail = Object.keys(METHODS).filter(m => S.payNumbers[m.toLowerCase()]);
    $('am-methods').innerHTML = avail.length ? avail.map(m => `<button class="method" style="--c:${METHODS[m].c}" data-m="${m}" onclick="pickMethod('${m}')"><img src="${METHODS[m].logo}" alt="" onerror="this.style.display='none'">${m}</button>`).join('')
      : '<div class="empty" style="grid-column:1/-1;padding:12px">Payment methods are not available right now.</div>';
  }).catch(() => { $('am-methods').innerHTML = '<div class="empty" style="grid-column:1/-1;padding:12px">Could not load payment methods.</div>'; });
}
function pickMethod(m) { S.method = m; document.querySelectorAll('.method').forEach(el => el.classList.toggle('on', el.dataset.m === m)); }
function goPay() {
  const amt = Number($('am-amount').value);
  if (!Number.isInteger(amt) || amt < 10 || amt > 100000) return Swal.fire('Invalid amount', 'Enter a whole amount between ৳10 and ৳100000.', 'warning');
  if (!S.method) return Swal.fire('Select method', 'Choose bKash, Nagad or Rocket.', 'warning');
  S.depAmount = amt; const m = METHODS[S.method];
  $('paybox').style.setProperty('--c', m.c); $('pb-logo').style.display = ''; $('pb-logo').src = m.logo; $('pb-method').textContent = S.method;
  $('pb-amt').textContent = amt; $('pb-amt2').textContent = amt; $('pb-num').textContent = S.payNumbers[S.method.toLowerCase()] || '—';
  document.querySelectorAll('.pb-m').forEach(e => e.textContent = S.method);
  $('am-trx').value = '';
  $('am-form').classList.add('hidden'); $('am-pay').classList.remove('hidden'); window.scrollTo(0, 0);
}
function backToForm() { $('am-pay').classList.add('hidden'); $('am-form').classList.remove('hidden'); }
// যেকোনো মান কপি করার ছোট বাটন (ভাউচার কোড, Player ID ইত্যাদির পাশে)
function copyVal(v) {
  const done = () => toast('Copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done).catch(() => fb(v, done)); else fb(v, done);
  function fb(text, cb) { const e = document.createElement('textarea'); e.value = text; e.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(e); e.select(); try { document.execCommand('copy'); } catch (x) { } document.body.removeChild(e); cb(); }
}
const cpb = v => v ? `<button type="button" class="cp" title="Copy" data-v="${esc(v)}" onclick="copyVal(this.dataset.v)"><i class="far fa-copy"></i></button>` : '';
function copyNum() {
  const t = $('pb-num').textContent;
  const done = () => toast('Number copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fb(t, done)); else fb(t, done);
  function fb(text, cb) { const e = document.createElement('textarea'); e.value = text; e.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(e); e.select(); try { document.execCommand('copy'); } catch (x) { } document.body.removeChild(e); cb(); }
}
async function submitDeposit() {
  if (S.blocked) return showBlock();
  if (S.busy || !S.user) return;
  const trx = $('am-trx').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (trx.length < 6 || trx.length > 30) return Swal.fire('Invalid', 'Enter only the Transaction ID (not the whole SMS).', 'warning');
  S.busy = true;
  Swal.fire({ title: 'Submitting...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    // doc id = TrxID, so one transaction id can be submitted only once
    const dep = { userId: S.user.uid, userEmail: S.user.email || '', amount: S.depAmount, trxId: trx, status: 'pending', date: TS(), method: S.method };
    await db.ref().update({ ['deposits/TRX_' + trx]: dep, ['userDeposits/' + S.user.uid + '/TRX_' + trx]: dep });
    await Swal.fire({ icon: 'success', title: 'Request submitted', text: 'Your wallet will be credited after admin approval.' });
    resetAddMoney();
  } catch (e) {
    const used = /permission.?denied/i.test(((e && e.code) || '') + ' ' + ((e && e.message) || ''));
    Swal.fire(used ? 'Already submitted' : 'Error', used ? 'This Transaction ID was already submitted. Contact support if you need help.' : errText(e), used ? 'warning' : 'error');
  } finally { S.busy = false; }
}

// ============================================================ INSTANT PAY / DIRECT REQUEST (admin approved)
// Instant Pay (kind = 'offer'): প্যাকেজ সিলেক্ট করলে অ্যামাউন্ট অটো বসে, ইউজার পেমেন্ট করে নাম্বার + TrxID দিয়ে সাবমিট করে।
// এটা অটো পেমেন্ট না, রিকোয়েস্ট হয়ে অ্যাডমিনের কাছে যায়; অ্যাডমিন চেক করে Approve/Reject করবে।
// ডাটাবেসে সেভ হয়: topupRequests/TRX_<TrxID> এবং userTopupRequests/<uid>/TRX_<TrxID>
// একই TrxID দুইবার ব্যবহার করা যাবে না (ডাটাবেস রুলস এটা আটকায়)।
function setPayMode(m) {
  S.payMode = m;
  ['wallet', 'offer'].forEach(k => $('pm-' + k).classList.toggle('on', k === m));
  $('pm-wallet-view').classList.toggle('hidden', m !== 'wallet');
  $('pm-req-view').classList.toggle('hidden', m === 'wallet');
  syncBuyBar(); updateReqHint();
  if (m !== 'wallet') loadReqMethods();
}
function resetReqForm() {
  S.reqMethod = null;
  ['rq-sender', 'rq-trx'].forEach(id => { $(id).value = ''; });
  $('rq-num-box').classList.add('hidden');
  setPayMode('wallet');
}
function renderReqSummary() {
  const p = S.product;
  $('rq-pkg-name').textContent = p ? p.name : 'Select a package above';
  $('rq-pkg-price').textContent = p ? (Number(p.price) || 0) : 0;
  updateReqHint();
}
function updateReqHint() {
  const h = $('rq-hint');
  if (!S.reqMethod) { h.textContent = ''; return; }
  h.textContent = 'Send exactly ৳' + (S.product ? (Number(S.product.price) || 0) : 0) + ' via Send Money, then enter your number and Transaction ID below.';
}
async function loadReqMethods() {
  const box = $('rq-methods');
  try {
    if (!Object.keys(S.payNumbers || {}).length) S.payNumbers = (await db.ref('admin/payment').once('value')).val() || {};
    const avail = Object.keys(METHODS).filter(m => S.payNumbers[m.toLowerCase()]);
    box.innerHTML = avail.length ? avail.map(m => `<button class="method${S.reqMethod === m ? ' on' : ''}" style="--c:${METHODS[m].c}" data-rm="${m}" onclick="pickReqMethod('${m}')"><img src="${METHODS[m].logo}" alt="" onerror="this.style.display='none'">${m}</button>`).join('')
      : '<div class="empty" style="grid-column:1/-1;padding:12px">Payment methods are not available right now.</div>';
  } catch (e) { box.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:12px">Could not load payment methods.</div>'; }
}
function pickReqMethod(m) {
  S.reqMethod = m;
  document.querySelectorAll('#rq-methods .method').forEach(el => el.classList.toggle('on', el.dataset.rm === m));
  $('rq-mname').textContent = m; $('rq-num').textContent = S.payNumbers[m.toLowerCase()] || '—';
  $('rq-num-box').classList.remove('hidden'); updateReqHint();
}
function copyReqNum() {
  const t = $('rq-num').textContent;
  const done = () => toast('Number copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fb(t, done)); else fb(t, done);
  function fb(text, cb) { const e = document.createElement('textarea'); e.value = text; e.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(e); e.select(); try { document.execCommand('copy'); } catch (x) { } document.body.removeChild(e); cb(); }
}
async function submitReq() {
  if (S.blocked) return showBlock();
  const g = S.games[S.gameId]; if (!g) return;
  if (!S.user) {
    return Swal.fire({ title: 'Login required', text: 'Please login to continue.', icon: 'info', showCancelButton: true, confirmButtonText: 'Login' })
      .then(r => { if (r.isConfirmed) showSec('auth'); });
  }
  if (S.busy) return;
  const kind = 'offer';
  const type = g.type || 'uid';
  let pid = 'Voucher Request';
  if (type !== 'code') {
    pid = $('player-id').value.trim();
    if (!pid) return Swal.fire({ icon: 'warning', title: 'Missing ID', text: 'Please enter your Player ID.' });
    if (!/^[\w\-.@# ]{3,40}$/.test(pid)) return Swal.fire({ icon: 'warning', title: 'Invalid ID', text: 'Player ID is not valid.' });
  }
  const p = S.product;
  if (!p) return Swal.fire({ icon: 'warning', title: 'Select a package' });
  if (p.stockCount !== undefined && Number(p.stockCount) <= 0) return Swal.fire({ icon: 'warning', title: 'Out of stock', text: 'This package is out of stock.' });
  const amount = Number(p.price) || 0, productId = p.id, productName = p.name || '', diamonds = productName;   // অ্যামাউন্ট প্যাকেজ থেকে অটো
  if (!S.reqMethod) return Swal.fire('Select method', 'Choose bKash, Nagad or Rocket.', 'warning');
  const sender = $('rq-sender').value.trim();
  if (!/^[0-9+]{10,15}$/.test(sender)) return Swal.fire('Invalid number', 'Enter the number you sent the money from.', 'warning');
  const trx = $('rq-trx').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (trx.length < 6 || trx.length > 30) return Swal.fire('Invalid', 'Enter only the Transaction ID (not the whole SMS).', 'warning');

  S.busy = true;
  Swal.fire({ title: 'Submitting...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  try {
    // doc id = TrxID, তাই একই TrxID দিয়ে একবারই রিকোয়েস্ট করা যাবে
    const key = 'TRX_' + trx, uid = S.user.uid;
    const req = { kind, userId: uid, userEmail: S.user.email || '', gameId: S.gameId, gameName: g.name, productId, productName, diamonds: String(diamonds).slice(0, 60),
      amount, method: S.reqMethod, senderNumber: sender, trxId: trx, playerId: pid, status: 'pending', date: TS() };
    await db.ref().update({ ['topupRequests/' + key]: req, ['userTopupRequests/' + uid + '/' + key]: req });
    await Swal.fire({ icon: 'success', title: 'Request submitted', text: 'Admin will verify your payment and complete the top-up. You will get a notification.' });
    resetReqForm(); loadReqMethods();
  } catch (e) {
    console.error('submitReq', e);
    // permission-denied মানে: এই TrxID আগেই ব্যবহার হয়েছে, অথবা ডাটাবেস রুলস এখনো বসানো হয়নি
    const denied = /permission.?denied/i.test(((e && e.code) || '') + ' ' + ((e && e.message) || ''));
    Swal.fire(denied ? 'Could not submit' : 'Error', denied ? 'This Transaction ID may already be used. Please check the ID, or contact support.' : errText(e), denied ? 'warning' : 'error');
  } finally { S.busy = false; }
}

// ============================================================ INIT
loadSettings(); loadBanners(); loadOffers(); loadGames(); loadFeed(); loadTutorials();

// ============================================================ BLOCKED ACCOUNT
function showBlock() {
  $('block-reason').textContent = S.blockReason || 'No reason was given.';
  const L = [];
  if (S.support.wa) L.push(`<a class="wa" href="https://wa.me/${esc(S.support.wa)}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>`);
  if (S.support.tg) L.push(`<a class="tg" href="${esc(S.support.tg)}" target="_blank" rel="noopener"><i class="fab fa-telegram"></i> Telegram</a>`);
  $('block-links').innerHTML = L.join('') || '<span class="muted" style="font-size:12px">Support contacts are not available right now.</span>';
  $('block-ov').classList.remove('hidden'); document.body.classList.add('locked');
}
function hideBlock() { $('block-ov').classList.add('hidden'); document.body.classList.remove('locked'); }

// ============================================================ NOTIFICATIONS
function startNotifs(uid) {
  let first = true; const seen = new Set();
  unsubs.push(listen(db.ref('notifications/' + uid).limitToLast(50), snap => {
    const arr = rows(snap).sort((a, b) => tsMs(b.at) - tsMs(a.at));
    if (!first) arr.forEach(n => { if (!seen.has(n.id)) toast(n.title || 'New notification', 'info'); });
    arr.forEach(n => seen.add(n.id)); first = false;
    S.notifs = arr; renderBell();
    if (!$('notif-ov').classList.contains('hidden')) renderNotifs();
  }, () => { }));
}
function renderBell() {
  const n = S.notifs.filter(x => (Number(x.at) || 0) > S.notifSeen).length;
  $('bell-n').textContent = n > 9 ? '9+' : n; $('bell-n').classList.toggle('hidden', !n);
}
const NOTIF_ICON = { plus: ['ok', 'fa-circle-plus'], ok: ['ok', 'fa-circle-check'], minus: ['bad', 'fa-circle-minus'], reject: ['bad', 'fa-circle-xmark'], info: ['inf', 'fa-bell'] };
function renderNotifs() {
  $('notif-list').innerHTML = S.notifs.length ? S.notifs.map(n => {
    const [c, ic] = NOTIF_ICON[n.type] || NOTIF_ICON.info;
    return `<div class="nit ${(Number(n.at) || 0) > S.notifSeen ? 'new' : ''}"><div class="ic ${c}"><i class="fas ${ic}"></i></div><div style="min-width:0"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${esc(fmtDate(n.at))}</small></div></div>`;
  }).join('') : '<div class="empty"><i class="far fa-bell-slash"></i>No notifications yet</div>';
}
function openNotifs() {
  if (!S.user) return showSec('auth');
  const seenBefore = S.notifSeen; renderNotifs();
  $('notif-ov').classList.remove('hidden');
  const m = Math.max(0, ...S.notifs.map(n => Number(n.at) || 0));
  if (m > seenBefore) { db.ref('users/' + S.user.uid + '/notifSeen').set(m).catch(() => { }); setTimeout(() => { S.notifSeen = m; renderBell(); }, 1500); }
}
function closeNotifs() { $('notif-ov').classList.add('hidden'); }

// ============================================================ PROFILE PHOTO (ImgBB)
function pickAvatar() {
  if (!S.user) return showSec('auth');
  const f = $('avatar-file'); f.value = ''; f.onchange = () => uploadAvatar(f.files[0]); f.click();
}
function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const r = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error('Could not process the image')), 'image/jpeg', 0.85);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Please choose a valid image')); };
    im.src = url;
  });
}
async function uploadAvatar(file) {
  if (!file || !S.user) return;
  if (!/^image\//.test(file.type)) return toast('Please choose an image', 'warning');
  if (file.size > 15 * 1024 * 1024) return toast('Image is too large (max 15 MB)', 'warning');
  Swal.fire({ title: 'Uploading photo...', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
  try {
    const blob = await shrinkImage(file, 512);
    const fd = new FormData(); fd.append('image', blob, 'avatar.jpg');
    const r = await fetch('https://api.imgbb.com/1/upload?key=' + IMGBB_API_KEY, { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.success) throw new Error((j.error && j.error.message) || 'Upload failed');
    await db.ref('users/' + S.user.uid).update({ photoURL: j.data.url });
    Swal.close(); toast('Photo updated');
  } catch (e) { Swal.fire('Upload failed', errText(e), 'error'); }
}

// ============================================================ COVER PHOTO (ImgBB)
// কভার ফটো ImgBB তে আপলোড হয়ে users/<uid>/coverURL এ সেভ হয় (প্রোফাইল ফটোর মতোই)
function pickCover() {
  if (!S.user) return showSec('auth');
  const f = $('cover-file'); f.value = ''; f.onchange = () => uploadCover(f.files[0]); f.click();
}
async function uploadCover(file) {
  if (!file || !S.user) return;
  if (!/^image\//.test(file.type)) return toast('Please choose an image', 'warning');
  if (file.size > 15 * 1024 * 1024) return toast('Image is too large (max 15 MB)', 'warning');
  Swal.fire({ title: 'Uploading cover...', allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });
  try {
    const blob = await shrinkImage(file, 1280);
    const fd = new FormData(); fd.append('image', blob, 'cover.jpg');
    const r = await fetch('https://api.imgbb.com/1/upload?key=' + IMGBB_API_KEY, { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.success) throw new Error((j.error && j.error.message) || 'Upload failed');
    await db.ref('users/' + S.user.uid).update({ coverURL: j.data.url });
    Swal.close(); toast('Cover updated');
  } catch (e) { Swal.fire('Upload failed', errText(e), 'error'); }
}

// ============================================================ CHANGE PHONE NUMBER
async function editPhone() {
  if (!S.user) return showSec('auth');
  const r = await Swal.fire({
    title: 'Change mobile number', input: 'tel', inputValue: S.phone || '', inputPlaceholder: '01XXXXXXXXX',
    inputAttributes: { inputmode: 'tel', autocomplete: 'off' }, showCancelButton: true, confirmButtonText: 'Save',
    inputValidator: v => /^[0-9+]{10,15}$/.test(String(v || '').trim()) ? null : 'Enter a valid mobile number'
  });
  if (!r.isConfirmed) return;
  const phone = String(r.value).trim();
  try { await db.ref('users/' + S.user.uid).update({ phone }); toast('Mobile number updated'); }
  catch (e) { Swal.fire('Error', errText(e), 'error'); }
}

// ============================================================ DEV INFO (প্রোফাইল পেজ)
// লিংক script.js এর শুরুর DEV_INFO_LINK থেকে আসে (এখানে আলাদা করে কিছু বসাতে হবে না)
function openDevInfo() {
  const u = safeUrl(DEV_INFO_LINK);
  if (!u) return toast('Dev Info link is not set yet', 'info');
  window.open(u, '_blank', 'noopener');
}

// ============================================================ PWA (service worker)
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));