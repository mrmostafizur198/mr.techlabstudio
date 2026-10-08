import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase, ref, get, push, set, update, query, orderByChild, runTransaction, increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

/* ===================== FIREBASE INIT ===================== */
const firebaseConfig = {
  apiKey: "AIzaSyA4kRF_flz5aweGQdEypNzI9K0fAnzHlyA",
  authDomain: "mr-apk-bazar.firebaseapp.com",
  projectId: "mr-apk-bazar",
  storageBucket: "mr-apk-bazar.firebasestorage.app",
  messagingSenderId: "208873681519",
  appId: "1:208873681519:web:9a9a84fbb19f2cf866d39a",
  measurementId: "G-DGGTZ1PS6C"
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getDatabase(fbApp);
const googleProvider = new GoogleAuthProvider();

const IMGBB_API_KEY = "YOUR_IMGBB_API_KEY";

/* ===================== STATE ===================== */
const state = {
  user: null,
  isGuest: false,
  settings: { siteName: "Mr Techlab Studio", tagline: "Premium Android App Marketplace", logoUrl: "", allowAppUploads: true, allowFileUploads: true },
  apps: [],
  categories: [],
  activeCategory: "all",
  hostLinks: [],
  hostLoaded: false,
  prompts: [],
  promptsLoaded: false,
  pendingDownload: null,
  downloadInFlight: false,
  customPhotoURL: null,
  photoUploading: false,
  isBlocked: false,
  currentView: "home",
  detailApp: null
};

function getAvatarUrl(){
  return state.customPhotoURL || (state.user && state.user.photoURL) || null;
}

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ===================== TOAST ===================== */
function toast(msg, type="default"){
  const host = $("#toast-host");
  if(!host) return;
  const el = document.createElement("div");
  el.className = "toast" + (type==="error" ? " error" : type==="success" ? " success" : "");
  const icon = type==="error"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
  el.innerHTML = icon + `<span>${escapeHtml(msg)}</span>`;
  host.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(8px)"; el.style.transition="all .2s"; setTimeout(()=>el.remove(),200); }, 3200);
}
function escapeHtml(s){ const d=document.createElement("div"); d.textContent=s??""; return d.innerHTML; }

async function copyToClipboard(text){
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      toast("Copied.", "success");
      return;
    }
    throw new Error("clipboard api unavailable");
  }catch(e){
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Copied.", "success");
    }catch(e2){
      toast("Couldn't copy — please select and copy manually.", "error");
    }
  }
}

