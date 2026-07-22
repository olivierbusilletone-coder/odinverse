/* ============================================================================
   sales-feed.js — Live NFT Sales Feed (portage navigateur de ScanNFTs_5_5.py)
   ============================================================================
   Reprend la logique du scanner Telegram :
   - Scan des fonctions buy / bid / bulkBuy / buySwap / bulkSwap / giveaway /
     acceptGlobalOffer / acceptOffer / mint / mintFromMachine   (scan_loop)
   - From/To reconstruits depuis le parcours réel du NFT dans operations[]
     (derive_nft_route, FIX F1) + vendeur retrouvé via les payouts quand le
     NFT sort de l'escrow marketplace (_seller_from_payouts, FIX F7)
   - Paiements : EGLD vers smart contract ignoré (FIX F2), ESDT fongibles,
     somme pour bulkBuy (extract_payments / get_main_payment)
   - Résolution herotag avec cache TTL 1 h (resolve_herotag, FIX F3)
   - Cache anti-doublons avec expiration (FIX Q3)
   - Récap par collection au-delà de N NFTs par tx (FIX Q2)
   - Throttle global des requêtes API (FIX R1)
   - ★ NOUVEAU : historique persistant en localStorage — le flux, les
     compteurs et le curseur survivent au refresh ; au rechargement le
     scan reprend là où il s'était arrêté (rattrapage ≤ 1 h, sans doublons).
   ========================================================================= */

