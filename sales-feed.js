/* ============================================================================
   sales-feed.js — Live NFT Sales Feed (portage navigateur de ScanNFTs_5_5.py)
   ============================================================================
   Logique portée du scanner Telegram :
   - Scan des fonctions buy / bid / bulkBuy / buySwap / bulkSwap / giveaway /
     acceptGlobalOffer / acceptOffer / mint / mintFromMachine   (scan_loop)
   - Pagination + garde de progression si N txs partagent le même timestamp
     (FIX B12)
   - Suivi des transactions PENDING jusqu'à leur succès (pending_txs +
     check_pending_transactions) — aucune tx perdue si elle est encore en
     cours au moment du scan
   - bid : NFT extrait du champ data base64 "bid@id@collectionHex@nonceHex",
     nonce hex à longueur paire (extract_nft_from_bid_data + FIX B3)
   - function vide → décodée depuis data base64 (FIX F4)
   - From/To reconstruits depuis le parcours réel du NFT dans operations[]
     (derive_nft_route, FIX F1) + vendeur via les payouts en cas d'escrow
     (_seller_from_payouts, FIX F7)
   - Paiements : EGLD vers smart contract ignoré (FIX F2), somme bulkBuy
   - Herotags avec cache TTL 1 h (FIX F3) ; anti-doublons TTL (FIX Q3) ;
     récap par collection au-delà du seuil (FIX Q2) ; throttle global +
     backoff exponentiel sur 429/erreur réseau (FIX R1 renforcé)
   - withOperations=true sur les listes : pas de fetch de détail par tx
   - Historique persistant en localStorage (cartes, compteurs, curseurs)
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
const PAGE_SIZE           = 50;                    // comme le script Python
const MAX_PAGES_PER_SCAN  = 4;                     // garde-fou pagination
const PENDING_MAX_AGE_MS  = 15 * 60 * 1000;        // abandon d'un pending

/* Rythme : FUNCTIONS_PER_CYCLE fonctions par cycle, chacune avec son
   curseur → charge lissée, aucun événement raté. */
const FUNCTIONS_PER_CYCLE = 3;

/* Backoff sur 429 / erreur réseau : 5s → 10s → 20s → 40s → 60s max */
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS  = 60000;

/* ★ Persistance */
const STORAGE_KEY       = "odin_sales_feed_v1";
const MAX_STORED_EVENTS = MAX_FEED_CARDS;
const MAX_LOOKBACK_SEC  = 3600;                    // rattrapage max après refresh
const SAVE_DEBOUNCE_MS  = 600;

const METHOD_LABELS = {
  buy: "Buy", mint: "Mint", bid: "Bid", bulkbuy: "Bulk Buy",
  buyswap: "Buy Swap", bulkswap: "Bulk Swap", giveaway: "Giveaway",
  acceptglobaloffer: "Global Offer", acceptoffer: "Offer",
  mintfrommachine: "Machine Mint",
};

/* === ÉTAT =============================================================== */

const state = {
  running: false,
  cursors: {},                  // curseur PAR fonction (scan tournant)
  scanIdx: 0,                   // position dans la rotation
  seen: new Map(),              // txHash -> détecté à (ms)   (FIX Q3)
  pending: new Map(),           // txHash -> ajouté à (ms)    (pending_txs)
  herotags: new Map(),          // addr -> {name, ts}         (FIX F3)
  events: [],                   // historique sérialisable (récent → ancien)
  timer: null,
  eventsShown: 0,
  totalEgld: 0,
  _userPaused: false,
  _storageOk: true,
};

function defaultCursor() {
  return Math.floor(Date.now() / 1000) - 120;
}
for (const fn of SCAN_FUNCTIONS) state.cursors[fn] = defaultCursor();

/* === PERSISTANCE (localStorage) ======================================== */

let saveTimer = null;