/* ===================== URL RESOLVER ===================== */
function resolveDownloadUrl(url){
  if(!url) return null;
  const trimmed = String(url).trim();
  if(!/^https:\/\//i.test(trimmed)) return null;
  try{
    const driveMatch = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                        trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if(trimmed.includes("drive.google.com") && driveMatch){
      const fileId = driveMatch[1];
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    return trimmed;
  }catch(e){ return null; }
}

/* ===================== DOWNLOAD TYPE ===================== */
function getDownloadMeta(app){
  const type = app.downloadType || "direct_apk";
  if(type === "play_store"){
    return { type:"play_store", label:"Get it on Google Play", shortLabel:"Google Play", errorMsg:"Google Play link is unavailable." };
  }
  if(type === "google_drive"){
    return { type:"google_drive", label:"Download from Google Drive", shortLabel:"Drive Download", errorMsg:"Google Drive link is unavailable." };
  }
  return { type:"direct_apk", label:"Download APK", shortLabel:"Download APK", errorMsg:"APK download link is unavailable." };
}
function dlIconSvg(type){
  if(type==="play_store") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4.5v15L19 12 5 4.5Z"/></svg>';
  if(type==="google_drive") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 3h8l5 9-2.5 4.5h-13L3 12z"/><path d="M8 3l5 9m0 0 2.5 4.5M13 12H3"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
}

/* ===================== AUTH ===================== */
let emailMode = "signin";

$("#btn-guest")?.addEventListener("click", (e)=>{ e.preventDefault(); enterAsGuest(); });
$("#btn-google")?.addEventListener("click", ()=>doGoogleSignIn());
$("#gate-google")?.addEventListener("click", ()=>doGoogleSignIn(true));
$("#btn-email")?.addEventListener("click", ()=>{ $("#auth-buttons").style.display="none"; $("#email-panel").classList.add("show"); });
$("#btn-email-back")?.addEventListener("click", ()=>{ $("#email-panel").classList.remove("show"); $("#auth-buttons").style.display="flex"; });
$("#gate-email")?.addEventListener("click", ()=>{ closeGateUI(); $("#welcome").style.display="flex"; $("#app").classList.remove("ready"); $("#auth-buttons").style.display="none"; $("#email-panel").classList.add("show"); });
$("#btn-toggle-signup")?.addEventListener("click", ()=>{
  emailMode = emailMode==="signin" ? "signup" : "signin";
  $("#btn-email-submit").textContent = emailMode==="signin" ? "Sign In" : "Create Account";
  $("#btn-toggle-signup").parentElement.firstChild.textContent = emailMode==="signin" ? "Don't have an account? " : "Already have an account? ";
  $("#btn-toggle-signup").textContent = emailMode==="signin" ? "Create one" : "Sign in";
});
$("#btn-email-submit")?.addEventListener("click", async ()=>{
  const email = $("#email-input").value.trim();
  const pass = $("#pass-input").value;
  const errEl = $("#email-error");
  errEl.textContent = "";
  if(!email || !pass){ errEl.textContent = "Please enter your email and password."; return; }
  try{
    if(emailMode==="signin"){
      await signInWithEmailAndPassword(auth, email, pass);
    }else{
      await createUserWithEmailAndPassword(auth, email, pass);
    }
  }catch(err){
    errEl.textContent = friendlyAuthError(err);
  }
});
function friendlyAuthError(err){
  const code = err && err.code ? err.code : "";
  if(code.includes("wrong-password") || code.includes("invalid-credential")) return "Incorrect email or password.";
  if(code.includes("user-not-found")) return "No account found with that email.";
  if(code.includes("email-already-in-use")) return "An account already exists with that email.";
  if(code.includes("weak-password")) return "Password should be at least 6 characters.";
  if(code.includes("invalid-email")) return "Please enter a valid email address.";
  return "Authentication failed. Please try again.";
}
async function doGoogleSignIn(fromGate){
  try{
    await signInWithPopup(auth, googleProvider);
  }catch(err){
    if(err && (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request")){
      try{ await signInWithRedirect(auth, googleProvider); }catch(e2){ toast("Google sign-in failed.", "error"); }
    } else if(err && err.code !== "auth/popup-closed-by-user"){
      toast("Google sign-in failed.", "error");
    }
  }
}
function enterAsGuest(){
  state.isGuest = true;
  state.user = null;
  showApp();
  saveSnapshot();
}
$("#gate-cancel")?.addEventListener("click", ()=> history.back());
$("#gate-overlay")?.addEventListener("click", ()=> history.back());
function openGate(app){
  state.pendingDownload = app;
  $("#gate-overlay").classList.add("show");
  $("#gate-modal").classList.add("show");
  history.pushState({type:"overlay", overlay:"gate"}, "", location.href);
}

onAuthStateChanged(auth, (user)=>{
  state.user = user;
  resolveBoot(user);
  if(user){
    state.isGuest = false;
    state.promptsLoaded = false; state.zipLoaded = false;
    const welcome = $("#welcome");
    if(welcome) welcome.style.display = "none";
    showApp();
    updateProfileUI();
    loadCustomPhoto();
    syncUserProfile();
    (async ()=>{
      await loadBlockedStatus();
      await loadDeveloper();
      if(state.pendingDownload){
        const app = state.pendingDownload;
        state.pendingDownload = null;
        closeGateUI();
        toast("Signed in. Tap Download again to continue.", "success");
      }
    })();
  } else if(!state.isGuest){
    state.customPhotoURL = null;
    state.isBlocked = false;
    updateProfileUI();
  } else {
    state.customPhotoURL = null;
    state.isBlocked = false;
    updateProfileUI();
  }
});

async function loadCustomPhoto(){
  if(!state.user || state.isGuest) return;
  try{
    const snap = await get(ref(db, `users/${state.user.uid}/photoURL`));
    state.customPhotoURL = snap.exists() ? snap.val() : null;
    updateProfileUI();
    if($("#view-profile")?.classList.contains("show")) renderProfileView();
  }catch(e){ }
}

async function syncUserProfile(){
  if(!state.user || state.isGuest) return;
  try{
    await update(ref(db, `users/${state.user.uid}`), {
      name: state.user.displayName || "",
      email: state.user.email || ""
    });
  }catch(e){ }
}

async function loadBlockedStatus(){
  if(!state.user || state.isGuest) return;
  try{
    const snap = await get(ref(db, `users/${state.user.uid}/blocked`));
    state.isBlocked = snap.exists() && snap.val() === true;
  }catch(e){
    state.isBlocked = false;
  }
}

function showApp(){
  const welcome = $("#welcome");
  const appEl = $("#app");
  if(welcome) welcome.style.display = "none";
  if(appEl) appEl.classList.add("ready");
  if(!state.apps.length && !state._loaded){ loadCatalog(); }
  else maybeShowNotice();
}

/* ===================== LOAD CATALOG ===================== */
async function loadCatalog(){
  renderSkeletons();
  try{
    const [settingsSnap, appsSnap] = await Promise.all([
      get(ref(db, "settings")),
      get(ref(db, "apps"))
    ]);
    if(settingsSnap.exists()){
      const s = settingsSnap.val();
      state.settings = { siteName: s.siteName || "Mr Techlab Studio", tagline: s.tagline || "Premium Android App Marketplace", logoUrl: s.logoUrl || "", allowAppUploads: s.allowAppUploads !== false, allowFileUploads: s.allowFileUploads !== false, ticker: s.ticker || null, notice: s.notice || null };
    }
    applySettingsToUI();
    applyUploadAvailability();
    maybeShowNotice();

    const appsVal = appsSnap.exists() ? appsSnap.val() : {};
    const list = Object.entries(appsVal).map(([id, v])=>({ id, ...v }))
      .filter(a => a.enabled !== false);
    state.apps = list;
    state._loaded = true;

    const catSet = new Set();
    list.forEach(a => { if(a.category) catSet.add(a.category); });
    state.categories = Array.from(catSet).sort();
    if(state.activeCategory !== "all" && !state.categories.includes(state.activeCategory)) state.activeCategory = "all";

    renderChips();
    renderAll();
    finishRestore();
  }catch(err){
    state._restore = null;
    renderError();
  }
}

function applySettingsToUI(){
  document.title = state.settings.siteName + " — Premium Android App Marketplace";
  $$(".brand").forEach(el=>{ if(!el.closest("#welcome")) el.lastChild.textContent = " " + state.settings.siteName; });
  setBrandMark("#topbar-mark", state.settings.logoUrl);
  setBrandMark("#welcome-mark", state.settings.logoUrl);
  applyTicker();
  if(state.settings.logoUrl){
    const fav = $("#favicon-link");
    if(fav) fav.href = state.settings.logoUrl;
  }
}

const DEFAULT_MARK_HTML = '<img src="logo.png" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">';
function setBrandMark(selector, logoUrl){
  const el = $(selector);
  if(!el) return;
  if(!logoUrl){
    if(!el.querySelector("img")) el.innerHTML = DEFAULT_MARK_HTML;
    return;
  }
  const img = document.createElement("img");
  img.src = logoUrl;
  img.alt = "";
  img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit;";
  img.onerror = ()=>{ el.innerHTML = DEFAULT_MARK_HTML; };
  el.innerHTML = "";
  el.appendChild(img);
}

/* ===================== UI RENDERING ===================== */
function renderSkeletons(){
  const n = 6;
  ["rail-featured","rail-new","rail-updated","rail-trending"].forEach(id=>{
    const el = $("#"+id);
    if(el) el.innerHTML = Array.from({length:4}).map(()=>`<div class="skel-card" style="width:158px;flex-shrink:0;"></div>`).join("");
  });
  const gridAll = $("#grid-all");
  if(gridAll) gridAll.innerHTML = Array.from({length:n}).map(()=>`<div class="skel-card"></div>`).join("");
}

function renderError(){
  const html = `<div class="state-block">
    <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
    <h3>Unable to load apps.</h3>
    <p>Please check your internet connection and try again.</p>
    <button class="btn btn-ghost btn-sm" style="margin:16px auto 0;" onclick="location.reload()">Retry</button>
  </div>`;
  const gridAll = $("#grid-all");
  if(gridAll) gridAll.innerHTML = html;
  ["rail-featured","rail-new","rail-updated","rail-trending"].forEach(id=> {
    const el = $("#"+id);
    if(el) el.innerHTML = "";
  });
}

function emptyState(title, sub){
  return `<div class="state-block">
    <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8"/></svg>
    <h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub)}</p>
  </div>`;
}

function renderChips(){
  const cats = ["all", ...state.categories];
  const mk = (cat) => `<button class="chip ${cat===state.activeCategory?'active':''}" data-cat="${escapeHtml(cat)}">${cat==="all"?"All":escapeHtml(cat)}</button>`;
  const chipRow = $("#chip-row");
  const chipRow2 = $("#chip-row-2");
  if(chipRow) chipRow.innerHTML = cats.map(mk).join("");
  if(chipRow2) chipRow2.innerHTML = cats.filter(c=>c!=="all").map(cat=>`<button class="chip" data-cat2="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join("");
  $$("#chip-row .chip").forEach(btn=> btn.addEventListener("click", ()=>{
    state.activeCategory = btn.dataset.cat;
    renderChips();
    renderAll();
  }));
  $$("#chip-row-2 .chip").forEach(btn=> btn.addEventListener("click", ()=>{
    state.activeCategory = btn.dataset.cat2;
    switchView("home");
    renderChips();
    renderAll();
  }));
}

function catFiltered(list){
  if(state.activeCategory==="all") return list;
  return list.filter(a => (a.category || "Other") === state.activeCategory);
}

function renderAll(){
  saveSnapshot();
  const all = catFiltered(state.apps);
  const gridAll = $("#grid-all");
  if(!state.apps.length){
    if(gridAll) gridAll.innerHTML = emptyState("No apps yet", "Check back soon for new additions.");
    ["rail-featured","rail-new","rail-updated","rail-trending"].forEach(id=> {
      const el = $("#"+id);
      if(el) el.innerHTML = "";
    });
    renderCategoriesGrid();
    return;
  }
  const featured = all.filter(a=>a.featured).slice(0,10);
  const byNew = [...all].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,10);
  const byUpdated = [...all].filter(a=>a.updateNotes).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)).slice(0,10);
  const trending = [...all].sort((a,b)=>(b.downloadCount||0)-(a.downloadCount||0)).slice(0,10);

  fillRail("rail-featured", featured.length ? featured : all.slice(0,10), "No featured apps right now.");
  fillRail("rail-new", byNew, "No new apps yet.");
  fillRail("rail-updated", byUpdated, "Nothing updated recently.");
  fillRail("rail-trending", trending, "No trending apps yet.");

  if(gridAll) {
    gridAll.innerHTML = all.length ? all.map(cardHtml).join("") : emptyState("No apps in this category", "Try another category.");
    bindCardEvents(gridAll);
  }
  renderCategoriesGrid();
}

function fillRail(id, items, emptyMsg){
  const el = $("#"+id);
  if(!el) return;
  el.innerHTML = items.length ? items.map(cardHtml).join("") : `<p style="color:var(--text-faint);font-size:0.85rem;">${escapeHtml(emptyMsg)}</p>`;
  bindCardEvents(el);
}

function renderCategoriesGrid(){
  const wrap = $("#grid-categories");
  if(!wrap) return;
  if(!state.categories.length){ wrap.innerHTML = emptyState("No categories yet", "Apps will be grouped here once categorized."); return; }
  wrap.innerHTML = state.categories.map(cat=>{
    const count = state.apps.filter(a=>(a.category||"Other")===cat).length;
    return `<button class="app-card" data-cat-open="${escapeHtml(cat)}" style="padding:20px 14px;display:flex;flex-direction:column;gap:6px;min-height:auto;">
      <strong style="font-size:0.95rem;">${escapeHtml(cat)}</strong>
      <span style="color:var(--text-dim);font-size:0.78rem;">${count} app${count===1?"":"s"}</span>
    </button>`;
  }).join("");
  $$("#grid-categories [data-cat-open]").forEach(btn=> btn.addEventListener("click", ()=>{
    state.activeCategory = btn.dataset.catOpen;
    switchView("home");
    renderChips();
    renderAll();
  }));
}

/* ===================== HOST ===================== */
async function loadHostLinks(){
  const wrap = $("#host-grid");
  if(!wrap) return;
  wrap.innerHTML = `<div class="skel-card" style="min-height:150px;"></div>`.repeat(3);
  try{
    const snap = await get(ref(db, "hostLinks"));
    const val = snap.exists() ? snap.val() : {};
    state.hostLinks = Object.entries(val).map(([id,v])=>({id,...v})).filter(l=>l.enabled!==false);
    state.hostLoaded = true;
    renderHostGrid();
  }catch(err){
    wrap.innerHTML = emptyState("Unable to load", "Please check your internet connection and try again.");
  }
}

function formatMarkerText(text){
  const escaped = escapeHtml(text);
  if(!escaped.includes("/n") && !/\r\n|\r|\n/.test(escaped)) return escaped;
  return escaped.split(/\/n|\r\n|\r|\n/).map(l=>l.trim()).filter(Boolean).map(l=>`<div>• ${l}</div>`).join("");
}

function hostCardHtml(link){
  const logo = link.logoUrl
    ? `<img class="host-card-logo" src="${escapeHtml(link.logoUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'host-card-logo-fallback',textContent:'${escapeHtml((link.name||'?').charAt(0).toUpperCase())}'}))">`
    : `<div class="host-card-logo-fallback">${escapeHtml((link.name||"?").charAt(0).toUpperCase())}</div>`;
  return `<div class="host-card">
    <div class="host-card-head">
      ${logo}
      <div class="host-card-name">${escapeHtml(link.name||"Untitled")}</div>
    </div>
    ${link.description ? `<div class="host-card-desc">${formatMarkerText(link.description)}</div>` : ""}
    <div class="host-card-actions">
      <button class="btn btn-ghost" data-host-view="${escapeHtml(link.id)}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="none"/></svg>
        সেট-আপ ভিডিও
      </button>
      <button class="btn btn-primary" data-host-chrome="${escapeHtml(link.id)}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>
        Continue with Chrome
      </button>
    </div>
  </div>`;
}

function renderHostGrid(){
  const wrap = $("#host-grid");
  if(!wrap) return;
  if(!state.hostLinks.length){
    wrap.innerHTML = emptyState("No resources yet", "Hosting and Firebase links added by the team will show up here.");
    return;
  }
  wrap.innerHTML = state.hostLinks.map(hostCardHtml).join("");
  $$("#host-grid [data-host-view]").forEach(btn=> btn.addEventListener("click", ()=>{
    const link = state.hostLinks.find(l=>l.id===btn.dataset.hostView);
    if(!link || !link.videoUrl){ toast("Setup video is not available yet.", "error"); return; }
    adGate("hv:"+link.id, ()=> window.open(link.videoUrl, "_blank", "noopener"));
  }));
  $$("#host-grid [data-host-chrome]").forEach(btn=> btn.addEventListener("click", ()=>{
    const link = state.hostLinks.find(l=>l.id===btn.dataset.hostChrome);
    if(!link || !link.url){ toast("Link is not available.", "error"); return; }
    adGate("hc:"+link.id, ()=> openInChrome(link.url));
  }));
}

function openInChrome(url){
  const isAndroid = /Android/i.test(navigator.userAgent);
  if(isAndroid){
    try{
      const scheme = url.startsWith("http://") ? "http" : "https";
      const stripped = url.replace(/^https?:\/\//, "");
      window.location.href = `intent://${stripped}#Intent;scheme=${scheme};package=com.android.chrome;end`;
      return;
    }catch(e){ }
  }
  window.open(url, "_blank", "noopener");
}

/* ===================== PROMPTS ===================== */
async function loadPrompts(){
  const wrap = $("#prompt-grid");
  if(!wrap) return;
  if(state.isGuest || !state.user){ wrap.innerHTML = emptyState("Sign in to view prompts", "Create a free account or continue with Google to see and use prompts."); return; }
  wrap.innerHTML = `<div class="skel-card" style="min-height:120px;"></div>`.repeat(3);
  try{
    const snap = await get(ref(db, "prompts"));
    const val = snap.exists() ? snap.val() : {};
    state.prompts = Object.entries(val).map(([id,v])=>({id,...v})).filter(p=>p.enabled!==false);
    state.promptsLoaded = true;
    renderPromptGrid();
  }catch(err){
    wrap.innerHTML = emptyState("Unable to load", "Please check your internet connection and try again.");
  }
}

function promptCardHtml(p){
  return `<div class="host-card pc-prompt" data-pid="${escapeHtml(p.id)}">
    <div class="host-card-name">${escapeHtml(p.title||"Untitled")}</div>
    <div class="pc-prog"></div>
    <div class="pc-editor" hidden></div>
    <div class="host-card-actions">
      <button class="btn btn-ghost" data-pedit>Edit</button>
      <button class="btn btn-primary" data-copy-prompt="${escapeHtml(p.id)}">Copy</button>
    </div>
  </div>`;
}

function renderPromptGrid(){
  const wrap = $("#prompt-grid");
  if(!wrap) return;
  if(!state.prompts.length){
    wrap.innerHTML = emptyState("No prompts yet", "Prompts added by the team will show up here.");
    return;
  }
  wrap.innerHTML = state.prompts.map(promptCardHtml).join("");
  const byId = id => state.prompts.find(x=>x.id===id);
  const refresh = ()=> wrap.querySelectorAll(".pc-prompt").forEach(card=> zpProgress(byId(card.dataset.pid), card.querySelector(".pc-prog")));
  wrap.onclick = (e)=>{
    const card = e.target.closest(".pc-prompt"); if(!card) return;
    const p = byId(card.dataset.pid); if(!p) return;
    const edit = e.target.closest("[data-pedit]");
    if(edit){
      const box = card.querySelector(".pc-editor");
      if(!box.hidden){ box.hidden = true; box.innerHTML = ""; edit.textContent = "Edit"; return; }
      adGate("pe:"+p.id, ()=>{ box.innerHTML = zpEditorHtml(p); box.hidden = false; edit.textContent = "Done"; });
      return;
    }
    if(e.target.closest("[data-copy-prompt]")){
      if(!p.promptText){ toast("Nothing to copy.", "error"); return; }
      adGate("pc:"+p.id, ()=> copyToClipboard(zpBuild(p)));
    }
  };
  wrap.oninput = (e)=>{
    const i = e.target.closest("[data-pe]"); if(!i) return;
    (state.zipEdits[i.dataset.pe] = state.zipEdits[i.dataset.pe] || {})[i.dataset.k] = i.value;
    refresh();
  };
  refresh();
}

/* ===================== FILES (ZIP) ===================== */
state.zipPrompts = []; state.zipLoaded = false; state.zipEdits = {};
function zpParts(text){
  const re = /\{\{([^}]*)\}\}/g, parts = []; let last = 0, m;
  while((m = re.exec(text))){
    if(m.index > last) parts.push({t:text.slice(last, m.index)});
    parts.push({e:m[1]}); last = m.index + m[0].length;
  }
  if(last < text.length) parts.push({t:text.slice(last)});
  return parts;
}

function zpBuild(p){
  let k = 0; const ed = state.zipEdits[p.id] || {};
  return zpParts(p.promptText||"").map(x=> x.t !== undefined ? x.t : (ed[k] !== undefined ? ed[k++] : (k++, x.e))).join("");
}

function zpEditorHtml(p){
  let k = 0; const ed = state.zipEdits[p.id] || {};
  return `<div class="pc-text">` + zpParts(p.promptText||"").map(x=>{
    if(x.t !== undefined) return escapeHtml(x.t);
    const v = ed[k] !== undefined ? ed[k] : x.e;
    return `<input class="pe-input" data-pe="${escapeHtml(p.id)}" data-k="${k++}" value="${escapeHtml(v)}" style="width:${Math.max(8, v.length + 2)}ch">`;
  }).join("") + `</div>`;
}

function zpItemHtml(p){
  return `<div class="pc-item" data-pid="${escapeHtml(p.id)}">
    <div class="pc-item-row">
      <label class="pc-check"><input type="checkbox" data-pz><div class="pc-meta"><span class="pc-title">${escapeHtml(p.title||"Untitled")}</span><span class="pc-prog"></span><span class="pc-by">by ${escapeHtml(devLabel(p))}</span></div></label>
      <button class="btn btn-ghost btn-sm" data-pedit>Edit</button>
    </div>
    <div class="pc-editor" hidden></div>
  </div>`;
}

function zpStats(p){
  const ed = state.zipEdits[p.id] || {}; let total = 0, done = 0;
  zpParts(p.promptText||"").forEach(x=>{
    if(x.e === undefined) return;
    if(ed[total] !== undefined && ed[total] !== x.e) done++;
    total++;
  });
  return {total, done};
}

function zpProgress(p, t){
  if(!p || !t) return;
  const s = zpStats(p), left = s.total - s.done;
  if(!s.total){ t.textContent = "No edits needed"; t.dataset.s = "none"; return; }
  t.textContent = left ? `${s.done}/${s.total} edited · ${left} left` : `All ${s.total} edited ✓`;
  t.dataset.s = left ? (s.done ? "part" : "todo") : "done";
}

function zpRefresh(wrap){
  wrap.querySelectorAll(".pc-item").forEach(el=>{
    zpProgress(state.zipPrompts.find(x=>x.id===el.dataset.pid), el.querySelector(".pc-prog"));
  });
  wrap.querySelectorAll(".pc-cat").forEach(card=>{
    let total = 0, done = 0, n = 0;
    card.querySelectorAll(".pc-item").forEach(el=>{
      const p = state.zipPrompts.find(x=>x.id===el.dataset.pid); if(!p) return;
      const st = zpStats(p); total += st.total; done += st.done; n++;
    });
    card.querySelector(".pc-count").textContent = `${n} file${n>1?"s":""}` + (total ? ` · ${done}/${total} edited` : "");
  });
}

let zipLibPromise = null;
function loadZipLib(){
  if(window.zip) return Promise.resolve();
  if(!zipLibPromise) zipLibPromise = new Promise((res, rej)=>{
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.34/dist/zip.min.js";
    s.onload = res; s.onerror = ()=>{ zipLibPromise = null; rej(new Error("zip lib")); };
    document.head.appendChild(s);
  });
  return zipLibPromise;
}

function genFilePw(){
  const n = new Uint32Array(1); crypto.getRandomValues(n);
  return "ZIP-" + String(100000 + (n[0] % 900000));
}
/* One password per downloader per file: reused on every later download, created on the first one. */
async function getFilePassword(p){
  const uid = state.user.uid;
  const r = ref(db, `filePasswords/${p.id}/${uid}`);
  const fresh = {
    password: genFilePw(),
    fileId: p.id,
    fileTitle: p.title || "Untitled",
    fileName: (p.fileName || "").trim(),
    category: (p.category || "").trim() || "General",
    ownerUid: p.submittedBy || "admin",
    ownerName: p.submittedBy ? (p.submitterName || "Developer") : "Admin",
    userName: state.user.displayName || state.user.email || "User",
    userPhoto: getAvatarUrl() || "",
    count: 0,
    createdAt: Date.now()
  };
  const res = await runTransaction(r, cur => cur ? undefined : fresh);
  let rec = res.snapshot.val();
  if(!rec || !rec.password){ const snap = await get(r); rec = snap.val(); }
  try{ await set(ref(db, `filePasswords/${p.id}/${uid}/count`), increment(1)); }catch(e){}
  return rec.password;
}

async function downloadZipPack(catName, items){
  try{
    toast("Preparing ZIP…");
    await loadZipLib();
    const writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
    const used = new Set();
    let lockedAuto = false;
    for(const p of items){
      let name = ((p.fileName||"").trim() || ((p.title||"file").trim() + ".txt")).replace(/[\\/:*?"<>|]/g, "_");
      if(used.has(name)){ const i = name.lastIndexOf("."); let n = 2, c; do{ c = i > 0 ? `${name.slice(0,i)} (${n})${name.slice(i)}` : `${name} (${n})`; n++; }while(used.has(c)); name = c; }
      used.add(name);
      const mode = p.passwordMode === "custom" ? "custom" : p.passwordMode === "none" ? "none" : "auto";
      const opts = {};
      if(mode === "custom" && p.zipPassword) opts.password = String(p.zipPassword);
      else if(mode === "auto"){ opts.password = await getFilePassword(p); lockedAuto = true; }
      await writer.add(name, new zip.TextReader(zpBuild(p)), opts);
    }
    const blob = await writer.close();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = catName.replace(/[\\/:*?"<>|]/g, "_") + ".zip";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 4000);
    toast(lockedAuto ? "ZIP downloaded. Locked files need a password — ask the uploader." : "ZIP downloaded.", "success");
  }catch(err){ toast("ZIP failed. Check your internet connection and try again.", "error"); }
}

async function loadZipPrompts(){
  const wrap = $("#file-grid");
  if(!wrap) return;
  if(state.isGuest || !state.user){ wrap.innerHTML = emptyState("Sign in to view files", "Create a free account or continue with Google to see and download files."); return; }
  wrap.innerHTML = `<div class="skel-card" style="min-height:120px;"></div>`.repeat(3);
  try{
    const snap = await get(ref(db, "zipPrompts"));
    const val = snap.exists() ? snap.val() : {};
    state.zipPrompts = Object.entries(val).map(([id,v])=>({id,...v})).filter(p=>p.enabled!==false);
    state.zipLoaded = true;
    renderZipGrid();
  }catch(err){
    wrap.innerHTML = emptyState("Unable to load", "Please check your internet connection and try again.");
  }
}

function renderZipGrid(){
  const wrap = $("#file-grid");
  if(!wrap) return;
  if(!state.zipPrompts.length){
    wrap.innerHTML = emptyState("No files yet", "Files added by the team will show up here.");
    return;
  }
  const map = new Map();
  state.zipPrompts.forEach(p=>{ const c = (p.category||"").trim() || "General"; if(!map.has(c)) map.set(c, []); map.get(c).push(p); });
  const groups = [...map.entries()];
  wrap.innerHTML = groups.map(([cat, items], gi)=>`<div class="host-card pc-cat" data-gi="${gi}">
    <button class="pc-head" data-pcat><span>${escapeHtml(cat)}</span><span class="pc-count">${items.length}</span></button>
    <div class="pc-body" hidden>
      ${items.map(zpItemHtml).join("")}
      <button class="btn btn-primary btn-block" data-pzip>Download ZIP</button>
    </div>
  </div>`).join("");
  const byId = id => state.zipPrompts.find(x=>x.id===id);
  wrap.onclick = (e)=>{
    const head = e.target.closest("[data-pcat]");
    if(head){ const b = head.nextElementSibling; b.hidden = !b.hidden; head.classList.toggle("open", !b.hidden); return; }
    const item = e.target.closest(".pc-item");
    const edit = e.target.closest("[data-pedit]");
    if(edit && item){
      const box = item.querySelector(".pc-editor");
      if(!box.hidden){ box.hidden = true; box.innerHTML = ""; edit.textContent = "Edit"; return; }
      adGate("fe:"+item.dataset.pid, ()=>{ box.innerHTML = zpEditorHtml(byId(item.dataset.pid)); box.hidden = false; edit.textContent = "Done"; });
      return;
    }
    const zbtn = e.target.closest("[data-pzip]");
    if(zbtn){
      const card = zbtn.closest(".pc-cat"), [cat, items] = groups[+card.dataset.gi];
      const picked = [...card.querySelectorAll(".pc-item")].filter(el=> el.querySelector("[data-pz]").checked).map(el=> byId(el.dataset.pid));
      if(state.isBlocked){ toast("Downloads are currently disabled for your account. Please contact support.", "error"); return; }
      adGate("fz:"+cat, ()=> downloadZipPack(cat, picked.length ? picked : items));
    }
  };
  wrap.oninput = (e)=>{
    const i = e.target.closest("[data-pe]"); if(!i) return;
    (state.zipEdits[i.dataset.pe] = state.zipEdits[i.dataset.pe] || {})[i.dataset.k] = i.value;
    zpRefresh(wrap);
  };
  zpRefresh(wrap);
}

function cardVariant(id){
  let h = 0;
  for(let i=0;i<id.length;i++){ h = (h*31 + id.charCodeAt(i)) >>> 0; }
  return (h % 5) + 1;
}

const devLabel = (x)=> (x && x.submittedBy) ? (x.submitterName || "Developer") : "Admin";

function cardHtml(app){
  const iconHtml = app.logoUrl
    ? `<img class="card-icon" src="${escapeHtml(app.logoUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-icon-fallback',textContent:'${escapeHtml((app.name||'?').charAt(0).toUpperCase())}'}))">`
    : `<div class="card-icon-fallback">${escapeHtml((app.name||"?").charAt(0).toUpperCase())}</div>`;
  const meta = getDownloadMeta(app);
  const v = cardVariant(app.id || app.name || "app");
  return `<div class="app-card" data-app-id="${escapeHtml(app.id)}">
    <div class="card-bg v${v}"><div class="layer"></div></div>
    <span class="dev-tag">${escapeHtml(devLabel(app))}</span>
    <div class="card-body">
      ${iconHtml}
      <div class="card-name">${escapeHtml(app.name||"Untitled app")}</div>
      <div class="card-meta">${app.version ? `<span class="card-badge">v${escapeHtml(app.version)}</span>` : ""}${app.updateNotes ? `<span>Updated</span>` : ""}</div>
      <div class="card-desc">${escapeHtml(app.description||"")}</div>
      <button class="card-dl" data-dl-id="${escapeHtml(app.id)}" aria-label="${escapeHtml(meta.label)} — ${escapeHtml(app.name||'app')}">
        ${dlIconSvg(meta.type)}
        ${escapeHtml(meta.shortLabel)}
      </button>
    </div>
  </div>`;
}

function bindCardEvents(root){
  $$(".app-card[data-app-id]", root).forEach(card=>{     const id = card.dataset.appId;     card.addEventListener("click", (e)=>{       if(e.target.closest("[data-dl-id]")) return;       openDetail(id);     });   });   $$
("[data-dl-id]", root).forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      openDetail(btn.dataset.dlId);
    });
  });
}

/* ===================== SEARCH ===================== */
let searchTimer;
const searchInput = $("#search-input");
if(searchInput){
  searchInput.addEventListener("input", (e)=>{
    const v = e.target.value.trim();
    const clearBtn = $("#search-clear");
    if(clearBtn) clearBtn.classList.toggle("show", !!v);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(()=> runSearch(v), 120);
  });
}

$("#search-clear")?.addEventListener("click", ()=>{
  const input = $("#search-input");
  if(input) input.value = "";
  $("#search-clear").classList.remove("show");
  runSearch("");
});

function runSearch(q){
  const resWrap = $("#search-results-wrap");
  const homeSec = $("#home-sections");
  if(!q){
    if(resWrap) resWrap.style.display = "none";
    if(homeSec) homeSec.style.display = "";
    return;
  }
  if(resWrap) resWrap.style.display = "";
  if(homeSec) homeSec.style.display = "none";
  const ql = q.toLowerCase();
  const results = state.apps.filter(a =>
    (a.name||"").toLowerCase().includes(ql) ||
    (a.description||"").toLowerCase().includes(ql) ||
    (a.category||"").toLowerCase().includes(ql)
  );
  const el = $("#search-results");
  if(el){
    el.innerHTML = results.length ? results.map(cardHtml).join("") : emptyState("No apps found", "Try another search.");
    bindCardEvents(el);
  }
}

/* ===================== APP DETAIL SHEET ===================== */
function openDetail(id){
  const app = state.apps.find(a=>a.id===id);
  if(!app) return;
  const iconHtml = app.logoUrl
    ? `<img class="detail-icon" src="${escapeHtml(app.logoUrl)}" alt="" onerror="this.style.display='none'">`
    : `<div class="detail-icon card-icon-fallback" style="width:78px;height:78px;font-size:1.6rem;">${escapeHtml((app.name||"?").charAt(0).toUpperCase())}</div>`;
  const shots = Array.isArray(app.screenshots) ? app.screenshots : (app.screenshots ? Object.values(app.screenshots) : []);
  const hero = $("#detail-hero");
  if(hero){
    hero.innerHTML = `
      <div class="detail-hero">
        ${iconHtml}
        <div>
          <div class="detail-name">${escapeHtml(app.name||"Untitled app")}</div>
          <div class="detail-meta-row">
            ${app.version ? `<span class="card-badge">v${escapeHtml(app.version)}</span>` : ""}
            ${app.category ? `<span>${escapeHtml(app.category)}</span>` : ""}
            <span>by ${escapeHtml(devLabel(app))}</span>
          </div>
        </div>
      </div>`;
  }
  const content = $("#detail-content");
  if(content){
    content.innerHTML = `
      ${app.description ? `<div class="detail-section"><h4>About</h4><p>${escapeHtml(app.description)}</p></div>` : ""}
      ${shots.length ? `<div class="detail-section"><h4>Screenshots</h4><div class="shots-row">${shots.map(s=>`<img src="${escapeHtml(s)}" alt="" loading="lazy">`).join("")}</div></div>` : ""}
      ${app.updateNotes ? `<div class="detail-section"><h4>What's new</h4><p>${escapeHtml(app.updateNotes)}</p></div>` : ""}
      ${app.instructions ? `<div class="detail-section"><h4>Instructions</h4><p>${escapeHtml(app.instructions)}</p></div>` : ""}
    `;
  }

  state.detailApp = app;
  const meta = getDownloadMeta(app);
  const dlBtn = $("#detail-dl-btn");
  if(dlBtn) dlBtn.innerHTML = `${dlIconSvg(meta.type)} ${escapeHtml(meta.label)}`;
  $("#detail-overlay")?.classList.add("show");
  $("#detail-sheet")?.classList.add("show");
  document.body.classList.add("sheet-open");
  
  history.pushState({type:"overlay", overlay:"detail"}, "", location.href);
}

$("#detail-dl-btn")?.addEventListener("click", ()=>{ if(state.detailApp) requestDownload(state.detailApp); });
$("#detail-close")?.addEventListener("click", ()=> history.back());
$("#detail-overlay")?.addEventListener("click", ()=> history.back());

/* ===================== AD GATE & DOWNLOAD FLOW ===================== */
const SMARTLINK_URL = "https://www.profitableratecpmnetwork.com/khhb0sxa?key=a5b50548384953d1a4866f2b52283023";
const AD_CLICKS_NEEDED = 2;
state.adClicks = {};

function requireAccount(){
  if(state.isGuest || !state.user){ toast("Please sign in to use this. Guest mode can only browse.", "error"); return false; }
  return true;
}

function adGate(key, run){
  if(!requireAccount()) return;
  const n = state.adClicks[key] || 0;
  if(n >= AD_CLICKS_NEEDED){ state.adClicks[key] = 0; saveSnapshot(); run(); return; }

  // অ্যাড খোলার আগেই অবস্থা সেভ — যাতে অ্যাড থেকে ফিরে এসে পেজ রিলোড হলেও আগের জায়গায় ফেরা যায়
  state.adClicks[key] = n + 1;
  saveSnapshot();

  let w = null;
  try {
    w = window.open(SMARTLINK_URL, "_blank");
    if(w) w.opener = null;
  } catch(e) {
    w = null;
  }

  if(!w){
    state.adClicks[key] = n;
    saveSnapshot();
    toast("Please allow pop-ups for this site, then tap again.", "error");
    return;
  }

  const left = AD_CLICKS_NEEDED - state.adClicks[key];
  toast(left ? `Ad opened. Tap ${left} more time${left>1?"s":""} to continue.` : "Ad opened. Tap once more to continue.");
}

function requestDownload(app){
  if(state.isGuest || !state.user){
    openGate(app);
    return;
  }
  if(state.isBlocked){
    toast("Downloads are currently disabled for your account. Please contact support.", "error");
    return;
  }
  adGate("dl:"+app.id, ()=> startDownload(app));
}

async function startDownload(app){
  if(state.downloadInFlight) return;
  const meta = getDownloadMeta(app);
  const url = resolveDownloadUrl(app.downloadUrl);
  if(!url){
    toast(meta.errorMsg, "error");
    return;
  }
  state.downloadInFlight = true;
  toast(meta.type === "play_store" ? "Opening Google Play..." : "Preparing download...");
  try{
    await logAnalytics(app, meta.type);
    await recordDownloadHistory(app, url, meta.type);
    setTimeout(()=>{
      toast(meta.type === "play_store" ? "Opening Google Play..." : "Starting download...", "success");
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      state.downloadInFlight = false;
    }, 450);
  }catch(err){
    toast("Something went wrong.", "error");
    state.downloadInFlight = false;
  }
}

async function logAnalytics(app, downloadType){
  try{
    const entry = {
      appId: app.id,
      downloadType: downloadType || "direct_apk",
      timestamp: Date.now(),
      clientTime: new Date().toISOString()
    };
    if(state.user && !state.isGuest) entry.uid = state.user.uid;
    await push(ref(db, "analytics"), entry);
  }catch(e){ }
}

async function recordDownloadHistory(app, resolvedUrl, downloadType){
  if(!state.user || state.isGuest) return;
  try{
    const entry = {
      appId: app.id,
      name: app.name || "Untitled app",
      version: app.version || "",
      logoUrl: app.logoUrl || "",
      downloadUrl: resolvedUrl,
      downloadType: downloadType || "direct_apk",
      timestamp: Date.now()
    };
    await set(ref(db, `users/${state.user.uid}/downloads/${app.id}`), entry);
  }catch(e){ }
}

/* ===================== MY DOWNLOADS VIEW ===================== */
async function renderDownloadsView(){
  const wrap = $("#downloads-list");
  if(!wrap) return;
  if(state.isGuest || !state.user){
    wrap.innerHTML = emptyState("Sign in to see your downloads", "Guest download history isn't saved to an account.");
    return;
  }
  wrap.innerHTML = `<div class="skel-card" style="height:64px;margin-bottom:10px;"></div>`.repeat(4);
  try{
    const snap = await get(ref(db, `users/${state.user.uid}/downloads`));
    if(!snap.exists()){
      wrap.innerHTML = emptyState("No downloads yet", "Apps you download will show up here.");
      return;
    }
    const entries = Object.entries(snap.val()).map(([id,v])=>({id,...v})).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
    wrap.innerHTML = entries.map(e=>{
      const icon = e.logoUrl ? `<img src="${escapeHtml(e.logoUrl)}" alt="" onerror="this.style.display='none'">` : `<div class="card-icon-fallback">${escapeHtml((e.name||"?").charAt(0).toUpperCase())}</div>`;
      const date = e.timestamp ? new Date(e.timestamp).toLocaleDateString() : "";
      const isPlay = e.downloadType === "play_store";
      const liveApp = state.apps.find(a => a.id === e.appId);
      const liveVersion = liveApp ? (liveApp.version || "") : null;
      const hasUpdate = !isPlay && liveApp && liveVersion && liveVersion !== (e.version || "");

      let statusText, btnLabel, disabledAttr, btnCls;
      if(isPlay){
        statusText = "Opened Google Play";
        btnLabel = "Open Google Play";
        disabledAttr = "";
        btnCls = "btn-ghost";
      } else if(hasUpdate){
        statusText = `v${escapeHtml(e.version||"—")} → v${escapeHtml(liveVersion)}`;
        btnLabel = "Update";
        disabledAttr = "";
        btnCls = "btn-primary";
      } else {
        statusText = e.version ? "v"+escapeHtml(e.version) : "Downloaded";
        btnLabel = "Downloaded";
        disabledAttr = "disabled";
        btnCls = "btn-ghost";
      }

      return `<div class="dl-row">
        ${icon}
        <div class="info">
          <div class="n">${escapeHtml(e.name||"Untitled app")}</div>
          <div class="m">${statusText} · ${escapeHtml(date)}</div>
        </div>
        <button class="btn ${btnCls} btn-sm" ${disabledAttr} data-appid="${escapeHtml(e.appId||"")}" data-isupdate="${hasUpdate?"1":"0"}" data-isplay="${isPlay?"1":"0"}" data-redl="${escapeHtml(e.downloadUrl||"")}">${btnLabel}</button>
      </div>`;
    }).join("");
    $$("#downloads-list [data-appid]").forEach(btn=>{
      if(btn.disabled) return;
      btn.addEventListener("click", ()=>{
        if(state.isBlocked){
          toast("Downloads are currently disabled for your account. Please contact support.", "error");
          return;
        }
        adGate("rdl:"+btn.dataset.appid+":"+btn.dataset.redl, async ()=>{
          const isUpdate = btn.dataset.isupdate === "1";
          const isPlay = btn.dataset.isplay === "1";
          if(isUpdate || isPlay){
            const liveApp = state.apps.find(a => a.id === btn.dataset.appid);
            if(liveApp){ await startDownload(liveApp); renderDownloadsView(); return; }
          }
          const url = btn.dataset.redl;
          if(!url){ toast("Download link is not available.", "error"); return; }
          const a = document.createElement("a"); a.href=url; a.target="_blank"; a.rel="noopener"; document.body.appendChild(a); a.click(); a.remove();
        });
      });
    });
  }catch(err){
    wrap.innerHTML = emptyState("Unable to load downloads", "Please check your internet connection.");
  }
}

/* ===================== PROFILE VIEW ===================== */
function updateProfileUI(){
  const btn = $("#btn-profile");
  if(!btn) return;
  if(state.user && !state.isGuest){
    const photo = getAvatarUrl();
    if(photo){
      btn.innerHTML = `<img src="${escapeHtml(photo)}" alt="">`;
    }else{
      btn.textContent = (state.user.displayName||state.user.email||"?").charAt(0).toUpperCase();
    }
  }else{
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6"/></svg>`;
  }
}

async function uploadProfilePhoto(file){
  if(!state.user || state.isGuest) return;
  if(!file.type || !file.type.startsWith("image/")){
    toast("Please choose an image file.", "error");
    return;
  }
  if(!IMGBB_API_KEY || IMGBB_API_KEY === "YOUR_IMGBB_API_KEY"){
    toast("Photo upload isn't configured yet.", "error");
    return;
  }
  state.photoUploading = true;
  renderProfileView();
  toast("Uploading photo...");
  try{
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: "POST",
      body: form
    });
    const data = await res.json();
    if(!res.ok || !data || !data.success || !data.data || !data.data.url){
      throw new Error("upload failed");
    }
    const url = data.data.url;
    await set(ref(db, `users/${state.user.uid}/photoURL`), url);
    state.customPhotoURL = url;
    toast("Profile photo updated.", "success");
  }catch(err){
    toast("Photo upload failed. Please try again.", "error");
  }finally{
    state.photoUploading = false;
    updateProfileUI();
    renderProfileView();
  }
}