(() => {
"use strict";

/* === CONFIGURATION ====================================================== */

const API_BASE = "https://api.multiversx.com";

const SCAN_FUNCTIONS = [
  "buy", "mint", "bid", "bulkBuy", "buySwap", "bulkSwap", "giveaway",
  "acceptGlobalOffer", "acceptOffer", "mintFromMachine",
];

const ALLOWED_FUNCTIONS = new Set(SCAN_FUNCTIONS.map(f => f.toLowerCase()));

const FORBIDDEN_KEYWORDS = [
  "stake", "unstake", "staking", "listing", "listtoken", "unlist",
  "unlisting", "cancelstake", "withdrawstake", "withdraw",
];

/* Collections suivies par le scanner (ScanNFTs_5_5.py → COLLECTIONS) */
const WATCHED_COLLECTIONS = new Set([
  "BLOOPX-1ced34","MADC-d03f58","WJX-31a722","HODL-ffb01b","CREATOROCX-b96f26",
  "MAINSEASON-3db9f8","OCXSII-26bb89","GHOWLETS-7d3ebf","OWLETS-5446cd",
  "SOCIUSOP-a1713e","BOOGAS-afc98d","EAPES-8f3c1f","SRB-61daf7","HYPEY-794a10",
  "ZOMBIX-7dd9a4","VRSENYATH-4f2c95","VRSENYATH2-6b632c","UAC-406dab",
  "FRUGLY-e6158a","R2L-6aa15e","BAXC-cdf74d","OAG-0eaf3b","EVCYB-aea8b4",
  "EVOAG-1a4f7d","ANDRIANS-e6144d","MOS-b9b4b2","PROJECTF-7f9ae1",
  "XPIXEL-c59b48","VICBITS-da9df7","KO7GF-044047","SUBJECTX-2c184d",
  "BEEF-032185","MINIBOSSES-104b7f","SUPERVIC-f07785","HAMHAM-800c2e",
  "HALLOVIC-b80f05","SVUACT0-e86669","ODINSDECK-4e300a","VRSKRAAD-d3e816",
  "MINIKRAAD-bff059","OFT-01552b","SMARUGON-69bfc0",
]);

/* Collections Odinverse (groupe GROUP_ODIN dans le script) */
const ODIN_COLLECTIONS = new Set(["ODINSDECK-4e300a", "OFT-01552b"]);

/* Messages par ticker (collection_messages_by_ticker) */
const COLLECTION_MESSAGES = {
  BLOOPX: "🔥 NFT created by @BloopXNft",
  CREATOROCX: "🎨 NFT created by @Cuget",
  MAINSEASON: "🌟 NFT created by @Cuget and @KingOwl7",
  OCXSII: "⚔️ NFT created by @Cuget and @KingOwl7",
  GHOWLETS: "🎨 NFT created by @Cuget",
  OWLETS: "🎨 NFT created by @Cuget",
  VRSENYATH: "🎨 NFT created by Alejandro",
  VRSENYATH2: "🎨 EnyathAI NFTs created by Spawny (ArtCpa)",
  ODINSDECK: "⚔️ NFT created by @TriskelMultiversX",
  OFT: "⚔️ NFT created by @TriskelMultiversX",
  XPIXEL: "🎨 NFT created by @Cuget",
  KO7GF: "🎨 NFT created by @KingOwl7",
};

const KNOWN_ADDRESSES = {
  "erd1qqqqqqqqqqqqqpgq6wegs2xkypfpync8mn2sa5cmpqjlvrhwz5nqgepyg8": "XOXNO Marketplace",
  "erd1qqqqqqqqqqqqqpgqwp73w2a9eyzs64eltupuz3y3hv798vlv899qrjnflg": "OOX Marketplace",
  "erd1qqqqqqqqqqqqqpgqequr9yk0g6h9mnsylcqcuntsw3at374jlrlqx8nhpj": "Boogas Caveman Mint",
};

const SC_ADDRESS_PREFIX = "erd1qqqqqqqqqqqqq";     // FIX F1/F2
const LOOP_DELAY_MS       = 9000;                  // pause entre deux cycles
const MIN_REQUEST_INTERVAL = 650;                  // FIX R1 (~1.5 req/s)
const SEEN_TTL_MS         = 3600 * 1000;           // FIX Q3
const HEROTAG_TTL_MS      = 3600 * 1000;           // FIX F3
const MAX_NFT_CARDS_PER_TX = 6;                    // FIX Q2 (récap au-delà)
const MAX_FEED_CARDS      = 50;

/* ★ Persistance */
const STORAGE_KEY         = "odin_sales_feed_v1";
const MAX_STORED_EVENTS   = MAX_FEED_CARDS;        // même plafond que le flux
const MAX_LOOKBACK_SEC    = 3600;                  // rattrapage max après refresh
const SAVE_DEBOUNCE_MS    = 600;

const METHOD_LABELS = {
  buy: "Buy", mint: "Mint", bid: "Bid", bulkbuy: "Bulk Buy",
  buyswap: "Buy Swap", bulkswap: "Bulk Swap", giveaway: "Giveaway",
  acceptglobaloffer: "Global Offer", acceptoffer: "Offer",
  mintfrommachine: "Machine Mint",
};

/* === ÉTAT =============================================================== */

const state = {
  running: false,
  filter: "watched",            // "odin" | "watched" | "all"
  cursor: Math.floor(Date.now() / 1000) - 120,   // démarre 2 min en arrière
  seen: new Map(),              // txHash -> détecté à (ms)   (FIX Q3)
  herotags: new Map(),          // addr -> {name, ts}         (FIX F3)
  events: [],                   // ★ historique sérialisable (récent → ancien)
  timer: null,
  eventsShown: 0,
  totalEgld: 0,
  _userPaused: false,
  _storageOk: true,
};

/* === ★ PERSISTANCE (localStorage) ====================================== */

let saveTimer = null;

function saveStateNow() {
  if (!state._storageOk) return;
  try {
    const payload = {
      v: 1,
      cursor: state.cursor,
      filter: state.filter,
      eventsShown: state.eventsShown,
      totalEgld: state.totalEgld,
      /* seen : uniquement les hashes récents (FIX Q3 conservé au refresh) */
      seen: [...state.seen.entries()].filter(
        ([, t]) => Date.now() - t < SEEN_TTL_MS
      ),
      /* herotags : cache réutilisé, borné */
      herotags: [...state.herotags.entries()].slice(-200),
      events: state.events.slice(0, MAX_STORED_EVENTS),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota plein ou mode privé : on continue sans persistance */
    state._storageOk = false;
  }
}

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, SAVE_DEBOUNCE_MS);
}

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    state._storageOk = false;   // localStorage inaccessible (mode privé…)
    return;
  }
  if (!raw) return;

  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (!data || data.v !== 1) return;

  state.filter      = ["odin", "watched", "all"].includes(data.filter)
                        ? data.filter : "watched";
  state.eventsShown = Number(data.eventsShown) || 0;
  state.totalEgld   = Number(data.totalEgld) || 0;

  const now = Date.now();
  for (const [h, t] of data.seen || []) {
    if (now - t < SEEN_TTL_MS) state.seen.set(h, t);
  }
  for (const [addr, entry] of data.herotags || []) {
    if (entry && now - entry.ts < HEROTAG_TTL_MS) state.herotags.set(addr, entry);
  }

  state.events = Array.isArray(data.events)
    ? data.events.slice(0, MAX_STORED_EVENTS)
    : [];

  /* Curseur : on reprend où on s'était arrêté, mais jamais plus d'1 h en
     arrière (le cache seen évite les doublons à la frontière). */
  const nowSec = Math.floor(now / 1000);
  const saved = Number(data.cursor) || 0;
  state.cursor = Math.max(saved, nowSec - MAX_LOOKBACK_SEC);
}