function saveStateNow() {
  if (!state._storageOk) return;
  try {
    const payload = {
      v: 2,
      cursors: state.cursors,
      eventsShown: state.eventsShown,
      totalEgld: state.totalEgld,
      seen: [...state.seen.entries()].filter(
        ([, t]) => Date.now() - t < SEEN_TTL_MS
      ),
      pending: [...state.pending.entries()],
      herotags: [...state.herotags.entries()].slice(-200),
      events: state.events.slice(0, MAX_STORED_EVENTS),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    state._storageOk = false;   // quota plein / mode privé : on continue sans
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
    state._storageOk = false;
    return;
  }
  if (!raw) return;

  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (!data || (data.v !== 1 && data.v !== 2)) return;

  state.eventsShown = Number(data.eventsShown) || 0;
  state.totalEgld   = Number(data.totalEgld) || 0;

  const now = Date.now();
  for (const [h, t] of data.seen || []) {
    if (now - t < SEEN_TTL_MS) state.seen.set(h, t);
  }
  for (const [h, t] of data.pending || []) {
    if (now - t < PENDING_MAX_AGE_MS) state.pending.set(h, t);
  }
  for (const [addr, entry] of data.herotags || []) {
    if (entry && now - entry.ts < HEROTAG_TTL_MS) state.herotags.set(addr, entry);
  }

  state.events = Array.isArray(data.events)
    ? data.events.slice(0, MAX_STORED_EVENTS)
    : [];

  /* Curseurs : reprise là où on s'était arrêté, plafonnée à 1 h en arrière
     (le cache seen évite les doublons à la frontière). v1 : curseur global. */
  const floor = Math.floor(now / 1000) - MAX_LOOKBACK_SEC;
  const savedCursors = data.v === 2 && data.cursors ? data.cursors : {};
  const legacy = Number(data.cursor) || 0;
  for (const fn of SCAN_FUNCTIONS) {
    const saved = Number(savedCursors[fn]) || legacy || 0;
    state.cursors[fn] = Math.max(saved, floor);
  }
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

/* === HTTP THROTTLÉ (FIX R1) + BACKOFF ================================== */

let lastRequestAt = 0;
let httpChain = Promise.resolve();
let failStreak = 0;
let backoffUntil = 0;

function throttledFetchJson(url) {
  const run = async () => {
    const backoffWait = backoffUntil - Date.now();
    if (backoffWait > 0) await new Promise(r => setTimeout(r, backoffWait));
    const wait = MIN_REQUEST_INTERVAL - (performance.now() - lastRequestAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = performance.now();

    try {
      /* Pas d'en-tête custom : requête "simple" → aucun preflight OPTIONS */
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        failStreak += 1;
        backoffUntil = Date.now() +
          Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failStreak - 1));
        return null;
      }
      if (!res.ok) return null;      // 404 etc. : réponse légitime
      const json = await res.json();
      failStreak = 0;
      return json;
    } catch {
      /* Réseau coupé ou 429 masqué en erreur CORS par le navigateur */
      failStreak += 1;
      backoffUntil = Date.now() +
        Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failStreak - 1));
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

function decodeBase64(b64) {
  try { return atob(b64); } catch { return null; }
}

function hexToUtf8(hex) {
  try {
    const bytes = hex.match(/.{2}/g).map(h => parseInt(h, 16));
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch { return null; }
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
  saveState();
  return result;
}

function mediaThumb(identifier) {
  return `https://media.multiversx.com/nfts/thumbnail/${identifier}`;
}

/* FIX B10 : passerelles IPFS actives */
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
];

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

/* Portage de extract_media_url : media[] → url → uris b64 → thumbnail */
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
      const decoded = decodeBase64(b64);
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

/* === BID : extract_nft_from_bid_data (FIX B3) ========================== */
/* Une enchère ne déplace PAS le NFT : aucune opération nft dans la tx.
   L'identifier est reconstruit depuis le data : "bid@id@collectionHex@nonceHex"
   avec un nonce hex à longueur PAIRE (535 → "0217", pas "217"). */
function extractNftFromBidData(tx) {
  const dataStr = decodeBase64(tx.data || "");
  if (!dataStr) return null;

  const parts = dataStr.split("@");
  if (parts.length < 4 || parts[0] !== "bid") return null;

  const collection = hexToUtf8(parts[2]);
  if (!collection) return null;

  const nonce = parseInt(parts[3], 16);
  if (!Number.isFinite(nonce)) return null;

  let nonceHex = nonce.toString(16);
  if (nonceHex.length % 2) nonceHex = "0" + nonceHex;   // FIX B3

  return {
    collection,
    identifier: `${collection}-${nonceHex}`,
    value: formatEgld(tx.value || "0"),
  };
}

/* === ANALYSE D'UNE TRANSACTION (analyze_and_send) ====================== */

/* Accepte un objet tx complet (liste withOperations=true : 0 requête) ou un
   hash (fallback : 1 fetch de détail). En cas d'échec du fetch, le hash est
   mis en pending pour ré-essai au cycle suivant — jamais perdu en silence. */
async function analyzeTx(txOrHash) {
  let tx = typeof txOrHash === "object" ? txOrHash : null;
  const hash = tx ? tx.txHash : txOrHash;

  const needsDetail =
    !tx || (!Array.isArray(tx.operations) &&
            (tx.function || "").toLowerCase() !== "bid");
  if (needsDetail) {
    tx = await throttledFetchJson(
      `${API_BASE}/transactions/${hash}?withOperations=true`);
    if (!tx) {
      state.pending.set(hash, Date.now());   // ré-essai plus tard
      return;
    }
  }

  const status = (tx.status || "").toLowerCase();
  if (status === "pending") {                // suivi comme le script Python
    state.pending.set(tx.txHash, Date.now());
    return;
  }
  if (status !== "success") return;

  /* FIX F4 : function vide → décodée depuis le data base64 */
  let fn = (tx.function || "").toLowerCase();
  if (!fn) {
    const decoded = decodeBase64(tx.data || "");
    fn = (decoded || "").split("@")[0].slice(0, 32).toLowerCase();
  }
  if (!ALLOWED_FUNCTIONS.has(fn)) return;
  if (FORBIDDEN_KEYWORDS.some(k => fn.includes(k))) return;

  const payments = extractPayments(tx);
  const mainPayment = getMainPayment(payments, fn);

  /* --- bid : identifier reconstruit depuis le data (FIX 4.5 conservé) --- */
  if (fn === "bid") {
    const bidNft = extractNftFromBidData(tx);
    if (!bidNft) return;
    addSale({
      txHash: tx.txHash, timestamp: tx.timestamp,
      method: fn, identifier: bidNft.identifier, collection: bidNft.collection,
      name: bidNft.identifier, bulkCount: 0,
      fromErd: tx.sender,                    // l'enchérisseur
      toErd: tx.receiver,                    // le SC d'enchères (résolu en nom)
      fromName: null, toName: null,
      payment: mainPayment ||
        (bidNft.value > 0 ? { value: bidNft.value, token: "EGLD" } : null),
    });
    return;
  }

  /* --- Autres méthodes : NFTs réellement transférés ---------------------- */
  const nftOps = (tx.operations || []).filter(
    op => op.type === "nft" && op.identifier &&
          op.action !== "burn" && op.receiver
  );
  if (!nftOps.length) return;

  const byId = new Map();
  for (const op of nftOps) if (!byId.has(op.identifier)) byId.set(op.identifier, op);
  const identifiers = [...byId.keys()];

  /* FIX Q2 : récap par collection au-delà du seuil */
  if (identifiers.length > MAX_NFT_CARDS_PER_TX) {
    const byCollection = new Map();
    for (const id of identifiers) {
      const coll = byId.get(id).collection || id.split("-").slice(0, 2).join("-");
      if (!byCollection.has(coll)) byCollection.set(coll, []);
      byCollection.get(coll).push(id);
    }
    for (const [coll, ids] of byCollection) {
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

/* === SUIVI DES PENDING (check_pending_transactions) ==================== */

async function checkPendingTransactions() {
  if (!state.pending.size) return;

  for (const [hash, addedAt] of [...state.pending.entries()]) {
    if (Date.now() - addedAt > PENDING_MAX_AGE_MS) {
      state.pending.delete(hash);            // trop vieux : abandon
      continue;
    }
    const tx = await throttledFetchJson(
      `${API_BASE}/transactions/${hash}?withOperations=true`);
    if (!tx) continue;                       // ré-essai au prochain cycle

    const status = (tx.status || "").toLowerCase();
    if (status === "success") {
      state.pending.delete(hash);
      analyzeTx(tx).catch(() => {});
    } else if (status === "invalid" || status === "fail" ||
               status === "failed") {
      state.pending.delete(hash);            // définitivement échouée
    }
    /* status pending : on laisse pour le prochain cycle */
  }
}

/* === BOUCLE DE SCAN (scan_loop / scan_function) ======================== */

/* Pagination complète + garde de progression (FIX B12) : si une page
   entière partage le même timestamp, le curseur avance de +1 s au lieu de
   rester bloqué — plus aucune tx inatteignable derrière un pic d'activité.
   Pas de filtre status : les pending sont détectées et suivies (FIX Q3). */
async function scanFunction(fn) {
  let pageStart = state.cursors[fn] ?? defaultCursor();
  const initialStart = pageStart;

  for (let page = 0; page < MAX_PAGES_PER_SCAN; page++) {
    const url = `${API_BASE}/transactions?function=${fn}` +
                `&after=${pageStart}&size=${PAGE_SIZE}&order=asc` +
                `&withOperations=true`;
    const txs = await throttledFetchJson(url);
    if (!Array.isArray(txs) || !txs.length) break;

    let lastTs = pageStart;
    for (const tx of txs) {
      const hash = tx.txHash;
      const ts = tx.timestamp || 0;
      if (!hash || ts <= initialStart) continue;
      lastTs = Math.max(lastTs, ts);

      if (!state.seen.has(hash)) {
        state.seen.set(hash, Date.now());    // FIX Q3
        const status = (tx.status || "").toLowerCase();
        if (status === "pending") {
          state.pending.set(hash, Date.now());
        } else {
          analyzeTx(tx).catch(() => {});     // objet complet : 0 requête
        }
      }
    }

    /* FIX B12 : garantir la progression */
    if (lastTs <= pageStart) {
      if (txs.length >= PAGE_SIZE) { pageStart += 1; continue; }
      break;
    }
    pageStart = lastTs;
    if (txs.length < PAGE_SIZE) break;       // dernière page atteinte
  }

  if (pageStart > initialStart) state.cursors[fn] = pageStart - 1;
}

async function scanCycle() {
  if (!state.running) return;
  setStatus("scan");

  /* Scan TOURNANT : FUNCTIONS_PER_CYCLE fonctions par cycle, chacune avec
     son propre curseur — chaque fonction reprend là où ELLE s'était arrêtée. */
  const batch = [];
  for (let i = 0; i < FUNCTIONS_PER_CYCLE; i++) {
    batch.push(SCAN_FUNCTIONS[state.scanIdx % SCAN_FUNCTIONS.length]);
    state.scanIdx = (state.scanIdx + 1) % SCAN_FUNCTIONS.length;
  }
  for (const fn of batch) await scanFunction(fn);   // séquentiel : charge lissée

  await checkPendingTransactions();

  /* Purge du cache seen (FIX Q3) */
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [h, t] of state.seen) if (t < cutoff) state.seen.delete(h);

  refreshTimes();
  setStatus("live");
  saveState();                               // curseurs + seen + pending
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

/* Média : vrai fichier (gateways IPFS si besoin) → thumbnail → rune ᛟ */
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
    el.setAttribute("muted", "");
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
      el.src = candidates[idx];
    } else {
      el.remove();
      wrap.classList.add("no-media");
    }
  });

  wrap.prepend(el);
}