function renderProfileView(){
  const card = $("#profile-card");
  const menu = $("#profile-menu");
  if(!card || !menu) return;
  if(state.user && !state.isGuest){
    const photo = getAvatarUrl();
    const avatar = photo
      ? `<img class="profile-avatar" src="${escapeHtml(photo)}" alt="">`
      : `<div class="profile-avatar-fallback">${escapeHtml((state.user.displayName||state.user.email||"?").charAt(0).toUpperCase())}</div>`;
    card.innerHTML = `<div style="position:relative;flex-shrink:0;">
        ${avatar}
        <button class="icon-btn" id="btn-change-avatar" aria-label="Change profile photo"
          style="position:absolute;right:-4px;bottom:-4px;width:24px;height:24px;background:var(--accent);border-color:transparent;color:#fff;">
          ${state.photoUploading
            ? '<span class="spinner" style="width:11px;height:11px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;display:inline-block;animation:spin .7s linear infinite;"></span>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="3.5"/></svg>'}
        </button>
        <input type="file" id="avatar-file-input" accept="image/*" style="display:none;">
      </div>
      <div>
        <div style="font-weight:600;">${escapeHtml(state.user.displayName||"Account")}</div>
        <div style="font-size:0.82rem;color:var(--text-dim);">${escapeHtml(state.user.email||"")}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color:var(--text-faint);flex-shrink:0;"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5"/></svg>
          <span style="font-size:0.72rem;color:var(--text-faint);word-break:break-all;">${escapeHtml(state.user.uid)}</span>
          <button class="icon-btn" id="btn-copy-uid" aria-label="Copy user ID" style="width:22px;height:22px;flex-shrink:0;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
          </button>
        </div>
        <div style="font-size:0.74rem;color:var(--teal);margin-top:5px;">Active</div>
      </div>`;
    $("#btn-copy-uid")?.addEventListener("click", ()=> copyToClipboard(state.user.uid));
    $("#btn-change-avatar")?.addEventListener("click", ()=>{
      if(state.photoUploading) return;
      $("#avatar-file-input")?.click();
    });
    $("#avatar-file-input")?.addEventListener("change", (e)=>{
      const file = e.target.files && e.target.files[0];
      if(file) uploadProfilePhoto(file);
    });
    menu.innerHTML = `
      <button class="menu-item" data-view="downloads"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>My Downloads</button>
      <button class="menu-item" data-view="prompts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>Prompts</button>
      <button class="menu-item" data-view="upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>Upload App / File</button>
      <button class="menu-item" data-page="privacy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>Privacy Policy</button>
      <button class="menu-item" data-page="terms"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5"/></svg>Terms of Service</button>
      <button class="menu-item" data-page="about"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>About</button>
      <button class="menu-item danger" id="btn-signout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>Sign Out</button>
    `;
    $("#btn-signout")?.addEventListener("click", async ()=>{ await signOut(auth); state.isGuest=false; clearSnapshot(); $("#welcome").style.display="flex"; $("#app").classList.remove("ready"); });
  } else {
    card.innerHTML = `<div class="profile-avatar-fallback">G</div>
      <div>
        <div style="font-weight:600;">Guest Mode</div>
        <div style="font-size:0.82rem;color:var(--text-dim);">Sign in to download apps</div>
      </div>`;
    menu.innerHTML = `
      <button class="menu-item" id="btn-profile-signin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/></svg>Sign In</button>
      <button class="menu-item" data-view="prompts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>Prompts</button>
      <button class="menu-item" data-page="privacy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>Privacy Policy</button>
      <button class="menu-item" data-page="terms"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5"/></svg>Terms of Service</button>
      <button class="menu-item" data-page="about"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>About</button>
    `;
    $("#btn-profile-signin")?.addEventListener("click", ()=>{ $("#welcome").style.display="flex"; $("#app").classList.remove("ready"); });
  }
  bindNavTriggers(menu);
}