function clearHistory() {
  state.events = [];
  state.eventsShown = 0;
  state.totalEgld = 0;
  if (feedEl) feedEl.innerHTML = "";
  if (emptyEl) emptyEl.style.display = "";
  updateCounters();
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  saveStateNow();
}

/* === HTTP THROTTLÉ (FIX R1) ============================================ */

let lastRequestAt = 0;
let httpChain = Promise.resolve();

function throttledFetchJson(url) {
  const run = async () => {
    const wait = MIN_REQUEST_INTERVAL - (performance.now() - lastRequestAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = performance.now();
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 429) {                       // rate-limit → on respire
        await new Promise(r => setTimeout(r, 15000));
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
  const p = httpChain.then(run, run);
  httpChain = p.catch(() => {});
  return p;
}

/* === HELPERS (portés du script) ======================================== */

const isSmartContract = a => !!a && String(a).startsWith(SC_ADDRESS_PREFIX);

function shortenAddress(address) {
  if (!address) return "Unknown";
  if (address.endsWith(".elrond")) return address.slice(0, -7);
  return address.length > 10
    ? `${address.slice(0, 6)}…${address.slice(-6)}`
    : address;
}

function formatEgld(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n / 1e18 : 0;
}

function formatAmount(v) {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1)    return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 5 });
}

function relativeTime(tsSec) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* FIX F7 : vendeur retrouvé via le plus gros payout SC → wallet */
function sellerFromPayouts(tx, buyerErd) {
  let best = null;
  for (const op of tx.operations || []) {
    const t = op.type;
    if (t !== "egld" && t !== "esdt") continue;
    if (t === "esdt" && op.esdtType && op.esdtType !== "FungibleESDT") continue;
    const snd = op.sender, rcv = op.receiver;
    if (!(isSmartContract(snd) && rcv && !isSmartContract(rcv))) continue;
    if (rcv === buyerErd || rcv === tx.sender) continue;   // remboursements
    const val = Number(op.value || 0);
    if (val > 0 && (!best || val > best.val)) best = { val, rcv };
  }
  return best ? best.rcv : null;
}