/* Récupère le vrai média (une seule fois par NFT, persisté avec la carte) */
async function upgradeMedia(rec, card) {
  if (rec.mediaUrl) return;
  const info = await fetchNftMedia(rec.identifier);
  if (!info) {
    rec.mediaUrl = mediaThumb(rec.identifier);
    saveState();
    return;
  }

  rec.mediaUrl = info.url;
  rec.mediaType = info.fileType || "";

  if (info.name && !rec.bulkCount &&
      (!rec.name || rec.name === rec.identifier)) {
    rec.name = info.name;
    const nameEl = card.querySelector(".salecard-name");
    if (nameEl) nameEl.textContent = info.name;
  }

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

  setCardMedia(card, rec);
  if (!rec.mediaUrl) upgradeMedia(rec, card);

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
  saveState();
}

/* Restaure l'historique sauvegardé (sans animation ni compteurs) */
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
  const floor = Math.floor(Date.now() / 1000) - MAX_LOOKBACK_SEC;
  for (const fn of SCAN_FUNCTIONS) {
    state.cursors[fn] = Math.max(state.cursors[fn] ?? defaultCursor(), floor);
  }
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

  loadState();
  renderStoredEvents();

  toggleBtn.addEventListener("click", () => {
    if (state.running) { stop(); state._userPaused = true; }
    else { state._userPaused = false; start(); }
  });

  const clearBtn = $("sfClearBtn");
  if (clearBtn) clearBtn.addEventListener("click", clearHistory);

  setInterval(refreshTimes, 30000);

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