/* ===================== ROUTING & BACK-BUTTON FIX ===================== */
const views = ["home","host","prompts","files","upload","categories","downloads","profile","privacy","terms","about","contact"];

function applyView(name){
  state.currentView = name;
  views.forEach(v=> {
    const el = $("#view-"+v);
    if(el) el.classList.toggle("show", v===name);
  });
  $$(".nav-item[data-view]").forEach(el=> el.classList.toggle("active", el.dataset.view===name));   $$
("#desktop-nav a[data-view]").forEach(el=> el.classList.toggle("active", el.dataset.view===name));
  window.scrollTo({top:0, behavior:"instant" in window ? "instant" : "auto"});
  lastScrollY = 0;
  saveSnapshot();
  if(name==="downloads") renderDownloadsView();
  if(name==="profile") renderProfileView();
  if(name==="categories") renderCategoriesGrid();
  if(name==="upload") renderMyUploads();
  if(name==="host"){ if(state.hostLoaded) renderHostGrid(); else loadHostLinks(); }
  if(name==="prompts"){ if(state.promptsLoaded) renderPromptGrid(); else loadPrompts(); }
  if(name==="files"){ if(state.zipLoaded) renderZipGrid(); else loadZipPrompts(); }
}

function switchView(name){
  const changed = state.currentView !== name;
  applyView(name);
  if(changed) history.pushState({type:"view", view:name}, "", location.href);
}