/* FIX F1 : vrai parcours du NFT dans operations[] */
function deriveNftRoute(tx, identifier) {
  const ops = (tx.operations || []).filter(
    op => op.type === "nft" && op.identifier === identifier
  );
  const senders = ops.map(o => o.sender).filter(Boolean);
  const receivers = ops.map(o => o.receiver).filter(Boolean);
  if (!senders.length && !receivers.length) return [null, null];

  const toErd =
    [...receivers].reverse().find(r => !isSmartContract(r)) ||
    receivers[receivers.length - 1] || null;

  let fromErd = senders.find(s => !isSmartContract(s)) || null;
  if (!fromErd) fromErd = sellerFromPayouts(tx, toErd);      // FIX F7
  if (!fromErd) fromErd = senders[0] || null;                // mint

  return [fromErd, toErd];
}

/* FIX F2 : paiements en ignorant les flux internes marketplace */
function extractPayments(tx) {
  const payments = [];
  for (const op of tx.operations || []) {
    const sName = op.senderAssets?.name || "";
    const rName = op.receiverAssets?.name || "";

    if (op.type === "egld") {
      if (isSmartContract(op.receiver)) continue;            // FIX F2
      if (
        (sName.startsWith("XOXNO:") && rName.startsWith("XOXNO:")) ||
        rName.includes("Accumulator") ||
        sName.includes("OOX") || rName.includes("OOX") ||
        rName.includes("Launchpad Manager")
      ) continue;
      const v = formatEgld(op.value);
      if (v > 0) payments.push({ value: v, token: "EGLD" });

    } else if (op.type === "esdt" && op.esdtType === "FungibleESDT") {
      if (sName.includes("Marketplace")) continue;           // fees sortants
      const dec = Number.isFinite(op.decimals) ? op.decimals : 6;
      const amount = Number(op.value || 0) / 10 ** dec;
      if (amount > 0) payments.push({
        value: Math.round(amount * 1e6) / 1e6,
        token: op.ticker || op.identifier || "TOKEN",
      });
    }
  }
  if (!payments.length && tx.value) {
    const v = formatEgld(tx.value);
    if (v > 0) payments.push({ value: v, token: "EGLD" });
  }
  return payments;
}

function getMainPayment(payments, methodClean) {
  if (!payments.length) return null;
  if (methodClean === "bulkbuy" || methodClean === "bulkswap") {
    const token = payments[0].token;
    const total = payments
      .filter(p => p.token === token)
      .reduce((s, p) => s + p.value, 0);
    return { value: total, token };
  }
  const valid = payments.filter(p => p.value > 0);
  return valid.length
    ? valid.reduce((a, b) => (b.value > a.value ? b : a))
    : null;
}

/* FIX F3 + B11 : herotag avec cache TTL */
async function resolveHerotag(address) {
  if (!address) return "Unknown";
  const known = KNOWN_ADDRESSES[address.toLowerCase()];
  if (known) return known;

  const cached = state.herotags.get(address);
  if (cached && Date.now() - cached.ts < HEROTAG_TTL_MS) return cached.name;

  let result = shortenAddress(address);
  const data = await throttledFetchJson(`${API_BASE}/accounts/${address}`);
  let tag = data?.username;
  if (tag && !tag.includes("…") && !tag.includes("...")) {
    if (tag.endsWith(".elrond")) tag = tag.slice(0, -7);
    result = tag;
  }
  state.herotags.set(address, { name: result, ts: Date.now() });
  saveState();                       // ★ le cache herotag survit au refresh
  return result;
}

function mediaThumb(identifier) {
  return `https://media.multiversx.com/nfts/thumbnail/${identifier}`;
}

/* FIX B10 : passerelles IPFS actives (cloudflare-ipfs.com fermée en 2024) */
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
];

function decodeBase64Url(b64) {
  try { return atob(b64); } catch { return null; }
}

