import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getDatabase, ref, get, push, set, update, query, orderByChild
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

/* ===================== FIREBASE INIT (existing project — do not change) ===================== */
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

/* Profile photo uploads go directly to ImgBB (not Firebase Storage).
   Replace this with your own ImgBB API key (https://api.imgbb.com/). */
const IMGBB_API_KEY = "YOUR_IMGBB_API_KEY";

/* ===================== STATE ===================== */
const state = {
  user: null,           // firebase user or null
  isGuest: false,
  settings: { siteName: "Mr Techlab Studio", tagline: "Premium Android App Marketplace", logoUrl: "" },
  apps: [],              // array of {id, ...fields}
  categories: [],
  activeCategory: "all",
  hostLinks: [],
  hostLoaded: false,
  prompts: [],
  promptsLoaded: false,
  pendingDownload: null, // app object waiting on auth
  downloadInFlight: false,
  customPhotoURL: null,  // ImgBB-hosted profile photo, takes priority over Google's photoURL
  photoUploading: false,
  isBlocked: false,       // set by admin — blocks downloads only, browsing still allowed
  currentView: "home",    // tracked so switchView() doesn't push duplicate history entries
  detailApp: null         // which app the (static) detail-sheet download button currently targets
};
function getAvatarUrl(){
  return state.customPhotoURL || (state.user && state.user.photoURL) || null;
}

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ===================== TOAST ===================== */
function toast(msg, type="default"){
  const host = $("#toast-host");
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

// works with navigator.clipboard where available, falls back to a hidden
// textarea + execCommand for older/embedded mobile WebViews
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

/* ===================== GOOGLE DRIVE URL CONVERSION (preserved) + URL SAFETY ===================== */
function resolveDownloadUrl(url){
  if(!url) return null;
  const trimmed = String(url).trim();
  if(!/^https:\/\//i.test(trimmed)) return null; // only allow https:// — blocks javascript:, data:, etc.
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

/* ===================== DOWNLOAD TYPE (admin-controlled) ===================== */
function getDownloadMeta(app){
  const type = app.downloadType || "direct_apk"; // backward-compatible default
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

$("#btn-guest").addEventListener("click", (e)=>{ e.preventDefault(); enterAsGuest(); });
$("#btn-google").addEventListener("click", ()=>doGoogleSignIn());
$("#gate-google").addEventListener("click", ()=>doGoogleSignIn(true));
$("#btn-email").addEventListener("click", ()=>{ $("#auth-buttons").style.display="none"; $("#email-panel").classList.add("show"); });
$("#btn-email-back").addEventListener("click", ()=>{ $("#email-panel").classList.remove("show"); $("#auth-buttons").style.display="flex"; });
$("#gate-email").addEventListener("click", ()=>{ closeGateUI(); $("#welcome").style.display="flex"; $("#app").classList.remove("ready"); $("#auth-buttons").style.display="none"; $("#email-panel").classList.add("show"); });
$("#btn-toggle-signup").addEventListener("click", ()=>{
  emailMode = emailMode==="signin" ? "signup" : "signin";
  $("#btn-email-submit").textContent = emailMode==="signin" ? "Sign In" : "Create Account";
  $("#btn-toggle-signup").parentElement.firstChild.textContent = emailMode==="signin" ? "Don't have an account? " : "Already have an account? ";
  $("#btn-toggle-signup").textContent = emailMode==="signin" ? "Create one" : "Sign in";
});
$("#btn-email-submit").addEventListener("click", async ()=>{
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
}
$("#gate-cancel").addEventListener("click", ()=> history.back());
$("#gate-overlay").addEventListener("click", ()=> history.back());
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
    $("#welcome").style.display = "none";
    showApp();
    updateProfileUI();
    loadCustomPhoto();
    syncUserProfile();
    (async ()=>{
      await loadBlockedStatus(); // must resolve before we act on any pending download
      if(state.pendingDownload){
        const app = state.pendingDownload;
        state.pendingDownload = null;
        closeGateUI();
        requestDownload(app); // re-checks guest/blocked status, not a bare startDownload
      }
    })();
  } else if(!state.isGuest){
    // stay on welcome unless user explicitly chose guest
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
    if($("#view-profile").classList.contains("show")) renderProfileView();
  }catch(e){ /* non-blocking */ }
}

// writes a small, non-sensitive profile record so the admin panel's Users
// tab can show a name instead of only a bare UID
async function syncUserProfile(){
  if(!state.user || state.isGuest) return;
  try{
    await update(ref(db, `users/${state.user.uid}`), {
      name: state.user.displayName || "",
      email: state.user.email || ""
    });
  }catch(e){ /* non-blocking */ }
}

async function loadBlockedStatus(){
  if(!state.user || state.isGuest) return;
  try{
    const snap = await get(ref(db, `users/${state.user.uid}/blocked`));
    state.isBlocked = snap.exists() && snap.val() === true;
  }catch(e){
    // if this can't be read, fail closed to "not blocked" rather than
    // silently locking someone out over a transient read error
    state.isBlocked = false;
  }
}

function showApp(){
  $("#welcome").style.display = "none";
  $("#app").classList.add("ready");
  if(!state.apps.length && !state._loaded){ loadCatalog(); }
}

/* ===================== LOAD CATALOG (existing RTDB structure — preserved) ===================== */
async function loadCatalog(){
  renderSkeletons();
  try{
    const [settingsSnap, appsSnap] = await Promise.all([
      get(ref(db, "settings")),
      get(ref(db, "apps"))
    ]);
    if(settingsSnap.exists()){
      const s = settingsSnap.val();
      state.settings = { siteName: s.siteName || "Mr Techlab Studio", tagline: s.tagline || "Premium Android App Marketplace", logoUrl: s.logoUrl || "" };
    }
    applySettingsToUI();

    const appsVal = appsSnap.exists() ? appsSnap.val() : {};
    const list = Object.entries(appsVal).map(([id, v])=>({ id, ...v }))
      .filter(a => a.enabled !== false);
    state.apps = list;
    state._loaded = true;

    const catSet = new Set();
    list.forEach(a => { if(a.category) catSet.add(a.category); });
    state.categories = Array.from(catSet).sort();

    renderChips();
    renderAll();
  }catch(err){
    renderError();
  }
}

function applySettingsToUI(){
  document.title = state.settings.siteName + " — Premium Android App Marketplace";
  $$(".brand").forEach(el=>{ if(!el.closest("#welcome")) el.lastChild.textContent = " " + state.settings.siteName; });
  setBrandMark("#topbar-mark", state.settings.logoUrl);
  setBrandMark("#welcome-mark", state.settings.logoUrl);
  if(state.settings.logoUrl){
    const fav = $("#favicon-link");
    if(fav) fav.href = state.settings.logoUrl; // browser tab icon too
  }
}

const DEFAULT_MARK_HTML = '<img src="logo.png" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">';
// swaps the built-in logo.png mark for the logo set on the admin
// Settings page (falls back to logo.png if empty or broken)
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

/* ===================== SKELETONS / ERROR / EMPTY ===================== */
function renderSkeletons(){
  const n = 6;
  ["rail-featured","rail-new","rail-updated","rail-trending"].forEach(id=>{
    $("#"+id).innerHTML = Array.from({length:4}).map(()=>`<div class="skel-card" style="width:158px;flex-shrink:0;"></div>`).join("");
  });
  $("#grid-all").innerHTML = Array.from({length:n}).map(()=>`<div class="skel-card"></div>`).join("");
}
function renderError(){
  const html = `<div class="state-block">
    <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
    <h3>Unable to load apps.</h3>
    <p>Please check your internet connection and try again.</p>
    <button class="btn btn-ghost btn-sm" style="margin:16px auto 0;" onclick="location.reload()">Retry</button>
  </div>`;
  $("#grid-all").innerHTML = html;
  ["rail-featured","rail-new","rail-updated","rail-trending"].forEach(id=> $("#"+id).innerHTML = "");
}
function emptyState(title, sub){
  return `<div class="state-block">
    <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8"/></svg>
    <h3>${escapeHtml(title)}</h3><p>${escapeHtml(sub)}</p>
  </div>`;
}

/* ===================== RENDER LISTS ===================== */
function renderChips(){
  const cats = ["all", ...state.categories];
  const mk = (cat) => `<button class="chip ${cat===state.activeCategory?'active':''}" data-cat="${escapeHtml(cat)}">${cat==="all"?"All":escapeHtml(cat)}</button>`;
  $("#chip-row").innerHTML = cats.map(mk).join("");
  $("#chip-row-2").innerHTML = cats.filter(c=>c!=="all").map(cat=>`<button class="chip" data-cat2="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join("");
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
  const all = catFiltered(state.apps);
  if(!state.apps.length){
    $("#grid-all").innerHTML = emptyState("No apps yet", "Check back soon for new additions.");
    ["rail-featured","rail-new","rail-updated","rail-trending"].forEach(id=> $("#"+id).innerHTML = "");
    renderCategoriesGrid();
    return;
  }
  const featured = all.filter(a=>a.featured) .slice(0,10);
  const byNew = [...all].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,10);
  const byUpdated = [...all].filter(a=>a.updateNotes).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)).slice(0,10);
  const trending = [...all].sort((a,b)=>(b.downloadCount||0)-(a.downloadCount||0)).slice(0,10);

  fillRail("rail-featured", featured.length ? featured : all.slice(0,10), "No featured apps right now.");
  fillRail("rail-new", byNew, "No new apps yet.");
  fillRail("rail-updated", byUpdated, "Nothing updated recently.");
  fillRail("rail-trending", trending, "No trending apps yet.");

  $("#grid-all").innerHTML = all.length ? all.map(cardHtml).join("") : emptyState("No apps in this category", "Try another category.");
  bindCardEvents($("#grid-all"));
  renderCategoriesGrid();
}

function fillRail(id, items, emptyMsg){
  const el = $("#"+id);
  el.innerHTML = items.length ? items.map(cardHtml).join("") : `<p style="color:var(--text-faint);font-size:0.85rem;">${escapeHtml(emptyMsg)}</p>`;
  bindCardEvents(el);
}

function renderCategoriesGrid(){
  const wrap = $("#grid-categories");
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

/* ===================== HOST (resource/link cards from admin) ===================== */
async function loadHostLinks(){
  const wrap = $("#host-grid");
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
// splits on a literal "/n" marker the admin types manually (not a real
// newline) into bulleted lines; text without the marker renders exactly
// as before, unchanged
function formatMarkerText(text){
  const escaped = escapeHtml(text);
  // supports both the manual "/n" marker AND real line breaks — e.g. text
  // pasted in from somewhere else that already has actual Enter/newlines
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
  if(!state.hostLinks.length){
    wrap.innerHTML = emptyState("No resources yet", "Hosting and Firebase links added by the team will show up here.");
    return;
  }
  wrap.innerHTML = state.hostLinks.map(hostCardHtml).join("");
  $$("#host-grid [data-host-view]").forEach(btn=> btn.addEventListener("click", ()=>{
    const link = state.hostLinks.find(l=>l.id===btn.dataset.hostView);
    if(link && link.videoUrl) window.open(link.videoUrl, "_blank", "noopener");
    else toast("Setup video is not available yet.", "error");
  }));
  $$("#host-grid [data-host-chrome]").forEach(btn=> btn.addEventListener("click", ()=>{
    const link = state.hostLinks.find(l=>l.id===btn.dataset.hostChrome);
    if(link && link.url) openInChrome(link.url);
    else toast("Link is not available.", "error");
  }));
}
// forces the link open in the system Chrome browser (via an Android intent),
// instead of any in-app/WebView tab — needed because Google Sign-In and
// similar flows are blocked inside embedded WebViews (e.g. an Appilix APK)
function openInChrome(url){
  const isAndroid = /Android/i.test(navigator.userAgent);
  if(isAndroid){
    try{
      const scheme = url.startsWith("http://") ? "http" : "https";
      const stripped = url.replace(/^https?:\/\//, "");
      window.location.href = `intent://${stripped}#Intent;scheme=${scheme};package=com.android.chrome;end`;
      return;
    }catch(e){ /* fall through to a normal new tab */ }
  }
  window.open(url, "_blank", "noopener");
}

/* ===================== PROMPTS (title + copy-able text, from admin) ===================== */
async function loadPrompts(){
  const wrap = $("#prompt-grid");
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
  return `<div class="host-card">
    <div class="host-card-name">${escapeHtml(p.title||"Untitled")}</div>
    <div class="host-card-actions">
      <button class="btn btn-primary btn-block" data-copy-prompt="${escapeHtml(p.id)}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
        Copy
      </button>
    </div>
  </div>`;
}
function renderPromptGrid(){
  const wrap = $("#prompt-grid");
  if(!state.prompts.length){
    wrap.innerHTML = emptyState("No prompts yet", "Prompts added by the team will show up here.");
    return;
  }
  wrap.innerHTML = state.prompts.map(promptCardHtml).join("");
  $$("#prompt-grid [data-copy-prompt]").forEach(btn=> btn.addEventListener("click", ()=>{
    const p = state.prompts.find(x=>x.id===btn.dataset.copyPrompt);
    if(!p || !p.promptText){ toast("Nothing to copy.", "error"); return; }
    copyToClipboard(p.promptText);
    maybeOpenSmartlink(); // same ad trigger pattern as the download flow
  }));
}

function cardVariant(id){
  let h = 0;
  for(let i=0;i<id.length;i++){ h = (h*31 + id.charCodeAt(i)) >>> 0; }
  return (h % 5) + 1;
}
function cardHtml(app){
  const iconHtml = app.logoUrl
    ? `<img class="card-icon" src="${escapeHtml(app.logoUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-icon-fallback',textContent:'${escapeHtml((app.name||'?').charAt(0).toUpperCase())}'}))">`
    : `<div class="card-icon-fallback">${escapeHtml((app.name||"?").charAt(0).toUpperCase())}</div>`;
  const meta = getDownloadMeta(app);
  const v = cardVariant(app.id || app.name || "app");
  return `<div class="app-card" data-app-id="${escapeHtml(app.id)}">
    <div class="card-bg v${v}"><div class="layer"></div></div>
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
  $$(".app-card[data-app-id]", root).forEach(card=>{
    const id = card.dataset.appId;
    card.addEventListener("click", (e)=>{
      if(e.target.closest("[data-dl-id]")) return;
      openDetail(id);
    });
  });
  $$("[data-dl-id]", root).forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const app = state.apps.find(a=>a.id===btn.dataset.dlId);
      if(app) requestDownload(app);
    });
  });
}

/* ===================== SEARCH ===================== */
let searchTimer;
$("#search-input").addEventListener("input", (e)=>{
  const v = e.target.value.trim();
  $("#search-clear").classList.toggle("show", !!v);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=> runSearch(v), 120);
});
$("#search-clear").addEventListener("click", ()=>{
  $("#search-input").value = "";
  $("#search-clear").classList.remove("show");
  runSearch("");
});

function runSearch(q){
  if(!q){
    $("#search-results-wrap").style.display = "none";
    $("#home-sections").style.display = "";
    return;
  }
  $("#search-results-wrap").style.display = "";
  $("#home-sections").style.display = "none";
  const ql = q.toLowerCase();
  const results = state.apps.filter(a =>
    (a.name||"").toLowerCase().includes(ql) ||
    (a.description||"").toLowerCase().includes(ql) ||
    (a.category||"").toLowerCase().includes(ql)
  );
  const el = $("#search-results");
  el.innerHTML = results.length ? results.map(cardHtml).join("") : emptyState("No apps found", "Try another search.");
  bindCardEvents(el);
}

/* ===================== APP DETAIL SHEET ===================== */
function openDetail(id){
  const app = state.apps.find(a=>a.id===id);
  if(!app) return;
  const iconHtml = app.logoUrl
    ? `<img class="detail-icon" src="${escapeHtml(app.logoUrl)}" alt="" onerror="this.style.display='none'">`
    : `<div class="detail-icon card-icon-fallback" style="width:78px;height:78px;font-size:1.6rem;">${escapeHtml((app.name||"?").charAt(0).toUpperCase())}</div>`;
  const shots = Array.isArray(app.screenshots) ? app.screenshots : (app.screenshots ? Object.values(app.screenshots) : []);
  $("#detail-content").innerHTML = `
    <div class="detail-hero">
      ${iconHtml}
      <div>
        <div class="detail-name">${escapeHtml(app.name||"Untitled app")}</div>
        <div class="detail-meta-row">
          ${app.version ? `<span class="card-badge">v${escapeHtml(app.version)}</span>` : ""}
          ${app.category ? `<span>${escapeHtml(app.category)}</span>` : ""}
        </div>
      </div>
    </div>
    ${app.description ? `<div class="detail-section"><h4>About</h4><p>${escapeHtml(app.description)}</p></div>` : ""}
    ${shots.length ? `<div class="detail-section"><h4>Screenshots</h4><div class="shots-row">${shots.map(s=>`<img src="${escapeHtml(s)}" alt="" loading="lazy">`).join("")}</div></div>` : ""}
    ${app.updateNotes ? `<div class="detail-section"><h4>What's new</h4><p>${escapeHtml(app.updateNotes)}</p></div>` : ""}
    ${app.instructions ? `<div class="detail-section"><h4>Instructions</h4><p>${escapeHtml(app.instructions)}</p></div>` : ""}
  `;
  // the ad + download button live in a static bar outside #detail-content
  // (script tags inside innerHTML never execute, so the ad has to sit in
  // real, static HTML) — just update its label/icon and which app it targets
  state.detailApp = app;
  const meta = getDownloadMeta(app);
  $("#detail-dl-btn").innerHTML = `${dlIconSvg(meta.type)} ${escapeHtml(meta.label)}`;
  $("#detail-overlay").classList.add("show");
  $("#detail-sheet").classList.add("show");
  document.body.classList.add("sheet-open"); // locks background scroll while the sheet is open
  history.pushState({type:"overlay", overlay:"detail"}, "", location.href);
}
$("#detail-dl-btn").addEventListener("click", ()=>{ if(state.detailApp) requestDownload(state.detailApp); });
$("#detail-close").addEventListener("click", ()=> history.back());
$("#detail-overlay").addEventListener("click", ()=> history.back());

/* ===================== DOWNLOAD FLOW ===================== */

/* ---- Adsterra Smartlink ----
   Opens every 3rd download-button click (not every click), so it rides the
   same user-gesture as the click (popup blockers allow it) without being
   naggy on every single tap. */
const SMARTLINK_URL = "https://www.profitableratecpmnetwork.com/khhb0sxa?key=a5b50548384953d1a4866f2b52283023";
function maybeOpenSmartlink(){
  try{
    const count = (parseInt(localStorage.getItem("mrapk_dl_click_count") || "0", 10) + 1) % Number.MAX_SAFE_INTEGER;
    localStorage.setItem("mrapk_dl_click_count", String(count));
    if(count % 3 === 0){
      window.open(SMARTLINK_URL, "_blank", "noopener");
    }
  }catch(e){ /* localStorage may be unavailable in some webviews — skip silently */ }
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
  maybeOpenSmartlink();
  startDownload(app);
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
  }catch(e){ /* non-blocking */ }
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
    // keyed by appId (not pushed) so re-downloading the same app updates
    // the existing history entry instead of creating a duplicate row
    await set(ref(db, `users/${state.user.uid}/downloads/${app.id}`), entry);
  }catch(e){ /* non-blocking */ }
}

/* ===================== MY DOWNLOADS VIEW ===================== */
async function renderDownloadsView(){
  const wrap = $("#downloads-list");
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
      btn.addEventListener("click", async ()=>{
        if(state.isBlocked){
          toast("Downloads are currently disabled for your account. Please contact support.", "error");
          return;
        }
        const isUpdate = btn.dataset.isupdate === "1";
        const isPlay = btn.dataset.isplay === "1";
        if(isUpdate || isPlay){
          // re-run the full download flow so analytics + history are refreshed
          // to the app's current live version/URL
          const liveApp = state.apps.find(a => a.id === btn.dataset.appid);
          if(liveApp){ await startDownload(liveApp); renderDownloadsView(); return; }
        }
        const url = btn.dataset.redl;
        if(!url){ toast("Download link is not available.", "error"); return; }
        const a = document.createElement("a"); a.href=url; a.target="_blank"; a.rel="noopener"; document.body.appendChild(a); a.click(); a.remove();
      });
    });
  }catch(err){
    wrap.innerHTML = emptyState("Unable to load downloads", "Please check your internet connection.");
  }
}

/* ===================== PROFILE VIEW ===================== */
function updateProfileUI(){
  const btn = $("#btn-profile");
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
/* ===================== PROFILE PHOTO UPLOAD (direct to ImgBB) ===================== */
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
    $("#btn-copy-uid").addEventListener("click", ()=> copyToClipboard(state.user.uid));
    $("#btn-change-avatar").addEventListener("click", ()=>{
      if(state.photoUploading) return;
      $("#avatar-file-input").click();
    });
    $("#avatar-file-input").addEventListener("change", (e)=>{
      const file = e.target.files && e.target.files[0];
      if(file) uploadProfilePhoto(file);
    });
    menu.innerHTML = `
      <button class="menu-item" data-view="downloads"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>My Downloads</button>
      <button class="menu-item" data-view="prompts"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>Prompts</button>
      <button class="menu-item" data-page="privacy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/></svg>Privacy Policy</button>
      <button class="menu-item" data-page="terms"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l5 5v13H6z"/><path d="M14 3v5h5"/></svg>Terms of Service</button>
      <button class="menu-item" data-page="about"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>About</button>
      <button class="menu-item danger" id="btn-signout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>Sign Out</button>
    `;
    $("#btn-signout").addEventListener("click", async ()=>{ await signOut(auth); state.isGuest=false; $("#welcome").style.display="flex"; $("#app").classList.remove("ready"); });
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
    $("#btn-profile-signin").addEventListener("click", ()=>{ $("#welcome").style.display="flex"; $("#app").classList.remove("ready"); });
  }
  bindNavTriggers(menu);
}

/* ===================== VIEW ROUTING (+ browser/hardware back button support) ===================== */
const views = ["home","host","prompts","categories","downloads","profile","privacy","terms","about","contact"];
function applyView(name){
  state.currentView = name;
  views.forEach(v=> $("#view-"+v).classList.toggle("show", v===name));
  $$(".nav-item[data-view]").forEach(el=> el.classList.toggle("active", el.dataset.view===name));
  $$("#desktop-nav a[data-view]").forEach(el=> el.classList.toggle("active", el.dataset.view===name));
  window.scrollTo({top:0, behavior:"instant" in window ? "instant" : "auto"});
  if(name==="downloads") renderDownloadsView();
  if(name==="profile") renderProfileView();
  if(name==="categories") renderCategoriesGrid();
  if(name==="host"){ if(state.hostLoaded) renderHostGrid(); else loadHostLinks(); }
  if(name==="prompts"){ if(state.promptsLoaded) renderPromptGrid(); else loadPrompts(); }
}
function switchView(name){
  const changed = state.currentView !== name;
  applyView(name);
  // only push a new history entry when the view actually changes, so tapping
  // a nav item that's already active doesn't pile up back-button presses
  if(changed) history.pushState({type:"view", view:name}, "", location.href);
}
function closeDetailUI(){
  $("#detail-overlay").classList.remove("show");
  $("#detail-sheet").classList.remove("show");
  document.body.classList.remove("sheet-open");
}
function closeGateUI(){
  $("#gate-overlay").classList.remove("show");
  $("#gate-modal").classList.remove("show");
}
window.addEventListener("popstate", (e)=>{
  const st = e.state;
  const detailOpen = $("#detail-sheet").classList.contains("show");
  const gateOpen = $("#gate-modal").classList.contains("show");
  const targetIsDetail = !!(st && st.type === "overlay" && st.overlay === "detail");
  const targetIsGate = !!(st && st.type === "overlay" && st.overlay === "gate");

  // back navigated away from an open overlay (sheet/modal) -> just close it,
  // the view underneath hasn't changed
  if(detailOpen && !targetIsDetail) closeDetailUI();
  if(gateOpen && !targetIsGate) closeGateUI();

  if(st && st.type === "view"){
    applyView(st.view);
  } else if(!st && !targetIsDetail && !targetIsGate){
    applyView("home");
  }
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
$("#btn-profile").addEventListener("click", ()=> switchView("profile"));
$("#btn-refresh").addEventListener("click", ()=> loadCatalog());

/* ===================== BOOT ===================== */
$("#year").textContent = new Date().getFullYear();
$("#privacy-date").textContent = new Date().toLocaleDateString();

// base history entry so the very first back-button press has a "home"
// state to land on instead of leaving the site
history.replaceState({type:"view", view:"home"}, "", location.href);

getRedirectResult(auth).catch(()=>{});

// keeps the loading splash up until Firebase has actually determined
// whether a session is already signed in, then goes straight into the app
// (no welcome-screen flash) or shows the welcome/login screen — whichever
// is correct — instead of always revealing welcome after a fixed delay
let bootResolved = false;
function resolveBoot(user){
  if(bootResolved) return;
  bootResolved = true;
  $("#boot").style.display = "none";
  if(!user){
    $("#welcome").style.display = "flex";
  }
  // if a user is already signed in, onAuthStateChanged's own "if(user)"
  // branch calls showApp() and hides #welcome — nothing more to do here
}
// safety net: don't leave the splash up forever if the auth check is
// ever unexpectedly slow or stuck
setTimeout(()=> resolveBoot(state.user), 4000);