function closeDetailUI(){
  $("#detail-overlay")?.classList.remove("show");
  $("#detail-sheet")?.classList.remove("show");
  document.body.classList.remove("sheet-open");
}

function closeGateUI(){
  $("#gate-overlay")?.classList.remove("show");
  $("#gate-modal")?.classList.remove("show");
}

window.addEventListener("popstate", (e)=>{
  const st = e.state;
  const detailSheet = $("#detail-sheet");
  const gateModal = $("#gate-modal");
  const detailOpen = detailSheet ? detailSheet.classList.contains("show") : false;
  const gateOpen = gateModal ? gateModal.classList.contains("show") : false;
  const targetIsDetail = !!(st && st.type === "overlay" && st.overlay === "detail");
  const targetIsGate = !!(st && st.type === "overlay" && st.overlay === "gate");
  let overlayClosed = false;
  if(detailOpen && !targetIsDetail){ closeDetailUI(); overlayClosed = true; }
  if(gateOpen && !targetIsGate){ closeGateUI(); overlayClosed = true; }
  if(noticeIsOpen() && !(st && st.type === "overlay" && st.overlay === "notice")){ hideNotice(); overlayClosed = true; }
  if(st && st.type === "view"){
    // sheet বন্ধ করার সময় একই পেজ আবার রিলোড/স্ক্রল-টপ করা হবে না
    if(!(overlayClosed && st.view === state.currentView)) applyView(st.view);
  } else if(!st){
    applyView(state.currentView || "home");
  }
  saveSnapshot();
});