/* Liste ordonnée d'URLs à essayer pour un média (gateways IPFS → thumbnail) */
function mediaCandidates(url, identifier) {
  const out = [];
  if (url) {
    let hashPath = null;
    if (url.startsWith("ipfs://")) hashPath = url.slice(7);
    else if (url.includes("/ipfs/")) hashPath = url.split("/ipfs/")[1];
    if (hashPath) for (const g of IPFS_GATEWAYS) out.push(g + hashPath);
    else out.push(url);
  }
  const thumb = mediaThumb(identifier);
  if (!out.includes(thumb)) out.push(thumb);
  return out;
}

/* Portage de extract_media_url (ScanNFTs_5_5.py) :
   1) media[].url / originalUrl / thumbnailUrl   2) nft.url direct
   3) uris base64 décodées                       4) fallback thumbnail */
async function fetchNftMedia(identifier) {
  const nft = await throttledFetchJson(`${API_BASE}/nfts/${identifier}`);
  if (!nft) return null;

  let url = null, fileType = "";

  if (Array.isArray(nft.media)) {
    for (const m of nft.media) {
      if (!m || typeof m !== "object") continue;
      for (const key of ["url", "originalUrl", "thumbnailUrl"]) {
        const u = m[key];
        if (u && !u.includes("default.png")) { url = u; fileType = m.fileType || ""; break; }
      }
      if (url) break;
    }
  }
  if (!url && nft.url && !nft.url.includes("default.png")) url = nft.url;
  if (!url && Array.isArray(nft.uris)) {
    for (const b64 of nft.uris) {
      const decoded = decodeBase64Url(b64);
      if (decoded && !decoded.includes("default.png")) { url = decoded; break; }
    }
  }

  return {
    url: url || mediaThumb(identifier),
    fileType,
    name: nft.name || null,
  };
}

function collectionMessage(collection) {
  if (!collection) return "";
  return COLLECTION_MESSAGES[collection.split("-")[0]] || "";
}

function passesFilter(collection) {
  if (state.filter === "all") return true;
  if (!collection) return false;
  return state.filter === "odin"
    ? ODIN_COLLECTIONS.has(collection)
    : WATCHED_COLLECTIONS.has(collection);
}

/* === ANALYSE D'UNE TRANSACTION (analyze_and_send) ====================== */

async function analyzeTx(txHash) {
  const tx = await throttledFetchJson(`${API_BASE}/transactions/${txHash}`);
  if (!tx || tx.status !== "success") return;

  const fn = (tx.function || "").toLowerCase();
  if (!ALLOWED_FUNCTIONS.has(fn)) return;
  if (FORBIDDEN_KEYWORDS.some(k => fn.includes(k))) return;

  /* NFTs / SFTs réellement transférés dans la tx */
  const nftOps = (tx.operations || []).filter(
    op => op.type === "nft" && op.identifier &&
          op.action !== "burn" && op.receiver
  );
  if (!nftOps.length) return;

  /* Dédoublonnage par identifier */
  const byId = new Map();
  for (const op of nftOps) if (!byId.has(op.identifier)) byId.set(op.identifier, op);
  const identifiers = [...byId.keys()];

  const payments = extractPayments(tx);
  const mainPayment = getMainPayment(payments, fn);

  /* FIX Q2 : récap par collection au-delà du seuil */
  if (identifiers.length > MAX_NFT_CARDS_PER_TX) {
    const byCollection = new Map();
    for (const id of identifiers) {
      const coll = byId.get(id).collection || id.split("-").slice(0, 2).join("-");
      if (!byCollection.has(coll)) byCollection.set(coll, []);
      byCollection.get(coll).push(id);
    }
    for (const [coll, ids] of byCollection) {
      if (!passesFilter(coll)) continue;
      const [fromErd, toErd] = deriveNftRoute(tx, ids[0]);
      addSale({
        txHash: tx.txHash, timestamp: tx.timestamp,
        method: fn, identifier: ids[0], collection: coll,
        name: `${coll.split("-")[0]} × ${ids.length} NFTs`,
        bulkCount: ids.length,
        fromErd, toErd, fromName: null, toName: null,
        payment: mainPayment,
      });
    }
    return;
  }

  for (const id of identifiers) {
    const op = byId.get(id);
    const coll = op.collection || id.split("-").slice(0, 2).join("-");
    if (!passesFilter(coll)) continue;
    const [fromErd, toErd] = deriveNftRoute(tx, id);
    addSale({
      txHash: tx.txHash, timestamp: tx.timestamp,
      method: fn, identifier: id, collection: coll,
      name: op.name || id, bulkCount: 0,
      fromErd, toErd, fromName: null, toName: null,
      payment: identifiers.length > 1 && fn === "bulkbuy" ? null : mainPayment,
    });
  }
}

/* === BOUCLE DE SCAN (scan_loop / scan_function) ======================== */

async function scanFunction(fn, after) {
  const url = `${API_BASE}/transactions?function=${fn}` +
              `&after=${after}&size=25&order=asc&status=success`;
  const txs = await throttledFetchJson(url);
  if (!Array.isArray(txs)) return after;

  let last = after;
  for (const tx of txs) {
    const hash = tx.txHash;
    const ts = tx.timestamp || 0;
    if (!hash || ts <= after) continue;
    last = Math.max(last, ts);
    if (!state.seen.has(hash)) {
      state.seen.set(hash, Date.now());          // FIX Q3
      analyzeTx(hash).catch(() => {});
    }
  }
  return last;
}

async function scanCycle() {
  if (!state.running) return;
  setStatus("scan");

  const results = await Promise.all(
    SCAN_FUNCTIONS.map(fn => scanFunction(fn, state.cursor))
  );
  const valid = results.filter(r => r > state.cursor);
  if (valid.length) state.cursor = Math.max(...valid) - 1;

  /* Purge du cache seen (FIX Q3) */
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [h, t] of state.seen) if (t < cutoff) state.seen.delete(h);

  refreshTimes();
  setStatus("live");
  saveState();                                   // ★ curseur + seen persistés
  state.timer = setTimeout(scanCycle, LOOP_DELAY_MS);
}

/* === UI ================================================================= */

const $ = id => document.getElementById(id);
let feedEl, emptyEl, statusDot, statusText, toggleBtn;

function setStatus(mode) {
  if (!statusDot) return;
  statusDot.className = `sf-live-dot ${mode}`;
  statusText.textContent =
    mode === "live" ? "LIVE" : mode === "scan" ? "SCANNING" : "PAUSED";
}

function refreshTimes() {
  document.querySelectorAll(".salecard-time[data-ts]").forEach(el => {
    el.textContent = relativeTime(Number(el.dataset.ts));
  });
}

function updateCounters() {
  const ev = $("sfCountEvents"), vol = $("sfCountVolume");
  if (ev) ev.textContent = state.eventsShown;
  if (vol) vol.textContent = formatAmount(state.totalEgld);
}

/* Affiche le média d'une carte avec chaîne de secours :
   vrai média (via gateways IPFS si besoin) → thumbnail → rune ᛟ.
   Rend une <video> muette en boucle si le fichier est une vidéo. */
function setCardMedia(card, rec) {
  const wrap = card.querySelector(".salecard-media");
  if (!wrap) return;

  const candidates = mediaCandidates(rec.mediaUrl, rec.identifier);
  const isVideo =
    (rec.mediaType || "").startsWith("video") ||
    /\.(mp4|webm|mov)(\?|$)/i.test(rec.mediaUrl || "");

  wrap.classList.remove("no-media");
  wrap.querySelectorAll("img,video").forEach(n => n.remove());

  let el;
  if (isVideo) {
    el = document.createElement("video");
    el.muted = true;
    el.loop = true;
    el.autoplay = true;
    el.playsInline = true;
    el.setAttribute("muted", "");        // requis pour l'autoplay iOS
    el.setAttribute("playsinline", "");
    el.poster = mediaThumb(rec.identifier);
  } else {
    el = document.createElement("img");
    el.loading = "lazy";
    el.alt = rec.name || rec.identifier;
  }

  let idx = 0;
  el.src = candidates[idx];
  el.addEventListener("error", () => {
    idx += 1;
    if (idx < candidates.length) {
      el.src = candidates[idx];          // gateway IPFS suivante / thumbnail
    } else {
      el.remove();
      wrap.classList.add("no-media");    // placeholder rune ᛟ
    }
  });

  wrap.prepend(el);
}