function bindNavTriggers(root=document){
  $$("[data-view]", root).forEach(el=>{
    el.addEventListener("click", (e)=>{ e.preventDefault(); switchView(el.dataset.view); });
  });
  $$("[data-page]", root).forEach(el=>{
    el.addEventListener("click", (e)=>{ e.preventDefault(); switchView(el.dataset.page); });
  });
  $$("[data-back]", root).forEach(el=>{
    el.addEventListener("click", (e)=>{ e.preventDefault(); switchView("home"); });
  });
}

bindNavTriggers();
$("#btn-profile")?.addEventListener("click", ()=> switchView("profile"));
$("#btn-refresh")?.addEventListener("click", ()=> loadCatalog());

/* ===================== BOOT ===================== */
const yearEl = $("#year");
if(yearEl) yearEl.textContent = new Date().getFullYear();
const privacyDateEl = $("#privacy-date");
if(privacyDateEl) privacyDateEl.textContent = new Date().toLocaleDateString();

history.replaceState({type:"view", view:"home"}, "", location.href);

/* ===================== SESSION RESTORE ===================== */
/* অ্যাড/অন্য পেজ থেকে ব্যাক করে এলে অ্যাপ রিলোড হলেও আগের অবস্থায় ফেরার জন্য */
const SNAP_KEY = "mtl_session_v1";
const SNAP_TTL = 20 * 60 * 1000;
let lastScrollY = 0;

function readSnapshot(){
  try{
    const raw = localStorage.getItem(SNAP_KEY);
    if(!raw) return null;
    const sn = JSON.parse(raw);
    if(!sn || !sn.ts || Date.now() - sn.ts > SNAP_TTL) return null;
    return sn;
  }catch(e){ return null; }
}
function saveSnapshot(){
  if(!bootResolved || state._restore) return;
  try{
    const sheetOpen = !!$("#detail-sheet")?.classList.contains("show");
    localStorage.setItem(SNAP_KEY, JSON.stringify({
      ts: Date.now(),
      guest: !!state.isGuest && !state.user,
      view: state.currentView,
      cat: state.activeCategory,
      detailId: (sheetOpen && state.detailApp) ? state.detailApp.id : null,
      scroll: lastScrollY,
      adClicks: state.adClicks
    }));
  }catch(e){}
}
function clearSnapshot(){ try{ localStorage.removeItem(SNAP_KEY); }catch(e){} }
function restoreSession(sn){
  if(!sn) return;
  state._restore = { detailId: sn.detailId || null, scroll: sn.scroll || 0 };
  if(sn.adClicks && typeof sn.adClicks === "object") state.adClicks = sn.adClicks;
  if(sn.cat) state.activeCategory = sn.cat;
  if(sn.view && sn.view !== "home" && views.includes(sn.view)){
    applyView(sn.view);
    history.replaceState({type:"view", view:sn.view}, "", location.href);
  }
}
function finishRestore(){
  const r = state._restore;
  if(!r) return;
  state._restore = null;
  if(r.scroll) window.scrollTo(0, r.scroll);
  lastScrollY = r.scroll || 0;
  if(r.detailId && state.apps.some(a=>a.id===r.detailId)) openDetail(r.detailId);
  saveSnapshot();
}
window.addEventListener("scroll", ()=>{
  if(!document.body.classList.contains("sheet-open")) lastScrollY = window.scrollY || 0;
}, {passive:true});
window.addEventListener("pagehide", saveSnapshot);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "hidden") saveSnapshot(); });

getRedirectResult(auth).catch(()=>{});

let bootResolved = false;
function resolveBoot(user){
  if(bootResolved) return;
  const snap = readSnapshot();
  bootResolved = true;
  const bootEl = $("#boot");
  if(bootEl) bootEl.style.display = "none";
  if(!user && snap && snap.guest){ state.isGuest = true; showApp(); }
  if(!user && !state.isGuest){
    const welcome = $("#welcome");
    if(welcome) welcome.style.display = "flex";
    return;
  }
  restoreSession(snap);
}

setTimeout(()=> resolveBoot(state.user), 4000);

/* ===================== EXPORTS ===================== */
export {
  auth,
  db,
  state,
  loadCatalog,
  switchView,
  openDetail,
  startDownload
};

/* ===================== UPLOAD — app + file in one place (stays pending until an admin approves) ===================== */
state.upTab = "app";
state.upIcon = "";
state.upShots = [];
state.upBusy = false;
state.fuBusy = false;
const UP_MAX_SHOTS = 5;
const FU_MAX_TEXT = 100000;
const upUrlLabels = {
  direct_apk: "Direct download URL (APK or any file) *",
  google_drive: "Google Drive file URL *",
  play_store: "Google Play Store URL *"
};
const upAttr = (v)=> escapeHtml(v).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ---- availability (developer account + admin switches) ---- */
const isDev = ()=> !!(state.user && !state.isGuest && state.dev && state.dev.blocked !== true);
function uploadsAllowed(kind){
  if(state.isBlocked || !isDev()) return false;
  return kind === "file" ? state.settings.allowFileUploads !== false : state.settings.allowAppUploads !== false;
}
function applyUploadAvailability(){
  const gate = $("#dev-gate"), main = $("#up-main"), blocked = $("#dev-blocked"), signin = $("#dev-signin");
  if(!gate || !main) return;
  const signed = !!(state.user && !state.isGuest);
  signin.hidden = signed;
  gate.hidden = !(signed && !state.dev);
  blocked.hidden = !(signed && state.dev && state.dev.blocked === true);
  main.hidden = !isDev();
  if(!gate.hidden && !state.devGateReady){ state.devGateReady = true; devGateInit(); }
  const app = $("#up-app-form"), file = $("#up-file-form"), off = $("#up-off");
  if(!app || !file || !off) return;
  const ok = uploadsAllowed(state.upTab);
  app.hidden = !(ok && state.upTab === "app");
  file.hidden = !(ok && state.upTab === "file");
  off.hidden = ok || !isDev();
  off.textContent = state.isBlocked ? "Uploads are disabled for your account." : "Uploads are turned off by the admin right now.";
}
function setUpTab(tab){
  state.upTab = tab === "file" ? "file" : "app";
  $$("#up-tabs .up-tab").forEach(b=> b.classList.toggle("active", b.dataset.upTab === state.upTab));
  applyUploadAvailability();
}
document.addEventListener("click", (e)=>{
  const b = e.target.closest("[data-up-tab]");
  if(b) setUpTab(b.dataset.upTab);
});

/* ---- image upload helper (icon + screenshots) ---- */
async function upUploadImage(file){
  if(!file.type || !file.type.startsWith("image/")) throw new Error("type");
  if(!IMGBB_API_KEY || IMGBB_API_KEY === "YOUR_IMGBB_API_KEY") throw new Error("nokey");
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method:"POST", body:form });
  const data = await res.json();
  if(!res.ok || !data || !data.success || !data.data || !data.data.url) throw new Error("fail");
  return data.data.url;
}
function upImgError(e){
  const m = e && e.message;
  toast(m === "nokey" ? "Image upload isn't configured yet." : m === "type" ? "Please choose an image file." : "Image upload failed. Try again.", "error");
}

/* ---- APP form ---- */
$("#up-type").addEventListener("change", ()=>{ $("#up-url-label").textContent = upUrlLabels[$("#up-type").value] || upUrlLabels.direct_apk; });
$("#up-icon-btn").addEventListener("click", ()=> $("#up-icon-file").click());
$("#up-icon-file").addEventListener("change", async (e)=>{
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  const btn = $("#up-icon-btn");
  btn.disabled = true; btn.textContent = "Uploading…";
  try{
    state.upIcon = await upUploadImage(f);
    const p = $("#up-icon-prev"); p.src = state.upIcon; p.hidden = false;
  }catch(err){ upImgError(err); }
  finally{ btn.disabled = false; btn.textContent = state.upIcon ? "Change icon" : "Choose icon"; }
});
function renderUpShots(){
  $("#up-shots").innerHTML = state.upShots.map((u,i)=>
    `<div class="up-shot"><img src="${upAttr(u)}" alt=""><button type="button" data-rm-shot="${i}" aria-label="Remove screenshot">×</button></div>`
  ).join("");
  $("#up-shot-btn").hidden = state.upShots.length >= UP_MAX_SHOTS;
}
$("#up-shot-btn").addEventListener("click", ()=> $("#up-shot-file").click());
$("#up-shot-file").addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []).slice(0, UP_MAX_SHOTS - state.upShots.length);
  e.target.value = "";
  if(!files.length) return;
  const btn = $("#up-shot-btn");
  btn.disabled = true; btn.textContent = "Uploading…";
  try{
    for(const f of files){ state.upShots.push(await upUploadImage(f)); renderUpShots(); }
  }catch(err){ upImgError(err); }
  finally{ btn.disabled = false; btn.textContent = "Add screenshots"; renderUpShots(); }
});
$("#up-shots").addEventListener("click", (e)=>{
  const b = e.target.closest("[data-rm-shot]"); if(!b) return;
  state.upShots.splice(Number(b.dataset.rmShot), 1);
  renderUpShots();
});
$("#up-submit").addEventListener("click", async ()=>{
  const err = $("#up-error"); err.textContent = "";
  if(!state.user || state.isGuest){ err.textContent = "Sign in to upload."; return; }
  if(!uploadsAllowed("app")){ err.textContent = "Uploads are not available right now."; return; }
  if(state.upBusy) return;
  const name = $("#up-name").value.trim();
  const url = $("#up-url").value.trim();
  if(!name){ err.textContent = "Enter a name."; return; }
  if(!/^https:\/\/\S+$/i.test(url)){ err.textContent = "Enter a valid https:// download URL."; return; }
  state.upBusy = true;
  const btn = $("#up-submit"); btn.disabled = true;
  const now = Date.now();
  const payload = {
    name,
    version: $("#up-version").value.trim(),
    category: $("#up-category").value.trim(),
    logoUrl: state.upIcon,
    description: $("#up-desc").value.trim(),
    updateNotes: $("#up-notes").value.trim(),
    instructions: $("#up-instr").value.trim(),
    screenshots: state.upShots.slice(),
    downloadType: $("#up-type").value,
    downloadUrl: url,
    enabled: false,
    featured: false,
    status: "pending",
    submittedBy: state.user.uid,
    submitterName: state.dev.name,
    createdAt: now,
    updatedAt: now
  };
  try{
    await set(push(ref(db, "apps")), payload);
    ["#up-name","#up-version","#up-category","#up-desc","#up-notes","#up-instr","#up-url"].forEach(id=> $(id).value = "");
    $("#up-type").value = "direct_apk";
    $("#up-url-label").textContent = upUrlLabels.direct_apk;
    state.upIcon = ""; state.upShots = [];
    $("#up-icon-prev").hidden = true; $("#up-icon-btn").textContent = "Choose icon";
    renderUpShots();
    toast("Submitted. It will appear after admin approval.", "success");
    renderMyUploads();
  }catch(e){
    err.textContent = "Upload failed. Check your connection and try again.";
  }finally{
    state.upBusy = false; btn.disabled = false;
  }
});

/* ---- FILE form (text-based files only — nothing is uploaded as a ZIP) ---- */
const fuMode = ()=> ($("input[name=fu-pwmode]:checked") || {}).value || "auto";
const fuHints = {
  auto: "Every downloader automatically gets their own password. You can see and copy them under \"Downloads of my files\".",
  custom: "One password you choose, used for everyone who downloads this file.",
  none: "The ZIP opens without a password."
};
function fuApplyMode(){
  $("#fu-pass-wrap").hidden = fuMode() !== "custom";
  $("#fu-pw-hint").textContent = fuHints[fuMode()];
}
$$("input[name=fu-pwmode]").forEach(r=> r.addEventListener("change", fuApplyMode));
fuApplyMode();

$("#fu-import-btn").addEventListener("click", ()=> $("#fu-import").click());
$("#fu-import").addEventListener("change", async (e)=>{
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  if(/\.(zip|rar|7z|apk|exe|png|jpe?g|gif|webp|mp3|mp4|pdf)$/i.test(f.name)){
    toast("Only text-based files can be read here. ZIPs and other binary files aren't uploaded.", "error"); return;
  }
  if(f.size > FU_MAX_TEXT){ toast("File is too large (max 100 KB of text).", "error"); return; }
  try{
    const text = await f.text();
    if(text.indexOf("\u0000") !== -1){ toast("Only text-based files can be read here.", "error"); return; }
    $("#fu-text").value = text;
    $("#fu-filename").value = f.name;
    if(!$("#fu-title").value.trim()) $("#fu-title").value = f.name;
    toast("File name and text filled in.", "success");
  }catch(err){ toast("Could not read that file.", "error"); }
});
$("#fu-submit").addEventListener("click", async ()=>{
  const err = $("#fu-error"); err.textContent = "";
  if(!state.user || state.isGuest){ err.textContent = "Sign in to upload."; return; }
  if(!uploadsAllowed("file")){ err.textContent = "Uploads are not available right now."; return; }
  if(state.fuBusy) return;
  const title = $("#fu-title").value.trim();
  const text = $("#fu-text").value.trim();
  if(!title){ err.textContent = "Enter a display name."; return; }
  if(!text){ err.textContent = "Add the file text or choose a file."; return; }
  if(text.length > FU_MAX_TEXT){ err.textContent = "Text is too long (max 100,000 characters)."; return; }
  const mode = fuMode();
  let password = "";
  if(mode === "custom"){
    password = $("#fu-pass").value.trim();
    if(password.length < 4 || password.length > 64){ err.textContent = "Password must be 4–64 characters."; return; }
  }
  state.fuBusy = true;
  const btn = $("#fu-submit"); btn.disabled = true;
  const payload = {
    title,
    promptText: text,
    category: $("#fu-category").value.trim(),
    fileName: $("#fu-filename").value.trim(),
    passwordMode: mode,
    zipPassword: password,
    enabled: false,
    status: "pending",
    submittedBy: state.user.uid,
    submitterName: state.dev.name,
    createdAt: Date.now()
  };
  try{
    await set(push(ref(db, "zipPrompts")), payload);
    ["#fu-category","#fu-title","#fu-filename","#fu-text","#fu-pass"].forEach(id=> $(id).value = "");
    { const r0 = $("input[name=fu-pwmode][value=auto]"); if(r0) r0.checked = true; fuApplyMode(); }
    toast("Submitted. It will appear after admin approval.", "success");
    renderMyUploads();
  }catch(e){
    err.textContent = "Upload failed. Check your connection and try again.";
  }finally{
    state.fuBusy = false; btn.disabled = false;
  }
});

/* ---- My uploads (apps + files together) ---- */
document.addEventListener("click", (e)=>{
  const b = e.target.closest("[data-copy-pw]");
  if(b) copyToClipboard(b.dataset.copyPw);
});
async function renderMyUploads(){
  applyUploadAvailability();
  const wrap = $("#my-uploads"); if(!wrap) return;
  if(!isDev()){ wrap.innerHTML = ""; return; }
  wrap.innerHTML = '<div class="up-empty">Loading…</div>';
  try{
    const [aSnap, fSnap] = await Promise.all([get(ref(db, "apps")), get(ref(db, "zipPrompts"))]);
    const aVal = aSnap.exists() ? aSnap.val() : {};
    const fVal = fSnap.exists() ? fSnap.val() : {};
    const uid = state.user.uid;
    const items = [];
    Object.entries(aVal).forEach(([id,a])=>{ if(a.submittedBy === uid) items.push({ ...a, id, type:"App", label:a.name }); });
    Object.entries(fVal).forEach(([id,p])=>{ if(p.submittedBy === uid) items.push({ ...p, id, type:"File", label:p.title }); });
    items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));

    // category suggestions for the file form
    const cats = Array.from(new Set(Object.values(fVal).filter(p=> p.enabled !== false).map(p=> (p.category||"").trim()).filter(Boolean))).sort();
    $("#fu-cats").innerHTML = cats.map(c=> `<option value="${upAttr(c)}"></option>`).join("");

    loadDevDownloads(Object.entries(fVal).filter(([id,p])=> p.submittedBy === uid).map(([id,p])=>({ id, title:p.title, category:p.category, fileName:p.fileName })));
    if(!items.length){ wrap.innerHTML = '<div class="up-empty">You haven\'t uploaded anything yet.</div>'; return; }
    wrap.innerHTML = items.map(a=>{
      const st = a.status === "pending" ? ["pending","Pending approval"]
               : a.status === "rejected" ? ["rejected","Rejected"]
               : a.enabled !== false ? ["live","Live"] : ["hidden","Hidden"];
      const meta = [a.type, a.type === "App" && a.version ? "v" + a.version : (a.category || ""), a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ""].filter(Boolean).map(escapeHtml).join(" · ");
      const pw = "";
      return `<div class="up-item">
        <div class="up-item-top"><div class="up-item-name">${escapeHtml(a.label || "Untitled")}</div><span class="up-badge ${st[0]}">${st[1]}</span></div>
        <div class="up-item-meta">${meta}</div>${pw}
      </div>`;
    }).join("");
  }catch(e){
    wrap.innerHTML = '<div class="up-empty">Could not load your uploads.</div>';
  }
}


/* ---- Downloads of my files (who downloaded + their password) ---- */
const dvAv = (name, photo)=> /^https:\/\//i.test(photo || "")
  ? `<img class="dl-av" src="${upAttr(photo)}" alt="" loading="lazy" onerror="this.style.display='none'">`
  : `<div class="dl-av dl-av-f">${escapeHtml((name || "?").trim().charAt(0).toUpperCase() || "?")}</div>`;