/* Récupère le vrai média (et le vrai nom si absent) puis met à jour la
   carte + l'historique persistant. Une seule requête par NFT : le résultat
   est stocké dans l'enregistrement, donc réutilisé après un refresh. */
async function upgradeMedia(rec, card) {
  if (rec.mediaUrl) return;
  const info = await fetchNftMedia(rec.identifier);
  if (!info) {
    rec.mediaUrl = mediaThumb(rec.identifier);  // ne pas réessayer en boucle
    saveState();
    return;
  }

  rec.mediaUrl = info.url;
  rec.mediaType = info.fileType || "";

  /* Bonus : nom réel du NFT si l'opération n'en fournissait pas */
  if (info.name && !rec.bulkCount &&
      (!rec.name || rec.name === rec.identifier)) {
    rec.name = info.name;
    const nameEl = card.querySelector(".salecard-name");
    if (nameEl) nameEl.textContent = info.name;
  }

  /* Ne remplace l'élément que si le média diffère du thumbnail déjà affiché */
  if (rec.mediaUrl !== mediaThumb(rec.identifier)) setCardMedia(card, rec);
  saveState();
}

/* Construit le DOM d'une carte à partir d'un enregistrement sérialisable */
function buildCard(rec, animate) {
  const methodLabel = METHOD_LABELS[rec.method] || rec.method;
  const isMint = rec.method.includes("mint");
  const custom = collectionMessage(rec.collection);
  const name = escapeHtml(rec.name);

  const card = document.createElement("article");
  card.className = "salecard" + (animate ? "" : " salecard--in");
  card.dataset.method = rec.method;
  card.dataset.tx = rec.txHash;

  const priceHtml = rec.payment
    ? `<div class="salecard-price">${formatAmount(rec.payment.value)}
         <span class="salecard-token">${escapeHtml(rec.payment.token)}</span></div>`
    : `<div class="salecard-price salecard-price--free">${isMint ? "MINT" : "—"}</div>`;

  card.innerHTML = `
    <div class="salecard-media">
      ${rec.bulkCount ? `<span class="salecard-bulk">×${rec.bulkCount}</span>` : ""}
    </div>
    <div class="salecard-body">
      <div class="salecard-top">
        <span class="salecard-badge salecard-badge--${rec.method}">${methodLabel}</span>
        <span class="salecard-time" data-ts="${rec.timestamp}">${relativeTime(rec.timestamp)}</span>
      </div>
      <div class="salecard-name" title="${escapeHtml(rec.identifier)}">${name}</div>
      <div class="salecard-route">
        <span class="salecard-actor salecard-from">${escapeHtml(rec.fromName || "…")}</span>
        <span class="salecard-arrow">⚔</span>
        <span class="salecard-actor salecard-to">${escapeHtml(rec.toName || "…")}</span>
      </div>
      ${custom ? `<div class="salecard-custom">${custom}</div>` : ""}
    </div>
    <div class="salecard-side">
      ${priceHtml}
      <div class="salecard-links">
        <a href="https://explorer.multiversx.com/transactions/${rec.txHash}"
           target="_blank" rel="noopener noreferrer" title="Explorer">⛓</a>
        <a href="https://xoxno.com/nft/${rec.identifier}"
           target="_blank" rel="noopener noreferrer" title="XOXNO">✕</a>
      </div>
    </div>`;

  /* Média : URL déjà connue (historique) sinon thumbnail immédiat,
     puis upgrade vers le vrai média via /nfts/{identifier} */
  setCardMedia(card, rec);
  if (!rec.mediaUrl) upgradeMedia(rec, card);

  /* Herotags manquants : résolution différée + mise à jour de l'historique */
  if (!rec.fromName) {
    resolveHerotag(rec.fromErd).then(n => {
      rec.fromName = n;
      card.querySelector(".salecard-from").textContent = n;
      saveState();
    });
  }
  if (!rec.toName) {
    resolveHerotag(rec.toErd).then(n => {
      rec.toName = n;
      card.querySelector(".salecard-to").textContent = n;
      saveState();
    });
  }
  return card;
}