const pwLine = (name, pw)=> `${name} --- ${pw}`;
const attrNL = (v)=> upAttr(v).replace(/\n/g, "&#10;");
function groupDownloads(rows){
  const m = new Map();
  rows.forEach(r=>{
    let u = m.get(r.uid);
    if(!u){ u = { uid:r.uid, name:r.userName, photo:r.userPhoto, last:0, cats:new Map() }; m.set(r.uid, u); }
    u.last = Math.max(u.last, r.createdAt || 0);
    const c = r.category || "General";
    if(!u.cats.has(c)) u.cats.set(c, []);
    u.cats.get(c).push(r);
  });
  return Array.from(m.values()).sort((a,b)=> b.last - a.last);
}
async function loadDevDownloads(files){
  const box = $("#dev-downloads"); if(!box) return;
  if(!files.length){ box.innerHTML = '<div class="up-empty">Upload a file to see who downloads it.</div>'; return; }
  box.innerHTML = '<div class="up-empty">Loading…</div>';
  try{
    const parts = await Promise.all(files.map(async f=>{
      try{
        const snap = await get(ref(db, `filePasswords/${f.id}`));
        const v = snap.exists() ? snap.val() : {};
        return Object.entries(v).map(([uid, r])=>({
          ...r, uid, fileId: f.id,
          category: r.category || f.category || "General",
          fileName: r.fileName || f.fileName || r.fileTitle || f.title || "file"
        }));
      }catch(e){ return []; }
    }));
    const groups = groupDownloads(parts.flat());
    if(!groups.length){ box.innerHTML = '<div class="up-empty">No downloads yet.</div>'; return; }
    box.innerHTML = groups.map(u=>{
      const total = Array.from(u.cats.values()).reduce((n,x)=> n + x.length, 0);
      const cats = Array.from(u.cats.entries()).map(([cat, items])=>{
        const all = items.map(r=> pwLine(r.fileName, r.password)).join("\n");
        const rows = items.map(r=> `<div class="dl-row">
          <div class="dl-rmain"><div class="dl-rn">${escapeHtml(r.fileName)}</div><div class="dl-rp">${escapeHtml(r.password || "")}</div></div>
          <button type="button" class="btn btn-ghost btn-sm" data-copy-pw="${attrNL(pwLine(r.fileName, r.password))}">Copy</button></div>`).join("");
        return `<div class="dl-cat"><div class="dl-cat-head"><span>${escapeHtml(cat)}</span><button type="button" class="btn btn-ghost btn-sm" data-copy-pw="${attrNL(all)}">Copy all</button></div>${rows}</div>`;
      }).join("");
      return `<div class="dl-card">
        <button type="button" class="dl-head" data-dl-toggle>${dvAv(u.name, u.photo)}
          <div class="dl-info"><div class="dl-name">${escapeHtml(u.name || "User")}</div><div class="dl-uid">${escapeHtml(u.uid)}</div></div>
          <span class="dl-count">${total} file${total === 1 ? "" : "s"}</span><span class="dl-chev">▾</span></button>
        <div class="dl-body" hidden>${cats}</div></div>`;
    }).join("");
  }catch(e){ box.innerHTML = '<div class="up-empty">Could not load downloads.</div>'; }
}
document.addEventListener("click", (e)=>{
  const t = e.target.closest("[data-dl-toggle]"); if(!t) return;
  const body = t.nextElementSibling, card = t.closest(".dl-card");
  if(body){ body.hidden = !body.hidden; card.classList.toggle("open", !body.hidden); }
});

/* ===================== DEVELOPER ACCOUNT ===================== */
state.dev = null;
state.devGateReady = false;
const devDraftKey = ()=> "mtl_dev_" + (state.user ? state.user.uid : "x");
const devReadDraft = ()=>{ try{ return JSON.parse(localStorage.getItem(devDraftKey()) || "null"); }catch(e){ return null; } };
const devSaveDraft = (d)=>{ try{ localStorage.setItem(devDraftKey(), JSON.stringify(d)); }catch(e){} };
const devClearDraft = ()=>{ try{ localStorage.removeItem(devDraftKey()); }catch(e){} };
const devNormWa = (v)=> { const t = String(v||"").trim(); return (t.startsWith("+") ? "+" : "") + t.replace(/\D/g, ""); };

async function loadDeveloper(){
  state.dev = null; state.devGateReady = false;
  if(!state.user || state.isGuest) return;
  try{
    const snap = await get(ref(db, `developers/${state.user.uid}`));
    state.dev = snap.exists() ? snap.val() : null;
  }catch(e){ state.dev = null; }
}
function devStep(n){ $("#dev-step1").hidden = n !== 1; $("#dev-step2").hidden = n !== 2; }
function devGateInit(){
  const d = devReadDraft();
  if(d){ $("#dv-name").value = d.name || ""; $("#dv-wa").value = d.whatsapp || ""; $("#dv-email").value = d.email || ""; devStep(2); }
  else{
    $("#dv-email").value = (state.user && state.user.email) || "";
    $("#dv-name").value = (state.user && state.user.displayName) || "";
    devStep(1);
  }
}
$("#dv-continue").addEventListener("click", async ()=>{
  const err = $("#dv-error1"); err.textContent = "";
  if(!state.user || state.isGuest){ err.textContent = "Sign in first."; return; }
  const name = $("#dv-name").value.trim();
  const wa = devNormWa($("#dv-wa").value);
  const email = $("#dv-email").value.trim();
  if(name.length < 2){ err.textContent = "Enter your name."; return; }
  if(/^\s*admin\s*$/i.test(name)){ err.textContent = "Please choose a different name."; return; }
  if(wa.replace(/\D/g, "").length < 8 || wa.replace(/\D/g, "").length > 15){ err.textContent = "Enter a valid WhatsApp number."; return; }
  if(!/^\S+@\S+\.\S+$/.test(email)){ err.textContent = "Enter a valid email."; return; }
  const btn = $("#dv-continue"); btn.disabled = true;
  const n = new Uint32Array(1); crypto.getRandomValues(n);
  const code = String(100000 + (n[0] % 900000));
  try{
    await set(ref(db, `developerRequests/${state.user.uid}`), { name, whatsapp: wa, email, code, approved: false, createdAt: Date.now() });
    devSaveDraft({ name, whatsapp: wa, email });
    $("#dv-wa").value = wa;
    devStep(2);
    toast("Request sent. Wait for the admin's code.", "success");
  }catch(e){
    if(String((e && (e.code || e.message)) || "").includes("PERMISSION_DENIED")){
      devSaveDraft({ name, whatsapp: wa, email });
      devStep(2);
      toast("You already have a request. Enter the code the admin sent you.");
    }else{
      err.textContent = "Could not send your request. Try again.";
    }
  }finally{ btn.disabled = false; }
});
$("#dv-back").addEventListener("click", ()=>{ devClearDraft(); devGateInit(); });
$("#dv-verify").addEventListener("click", async ()=>{
  const err = $("#dv-error2"); err.textContent = "";
  const code = $("#dv-code").value.trim();
  const d = devReadDraft();
  if(!/^\d{6}$/.test(code)){ err.textContent = "Enter the 6-digit code."; return; }
  if(!d){ devGateInit(); return; }
  const btn = $("#dv-verify"); btn.disabled = true;
  const rec = { name: d.name, whatsapp: d.whatsapp, email: d.email, code, createdAt: Date.now() };
  try{
    await set(ref(db, `developers/${state.user.uid}`), rec);
    state.dev = rec; devClearDraft();
    toast("Developer account created.", "success");
    applyUploadAvailability();
    renderMyUploads();
  }catch(e){
    err.textContent = "That code is incorrect, or the admin hasn't approved your request yet.";
  }finally{ btn.disabled = false; }
});


/* ===================== TICKER + WELCOME NOTICE (content set in the admin app) ===================== */
function applyTicker(){
  const el = $("#ticker"), track = $("#ticker-track");
  if(!el || !track) return;
  const t = state.settings.ticker;
  const text = t && t.enabled === true ? String(t.text || "").trim() : "";
  if(!text){ el.hidden = true; track.style.animation = "none"; return; }
  track.textContent = text;
  el.hidden = false;
  requestAnimationFrame(()=>{
    const cw = el.clientWidth || window.innerWidth, tw = track.scrollWidth || 200;
    track.style.setProperty("--tk-from", cw + "px");
    track.style.setProperty("--tk-dur", Math.max(8, (cw + tw) / 60).toFixed(1) + "s");
    track.style.animation = "";
  });
}

const noticeIsOpen = ()=> { const o = $("#notice-overlay"); return !!(o && !o.hidden); };
const localDay = ()=> { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
function hideNotice(){
  const o = $("#notice-overlay");
  if(!o || o.hidden) return;
  o.hidden = true;
  // ticked "Don't show again today" → stay hidden for the rest of today; unticked → shows again on every visit
  const skip = $("#notice-skip");
  if(skip && skip.checked){
    try{ localStorage.setItem("mtl_notice", JSON.stringify({ key: state.noticeKeyNow, hideDay: localDay() })); }catch(e){}
  }
}
function closeNotice(){
  if(history.state && history.state.type === "overlay" && history.state.overlay === "notice") history.back();
  else hideNotice();
}
function noticeKey(n){
  const str = [n.title, n.text, n.buttonText, n.buttonAction, n.buttonUrl, n.resetAt].map(v=> String(v || "")).join("|");
  let h = 0; for(let i = 0; i < str.length; i++){ h = (h * 31 + str.charCodeAt(i)) | 0; }
  return String(h);
}
function maybeShowNotice(){
  if(state.noticeShown) return;
  const n = state.settings && state.settings.notice;
  if(!n || n.enabled !== true || !(n.title || n.text)) return;
  if(!state.user || state.isGuest) return;
  const key = noticeKey(n);
  state.noticeKeyNow = key;
  // ticked "not today" earlier today?
  try{
    const rec = JSON.parse(localStorage.getItem("mtl_notice") || "null");
    if(rec && rec.key === key && rec.hideDay === localDay()) return;
  }catch(e){}
  // already shown in this visit (e.g. the page reloaded after coming back from an ad)?
  try{
    if(sessionStorage.getItem("mtl_notice_seen") === key) return;
    sessionStorage.setItem("mtl_notice_seen", key);
  }catch(e){}
  state.noticeShown = true;
  $("#notice-title").textContent = n.title || "";
  $("#notice-title").hidden = !n.title;
  $("#notice-text").textContent = n.text || "";
  $("#notice-text").hidden = !n.text;
  $("#notice-skip").checked = false;
  $("#notice-btn").textContent = (n.buttonText || "").trim() || "Continue";
  $("#notice-btn").onclick = ()=>{
    closeNotice();
    if(n.buttonAction === "link" && /^https:\/\/\S+$/i.test(n.buttonUrl || "")){
      window.open(n.buttonUrl, "_blank", "noopener");
    }
  };
  $("#notice-overlay").hidden = false;
  history.pushState({ type:"overlay", overlay:"notice" }, "", location.href);
}
$("#notice-x").addEventListener("click", closeNotice);