/* Ajoute un NOUVEL événement (scan live) : état + DOM + persistance */
function addSale(rec) {
  if (!feedEl) return;
  if (emptyEl) emptyEl.style.display = "none";

  state.events.unshift(rec);
  if (state.events.length > MAX_STORED_EVENTS) state.events.length = MAX_STORED_EVENTS;

  const card = buildCard(rec, true);
  feedEl.prepend(card);
  requestAnimationFrame(() => card.classList.add("salecard--in"));
  while (feedEl.children.length > MAX_FEED_CARDS) feedEl.lastElementChild.remove();

  state.eventsShown += 1;
  if (rec.payment?.token === "EGLD") state.totalEgld += rec.payment.value;
  updateCounters();
  saveState();                                   // ★
}

/* ★ Restaure l'historique sauvegardé (sans animation ni compteurs) */
function renderStoredEvents() {
  if (!feedEl || !state.events.length) return;
  if (emptyEl) emptyEl.style.display = "none";
  const frag = document.createDocumentFragment();
  for (const rec of state.events) frag.appendChild(buildCard(rec, false));
  feedEl.appendChild(frag);
  updateCounters();
}

/* === CONTRÔLES ========================================================== */

function start() {
  if (state.running) return;
  state.running = true;
  state.cursor = Math.max(
    state.cursor,
    Math.floor(Date.now() / 1000) - MAX_LOOKBACK_SEC
  );
  toggleBtn.textContent = "⏸ Pause";
  setStatus("live");
  scanCycle();
}

function stop() {
  state.running = false;
  clearTimeout(state.timer);
  toggleBtn.textContent = "▶ Resume";
  setStatus("paused");
  saveStateNow();
}

function initSalesFeed() {
  feedEl = $("salesFeedList");
  emptyEl = $("salesFeedEmpty");
  statusDot = $("sfLiveDot");
  statusText = $("sfLiveText");
  toggleBtn = $("sfToggleBtn");
  if (!feedEl) return;

  /* ★ Restauration avant tout */
  loadState();
  renderStoredEvents();

  /* Filtre actif restauré sur les chips */
  document.querySelectorAll(".sf-filter-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === state.filter);
    chip.addEventListener("click", () => {
      document.querySelectorAll(".sf-filter-chip")
        .forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.filter = chip.dataset.filter;
      saveState();
    });
  });

  toggleBtn.addEventListener("click", () => {
    if (state.running) { stop(); state._userPaused = true; }
    else { state._userPaused = false; start(); }
  });

  const clearBtn = $("sfClearBtn");
  if (clearBtn) clearBtn.addEventListener("click", clearHistory);

  setInterval(refreshTimes, 30000);

  /* ★ Sauvegarde de dernière chance quand l'onglet se ferme / passe en fond */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveStateNow();
  });
  window.addEventListener("pagehide", saveStateNow);

  /* Démarre uniquement quand la section devient visible (économise l'API) */
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting && !state.running && !state._userPaused) start();
    });
  }, { threshold: 0.05 });
  io.observe($("salesFeedSection"));
}

document.addEventListener("DOMContentLoaded", initSalesFeed);
})();
