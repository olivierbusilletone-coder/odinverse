// main.js
import process from "process";
import { Buffer } from "buffer";

window.process = process;
window.Buffer = Buffer;

import QRCode from "qrcode";
import { WalletConnectV2Provider } from "@multiversx/sdk-wallet-connect-provider";
import { ExtensionProvider } from "@multiversx/sdk-extension-provider";


/* ================= GLOBAL COMBAT STATE ================= */
window.currentUserAddress = null;       // Adresse connectée
window.selectedCombatNft = null;        // NFT sélectionné pour le combat
window.enemyCombatNft = null;           // NFT ennemi
window.usedCombatNfts = new Set();      // NFTs déjà utilisés en session

const COLLECTION_ODINS = "ODINSDECK-4e300a"; // Collection des NFTs Odins
const SEER_IDS = new Set([91, 127, 130, 176, 224, 301, 309, 352, 361, 373]); // Seers

window.telegramLeaderboardSent = false;
// 🧪 MODE TEST — METTRE null EN PRODUCTION
// (sinon tous les utilisateurs voient le wallet de test au lieu du leur)
 //const TEST_ERD_ADDRESS = null;
// Pour tester en local, décommente la ligne suivante :
 const TEST_ERD_ADDRESS = "erd1z4xjt3dnlz5nyt8vsp5r68ftmstfepldc4r3yv9rfyknyn872psstnrh3f";

/* ================= FIRESTORE SETUP ================= */
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  getDocs,
  increment,
  arrayUnion
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCTvZ8uBFquJyQafDoFxaMnTtQosbm2cc8",
  authDomain: "odinverse-68f9a.firebaseapp.com",
  projectId: "odinverse-68f9a",
  storageBucket: "odinverse-68f9a.firebasestorage.app",
  messagingSenderId: "1008100514502",
  appId: "1:1008100514502:web:a2792d928c1ff4600855c7",
  measurementId: "G-NG4N10WTRD"
};
// 🔹 Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 🔹 Collection leaderboard
const leaderboardCollection = collection(db, "combatStats");

document.addEventListener("DOMContentLoaded", () => {

  /* ========= DOM ========= */
  const statusEl = document.getElementById("status");
  const addressEl = document.getElementById("address");

  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const walletChoices = document.getElementById("walletChoices");
  const connectExtensionBtn = document.getElementById("connectExtension");
  const connectWalletConnectBtn = document.getElementById("connectWalletConnect");
  const connectXPortalBtn = document.getElementById("connectXPortal");
  const qrEl = document.getElementById("MyWalletConnectQRContainer");
  const balancesContainer = document.querySelector(".wallet-balances");
  const aboutSection = document.getElementById("aboutSection");
  const odinsSection = document.getElementById("nftSectionOdins");
  const otherSection = document.getElementById("nftSectionOthers");
  const odinsList = document.getElementById("odinsList");
  const otherList = document.getElementById("otherNftsList");
  const postConnectActions = document.getElementById("postConnectActions");
  const odinsPreview = document.getElementById("odinsPreview");
  const odinsCountEl = document.getElementById("odinsCount");
  const odinsAttributesTable = document.getElementById("odinsAttributesTable");
  const otherNftSearch = document.getElementById("otherNftSearch");
  const topHolders = document.getElementById("topHoldersdeck");
  
  /* ========= MODAL ========= */
  const nftModal = document.getElementById("nftModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalAttributes = document.getElementById("modalAttributes");
  const modalMediaContainer = document.getElementById("modalMediaContainer");
  const closeModalBtn = document.getElementById("closeModal");
  const walletActions = document.querySelector(".wallet-actions");
  const backBtn = document.getElementById("walletBackBtn");

  /* ========= CONFIG ========= */
  const COLLECTION_ID = "ODINSDECK-4e300a";
  const TSK_TOKEN_ID = "TSK-4c0988";
  const projectId = "34e304e844296ede8b06875106a3276c";
  const relayUrl = "wss://relay.walletconnect.com";
  const chainId = "D";

  let provider = null;

  /* ========= UTILS ========= */
  function createLine(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div;
  }

  function getAttributes(nft) {
    if (Array.isArray(nft.metadata?.attributes)) return nft.metadata.attributes;
    if (Array.isArray(nft.attributes)) return nft.attributes;
    return [];
  }


function createMediaElement(url, className = "", autoplay = false, previewUrl = null) {
  if (!url) {
    const ph = document.createElement("div");
    ph.className = className;
    ph.style.cssText = "background:rgba(255,255,255,.04);width:100%;height:100%;border-radius:10px;";
    return ph;
  }

  const isVideo = url.match(/\.(mp4|webm|ogg)$/i);
  let el;

  if (isVideo) {
    el = document.createElement("video");
    el.preload = "metadata";
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.controls = false;
    el.src = url;              // ✅ toujours défini (sinon vide sur mobile sans hover)

    if (autoplay) el.autoplay = true;
    if (previewUrl) el.poster = previewUrl;

  } else {
    el = document.createElement("img");
    el.src = url;
    el.loading = "lazy";
    el.decoding = "async";
    el.alt = "";              // décoratif — évite le double-lecture par lecteurs d'écran
  }

  // Fallback si le média échoue à charger
  el.addEventListener("error", () => {
    el.style.background = "rgba(255,80,80,.06)";
  }, { once: true });

  el.className = className;
  return el;
}

function openNftModal(nft) {
  modalTitle.textContent = nft.nonce != null
    ? `${nft.name || "—"}  ·  ${nft.nonce}`
    : (nft.name || "—");

  modalMediaContainer.innerHTML = "";
  modalMediaContainer.appendChild(
    createMediaElement(nft.image, "modal-image", true)
  );

  const attrs = getAttributes?.(nft) || [];

  function getDisplayTrait(nft) {
    const manualTrait = MANUAL_NFT_TRAITS[nft.nonce];
    if (manualTrait) return normalizeTrait(manualTrait);

    const attr = attrs.find(a => a.trait_type === "Type");
    return attr ? normalizeTrait(attr.value) : "unknown";
  }

  const finalTrait = getDisplayTrait(nft);

  // ⚡ On ajoute un conteneur et on ne touche pas aux éléments qui pourraient bloquer le close
  let html = "";
  if (attrs.length) {
    html = attrs.map(a => {
      const value = a.trait_type === "Type" ? finalTrait : a.value;
      return `
        <div class="attr">
          <strong>${a.trait_type}</strong>
          <span>${value}</span>
        </div>
      `;
    }).join("");
  } else {
    html = `
      <div class="attr">
        <strong>Type</strong>
        <span>${finalTrait}</span>
      </div>
      <p style="
        opacity: 0.6;
        font-family: 'Cinzel', serif;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      ">
        No attributes
      </p>
    `;
  }

  modalAttributes.innerHTML = html;

  // ✅ Affiche le modal
  nftModal.style.display = "flex";

  // 🔒 Assure que le bouton close fonctionne
  closeModalBtn.onclick = () => (nftModal.style.display = "none");
  nftModal.onclick = e => {
    if (e.target === nftModal) nftModal.style.display = "none";
  };
  // Touche Escape pour fermer (accessibilité)
  const escClose = (e) => {
    if (e.key === "Escape") {
      nftModal.style.display = "none";
      document.removeEventListener("keydown", escClose);
    }
  };
  document.addEventListener("keydown", escClose);
}

  /* ========= NFT RENDER ========= */
  function renderNfts(nfts, container, emptyText) {
    container.innerHTML = "";

    if (!nfts.length) {
      container.innerHTML = `<p>${emptyText}</p>`;
      return;
    }

    nfts.forEach(nft => {
      const card = document.createElement("div");
      card.className = "nft-card";

      // data-category depuis _displayTrait assigné dans fetchNFTs
      if (nft._displayTrait) card.dataset.category = nft._displayTrait;

      const media = createMediaElement(nft.image, "");

      const nameEl = document.createElement("div");
      nameEl.className = "nft-name";
      nameEl.textContent = nft.name || "—";

      const nonceEl = document.createElement("div");
      nonceEl.className = "nft-nonce";
      // nft.nonce est déjà en décimal depuis l'API
      nonceEl.textContent = nft.nonce != null ? nft.nonce : "";

      card.append(media, nameEl, nonceEl);
      card.onclick = () => openNftModal(nft);

      container.appendChild(card);
    });
  }

/* ========= AFFICHAGE RECAP PAGE CENTRALE ========= */
async function loadRandomOdinsPreview() {
  const row = document.getElementById("odinsRow");
  if (!row) return;

  row.innerHTML = "";

  // 👁️ Observer pour pause/play (perf mobile énorme)
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        const el = entry.target;
        if (el.tagName === "VIDEO") {
          if (entry.isIntersecting) {
            el.play().catch(() => {});
          } else {
            el.pause();
          }
        }
      });
    },
    { threshold: 0.2 }
  );

  try {
    const res = await fetch(
      "https://api.multiversx.com/nfts?collection=ODINSDECK-4e300a&size=100"
    );
    if (!res.ok) return;

    const data = await res.json();

    const shuffled = data
      .sort(() => 0.5 - Math.random())
      .slice(0, 6);

    shuffled.forEach(nft => {
      const media = nft.media?.[0];
      if (!media) return;

      const url = media.originalUrl || media.url;
      if (!url) return;

      const item = document.createElement("div");
      item.className = "odins-item";

      let el;

      // 🎥 VIDEO
      if (media.fileType?.startsWith("video")) {
        el = document.createElement("video");

        el.src = url;
        el.autoplay = true;
        el.loop = true;
        el.muted = true;
        el.playsInline = true;

        // ⚡ OPTIMISATIONS
        el.preload = "metadata";
        el.loading = "lazy";
        el.disablePictureInPicture = true;
        el.controls = false;
        el.pointerEvents = "none";

        // 📐 taille fixe = pas de reflow
        el.width = 180;
        el.height = 180;

        observer.observe(el);

      } 
      // 🖼️ IMAGE
      else {
        el = document.createElement("img");
        el.src = url;
        el.loading = "lazy";
        el.decoding = "async";
        el.width = 180;
        el.height = 180;
      }

      item.appendChild(el);
      row.appendChild(item);
    });

  } catch (err) {
    console.error("Odin preview error:", err);
  }
}

function getDisplayTrait(nft) {
  const manualTrait = MANUAL_NFT_TRAITS[nft.nonce];
  if (manualTrait) return normalizeTrait(manualTrait);

  const attr = (getAttributes?.(nft) || []).find(
    a => a.trait_type === "Type"
  );

  return attr ? normalizeTrait(attr.value) : "unknown";
}

/* ========= ATTRIBUTES RECAP ========= */
// 🛠️ NFT avec attributs cassés / manquants
// nonce → trait forcé
const MANUAL_NFT_TRAITS = {
  330: "darkness",
  146: "strength",
  286: "nature",
  96: "darkness",
};
function buildAttributesRecap(nfts = []) {
  const odinsAttributesTable = document.getElementById("odinsAttributesTable");
  if (!odinsAttributesTable) return;

  /* 🔹 CONFIG */
  const TRAIT_KEY = "Type";
  const TRAIT_LABEL = "Category";
  const BONUS_THRESHOLD = 7;

  /* 🔮 SEERS CONFIG */
  const SEER_BONUS = 0.17;

  /* 💰 REWARD EGLD */
  const TRAIT_REWARDS = {
    strength: 0.02,
    resilience: 0.01,
    darkness: 0.01,
    command: 0.012,
    nature: 0.013,
    agility: 0.013,
    technology: 0.013,
    magic: 0.014,
    monster: 0.014,
    light: 0.014,
    chaos: 0.017,
    knowledge: 0.017,
    awareness: 0.018,
    stealth: 0.018,
    craftsmanship: 0.018
  };

  /* 🎁 BONUS EGLD */
  const TRAIT_BONUSES = {
    strength: 0.005,
    resilience: 0.001,
    darkness: 0.001,
    command: 0.002,
    nature: 0.002,
    agility: 0.002,
    technology: 0.002,
    magic: 0.003,
    monster: 0.003,
    light: 0.003,
    chaos: 0.003,
    knowledge: 0.004,
    awareness: 0.005,
    stealth: 0.005,
    craftsmanship: 0.005
  };

  /* 😀 EMOJIS */
  const TRAIT_EMOJIS = {
    strength: "💪",
    resilience: "🛡️",
    darkness: "🌑",
    command: "👑",
    nature: "🌿",
    agility: "🤸",
    technology: "⚙️",
    magic: "✨",
    monster: "👹",
    light: "🌟",
    chaos: "🔥",
    knowledge: "📚",
    awareness: "👁️",
    stealth: "🥷",
    craftsmanship: "🛠️"
  };

  /* 🔮 SEERS SPECIAL MOVES */
  const SPECIAL_MOVES = {
    127: { command: "magic" },
    130: { darkness: "magic" }
  };

  const valuesMap = {};
  const seerNFTs = [];

  /* 📦 COLLECTE */
  nfts.forEach(nft => {
    const nonces = Array.isArray(nft.nonce) ? nft.nonce : [nft.nonce];

    // 🔮 Détection Seer
    const seerNonces = nonces.filter(n => SEER_IDS.has(Number(n)));
    if (seerNonces.length) seerNFTs.push({ nft, seerNonces });

    const manualTrait = MANUAL_NFT_TRAITS[nft.nonce];

	// 🧩 CAS 1 : trait manuel forcé
	if (manualTrait) {
	  const key = normalizeTrait(manualTrait);
	  valuesMap[key] = (valuesMap[key] || 0) + 1;
	} 
	// 🧩 CAS 2 : comportement normal
	else {
	  (getAttributes?.(nft) || []).forEach(attr => {
		if (attr.trait_type !== TRAIT_KEY) return;
		const key = normalizeTrait(attr.value);
		valuesMap[key] = (valuesMap[key] || 0) + 1;
	  });
	}

  });

  // 🔄 AJUSTEMENTS SEERS SPÉCIAUX (une seule fois par NFT)
  seerNFTs.forEach(({ nft, seerNonces }) => {
    const attrs = (getAttributes?.(nft) || []).filter(a => a.trait_type === TRAIT_KEY);

    // Fusionner tous les moves de tous les Seers du NFT
    const mergedMoves = {};
    seerNonces.forEach(seerId => {
      const moves = SPECIAL_MOVES[seerId];
      if (moves) {
        Object.entries(moves).forEach(([from, to]) => {
          mergedMoves[from] = to;
        });
      }
    });

    // Appliquer les déplacements
    attrs.forEach(attr => {
      const key = normalizeTrait(attr.value);
      const newKey = mergedMoves[key];
      if (newKey) {
        valuesMap[key] = Math.max((valuesMap[key] || 0) - 1, 0);
        valuesMap[newKey] = (valuesMap[newKey] || 0) + 1;
      }
    });
  });

  if (!Object.keys(valuesMap).length) {
  odinsAttributesTable.innerHTML = `
    <div style="
      display:flex;
      justify-content:center;
      align-items:center;
      padding:20px;
    ">
      <div style="
        width:160px;
        height:220px;
        border:2px dashed rgba(255, 215, 0, 0.4);
        border-radius:12px;
        background:rgba(255,255,255,0.05);
        backdrop-filter: blur(4px);
        display:flex;
        flex-direction:column;
        justify-content:center;
        align-items:center;
        gap:10px;
        color:#ffdd77;
        font-family:'Cinzel', serif;
        text-transform:uppercase;
        letter-spacing:0.12em;
        opacity:0.7;
      ">
        <div style="font-size:28px;">🜂</div>
        <div style="font-size:0.7rem;">No NFT</div>
      </div>
    </div>
  `;
  return;
}

let baseTotal = 0;
let bonusTotal = 0;

//console.log("📊 ===== ATTRIBUTES CALC START =====");
//console.log("📦 RAW valuesMap:", JSON.parse(JSON.stringify(valuesMap)));

/* ================= TRAITS ================= */
const details = Object.entries(valuesMap)
  .sort((a, b) => b[1] - a[1])
  .map(([key, count]) => {

    const reward = TRAIT_REWARDS[key] || 0;

    // ⚠️ DEBUG CRUCIAL : vérifie si count est cohérent
    const expected = count * reward;

 //   console.log(`🧩 TRAIT RAW CHECK -> ${key}`, {
//      count,
//      reward,
//      countType: typeof count,
 //     expectedEarned: expected
 //   });

    const earned = count * reward;

    baseTotal += earned;

    const bonusCount = Math.floor(count / BONUS_THRESHOLD);
    const bonusUnit = TRAIT_BONUSES[key] || 0;
    const bonus = bonusCount * bonusUnit;

    bonusTotal += bonus;

    return {
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      emoji: TRAIT_EMOJIS[key] || "❓",
      count,
      earned,
      bonus,
      bonusCount
    };
  });

//console.log("💰 BASE TOTAL FINAL:", baseTotal);
//console.log("🎁 BONUS TOTAL:", bonusTotal);

/* 🔮 SEER BONUS CUMULÉ */
const seerCount = seerNFTs.flatMap(s => s.seerNonces).length;
const seerBonusEarned = seerCount * SEER_BONUS;

//console.log("🔮 SEER DEBUG:", {
//  seerCount,
//  SEER_BONUS,
//  seerBonusEarned
//});

bonusTotal += seerBonusEarned;

const grandTotal = baseTotal + bonusTotal;

//console.log("🏁 FINAL TOTAL BREAKDOWN:", {
//  baseTotal: baseTotal.toFixed(6),
//  bonusTotal: bonusTotal.toFixed(6),
//  grandTotal: grandTotal.toFixed(6)
//});

//console.log("📊 ===== ATTRIBUTES CALC END =====");

  /* 🖼️ RENDER */
  odinsAttributesTable.innerHTML = `
  <div class="attr-row">
    <strong>${TRAIT_LABEL}</strong>
    <div style="  display:flex;  flex-wrap:wrap;  gap:8px;  margin-top:2px;  justify-content:center;  width:100%;">
      ${details.filter(d => d.count > 0)
        .map(d => `<span>${d.emoji} ${d.label} (${d.count})</span>`).join("")}
    </div>
  </div>

  <div class="attr-row">
    <strong>Earnings by trait</strong>
    <div style="  display:flex;  flex-wrap:wrap;  gap:8px;  margin-top:2px;  justify-content:center;  width:100%;">
      ${details.filter(d => d.count > 0)
        .map(d => `<span>${d.emoji} ${d.label}: ${d.earned.toFixed(3)} EGLD</span>`).join("")}
    </div>
  </div>

  <div class="attr-row">
    <strong>🎁 Trait Bonuses (>7)</strong>
    <div style="  display:flex;  flex-wrap:wrap;  gap:8px;  margin-top:2px;  justify-content:center;  width:100%;">
      ${details.filter(d => d.bonus > 0)
        .map(d => `<span>${d.emoji} ${d.label}: +${d.bonus.toFixed(3)} EGLD (${d.bonusCount}×)</span>`).join("") || "<span style='opacity:.6'>No bonus</span>"}
    </div>
  </div>

  <div class="attr-row">
    <strong>🔮 Seer Bonus</strong>
    <div style="  display:flex;  flex-wrap:wrap;  gap:8px;  margin-top:2px;  justify-content:center;  width:100%;">
      <span>${seerCount} Seer(s) → +${seerBonusEarned.toFixed(2)} EGLD</span>
    </div>
  </div>

  <div class="attr-row" style="font-size:1rem;font-weight:800;">
    <strong>💰 Total Earnings</strong>
	<div style="display:flex;flex-wrap:wrap;gap:8px; margin-top:2px; justify-content:center;width:100%;">
	  <span style="font-size: 1.6rem;font-weight: 900;letter-spacing: 0.08em;color: #9cffc7;text-align: center;text-shadow:	0 0 10px rgba(125,255,178,0.35),0 0 22px rgba(125,255,178,0.18);">
		${grandTotal.toFixed(3)} EGLD
	  </span>
	</div>
</div>
</div>
	  `;
}

// 🔁 Normalisation (case / espaces)
function normalizeTrait(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


/* GESTION DU REFRESH */
window.addEventListener("load", async () => {
  try {
  const ext = ExtensionProvider.getInstance();

  await ext.init();

  // 🔥 On tente directement de récupérer l’adresse
  try {
    const address = await ext.getAddress();

    if (address) {
      provider = ext;
      await onLoginSuccess(address);
      return;
    }
  } catch (e) {
    console.log("Extension not connected");
  }

} catch (e) {
  console.warn("Extension init error", e);
}
  try {
    // WalletConnect
    const wc = new WalletConnectV2Provider(
      { onClientLogin: () => {} },
      chainId,
      relayUrl,
      projectId
    );

    await wc.init();

    if (wc.session) {
      provider = wc;
      const address = await wc.getAddress();
      onLoginSuccess(address);
      return;
    }
  } catch (err) {
    console.warn("[WC] auto-restore failed:", err);
  }

  // sinon reset clean
  resetUI();
});


function showWalletMain() {
  if (walletActions) walletActions.style.display = "flex";
  walletChoices.style.display = "none";
  connectBtn.style.display = "inline-flex";
  disconnectBtn.style.display = "none";
}

function showWalletChoices() {
  if (walletActions) walletActions.style.display = "none";
  walletChoices.style.display = "flex";
}

function showWalletConnected() {
  if (walletActions) walletActions.style.display = "flex";
  walletChoices.style.display = "none";
  connectBtn.style.display = "none";
  disconnectBtn.style.display = "inline-flex";
}


/* ========= RESET UI ========= */
function resetUI() {
  statusEl.textContent = "Status: Not connected";
  addressEl.textContent = "—";

  // 🔒 cacher les tabs
  const mainTabs = document.getElementById("mainTabs");
  if (mainTabs) mainTabs.style.display = "none";

  // 🔁 reset vers collection
  document
    .querySelectorAll(".main-tab")
    .forEach(t => t.classList.remove("active"));

  const collectionTab = document.querySelector('[data-main-tab="collection"]');
  if (collectionTab) collectionTab.classList.add("active");

  // cacher combat
  const combatContent = document.querySelector('[data-main-content="combat"]');
  if (combatContent) combatContent.style.display = "none";

  // BALANCES
  balancesContainer.innerHTML = "";
  balancesContainer.style.display = "none";

  // NFT LISTS
  odinsList.innerHTML = "";
  otherList.innerHTML = "";

  odinsSection.style.display = "none";
  otherSection.style.display = "none";

  // SEARCH
  const otherNftSearch = document.getElementById("otherNftSearch");
  if (otherNftSearch) otherNftSearch.style.display = "none";

  // TOP HOLDERS
  const topHoldersDeck = document.getElementById("topHoldersDeck");
  if (topHoldersDeck) topHoldersDeck.style.display = "none";

  // COUNTS / ATTRIBUTES
  if (odinsCountEl) odinsCountEl.textContent = "0";
  if (odinsAttributesTable) odinsAttributesTable.innerHTML = "";

  // UI WALLET
  walletChoices.style.display = "none";
  connectBtn.style.display = "inline-flex";
  disconnectBtn.style.display = "none";

  // PREVIEW / LANDING
  //if (odinsPreview) odinsPreview.style.display = "flex";
  /* postConnectActions always visible */

  qrEl.innerHTML = "";

  if (aboutSection) aboutSection.style.display = "block";
  
  window.selectedCombatNft = null;
  window.enemyCombatNft = null;
  enemyLoaded = false;
  nftCooldowns.clear();
}

/* ========= LOGIN SUCCESS ========= */
async function onLoginSuccess(address) {

  try {

    // ================= WALLET =================

    window.currentUserAddress = address;
    window.walletProvider = provider;

    console.log(
      "👛 Connected wallet:",
      address
    );

    statusEl.textContent =
      "Status: Connected";

    addressEl.textContent =
      address;

    // 🧪 Adresse réellement utilisée pour les calculs
    const activeAddress =
      TEST_ERD_ADDRESS || address;

    // ================= LOAD FIREBASE DATA =================

    //console.log(
    //  "🔥 Loading Firebase data..."
    //);

    await Promise.all([

      loadPlaysFromFirebase(
        window.currentUserAddress
      ),

      loadCooldownsFromFirebase()

    ]);

    //console.log(
   //   "✅ Firebase data loaded"
   // );

    // 🔥 IMPORTANT :
    // refresh UI après chargement cooldowns

    updateCombatCounter();

    if (
      typeof updateCombatArenaState ===
      "function"
    ) {

      updateCombatArenaState();
    }

    // ================= STATS =================

    await updateCombatStats();

    // 🔥 ACTIVE / BLOQUE LE BOUTON COMBAT
	const COMBAT_ENABLED = true;

	// ================= UI TABS =================

	const mainTabs =
	  document.getElementById(
		"mainTabs"
	  );

	if (mainTabs) {
	  mainTabs.style.display = "flex";
	}

	const combatTabBtn =
	  document.getElementById(
		"combatTabBtn"
	  );

	if (combatTabBtn) {

	  // 🔥 toujours visible
	  combatTabBtn.style.display =
		"inline-flex";

	  // 🔥 activation / blocage
	  combatTabBtn.disabled =
		!COMBAT_ENABLED;

	  if (!COMBAT_ENABLED) {

		// 🔥 style grisé / lock
		combatTabBtn.classList.add(
		  "disabled"
		);

		combatTabBtn.style.opacity =
		  ".45";

		combatTabBtn.style.pointerEvents =
		  "none";

		combatTabBtn.style.filter =
		  "grayscale(1)";

		combatTabBtn.style.cursor =
		  "not-allowed";

	  } else {

		// 🔥 restore normal state
		combatTabBtn.classList.remove(
		  "disabled"
		);

		combatTabBtn.style.opacity =
		  "1";

		combatTabBtn.style.pointerEvents =
		  "auto";

		combatTabBtn.style.filter =
		  "none";

		combatTabBtn.style.cursor =
		  "pointer";
	  }
	}

	const combatTabContent =
	  document.getElementById(
		"combatTabContent"
	  );

	if (combatTabContent) {

	  combatTabContent.style.display =
		"none";

	  combatTabContent.classList.remove(
		"active"
	  );
	}

	document
	  .querySelectorAll(
		".main-tab-content"
	  )
	  .forEach(c => {

		c.style.display = "none";

		c.classList.remove(
		  "active"
		);
	  });

	document
	  .querySelectorAll(
		".main-tab"
	  )
	  .forEach(t =>
		t.classList.remove(
		  "active"
		)
	  );

	const collectionTab =
	  document.querySelector(
		'.main-tab[data-main-tab="collection"]'
	  );

	const collectionContent =
	  document.querySelector(
		'.main-tab-content[data-main-content="collection"]'
	  );

	if (collectionTab) {
	  collectionTab.classList.add(
		"active"
	  );
	}

	if (collectionContent) {

	  collectionContent.style.display =
		"block";

	  collectionContent.classList.add(
		"active"
	  );
	}

    // ================= LANDING =================

    //if (odinsPreview) {
     // odinsPreview.style.display =
     //   "none";
    //}

    /* postConnectActions always visible */

    showWalletConnected();

    qrEl.innerHTML = "";

    if (aboutSection) {
      aboutSection.style.display =
        "none";
    }

    // ================= SECTIONS =================

    odinsSection.style.display =
      "block";

    otherSection.style.display =
      "block";

    const otherNftSearch =
      document.getElementById(
        "otherNftSearch"
      );

    if (otherNftSearch) {
      otherNftSearch.style.display =
        "block";
    }

    const topHoldersDeck =
      document.getElementById(
        "topHoldersDeck"
      );

    if (topHoldersDeck) {
      topHoldersDeck.style.display =
        "block";
    }

    // ================= BALANCES =================

    initBalancesUI();

    balancesContainer.style.display =
      "flex";

    const [egld, tsk] =
      await Promise.all([

        fetchEGLDBalance(
          activeAddress
        ),

        fetchTokenBalance(
          activeAddress,
          TSK_TOKEN_ID
        )

      ]);

    updateBalance("egld", egld);
    updateBalance("tsk", tsk);

    // ================= NFTS =================

    //console.log(
   //   "🖼️ Loading NFTs..."
   // );

    const nfts =
      await fetchNFTs(
        activeAddress
      );

    const odinsNfts =
      nfts.filter(
        n =>
          n.collection ===
          COLLECTION_ID
      );

    // Assigner _displayTrait sur chaque Odin NFT
    odinsNfts.forEach(nft => {
      nft._displayTrait = getDisplayTrait(nft);
    });

    const otherNfts =
      nfts.filter(
        n =>
          n.collection !==
          COLLECTION_ID
      );

    //console.log("🧩 Odin NFTs:", {
    //  total:
    //    odinsNfts.length
   // });

    renderNfts(
      odinsNfts,
      odinsList,
      `<span style="
        font-family:'Cinzel',serif;
        letter-spacing:.14em;
        text-transform:uppercase;
        color:#ffd700;
        opacity:.6;
        white-space:nowrap;
      "></span>`
    );

    window.playerNfts =
      odinsNfts;

    renderNfts(
      otherNfts,
      otherList,
      `<span style="
        font-family:'Cinzel',serif;
        letter-spacing:.14em;
        text-transform:uppercase;
        color:#ffd700;
        opacity:.6;
        white-space:nowrap;
      "></span>`
    );

    odinsCountEl.textContent =
      odinsNfts.length;

    buildAttributesRecap(
      odinsNfts
    );

    // ================= TOP HOLDERS =================

    //console.log(
    //  "🏆 Loading holders..."
    //);

    const holders =
      await loadTopHolders(
        COLLECTION_ID
      );

    renderTopHolders(
      holders
    );

    // ================= FINAL UI REFRESH =================

    updateCombatCounter();

    if (
      typeof updateCombatArenaState ===
      "function"
    ) {

      updateCombatArenaState();
    }

    // ================= INIT TABS =================

    initMainTabs();

    //console.log(
    //  "✅ Login success fully initialized"
    //);

  } catch (err) {

    console.error(
      "❌ onLoginSuccess error:",
      err
    );
  }
}

/* ========= ACTIONS ========= */
connectBtn.addEventListener("click", () => {
  if (walletActions) walletActions.style.display = "none";
  walletChoices.style.display = "flex";
});

backBtn.addEventListener("click", () => {
  walletChoices.style.display = "none";
  if (walletActions) walletActions.style.display = "flex";
});
  
disconnectBtn.onclick = async () => {
  try {
    await provider?.logout?.();
    await provider?.disconnect?.();
  } catch (e) {
    console.warn("Disconnect error", e);
  }

  provider = null;
  
  resetUI(); // ✅ CRUCIAL
};

/* ================= EXTENSION LOGIN ================= */

let extensionProvider = null;
let extensionInitialized = false;

/* ================= EXTENSION ================= */

connectExtensionBtn.onclick = async () => {
  //console.log("🔌 [Extension] Click");

  try {
    // 🔥 instance unique
    if (!extensionProvider) {
      extensionProvider = ExtensionProvider.getInstance();
    }

    // 🔥 init UNE seule fois
    if (!extensionInitialized) {
      console.log("⏳ [Extension] init...");
      await extensionProvider.init();

      extensionInitialized = true;

      console.log("✅ [Extension] init OK");
    }

    console.log("🔐 [Extension] login...");
    const loginResult = await extensionProvider.login();

	const address =
	  typeof loginResult === "string"
		? loginResult
		: loginResult?.address;

	if (!address) {
	  throw new Error("No wallet address returned");
	}

    console.log("📬 [Extension] address:", address);

    provider = extensionProvider;

    await onLoginSuccess(address);

  } catch (err) {
    console.error("💥 [Extension] error:", err);

    extensionInitialized = false;
    extensionProvider = null;
    provider = null;
  }
};

/* ================= WALLET CONNECT ================= */

connectXPortalBtn.onclick = async () => {
  console.log("📱 [WalletConnect] Click");

  try {

    /* ================= CLEAN PREVIOUS ================= */

    if (provider) {
      try {
        console.log("🧹 Cleaning previous provider...");

        await provider.logout?.();
        await provider.disconnect?.();

      } catch (err) {
        console.warn("⚠️ Provider cleanup failed:", err);
      }

      provider = null;
    }

    /* ================= CREATE PROVIDER ================= */

    const wc = new WalletConnectV2Provider(
      {
        onClientLogin: async () => {
          console.log("✅ [WC] onClientLogin");

          try {
            const address = await wc.getAddress();

            console.log("📬 [WC] address:", address);

            provider = wc;

            await onLoginSuccess(address);

          } catch (e) {
            console.error("💥 [WC] getAddress error:", e);
          }
        },

        onClientLogout: () => {
          console.log("❌ [WC] logout");

          provider = null;

          resetUI();
        }
      },

      chainId,
      relayUrl,
      projectId,

      // 🔥 METADATA
      {
        metadata: {
          name: "ODINVERSE",
          description: "Viking MultiversX dApp",
          url: "https://www.odinverse.app",
          icons: [
            "https://www.odinverse.app/logo-walletconnect.jpg"
          ]
        }
      }
    );

    console.log("🔄 [WC] init...");
    await wc.init();

    /* ================= CONNECT ================= */

    console.log("🔗 [WC] connect...");

    const { uri, approval } = await wc.connect({
      optionalNamespaces: {
        mvx: {
          chains: [`mvx:${chainId}`],

          methods: [
            "mvx_signTransaction",
            "mvx_signTransactions",
            "mvx_signMessage"
          ],

          events: []
        }
      }
    });

    console.log("✅ [WC] URI generated");

	/* ================= MOBILE / DESKTOP ================= */

	const isMobile =
	  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

	if (isMobile) {

	  console.log("📱 Mobile → xPortal");

	  const deepLink =
		`wc:${encodeURIComponent(uri)}`;

	  console.log("🔗 Deep link:", deepLink);

	  // ✅ ouvre xPortal
	  window.open(deepLink, "_self");

	  // 🔥 fallback debug
	  setTimeout(() => {
		console.log("⚠️ If xPortal did not open, deep link failed");
	  }, 2500);

	} else {

	  console.log("🖥️ Desktop → QR");

	  const qrEl = document.getElementById(
		"MyWalletConnectQRContainer"
	  );

	  if (!qrEl) return;

	  qrEl.innerHTML = "";

	  const canvas = document.createElement("canvas");

	  qrEl.appendChild(canvas);

	  await QRCode.toCanvas(canvas, uri, {
		width: 220,
		margin: 1
	  });
	}

    /* ================= WAIT LOGIN ================= */

    console.log("⏳ [WC] waiting approval...");

    await wc.login({ approval });

    console.log("✅ [WC] login success");

  } catch (err) {

    console.error("💥 [WalletConnect] error:", err);

    provider = null;
  }
};


/* ================= WEB WALLET ================= */

connectWalletConnectBtn.onclick = () => {
  window.location.href =
    "https://wallet.multiversx.com/unlock";
};

/* ================= SIGN MESSAGE ================= */

async function signMessage(provider, message) {
  const { SignableMessage } =
    await import("@multiversx/sdk-core");

  const signable = new SignableMessage({
    message: Buffer.from(message)
  });

  return provider.signMessage(signable);
}


/* ========= API ========= */
  async function fetchEGLDBalance(address) {
    const res = await fetch(`https://api.multiversx.com/accounts/${address}`);
    const data = await res.json();
    return (Number(data.balance) / 1e18).toFixed(4);
  }

async function fetchTokenBalance(address, tokenId) {
  try {
    const res = await fetch(
      `https://api.multiversx.com/accounts/${address}/tokens/${tokenId}`
    );

    if (res.status === 404) {
      return 0;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    return Number(data.balance || 0) / 10 ** data.decimals;

  } catch (err) {
    console.error("❌ Token balance error:", err);
    return 0;
  }
}

function initBalancesUI() {
  const container = document.querySelector(".wallet-balances");
  if (!container || container.children.length) return;

  container.innerHTML = `
    <div class="balance-line" data-token="egld">
      <span class="token-icon egld">
       <img src="/images/egld.gif" alt="EGLD" />
      </span>
      
      <span class="token-value">0.0000</span>
    </div>

    <div class="balance-line" data-token="tsk">
      <span class="token-icon tsk">
        <img src="/images/tsk.svg" alt="TSK" />
    </span>

      <span class="token-value">0.0000</span>
    </div>
  `;
}

function updateBalance(token, newValue) {
  const line = document.querySelector(
    `.balance-line[data-token="${token}"]`
  );
  if (!line) return;

  const valueEl = line.querySelector(".token-value");

  if (valueEl.textContent === newValue) return;

  valueEl.textContent = newValue;

  // 💓 pulse visuel
  line.classList.remove("updated");
  void line.offsetWidth; // force reflow
  line.classList.add("updated");
}


/* ========= Recup NFT page centrale ========= */
async function fetchNFTs(address) {
  const pageSize = 500; // 500 par batch
  const allNfts = [];

  // Récupérer le nombre total de NFTs pour calculer les pages
  let total = 0;
  try {
    const countRes = await fetch(`https://api.multiversx.com/accounts/${address}/nfts/count`);
    if (countRes.ok) {
      const countData = await countRes.json();
      total = Number(countData) || 0;
    }
  } catch (err) {
    console.warn("Impossible de récupérer le total de NFTs, on va continuer page par page", err);
  }

  const pageCount = Math.ceil(total / pageSize) || 1;

  // 2️⃣ Générer toutes les requêtes
  const requests = Array.from({ length: pageCount }, (_, i) =>
    fetch(`https://api.multiversx.com/accounts/${address}/nfts?from=${i * pageSize}&size=${pageSize}&withMetadata=true`)
      .then(res => res.ok ? res.json() : [])
      .then(batch => batch.map(nft => ({
        name:       nft.name || nft.identifier,
        identifier: nft.identifier || null,
        // nonce : l'API retourne déjà le décimal (377)
        // Fallback : dériver depuis identifier "ODINSDECK-4e300a-0179" → parseInt("0179",16) = 377
        // Nonce toujours depuis identifier hex (source fiable)
        // ODINSDECK-4e300a-0178 → parseInt("0178",16) = 376
        // nft.nonce est déjà en décimal (94) depuis l'API MultiversX
        nonce: nft.nonce ?? null,
        collection: nft.collection,
        image: nft.metadata?.fileUri || nft.media?.[0]?.url || null,
        metadata: nft.metadata || null,
        attributes: nft.attributes || null
      })))
      .catch(err => {
        console.error(`Erreur chargement batch ${i}:`, err);
        return [];
      })
  );

  // 3️⃣ Exécuter toutes les requêtes en parallèle
  const batches = await Promise.all(requests);

  // 4️⃣ Fusionner tous les résultats
  batches.forEach(batch => allNfts.push(...batch));

  return allNfts;
}


// fonction asynchrone pour récupérer le count
async function fetchNftCount() {
  try {
    const res = await fetch(
      "https://api.multiversx.com/collections/ODINSDECK-4e300a/nfts/count"
    );
    
    if (!res.ok) {
      throw new Error("Erreur API: " + res.status);
    }

    const count = await res.json(); // attend un nombre
    return count;
  } catch (err) {
    console.error(err);
    return null;
  }
}

// HOLDERS COUNT
fetchNftCount().then(count => {
  if (count !== null) {
    document.querySelector(".stat-value.nfts-count").textContent = count;
  }
});

// fonction asynchrone pour récupérer le nombre de holders uniques
async function fetchHoldersCount() {
  try {
    const collection = "ODINSDECK-4e300a";
    const pageSize = 100;

    // 1) On récupère d'abord le total NFT (rapide)
    const totalRes = await fetch(
      `https://api.multiversx.com/collections/${collection}/nfts/count`
    );
    if (!totalRes.ok) throw new Error("Erreur API total: " + totalRes.status);
    const total = await totalRes.json();

    // 2) On fetch toutes les pages en parallèle
    const pages = Math.ceil(Number(total || 0) / pageSize);
    const requests = Array.from({ length: pages }, (_, i) => {
      const from = i * pageSize;
      return fetch(
        `https://api.multiversx.com/collections/${collection}/nfts?from=${from}&size=${pageSize}&withOwner=true`
      )
        .then(r => {
          if (!r.ok) throw new Error("Erreur API: " + r.status);
          return r.json();
        })
        .catch(err => {
          console.warn("Holders page fetch error:", err);
          return [];
        });
    });

    const results = await Promise.all(requests);
    const ownersSet = new Set();
    results.flat().forEach(nft => {
      if (nft?.owner) ownersSet.add(nft.owner);
    });

    return ownersSet.size;

  } catch (err) {
    console.error("Holders fetch error:", err);
    return null;
  }
}

// utilisation
fetchHoldersCount().then(count => {
  if (count !== null) {
    const adjustedCount = Math.max(count - 1, 0); //retire le creator
    document.querySelector(".stat-value.holders-count").textContent =
      adjustedCount.toLocaleString();
  } else {
    document.querySelector(".stat-value.holders-count").textContent = "—";
  }
});

// barre recherche nft
otherNftSearch?.addEventListener("input", () => {
  const query = otherNftSearch.value.toLowerCase().trim();
  const cards = otherNftsList.querySelectorAll(".nft-card");

  cards.forEach(card => {
    const name = card.querySelector(".nft-name")?.textContent.toLowerCase() || "";
    const nonce = card.querySelector(".nft-nonce")?.textContent.toLowerCase() || "";

    const match = name.includes(query) || nonce.includes(query);
    card.style.display = match ? "flex" : "none";
  });
});

function renderOtherNftsGrouped(nfts, container, emptyText) {
  container.innerHTML = "";

  if (!nfts.length) {
    container.innerHTML = `<div style="opacity:.6">${emptyText}</div>`;
    return;
  }

  // groupement par collection
  const groups = {};

  nfts.forEach(nft => {
    const collection = nft.collection || "Unknown collection";
    if (!groups[collection]) groups[collection] = [];
    groups[collection].push(nft);
  });

  // rendu
  Object.entries(groups).forEach(([collection, items]) => {
    const group = document.createElement("div");
    group.className = "nft-collection-group";

    const title = document.createElement("div");
    title.className = "nft-collection-title";
    title.textContent = collection;

    const grid = document.createElement("div");
    grid.className = "nft-collection-grid";

    items.forEach(nft => {
      const card = createNftCard(nft);
      grid.appendChild(card);
    });

    group.append(title, grid);
    container.appendChild(group);
  });
}

// TOP HOLDERS
async function loadTopHolders(collection, limit = 7) {
  const holdersMap = {};
  const PAGE_SIZE = 100;
  let from = 0;

  while (true) {
    const res = await fetch(
      `https://api.multiversx.com/collections/${collection}/nfts` +
      `?withOwner=true&size=${PAGE_SIZE}&from=${from}`
    );

    if (!res.ok) {
      console.error("Top holders fetch failed");
      break;
    }

    const nfts = await res.json();
    if (!nfts.length) break;

    for (const nft of nfts) {
      if (!nft.owner) continue;
      holdersMap[nft.owner] = (holdersMap[nft.owner] || 0) + 1;
    }

    from += PAGE_SIZE;
  }

  return Object.entries(holdersMap)
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function renderTopHolders(holders) {
  const list = document.getElementById("topHoldersList");
  list.innerHTML = "";

  if (!holders.length) {
    const p = document.createElement("p");
    p.style.opacity = ".6";
    p.textContent = "No holders found";
    list.appendChild(p);
    return;
  }

  holders.forEach((h, i) => {
    const row = document.createElement("div");
    row.className = "top-holder-row";

    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${i + 1}`;

    const addr = document.createElement("span");
    addr.className = "address";
    addr.textContent = `${h.address.slice(0, 8)}…${h.address.slice(-6)}`;

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(h.count);

    row.append(rank, addr, count);

    list.appendChild(row);
  });
}

/* ========= MAIN TABS ========= */
function initMainTabs() {
  const tabs = document.querySelectorAll(".main-tab");
  const contents = document.querySelectorAll(".main-tab-content");

  tabs.forEach(tab => {
    tab.onclick = async () => {
      const target = tab.dataset.mainTab;

      tabs.forEach(t => t.classList.remove("active"));
      contents.forEach(c => {
        c.classList.remove("active");
        c.style.display = "none";
      });

      tab.classList.add("active");

      const content = document.querySelector(
        `.main-tab-content[data-main-content="${target}"]`
      );

      if (content) {
        content.style.display = "block";
        content.classList.add("active");
      }

      if (target === "combat") {
        //console.log("⚔️ Combat tab opened");
        await updateCombatStats();
        await loadCombatOdins();

      }
    };
  });
}

/* ================= CONFIG ================= */
//const COOLDOWN_MS = 7 * 60 * 1000; // 6 heures par exemple
const COOLDOWN_MS = 17 * 60 * 60 * 1000;
//const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
let nftCooldowns = new Map();


/* ================= LOAD COMBAT ODINS ================= */
async function loadCombatOdins() {

  const list = document.getElementById("combatNftList");
  if (!list) return;

  const activeAddress =
    TEST_ERD_ADDRESS || window.currentUserAddress;

  if (!activeAddress) {
    list.innerHTML = `
      <p style="
        text-align:center;
        font-family:'Cinzel',serif;
        letter-spacing:.18em;
        text-transform:uppercase;
        color:#ffffff;
        opacity:.75;
      ">
        Wallet not connected
      </p>
    `;
    return;
  }

  /* ================= LOADING ================= */
  list.innerHTML = `
    <p style="
      opacity:.7;
      text-align:center;
      font-family:'Cinzel',serif;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#ffffff;
    ">
      Loading Odins…
    </p>
  `;
  
  try {

    const nfts = await fetchNFTs(activeAddress);

    const odins = nfts.filter(
      nft => nft.collection === COLLECTION_ODINS
    );

    list.innerHTML = "";

    /* ================= EMPTY ================= */
    if (odins.length === 0) {

      list.classList.add("empty");

      list.innerHTML = `
        <div style="
          width:180px;
          height:240px;

          border:2px dashed rgba(255,255,255,0.18);
          border-radius:18px;

          background:
            linear-gradient(
              145deg,
              rgba(255,255,255,0.04),
              rgba(0,0,0,0.28)
            );

          backdrop-filter: blur(10px);

          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;

          gap:12px;

          color:#ffffff;

          font-family:'Cinzel', serif;
          text-transform:uppercase;
          letter-spacing:0.12em;

          opacity:0.75;

          margin:auto;
        ">
          <div style="
            font-size:34px;
            opacity:.8;
          ">
            🜂
          </div>

          <div style="
            font-size:0.78rem;
          ">
            No NFT
          </div>
        </div>
      `;

      updateCombatCounter();
      return;
    }

    /* ================= GRID ACTIVE ================= */
    list.classList.remove("empty");

    const displayedOdins = odins.slice(0, 377);

    /* ================= CATEGORY COUNTS ================= */
    const categoryCounts = {};

    displayedOdins.forEach(nft => {

      const cat =
        MANUAL_NFT_TRAITS[nft.nonce] ||
        getFinalTrait(nft) ||
        "unknown";

      categoryCounts[cat] =
        (categoryCounts[cat] || 0) + 1;
    });

    /* ================= CATEGORY COLORS ================= */
    const categoryColors = {
      strength: "#4da3ff",
      resilience: "#53b6ff",
      darkness: "#5cc8ff",
      command: "#63d8ff",
      nature: "#5fe2c3",
      agility: "#66f0a9",
      technology: "#7dffb2",
      magic: "#96f7c8",
      monster: "#b29cff",
      light: "#c08cff",
      chaos: "#cb7cff",
      knowledge: "#d56dff",
      awareness: "#df5cff",
      stealth: "#ea4cff",
      craftsmanship: "#b620ff"
    };

    /* ================= LOOP NFTs ================= */
    displayedOdins.forEach(nft => {

      const item = document.createElement("div");

      item.className =
        "nft-card combat-nft-item";

      const nftId = getNftId(nft);

      item.dataset.id = nftId;

      /* ================= MEDIA ================= */

      const url =
        nft.image ||
        nft.media?.[0]?.url ||
        "";

      let mediaEl;

      if (url && /\.(mp4|webm|ogg)$/i.test(url)) {

        mediaEl = document.createElement("video");

        mediaEl.src = url;
        mediaEl.loop = true;
        mediaEl.muted = true;
        mediaEl.autoplay = true;
        mediaEl.playsInline = true;

      } else {

        mediaEl = document.createElement("img");

        mediaEl.src = url;
      }

      mediaEl.style.cssText = `
        width:100%;
        height:170px;

        object-fit:cover;

        border-radius:14px;

        background:#000;

        box-shadow:
          0 10px 24px rgba(0,0,0,.45);
      `;

      item.appendChild(mediaEl);

      /* ================= TEXT BLOCK ================= */

      const nftText = document.createElement("div");

      nftText.className = "nft-text";

      nftText.style.cssText = `
        width:100%;

        display:flex;
        flex-direction:column;
        align-items:center;

        gap:6px;

        margin-top:10px;
      `;

	/* ================= CATEGORY ================= */

	const category = document.createElement("div");

	category.className = "nft-category";

	const catName =
	  MANUAL_NFT_TRAITS[nft.nonce] ||
	  getFinalTrait(nft) ||
	  "unknown";

	const categoryColor =
	  categoryColors[catName] || "#ffffff";

	category.textContent = catName;

	category.style.cssText = `
	  display:flex;

	  align-items:center;
	  justify-content:center;

	  width:fit-content;

	  margin:10px auto 0;

	  padding:4px 11px;

	  border-radius:999px;

	  background:
		linear-gradient(
		  135deg,
		  rgba(255,255,255,0.08),
		  rgba(255,255,255,0.03)
		);

	  border:1px solid ${categoryColor}55;

	  color:${categoryColor};

	  font-family:'Cinzel', serif;

	  font-size:0.68rem;
	  font-weight:800;

	  text-transform:uppercase;
	  letter-spacing:.08em;

	  text-align:center;

	  box-shadow:
		0 0 14px ${categoryColor}22;
	`;

	nftText.appendChild(category);

      /* ================= BOOST ===============

      const count =
        categoryCounts[catName] || 0;

      nft.boost = count > 1 ? count : 1;

      if (count >= 7) {

        const boostBadge =
          document.createElement("span");

        boostBadge.textContent = `⚡x${count}`;

        boostBadge.style.cssText = `
          margin-left:6px;

          color:#7dffb2;

          font-weight:900;
          font-size:0.65rem;

          text-shadow:
            0 0 8px rgba(125,255,178,.45);
        `;

        category.appendChild(boostBadge);
      }== */

      /* ================= SEER ===============

      if (SEER_IDS.has(Number(nft.nonce))) {

        const seerBadge =
          document.createElement("span");

        seerBadge.textContent = "⭐ SEER";

        seerBadge.style.cssText = `
          display:inline-flex;
          align-items:center;
          justify-content:center;

          padding:5px 10px;

          border-radius:999px;

          background:
            linear-gradient(
              135deg,
              rgba(255,120,40,.95),
              rgba(255,60,0,.95)
            );

          color:#fff;

          font-size:0.58rem;
          font-weight:900;

          letter-spacing:.08em;

          box-shadow:
            0 0 18px rgba(255,90,0,.35);
        `;

        nftText.appendChild(seerBadge);

        nft.isSeer = true;
      }== */

      item.appendChild(nftText);

	/* ================= COOLDOWN ================= */

	const lastUsed =
	  nftCooldowns.get(nftId) || 0;

	const now = Date.now();

	if (lastUsed && now - lastUsed < COOLDOWN_MS) {

	  item.classList.add("used");

	  const label = document.createElement("div");

	  label.className = "already-used-label";

	  label.style.cssText = `
		  position:absolute;
		  top:10px;
		  left:50%;
		  transform:translateX(-50%);

		  padding:4px 9px;

		  min-width: 110px;
		  max-width: 160px;

		  display:flex;
		  align-items:center;
		  justify-content:center;
		  gap:6px;

		  border-radius:999px;

		  background:rgba(20,0,0,.78);

		  /* 🔥 contour rouge */
		  border:1px solid rgba(255,60,60,.45);

		  color:#ff4d4d;

		  font-size:.62rem;
		  font-weight:800;

		  font-family:'Cinzel', serif;

		  letter-spacing:.04em;
		  text-transform:uppercase;

		  white-space:nowrap;

		  backdrop-filter: blur(5px);

		  box-shadow:0 0 10px rgba(255,0,0,.12);
		`;

	  item.appendChild(label);

	  const updateCooldown = () => {

		const remaining =
		  COOLDOWN_MS - (Date.now() - lastUsed);

		if (remaining <= 0) {

		  label.remove();
		  item.classList.remove("used");

		  item.onclick = () =>
			selectCombatNft(nft, item);

		  return;
		}

		const h = Math.floor(remaining / 3600000);
		const m = Math.floor((remaining % 3600000) / 60000);
		const s = Math.floor((remaining % 60000) / 1000);

		/* 🔥 FORMAT STABLE (ANTI SAUT UI) */
		const text =
		  `${h.toString().padStart(2, "0")}h ` +
		  `${m.toString().padStart(2, "0")}m ` +
		  `${s.toString().padStart(2, "0")}s`;

		label.innerHTML = `⏳ <span style="color:#ff3b3b; font-weight:900;">${text}</span>`;

		requestAnimationFrame(updateCooldown);
	  };

	  updateCooldown();

	} else {

	  item.onclick = () =>
		selectCombatNft(nft, item);
	}

		  list.appendChild(item);
		});

    /* ================= COUNTER ================= */
    
    updateCombatCounter();

  } catch (err) {

    console.error(
      "❌ Combat load error:",
      err
    );

    list.innerHTML = `
      <p style="
        text-align:center;
        font-family:'Cinzel',serif;
        letter-spacing:.18em;
        text-transform:uppercase;
        color:#ffffff;
        opacity:.85;
      ">
        Error loading NFTs
      </p>
    `;
  }
}


// 🔹 Mapping manuel pour valeurs spéciales
const VALUE_MAP = {
  offensive: "darkness"
};
// Récupère la catégorie finale d’un NFT
function getFinalTrait(nft) {
  // Si le nonce est forcé dans MANUAL_NFT_TRAITS → priorité
  if (MANUAL_NFT_TRAITS[nft.nonce]) {
    return MANUAL_NFT_TRAITS[nft.nonce];
  }

  // Sinon récupérer la catégorie normale
  const attrValue = (getAttributes(nft) || [])
    .find(a => a.trait_type === "Type")?.value;

  if (!attrValue) return "unknown";

  // Map les valeurs spéciales (ex : offensive → darkness)
  return VALUE_MAP[attrValue.toLowerCase()] || normalizeTrait(attrValue);
}

/* ========= LOAD ENEMY CORRECTED ========= */
async function loadRandomEnemy() {
  const res = await fetch(
    `https://api.multiversx.com/nfts?collection=${COLLECTION_ODINS}&size=100`
  );
  const data = await res.json();

  // Filtrer le NFT du joueur pour ne pas tomber dessus
  const available = window.selectedCombatNft
    ? data.filter(n => getNftId(n) !== getNftId(window.selectedCombatNft))
    : data;

  window.enemyCombatNft = available[Math.floor(Math.random() * available.length)];

  document.getElementById("combatArena").style.display = "block";
  document.getElementById("startCombatBtn").disabled = false;

  renderCombatCard("playerCard", window.selectedCombatNft);
  renderCombatCard("enemyCard", window.enemyCombatNft);
}

/* ================= RENDU DES NFT ================= */
function renderCombatCard(id, nft) {
  const el = document.getElementById(id);
  if (!el) return;

  /* ================= CATEGORY COLORS ================= */
  const categoryColors = {
    strength: "#4da3ff",
    resilience: "#53b6ff",
    darkness: "#5cc8ff",
    command: "#63d8ff",
    nature: "#5fe2c3",
    agility: "#66f0a9",
    technology: "#7dffb2",
    magic: "#96f7c8",
    monster: "#b29cff",
    light: "#c08cff",
    chaos: "#cb7cff",
    knowledge: "#d56dff",
    awareness: "#df5cff",
    stealth: "#ea4cff",
    craftsmanship: "#b620ff",
    unknown: "#888888"
  };

  /* ================= EMPTY NFT ================= */
  if (!nft) {
    el.innerHTML = "";

    const p = document.createElement("p");

    p.style.cssText = `
      text-align:center;
      font-family:'Cinzel', serif;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#ffd700;
      opacity:.85;
    `;

    p.textContent = "No NFT selected";

    el.appendChild(p);
    return;
  }

  /* ================= IMAGE URL ================= */
  const url = nft.image || nft.media?.[0]?.url;

  if (!url) {
    el.innerHTML = "";

    const p = document.createElement("p");

    p.style.cssText = `
      text-align:center;
      font-family:'Cinzel', serif;
      letter-spacing:.18em;
      text-transform:uppercase;
      color:#ffd700;
      opacity:.85;
    `;

    p.textContent = "Image not available";

    el.appendChild(p);
    return;
  }

  /* ================= CATEGORY ================= */
  const category = (getFinalTrait(nft) || "unknown").toLowerCase();

  const categoryColor =
    categoryColors[category] || categoryColors.unknown;

  /* ================= CLEAN ================= */
  el.innerHTML = "";

  /* ================= WRAPPER ================= */
  const wrap = document.createElement("div");

  wrap.style.cssText = `
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:8px;
  `;

  /* ================= MEDIA ================= */
  const isVideo = /\.(mp4|webm|ogg)$/i.test(url);

  const media = document.createElement(
    isVideo ? "video" : "img"
  );

  media.src = url;

  if (isVideo) {
    media.loop = true;
    media.muted = true;
    media.autoplay = true;
    media.playsInline = true;
  }

  media.width = 120;
  media.height = 160;

  media.style.cssText = `
    width:180px;
    height:240px;

    object-fit:cover;

    border-radius:16px;

    border:1px solid ${categoryColor};

    background:#111;

    box-shadow:
      0 0 12px ${categoryColor}66,
      0 0 24px ${categoryColor}33;

    transition:
      transform .22s ease,
      box-shadow .22s ease,
      border-color .22s ease;
  `;

  /* ================= HOVER ================= */
  media.addEventListener("mouseenter", () => {
    media.style.transform = "scale(1.03)";

    media.style.boxShadow = `
      0 0 18px ${categoryColor},
      0 0 36px ${categoryColor}88,
      0 0 54px ${categoryColor}44
    `;
  });

  media.addEventListener("mouseleave", () => {
    media.style.transform = "scale(1)";

    media.style.boxShadow = `
      0 0 12px ${categoryColor}66,
      0 0 24px ${categoryColor}33
    `;
  });

  wrap.appendChild(media);

  /* ================= CATEGORY BADGE ================= */
  const badge = document.createElement("div");

  badge.textContent = category.toUpperCase();

  badge.style.cssText = `
    display:flex;

    align-items:center;
    justify-content:center;

    width:fit-content;

    margin:6px auto 0;

    padding:4px 11px;

    border-radius:999px;

    background:
      linear-gradient(
        135deg,
        rgba(255,255,255,0.08),
        rgba(255,255,255,0.03)
      );

    border:1px solid ${categoryColor}55;

    color:${categoryColor};

    font-family:'Cinzel', serif;

    font-size:0.68rem;
    font-weight:800;

    text-transform:uppercase;
    letter-spacing:.08em;

    text-align:center;

    box-shadow:
      0 0 14px ${categoryColor}22;

    backdrop-filter:blur(4px);
  `;

  wrap.appendChild(badge);

  /* ================= APPEND ================= */
  el.appendChild(wrap);
}


/* ================= START COMBAT ================= */
const COLLECTION_CATEGORY_COUNTS = {
  strength: 84,
  resilience: 44,
  darkness: 41,
  command: 38,
  nature: 33,
  agility: 25,
  technology: 23,
  magic: 20,
  monster: 15,
  light: 14,
  chaos: 11,
  knowledge: 10,
  awareness: 7,
  stealth: 6,
  craftsmanship: 6
};

// =====================================================
// 📊 CATEGORY COEFS (BALANCED + DEBUG)
// =====================================================

const maxCategoryCount =
  Math.max(...Object.values(COLLECTION_CATEGORY_COUNTS));

const CATEGORY_COEFS = {};

//console.log("📦 CATEGORY RAW COUNTS :", COLLECTION_CATEGORY_COUNTS);
//console.log("📈 MAX CATEGORY COUNT :", maxCategoryCount);

for (const cat in COLLECTION_CATEGORY_COUNTS) {

  const count =
    COLLECTION_CATEGORY_COUNTS[cat];

  // ⚠️ protection division par zéro
  const rawCoef =
    count > 0
      ? maxCategoryCount / count
      : 1;

  // ⚖️ clamp pour éviter des valeurs absurdes
  const coef =
    Math.min(
      Math.max(rawCoef, 0.6), // min = 0.6 (évite catégories trop faibles)
      3.5                   // max = 3.5 (évite domination excessive)
    );

  CATEGORY_COEFS[cat] = coef;

  //console.log(`🧩 CATEGORY COEF [${cat}]`, {
  //  count,
  //  rawCoef: rawCoef.toFixed(4),
  //  finalCoef: coef.toFixed(4)
  //});
}

//console.log("🏁 FINAL CATEGORY COEFS :", CATEGORY_COEFS);

/* ================= PLAYS CONFIG ================= */
const MAX_PLAYS = 7;

//  compteur global en mémoire (initialisé depuis Firebase)
let totalNftsPlayed = 0;

function updateCombatCounter() {
  const el = document.getElementById("combatCounter");
  const msgEl = document.getElementById("combatMessage");
  if (!el || !msgEl) return 0;

  const now = Date.now();

  let activeCooldowns = 0;

  nftCooldowns.forEach((lastUsed, id) => {
    // nettoyage automatique des cooldowns expirés
    if (now - lastUsed < COOLDOWN_MS) {
      activeCooldowns++;
    } else {
      nftCooldowns.delete(id); // 🧹 clean auto
    }
  });

  el.textContent = `⚔️ ${activeCooldowns} / ${MAX_PLAYS} battles`;

  if (activeCooldowns >= MAX_PLAYS) {
    el.classList.add("limit");

    msgEl.className = "combat-msg limit";
    msgEl.textContent =
      `❌ Limit reached: ${MAX_PLAYS} battles are active. Wait for cooldown!`;

  } else {
    el.classList.remove("limit");

    // reset message si plus de limite
    if (msgEl.classList.contains("limit")) {
      msgEl.className = "combat-msg";
      msgEl.textContent = "";
    }
  }
	
  return activeCooldowns;
  
}


/* ================= FIREBASE PLAYS ================= */
async function loadPlaysFromFirebase(address) {
  if (!address) return;

  const ref = doc(db, "combatPlays", address);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data();
    totalNftsPlayed = data.plays || 0;
  } else {
    totalNftsPlayed = 0;
  }

  // 🔹 Initialise le compteur local, mais le compteur réel se met à jour dynamiquement via nftCooldowns
  updateCombatCounter();
}

async function savePlaysToFirebase(address) {
  if (!address) return;

	await setDoc(
	  doc(db, "combatPlays", address),
	  {
		plays: totalNftsPlayed,
		lastUpdate: Date.now(),
		lastUpdateReadable: new Date().toLocaleString("fr-FR")
	  },
	  { merge: true }
	);
}

/* ================= RAFRAÎCHISSEMENT AUTOMATIQUE ================= */
// Permet de mettre à jour le compteur dès qu’un cooldown se termine
setInterval(() => {
  updateCombatCounter();
}, 1000);
/* ================= STATE ================= */
let enemyLoaded = false;
/* ================= SELECT NFT ================= */
function selectCombatNft(nft, el) {
  const nftId = getNftId(nft);
  const lastUsed = nftCooldowns.get(nftId) || 0;
  const now = Date.now();
  

  //  déjà sélectionné
  if (window.selectedCombatNft && window.selectedCombatNft.identifier === nft.identifier) {
    return;
  }

  //  reset visuel
  document.querySelectorAll(".combat-nft-item")
    .forEach(e => e.classList.remove("selected"));

  el.classList.add("selected");
  window.selectedCombatNft = nft;

  enableCombatArena();

  //  charger enemy UNE FOIS
  if (!enemyLoaded) {
    loadRandomEnemy();
    enemyLoaded = true;
  }

  // 🔹 nettoyer état "used" si terminé
  if (lastUsed && now - lastUsed >= COOLDOWN_MS) {
    el.classList.remove("used");

    const label = el.querySelector(".already-used-label");
    if (label) label.remove();
  }
}

document.getElementById("startCombatBtn").onclick = async () => {

  const arena = document.getElementById("combatArena");
  const startBtn = document.getElementById("startCombatBtn");
  const msgEl = document.getElementById("combatMessage");

  if (!window.selectedCombatNft || !window.enemyCombatNft) return;

  const nftId = getNftId(window.selectedCombatNft);
  const lastUsed = nftCooldowns.get(nftId) || 0;
  const now = Date.now();

  msgEl.className = "combat-msg";

  // 🔹 Vérifie cooldown NFT
  if (lastUsed && now - lastUsed < COOLDOWN_MS) {
    const remaining = COOLDOWN_MS - (now - lastUsed);
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    msgEl.className = "combat-msg cooldown";
    msgEl.textContent = `⏳ Cooldown (${h}h ${m}m ${s}s)`;
    return;
  }

  // 🔹 Vérifie limite active
  let activeCooldowns = 0;
  nftCooldowns.forEach(ts => {
    if (Date.now() - ts < COOLDOWN_MS) activeCooldowns++;
  });

  if (activeCooldowns >= MAX_PLAYS) {
    msgEl.className = "combat-msg limit";
    return;
  }

  // ================= START COMBAT =================
  arena.classList.add("disabled");
  startBtn.disabled = true;

  try {

    // 🚨 FIX CRITIQUE : await obligatoire
    const result = await weightedWin(
      window.selectedCombatNft,
      window.enemyCombatNft
    );

    // reset UI cards
    document.getElementById("playerCard").innerHTML = "";
    document.getElementById("enemyCard").innerHTML = "";

    // UI + Firebase en parallèle (OK)
    await Promise.all([
      recordCombatResult(result),
      showCombatOverlay(result)
    ]);

    const nowTs = Date.now();

    await saveCooldownToFirebase(
      window.currentUserAddress,
      window.selectedCombatNft
    );

    // 🔹 Cooldown local
    nftCooldowns.set(nftId, nowTs);

    // 🔹 compteur global
    totalNftsPlayed = Math.min(
      totalNftsPlayed + 1,
      MAX_PLAYS
    );

    await savePlaysToFirebase(
      window.currentUserAddress
    );

    updateCombatCounter();

  } catch (err) {
    console.error("❌ Combat error:", err);
  }

  // reset selection
  window.selectedCombatNft = null;
  window.enemyCombatNft = null;
  enemyLoaded = false;

  setTimeout(() => {

    loadCombatOdins();
    arena.classList.remove("disabled");

    let activeCooldownsNow = 0;

    nftCooldowns.forEach(ts => {
      if (Date.now() - ts < COOLDOWN_MS) activeCooldownsNow++;
    });

    startBtn.disabled = activeCooldownsNow >= MAX_PLAYS;

    if (activeCooldownsNow >= MAX_PLAYS) {
      msgEl.className = "combat-msg limit";
      msgEl.textContent = `❌ Limit rreached: ${MAX_PLAYS} battles are active. Wait for cooldown!`;
    } else {
      msgEl.textContent = "";
    }

  }, 2000);
};

/* ================= UTIL NFT CATEGORY ================= */
function getNftCategory(nft) {
  const TRAIT_KEY = "Type";
  const attr = (getAttributes(nft) || []).find(
    a => a.trait_type === TRAIT_KEY
  );
  return attr ? normalizeTrait(attr.value) : "unknown";
}

// Récupère le nombre de NFTs par catégorie
function getPlayerCategoryCounts(nfts = []) {
  const counts = {};
  nfts.forEach(nft => {
    const cat = getNftCategory(nft);
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return counts;
}

/* =====================================================
   ⚔️ RPG COMBAT SYSTEM — HP / ROUNDS / SPECIAL MOVES
   ===================================================== */

/* --- Attributs de base par catégorie --- */
const CATEGORY_STATS = {
  strength:      { hp: 120, atk: 22, def: 10, spd: 8,  crit: 0.12 },
  resilience:    { hp: 140, atk: 14, def: 18, spd: 7,  crit: 0.08 },
  darkness:      { hp: 100, atk: 20, def: 8,  spd: 14, crit: 0.18 },
  command:       { hp: 110, atk: 16, def: 14, spd: 10, crit: 0.14 },
  nature:        { hp: 115, atk: 15, def: 12, spd: 13, crit: 0.10 },
  agility:       { hp: 95,  atk: 18, def: 7,  spd: 20, crit: 0.20 },
  technology:    { hp: 105, atk: 17, def: 13, spd: 12, crit: 0.15 },
  magic:         { hp: 90,  atk: 24, def: 6,  spd: 11, crit: 0.22 },
  monster:       { hp: 130, atk: 25, def: 9,  spd: 6,  crit: 0.10 },
  light:         { hp: 100, atk: 16, def: 15, spd: 15, crit: 0.16 },
  chaos:         { hp: 95,  atk: 26, def: 5,  spd: 18, crit: 0.25 },
  knowledge:     { hp: 105, atk: 19, def: 11, spd: 10, crit: 0.18 },
  awareness:     { hp: 100, atk: 17, def: 13, spd: 17, crit: 0.20 },
  stealth:       { hp: 90,  atk: 21, def: 8,  spd: 22, crit: 0.28 },
  craftsmanship: { hp: 120, atk: 18, def: 16, spd: 9,  crit: 0.12 },
  unknown:       { hp: 100, atk: 15, def: 10, spd: 10, crit: 0.10 }
};

/* --- Coups spéciaux par catégorie --- */
const SPECIAL_MOVES_CONFIG = {
  strength:      { name: "Berserker Rage",    dmgMult: 2.2, chance: 0.20 },
  resilience:    { name: "Iron Shield",       dmgMult: 0.5, healPct: 0.15, chance: 0.22 },
  darkness:      { name: "Shadow Strike",     dmgMult: 1.8, defPierce: true, chance: 0.22 },
  command:       { name: "Battle Cry",        dmgMult: 1.5, atkBuff: 0.3, chance: 0.20 },
  nature:        { name: "Thorn Lash",        dmgMult: 1.6, retaliate: true, chance: 0.18 },
  agility:       { name: "Phantom Dodge",     dmgMult: 1.4, dodgeNext: true, chance: 0.28 },
  technology:    { name: "Overcharge Blast",  dmgMult: 2.0, chance: 0.18 },
  magic:         { name: "Arcane Surge",      dmgMult: 2.5, chance: 0.22 },
  monster:       { name: "Primal Crush",      dmgMult: 2.3, stunChance: 0.3, chance: 0.18 },
  light:         { name: "Holy Smite",        dmgMult: 1.9, healPct: 0.10, chance: 0.20 },
  chaos:         { name: "Entropy Blast",     dmgMult: 2.8, chance: 0.20 },
  knowledge:     { name: "Mind Shatter",      dmgMult: 1.7, defPierce: true, chance: 0.22 },
  awareness:     { name: "Prescient Strike",  dmgMult: 1.6, dodgeNext: true, chance: 0.24 },
  stealth:       { name: "Assassinate",       dmgMult: 3.0, chance: 0.16 },
  craftsmanship: { name: "Runic Forge",       dmgMult: 1.8, atkBuff: 0.2, chance: 0.20 },
  unknown:       { name: "Wild Strike",       dmgMult: 1.5, chance: 0.15 }
};

/* --- Table d'avantages type (pierre-papier-ciseaux étendu) --- */
const TYPE_ADVANTAGE = {
  strength:      { weak: "magic",    strong: "resilience" },
  resilience:    { weak: "chaos",    strong: "monster" },
  darkness:      { weak: "light",    strong: "awareness" },
  command:       { weak: "stealth",  strong: "agility" },
  nature:        { weak: "darkness", strong: "technology" },
  agility:       { weak: "monster",  strong: "command" },
  technology:    { weak: "nature",   strong: "craftsmanship" },
  magic:         { weak: "strength", strong: "darkness" },
  monster:       { weak: "light",    strong: "strength" },
  light:         { weak: "stealth",  strong: "chaos" },
  chaos:         { weak: "knowledge",strong: "resilience" },
  knowledge:     { weak: "chaos",    strong: "magic" },
  awareness:     { weak: "agility",  strong: "command" },
  stealth:       { weak: "awareness",strong: "knowledge" },
  craftsmanship: { weak: "magic",    strong: "nature" },
  unknown:       {}
};

/* --- Grades basés sur la performance --- */
const COMBAT_GRADES = [
  { min: 95, grade: "S+", color: "#FFD700", label: "Legendary" },
  { min: 85, grade: "S",  color: "#FFD700", label: "Epic" },
  { min: 70, grade: "A",  color: "#7dffb2", label: "Great" },
  { min: 55, grade: "B",  color: "#53b6ff", label: "Good" },
  { min: 40, grade: "C",  color: "#ffffff", label: "Average" },
  { min: 0,  grade: "D",  color: "#ff6b6b", label: "Poor" }
];

function getCombatGrade(hpRemainingPct, rounds, isWin) {
  if (!isWin) return COMBAT_GRADES[COMBAT_GRADES.length - 1];
  // hpRemainingPct : 0–100
  // rounds : rounds joués (1–12) — moins c'est, plus le bonus est grand
  // score max théorique : 100×0.70 + (12−1)/12×30 = 70 + 27.5 = 97.5
  const speedBonus = Math.max(0, ((12 - rounds) / 12) * 30);
  const score = hpRemainingPct * 0.70 + speedBonus;
  return COMBAT_GRADES.find(g => score >= g.min) || COMBAT_GRADES[COMBAT_GRADES.length - 1];
}

/* --- Streak global en session --- */
if (typeof window.combatStreak === "undefined") window.combatStreak = 0;
if (typeof window.maxStreak === "undefined") window.maxStreak = 0;

async function weightedWin(playerNft, enemyNft) {

  const playerCat = (MANUAL_NFT_TRAITS[playerNft.nonce] || getNftCategory(playerNft) || "unknown").toLowerCase();
  const enemyCat  = (MANUAL_NFT_TRAITS[enemyNft.nonce]  || getNftCategory(enemyNft)  || "unknown").toLowerCase();

  const statsP = { ...( CATEGORY_STATS[playerCat] || CATEGORY_STATS.unknown ) };
  const statsE = { ...( CATEGORY_STATS[enemyCat]  || CATEGORY_STATS.unknown ) };

  /* --- Rarité coef (même formule qu'avant pour le calcul du coef de rareté) --- */
  const coefP = CATEGORY_COEFS[playerCat] ?? 1;
  const coefE = CATEGORY_COEFS[enemyCat]  ?? 1;

  /* --- Seer bonus --- */
  const isSeerP = SEER_IDS.has(Number(playerNft.nonce));
  const isSeerE = SEER_IDS.has(Number(enemyNft.nonce));
  if (isSeerP) { statsP.atk *= 1.25; statsP.spd *= 1.2; statsP.crit += 0.08; }
  if (isSeerE) { statsE.atk *= 1.25; statsE.spd *= 1.2; statsE.crit += 0.08; }

  /* --- Streak bonus (joueur) --- */
  const streakBonus = Math.min(window.combatStreak * 0.05, 0.30);
  statsP.atk  *= (1 + streakBonus * (coefP / 2));
  statsP.crit += streakBonus * 0.5;

  /* --- Avantage de type --- */
  const advP = TYPE_ADVANTAGE[playerCat] || {};
  const advE = TYPE_ADVANTAGE[enemyCat]  || {};
  let typeMultP = 1, typeMultE = 1;
  if (advP.strong === enemyCat)  typeMultP = 1.25;
  if (advP.weak   === enemyCat)  typeMultP = 0.80;
  if (advE.strong === playerCat) typeMultE = 1.25;
  if (advE.weak   === playerCat) typeMultE = 0.80;

  statsP.atk *= typeMultP;
  statsE.atk *= typeMultE;

  /* --- HP initiaux --- */
  let hpP = Math.round(statsP.hp * (0.9 + Math.random() * 0.2));
  let hpE = Math.round(statsE.hp * (0.9 + Math.random() * 0.2));
  const maxHpP = hpP, maxHpE = hpE;

  /* --- Boost NFT (multi-hold) --- */
  const playerBoost = Number(playerNft.boost ?? 1);
  const boostMult = 1 + (playerBoost - 1) * 0.15;
  statsP.atk *= boostMult;

  /* ===================== SIMULATION ROUNDS ===================== */
  const MAX_ROUNDS = 12;
  const log = [];

  let atkBuffP = 1, atkBuffE = 1;
  let dodgeNextP = false, dodgeNextE = false;
  let stunnedP = false, stunnedE = false;
  let lastSpecialP = -99, lastSpecialE = -99;
  const SPECIAL_COOLDOWN = 3;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (hpP <= 0 || hpE <= 0) break;

    /* --- Ordre d'attaque par vitesse --- */
    const spdP = statsP.spd * (0.8 + Math.random() * 0.4);
    const spdE = statsE.spd * (0.8 + Math.random() * 0.4);

    const attackOrder = spdP >= spdE ? ["P", "E"] : ["E", "P"];

    for (const attacker of attackOrder) {
      if (hpP <= 0 || hpE <= 0) break;

      const isP = attacker === "P";

      const atkSt  = isP ? statsP : statsE;
      const defSt  = isP ? statsE : statsP;
      let   hpAtk  = isP ? hpP    : hpE;
      let   hpDef  = isP ? hpE    : hpP;
      const stunned = isP ? stunnedP : stunnedE;
      const dodgeActive = isP ? dodgeNextE : dodgeNextP; // l'adversaire peut esquiver

      if (stunned) {
        if (isP) stunnedP = false; else stunnedE = false;
        log.push({ round, attacker, action: "stunned", dmg: 0, hpP, hpE });
        continue;
      }

      const catAtk = isP ? playerCat : enemyCat;
      const specCfg = SPECIAL_MOVES_CONFIG[catAtk] || SPECIAL_MOVES_CONFIG.unknown;
      const lastSpec = isP ? lastSpecialP : lastSpecialE;
      const canSpecial = (round - lastSpec) >= SPECIAL_COOLDOWN;

      const isCrit    = Math.random() < atkSt.crit;
      const isSpecial = canSpecial && Math.random() < specCfg.chance;

      /* --- Calcul des dégâts --- */
      let baseDmg = atkSt.atk * (isP ? atkBuffP : atkBuffE) * (0.85 + Math.random() * 0.3);
      if (isCrit) baseDmg *= 1.5;

      let dmg = 0;
      let actionType = "normal";

      if (isSpecial) {
        actionType = "special";
        if (isP) lastSpecialP = round; else lastSpecialE = round;

        if (specCfg.defPierce) {
          dmg = Math.round(baseDmg * specCfg.dmgMult); // ignore défense
        } else {
          const mitigation = Math.max(0, defSt.def * (0.6 + Math.random() * 0.4));
          dmg = Math.round(Math.max(1, baseDmg * specCfg.dmgMult - mitigation));
        }

        /* Effets spéciaux */
        if (specCfg.healPct) {
          const heal = Math.round((isP ? maxHpP : maxHpE) * specCfg.healPct);
          if (isP) hpP = Math.min(maxHpP, hpP + heal); else hpE = Math.min(maxHpE, hpE + heal);
        }
        if (specCfg.atkBuff) {
          if (isP) atkBuffP *= (1 + specCfg.atkBuff); else atkBuffE *= (1 + specCfg.atkBuff);
        }
        if (specCfg.dodgeNext) {
          if (isP) dodgeNextP = true; else dodgeNextE = true;
        }
        if (specCfg.stunChance && Math.random() < specCfg.stunChance) {
          if (isP) stunnedE = true; else stunnedP = true;
        }
      } else {
        const mitigation = Math.max(0, defSt.def * (0.7 + Math.random() * 0.3));
        dmg = Math.round(Math.max(1, baseDmg - mitigation));
        if (isCrit) actionType = "crit";
      }

      /* --- Esquive --- */
      if (dodgeActive && Math.random() < 0.45) {
        actionType = "dodge";
        dmg = 0;
        if (isP) dodgeNextE = false; else dodgeNextP = false;
      }

      /* --- Application dégâts --- */
      if (isP) { hpE = Math.max(0, hpE - dmg); hpP = hpP; }
      else      { hpP = Math.max(0, hpP - dmg); hpE = hpE; }

      log.push({
        round,
        attacker,
        action: actionType,
        specialName: isSpecial ? specCfg.name : null,
        isCrit,
        dmg,
        hpP: isP ? hpP : (hpP - (isP ? 0 : dmg)),
        hpE: isP ? (hpE) : hpE
      });
    }
  }

  /* ===================== RÉSULTAT ===================== */
  const DRAW_HP_DIFF = 0.10;
  const hpPctP = hpP / maxHpP;
  const hpPctE = hpE / maxHpE;
  const diff = Math.abs(hpPctP - hpPctE);

  let result;
  if (hpE <= 0 && hpP > 0)        result = "WIN";
  else if (hpP <= 0 && hpE > 0)   result = "LOSS";
  else if (diff <= DRAW_HP_DIFF)   result = "DRAW";
  else if (hpPctP > hpPctE)        result = "WIN";
  else                              result = "LOSS";

  const isKO      = result === "WIN"  && hpE === 0;
  const isPerfect = result === "WIN"  && hpP >= maxHpP * 0.90;
  const isBraveKO = result === "LOSS" && hpP === 0;

  /* --- Streak mise à jour --- */
  if (result === "WIN") {
    window.combatStreak++;
    if (window.combatStreak > window.maxStreak) window.maxStreak = window.combatStreak;
  } else if (result === "LOSS") {
    window.combatStreak = 0;
  }

  /* --- XP --- */
  const xpBase = result === "WIN" ? 120 : result === "DRAW" ? 50 : 30;
  const xpP = Math.floor(xpBase * (1 + hpPctP * 0.5) * (isKO ? 1.4 : 1) * (isPerfect ? 1.6 : 1) + window.combatStreak * 15);
  const xpE = Math.floor(80 * (1 + hpPctE * 0.5));

  /* --- Type advantage label --- */
  let typeAdvLabel = null;
  if (typeMultP > 1)  typeAdvLabel = `⚡ ${playerCat} beats ${enemyCat}!`;
  if (typeMultP < 1)  typeAdvLabel = `⚠️ ${playerCat} is weak vs ${enemyCat}`;

  /* --- Scores de combat (0–100, significatifs) ---
     Formule : HP restants (60%) + efficacité offensive (25%) + rapidité (15%)
     Un score de 100 = KO parfait en 1 round sans dégâts reçus
     Un score de 0   = défaite totale (KO, 0 HP)
  */
  const roundsPlayed   = Math.ceil(log.length / 2);

  /* --- Grade (après roundsPlayed pour utiliser la bonne valeur) --- */
  const grade = getCombatGrade(hpPctP * 100, roundsPlayed, result === "WIN");

  const totalDmgDealtP = log.filter(e => e.attacker === "P" && e.dmg > 0).reduce((s, e) => s + e.dmg, 0);
  const totalDmgDealtE = log.filter(e => e.attacker === "E" && e.dmg > 0).reduce((s, e) => s + e.dmg, 0);
  const maxPossibleDmg = Math.max(totalDmgDealtP, totalDmgDealtE, 1);
  const roundsMax      = MAX_ROUNDS;

  const scoreP = Math.round(
    hpPctP * 60                                                  // 60% : HP restants
    + (totalDmgDealtP / maxPossibleDmg) * 25                    // 25% : efficacité offensive
    + Math.max(0, (roundsMax - roundsPlayed) / roundsMax) * 15  // 15% : rapidité
  );
  const scoreE = Math.round(
    hpPctE * 60
    + (totalDmgDealtE / maxPossibleDmg) * 25
    + Math.max(0, (roundsMax - roundsPlayed) / roundsMax) * 15
  );

  return {
    result,
    // Scores lisibles 0–100 (remplacent les anciens scoreP/scoreE = hpPct)
    scoreP,   // Score global joueur  (0–100)
    scoreE,   // Score global ennemi  (0–100)
    diff: Math.abs(scoreP - scoreE),  // Écart entre les deux scores
    hpP, hpE, maxHpP, maxHpE,
    hpPctP, hpPctE,
    xpP, xpE,
    isKO, isPerfect, isBraveKO,
    grade,
    streak: window.combatStreak,
    typeAdvLabel,
    roundsPlayed,
    log,
    playerCat, enemyCat,
    playerStats: statsP,
    enemyStats: statsE
  };
}

// ================= OVERLAY =================

/* Injecte les styles CSS de l'overlay enrichi une seule fois */
(function _injectCombatStyles() {
  if (document.getElementById("combat-overlay-styles")) return;
  const s = document.createElement("style");
  s.id = "combat-overlay-styles";
  s.textContent = `
    /* ── Overlay plein écran ── */
    #combatOverlay {
      position: fixed !important;
      inset: 0 !important;
      z-index: 9999 !important;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.88) !important;
      backdrop-filter: blur(10px);
      opacity: 0;
      pointer-events: none;
      transition: opacity .45s ease;
    }
    #combatOverlay.active {
      opacity: 1;
      pointer-events: all;
    }

    /* ── Panneau central ── */
    .co-panel {
      position: relative;
      width: min(92vw, 580px);
      background: linear-gradient(160deg, #0f1117 0%, #161c2a 100%);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 20px;
      box-shadow: 0 0 80px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06);
      overflow: hidden;
      animation: co-enter .4s cubic-bezier(.22,1,.36,1) both;
    }
    @keyframes co-enter {
      from { transform: scale(.92) translateY(24px); opacity:0; }
      to   { transform: scale(1)   translateY(0);    opacity:1; }
    }

    /* ── Barre de progression de phase ── */
    .co-progress {
      position: absolute;
      top: 0; left: 0;
      height: 3px;
      background: linear-gradient(90deg,#7dffb2,#53b6ff,#ffd700);
      border-radius: 0 3px 3px 0;
      transition: width .6s ease;
    }

    /* ── Header ── */
    .co-header {
      padding: 22px 26px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    .co-step-label {
      font-family: 'Cinzel', serif;
      font-size: .62rem;
      letter-spacing: .18em;
      color: rgba(255,255,255,.35);
      text-transform: uppercase;
    }
    .co-step-dots {
      display: flex;
      gap: 6px;
    }
    .co-step-dots span {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: rgba(255,255,255,.15);
      transition: background .3s;
    }
    .co-step-dots span.active { background: #7dffb2; box-shadow: 0 0 6px #7dffb2; }
    .co-step-dots span.done   { background: rgba(125,255,178,.4); }

    /* ── Body ── */
    .co-body {
      padding: 28px 26px 22px;
      min-height: 260px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
    }

    /* ── Suspense ── */
    .co-suspense-title {
      font-family: 'Cinzel', serif;
      font-size: clamp(1.1rem, 4vw, 1.55rem);
      font-weight: 700;
      letter-spacing: .1em;
      color: #fff;
      text-align: center;
      animation: co-pulse 1.4s ease-in-out infinite;
    }
    @keyframes co-pulse {
      0%,100% { opacity:.6; } 50% { opacity:1; }
    }
    .co-vs-row {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-top: 4px;
    }
    .co-cat-badge {
      padding: 6px 16px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.18);
      font-family: 'Cinzel', serif;
      font-size: .78rem;
      font-weight: 700;
      letter-spacing: .1em;
      background: rgba(255,255,255,.05);
    }
    .co-cat-badge.player { color: #7dffb2; border-color: rgba(125,255,178,.35); }
    .co-cat-badge.enemy  { color: #ff6b6b; border-color: rgba(255,107,107,.35); }
    .co-vs-sep {
      font-family: 'Cinzel', serif;
      font-size: 1.1rem;
      color: rgba(255,255,255,.3);
    }
    .co-type-adv {
      padding: 5px 16px;
      border-radius: 999px;
      background: rgba(255,215,0,.1);
      border: 1px solid rgba(255,215,0,.3);
      color: #ffd700;
      font-family: 'Cinzel', serif;
      font-size: .72rem;
      letter-spacing: .06em;
      text-align: center;
    }

    /* ── HP Bars ── */
    .co-hp-section { width: 100%; display: flex; flex-direction: column; gap: 14px; }
    .co-hp-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .co-hp-label-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .co-hp-name {
      font-family: 'Cinzel', serif;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .1em;
    }
    .co-hp-name.player { color: #7dffb2; }
    .co-hp-name.enemy  { color: #ff6b6b; }
    .co-hp-value {
      font-family: 'Cinzel', serif;
      font-size: .85rem;
      font-weight: 900;
    }
    .co-hp-value.player { color: #7dffb2; }
    .co-hp-value.enemy  { color: #ff6b6b; }
    .co-hp-track {
      height: 14px;
      background: rgba(255,255,255,.08);
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.06);
    }
    .co-hp-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 1.1s cubic-bezier(.22,1,.36,1);
    }
    .co-hp-fill.player { background: linear-gradient(90deg,#7dffb2,#28c970); }
    .co-hp-fill.enemy  { background: linear-gradient(90deg,#ff6b6b,#cc1111); }

    .co-rounds-badge {
      font-family: 'Cinzel', serif;
      font-size: .68rem;
      letter-spacing: .12em;
      color: rgba(255,255,255,.35);
      text-align: center;
      padding: 6px 0 0;
    }

    /* ── Combat log ── */
    .co-log-title {
      font-family: 'Cinzel', serif;
      font-size: .68rem;
      letter-spacing: .15em;
      color: rgba(255,255,255,.4);
      text-transform: uppercase;
      width: 100%;
      text-align: left;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    .co-log-list {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .co-log-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 10px;
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.06);
      font-family: 'Cinzel', serif;
      font-size: .78rem;
      animation: co-fadein .35s ease both;
    }
    .co-log-item.special { border-color: rgba(255,215,0,.25); background: rgba(255,215,0,.06); }
    .co-log-item.crit    { border-color: rgba(255,155,59,.25); background: rgba(255,155,59,.06); }
    .co-log-icon { font-size: 1.1rem; flex-shrink: 0; }
    .co-log-text { flex: 1; }
    .co-log-dmg  { font-weight: 900; font-size: .85rem; }
    .co-log-dmg.player { color: #7dffb2; }
    .co-log-dmg.enemy  { color: #ff6b6b; }
    @keyframes co-fadein {
      from { opacity:0; transform: translateX(-8px); }
      to   { opacity:1; transform: translateX(0); }
    }

    /* ── Résultat ── */
    .co-result-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      width: 100%;
    }
    .co-result-title {
      font-family: 'Cinzel', serif;
      font-size: clamp(1.8rem, 6vw, 2.6rem);
      font-weight: 900;
      letter-spacing: .12em;
      text-align: center;
      animation: co-result-pop .5s cubic-bezier(.22,1,.36,1) both;
    }
    @keyframes co-result-pop {
      from { transform: scale(.7); opacity:0; }
      to   { transform: scale(1);  opacity:1; }
    }
    .co-result-title.win  { color: #7dffb2; text-shadow: 0 0 40px rgba(125,255,178,.5); }
    .co-result-title.draw { color: #53b6ff; text-shadow: 0 0 40px rgba(83,182,255,.5); }
    .co-result-title.lose { color: #ff6b6b; text-shadow: 0 0 40px rgba(255,107,107,.5); }

    .co-xp-row {
      display: flex;
      gap: 24px;
      justify-content: center;
    }
    .co-xp-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 12px 22px;
      border-radius: 12px;
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.08);
    }
    .co-xp-label {
      font-family: 'Cinzel', serif;
      font-size: .62rem;
      letter-spacing: .15em;
      opacity: .55;
    }
    .co-xp-value {
      font-family: 'Cinzel', serif;
      font-size: 1.3rem;
      font-weight: 900;
    }
    .co-xp-card.player .co-xp-value { color: #7dffb2; }
    .co-xp-card.enemy  .co-xp-value { color: #ff6b6b; }

    .co-grade-badge {
      padding: 8px 24px;
      border-radius: 999px;
      font-family: 'Cinzel', serif;
      font-size: .85rem;
      font-weight: 700;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    .co-streak-badge {
      padding: 7px 22px;
      border-radius: 999px;
      background: rgba(255,165,0,.14);
      border: 1px solid rgba(255,165,0,.4);
      color: #ffa500;
      font-family: 'Cinzel', serif;
      font-size: .82rem;
      font-weight: 700;
      letter-spacing: .1em;
    }
    .co-badges-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
    }
    .co-special-badge {
      padding: 5px 14px;
      border-radius: 999px;
      font-family: 'Cinzel', serif;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .1em;
    }
    .co-special-badge.ko      { background: rgba(255,107,107,.15); border: 1px solid rgba(255,107,107,.4); color: #ff6b6b; }
    .co-special-badge.perfect { background: rgba(255,215,0,.12);   border: 1px solid rgba(255,215,0,.4);   color: #ffd700; }
    .co-special-badge.brave   { background: rgba(180,120,255,.12); border: 1px solid rgba(180,120,255,.4); color: #b47cff; }

    /* ── Footer bouton ── */
    .co-footer {
      padding: 0 26px 24px;
      display: flex;
      justify-content: center;
    }
    .co-btn {
      padding: 11px 36px;
      border-radius: 999px;
      border: none;
      cursor: pointer;
      font-family: 'Cinzel', serif;
      font-size: .82rem;
      font-weight: 700;
      letter-spacing: .14em;
      text-transform: uppercase;
      background: linear-gradient(135deg,#7dffb2,#28c970);
      color: #0a1a10;
      box-shadow: 0 4px 20px rgba(125,255,178,.3);
      transition: transform .15s, box-shadow .15s;
    }
    .co-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 28px rgba(125,255,178,.45); }
    .co-btn:active { transform: scale(.97); }
    .co-btn.secondary {
      background: rgba(255,255,255,.07);
      color: rgba(255,255,255,.7);
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: none;
    }

    /* ── Divider ── */
    .co-divider {
      width: 100%;
      height: 1px;
      background: rgba(255,255,255,.06);
    }
  `;
  document.head.appendChild(s);
})();

/* ── Helper : attend qu'un bouton soit cliqué ── */
function _waitForBtn(btnId) {
  return new Promise(resolve => {
    const btn = document.getElementById(btnId);
    if (!btn) { resolve(); return; }
    btn.addEventListener("click", resolve, { once: true });
  });
}

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ─────────────────────────────────────────────────────────────
   MAIN OVERLAY FUNCTION
───────────────────────────────────────────────────────────── */
/* ════════════════════════════════════════════════════
   Vidéo d'intro de combat — choisie aléatoirement
   dans une liste/dossier de vidéos
════════════════════════════════════════════════════ */

// 1) Liste tes fichiers vidéo ici (chemin relatif au site, ex: dossier "videos/")
const COMBAT_INTRO_VIDEOS = [
  "videos/arena2.mp4",
  "videos/arena3.mp4",
  "videos/arena4.mp4",
];

function playRandomCombatIntroVideo(container) {
  return new Promise((resolve) => {
    if (!COMBAT_INTRO_VIDEOS.length) return resolve();

    const src = COMBAT_INTRO_VIDEOS[Math.floor(Math.random() * COMBAT_INTRO_VIDEOS.length)];
    console.log("[combat-intro] tentative de lecture:", src);

    container.innerHTML = `
      <div class="co-intro-video-wrap">
        <video id="co-intro-video" playsinline muted></video>
      </div>
    `;

    if (!document.getElementById("co-intro-video-styles")) {
      const ss = document.createElement("style");
      ss.id = "co-intro-video-styles";
      ss.textContent = `
        .co-intro-video-wrap {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .co-intro-video-wrap video {
          width: 100%;
          max-height: 60vh;
          border-radius: 12px;
          background: #000;
        }
      `;
      document.head.appendChild(ss);
    }

    const video = document.getElementById("co-intro-video");
    let done = false;
    let started = false;

    const finish = (reason) => {
      if (done) return;
      done = true;
      console.log("[combat-intro] fin (" + reason + ") pour", src);
      resolve();
    };

    // Filet de sécurité ABSOLU : quoi qu'il arrive, on ne bloque jamais le combat plus de 8s
    const hardTimeout = setTimeout(() => finish("timeout-hard"), 8000);

    video.addEventListener("ended", () => {
      clearTimeout(hardTimeout);
      finish("ended");
    });

    video.addEventListener("error", (e) => {
      console.warn("[combat-intro] erreur de chargement vidéo:", src, e);
      clearTimeout(hardTimeout);
      finish("error");
    });

    // On attend que la vidéo soit réellement prête à jouer avant d'appeler play()
    video.addEventListener("canplay", () => {
      if (started) return;
      started = true;
      video.play().catch((err) => {
        console.warn("[combat-intro] play() a échoué:", err);
        clearTimeout(hardTimeout);
        finish("play-rejected");
      });
    });

    // Si la vidéo met trop de temps à devenir "canplay" (réseau lent, fichier manquant…),
    // on n'attend pas indéfiniment avant de tenter le play quand même / ou d'abandonner.
    setTimeout(() => {
      if (started || done) return;
      if (video.readyState >= 2) {
        // assez de data chargée mais l'event canplay n'est jamais arrivé : on force
        started = true;
        video.play().catch((err) => finish("play-rejected-fallback:" + err));
      } else {
        finish("not-ready-fallback");
      }
    }, 2000);

    video.src = src;
    video.load();
  });
}

async function showCombatOverlay(combatData) {

  const {
    result, xpP, xpE,
    hpP, hpE, maxHpP, maxHpE, hpPctP, hpPctE,
    isKO, isPerfect, isBraveKO, grade,
    streak, typeAdvLabel,
    roundsPlayed, log,
    playerCat, enemyCat
  } = combatData;

  const overlay = document.getElementById("combatOverlay");
  disableCombatArena();

  /* ── Remplace le contenu de l'overlay par notre panneau ── */
  overlay.innerHTML = `
    <div class="co-panel">
      <div class="co-progress" id="co-progress" style="width:0%"></div>

      <div class="co-header">
        <span class="co-step-label" id="co-step-label">Preparing…</span>
        <div class="co-step-dots" id="co-step-dots">
          <span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="co-body" id="co-body"></div>

      <div class="co-footer" id="co-footer" style="display:none">
        <button class="co-btn" id="co-btn-next">Continue →</button>
      </div>
    </div>
  `;

  overlay.classList.add("active");

  const body    = document.getElementById("co-body");
  const footer  = document.getElementById("co-footer");
  const btnNext = document.getElementById("co-btn-next");
  const stepLbl = document.getElementById("co-step-label");
  const dots    = document.getElementById("co-step-dots").querySelectorAll("span");
  const progress= document.getElementById("co-progress");

  function setStep(n, label) {
    stepLbl.textContent = label;
    progress.style.width = `${(n / 4) * 100}%`;
    dots.forEach((d, i) => {
      d.className = i < n ? "done" : i === n ? "active" : "";
    });
  }

  function showBtn(label = "Continue →") {
    btnNext.textContent = label;
    footer.style.display = "flex";
    btnNext.style.display = "";
  }
  function hideBtn() { footer.style.display = "none"; }

  /* ════════════════════════════════════════
     PHASE 0 — Vidéo d'intro de combat (aléatoire)
  ════════════════════════════════════════ */
  await playRandomCombatIntroVideo(body);

  /* ════════════════════════════════════════
     PHASE 1 — Suspense
  ════════════════════════════════════════ */
  setStep(0, "Combat in progress…");

   //console.log(
   //  "%c⚔️  COMBAT START  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    // "color:#ffd700;font-family:monospace;font-size:12px;font-weight:bold;"
   //);
   //console.log("%c  Player: " + playerCat.toUpperCase() + "   vs   Enemy: " + enemyCat.toUpperCase(),
   //  "color:#7dffb2;font-family:monospace;");
  // if (typeAdvLabel) {
   //  console.log("%c  " + typeAdvLabel, "color:#ffd700;font-family:monospace;");
  // }
  // console.log("%c  Full combat data:", "color:#aaa;font-family:monospace;", combatData);

  body.innerHTML = `
    <div class="co-suspense-title">⚔️ The fate is being decided…</div>
    <div class="co-vs-row">
      <span class="co-cat-badge player">${playerCat.toUpperCase()}</span>
      <span class="co-vs-sep">VS</span>
      <span class="co-cat-badge enemy">${enemyCat.toUpperCase()}</span>
    </div>
    ${typeAdvLabel ? `<div class="co-type-adv">${typeAdvLabel}</div>` : ""}
  `;

  await _delay(2200);

  /* ════════════════════════════════════════
     PHASE 2 — Battle Summary (scorecard)
  ════════════════════════════════════════ */
  setStep(1, "Battle Summary");

  /* ── Inject styles once ── */
  if (!document.getElementById("co-summary-styles")) {
    const ss = document.createElement("style");
    ss.id = "co-summary-styles";
    ss.textContent = `
      /* ── Scorecard wrapper ── */
      .co-scorecard {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* ── VS header ── */
      .co-sc-vs-header {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        gap: 10px;
      }
      .co-sc-fighter {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .co-sc-fighter.player { text-align: left; }
      .co-sc-fighter.enemy  { text-align: right; }
      .co-sc-fighter-role {
        font-family: 'Cinzel', serif;
        font-size: .58rem;
        letter-spacing: .16em;
        opacity: .4;
        text-transform: uppercase;
      }
      .co-sc-fighter-name {
        font-family: 'Cinzel', serif;
        font-size: .88rem;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .co-sc-fighter-name.player { color: #7dffb2; }
      .co-sc-fighter-name.enemy  { color: #ff6b6b; }
      .co-sc-vs-sep {
        font-family: 'Cinzel', serif;
        font-size: 1rem;
        font-weight: 900;
        color: rgba(255,255,255,.2);
        text-align: center;
      }
      /* Seer badge inline */
      .co-seer-tag {
        display: inline-block;
        font-family: 'Cinzel', serif;
        font-size: .55rem;
        padding: 1px 6px;
        border-radius: 4px;
        background: rgba(255,215,0,.15);
        border: 1px solid rgba(255,215,0,.35);
        color: #ffd700;
        letter-spacing: .08em;
        margin-left: 4px;
        vertical-align: middle;
      }

      /* ── HP block ── */
      .co-sc-hp-block {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 16px;
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 12px;
      }
      .co-sc-hp-row {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .co-sc-hp-meta {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .co-sc-hp-who {
        font-family: 'Cinzel', serif;
        font-size: .7rem;
        font-weight: 700;
        letter-spacing: .1em;
      }
      .co-sc-hp-who.player { color: #7dffb2; }
      .co-sc-hp-who.enemy  { color: #ff6b6b; }
      .co-sc-hp-numbers {
        font-family: 'Cinzel', serif;
        font-size: .78rem;
        font-weight: 900;
        color: rgba(255,255,255,.7);
      }
      .co-sc-hp-pct {
        font-size: .65rem;
        font-weight: 700;
        margin-left: 6px;
      }
      .co-sc-bar-track {
        height: 12px;
        background: rgba(255,255,255,.07);
        border-radius: 999px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.05);
        position: relative;
      }
      .co-sc-bar-fill {
        height: 100%;
        border-radius: 999px;
        transition: width 1.1s cubic-bezier(.22,1,.36,1);
        position: relative;
      }
      /* Couleur dynamique selon % HP restant */
      .co-sc-bar-fill.hp-high   { background: linear-gradient(90deg,#7dffb2,#28c970); }
      .co-sc-bar-fill.hp-mid    { background: linear-gradient(90deg,#ffd700,#ff9b3b); }
      .co-sc-bar-fill.hp-low    { background: linear-gradient(90deg,#ff6b6b,#cc1111); }
      .co-sc-bar-fill.hp-dead   { background: linear-gradient(90deg,#555,#333); }
      /* Shimmer sur la barre */
      .co-sc-bar-fill::after {
        content: '';
        position: absolute;
        top: 0; left: -40%;
        width: 30%; height: 100%;
        background: rgba(255,255,255,.18);
        border-radius: 999px;
        animation: co-shimmer 2s ease-in-out infinite;
      }
      @keyframes co-shimmer {
        0%   { left: -40%; }
        100% { left: 130%; }
      }

      /* ── Stats grid face-à-face ── */
      .co-sc-stats-title {
        font-family: 'Cinzel', serif;
        font-size: .65rem;
        letter-spacing: .18em;
        color: rgba(255,255,255,.3);
        text-transform: uppercase;
        text-align: center;
        padding: 2px 0 6px;
        border-bottom: 1px solid rgba(255,255,255,.06);
      }
      .co-sc-stats-grid {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .co-sc-stat-row {
        display: grid;
        grid-template-columns: 1fr 80px 1fr;
        align-items: center;
        gap: 6px;
        animation: co-tl-in .35s cubic-bezier(.22,1,.36,1) both;
      }
      .co-sc-stat-val {
        font-family: 'Cinzel', serif;
        font-size: .8rem;
        font-weight: 900;
      }
      .co-sc-stat-val.player { color: #7dffb2; text-align: left; }
      .co-sc-stat-val.enemy  { color: #ff6b6b; text-align: right; }
      .co-sc-stat-val.winner { text-decoration: underline; text-decoration-color: rgba(255,215,0,.6); }
      .co-sc-stat-label {
        font-family: 'Cinzel', serif;
        font-size: .6rem;
        letter-spacing: .1em;
        color: rgba(255,255,255,.3);
        text-align: center;
        text-transform: uppercase;
      }
      /* mini bar comparative */
      .co-sc-cmp-wrap {
        display: flex;
        align-items: center;
        gap: 3px;
        height: 5px;
      }
      .co-sc-cmp-bar {
        height: 5px;
        border-radius: 999px;
        transition: width .9s cubic-bezier(.22,1,.36,1);
        min-width: 2px;
      }
      .co-sc-cmp-bar.player { background: #7dffb2; }
      .co-sc-cmp-bar.enemy  { background: #ff6b6b; }

      /* ── Type advantage banner ── */
      .co-sc-adv-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 14px;
        border-radius: 10px;
        background: rgba(255,215,0,.07);
        border: 1px solid rgba(255,215,0,.22);
        font-family: 'Cinzel', serif;
        font-size: .75rem;
        color: #ffd700;
        letter-spacing: .06em;
        animation: co-tl-in .4s ease both;
      }
      .co-sc-adv-icon { font-size: 1.1rem; flex-shrink: 0; }

      /* ── Damage dealt summary ── */
      .co-sc-dmg-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .co-sc-dmg-card {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 10px 14px;
        border-radius: 10px;
        background: rgba(255,255,255,.03);
        border: 1px solid rgba(255,255,255,.06);
        animation: co-tl-in .4s ease both;
      }
      .co-sc-dmg-label {
        font-family: 'Cinzel', serif;
        font-size: .58rem;
        letter-spacing: .14em;
        opacity: .4;
        text-transform: uppercase;
      }
      .co-sc-dmg-value {
        font-family: 'Cinzel', serif;
        font-size: 1.1rem;
        font-weight: 900;
      }
      .co-sc-dmg-card.player .co-sc-dmg-value { color: #7dffb2; }
      .co-sc-dmg-card.enemy  .co-sc-dmg-value { color: #ff6b6b; }
      .co-sc-dmg-sub {
        font-family: 'Cinzel', serif;
        font-size: .62rem;
        color: rgba(255,255,255,.3);
      }
    `;
    document.head.appendChild(ss);
  }

  /* ── Calculs depuis le log ── */
  const totalDmgByPlayer = log
    .filter(e => e.attacker === "P" && e.dmg > 0)
    .reduce((s, e) => s + e.dmg, 0);
  const totalDmgByEnemy = log
    .filter(e => e.attacker === "E" && e.dmg > 0)
    .reduce((s, e) => s + e.dmg, 0);
  const specialsByPlayer = log.filter(e => e.attacker === "P" && e.action === "special").length;
  const specialsByEnemy  = log.filter(e => e.attacker === "E" && e.action === "special").length;
  const critsByPlayer    = log.filter(e => e.attacker === "P" && e.action === "crit").length;
  const critsByEnemy     = log.filter(e => e.attacker === "E" && e.action === "crit").length;
  const maxHitPlayer     = Math.max(0, ...log.filter(e => e.attacker === "P").map(e => e.dmg || 0));
  const maxHitEnemy      = Math.max(0, ...log.filter(e => e.attacker === "E").map(e => e.dmg || 0));

  const hpPctPlayerDisp = Math.max(0, Math.round(hpPctP * 100));
  const hpPctEnemyDisp  = Math.max(0, Math.round(hpPctE * 100));

  /* HP bar color class */
  function hpClass(pct) {
    if (pct <= 0)  return "hp-dead";
    if (pct <= 25) return "hp-low";
    if (pct <= 55) return "hp-mid";
    return "hp-high";
  }

  /* Seer check */
  const playerNftRef = window.selectedCombatNft || {};
  const enemyNftRef  = window.enemyCombatNft    || {};
  const playerIsSeer = SEER_IDS.has(Number(playerNftRef.nonce));
  const enemyIsSeer  = SEER_IDS.has(Number(enemyNftRef.nonce));

  /* Stats face-à-face rows */
  const { playerStats, enemyStats } = combatData;
  const statsRows = [
    { label: "ATK",   p: Math.round(playerStats.atk),  e: Math.round(enemyStats.atk)  },
    { label: "DEF",   p: Math.round(playerStats.def),  e: Math.round(enemyStats.def)  },
    { label: "SPD",   p: Math.round(playerStats.spd),  e: Math.round(enemyStats.spd)  },
    { label: "CRIT",  p: Math.round(playerStats.crit * 100) + "%",
                      e: Math.round(enemyStats.crit * 100) + "%",
      pNum: playerStats.crit, eNum: enemyStats.crit },
  ];

  /* Bar widths for comparative mini-bars (max = 50% each side) */
  function cmpWidths(pVal, eVal) {
    const maxV = Math.max(pVal, eVal, 1);
    return { pw: Math.round((pVal / maxV) * 50), ew: Math.round((eVal / maxV) * 50) };
  }

  let statsRowsHtml = "";
  statsRows.forEach((row, i) => {
    const pNum   = row.pNum ?? row.p;
    const eNum   = row.eNum ?? row.e;
    const pWins  = pNum > eNum;
    const eWins  = eNum > pNum;
    const { pw, ew } = cmpWidths(
      typeof pNum === "number" ? pNum : parseFloat(pNum),
      typeof eNum === "number" ? eNum : parseFloat(eNum)
    );
    statsRowsHtml += `
      <div class="co-sc-stat-row" style="animation-delay:${i * 0.07}s">
        <span class="co-sc-stat-val player ${pWins ? "winner" : ""}">${row.p}</span>
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
          <span class="co-sc-stat-label">${row.label}</span>
          <div class="co-sc-cmp-wrap" style="width:100%;">
            <div class="co-sc-cmp-bar player" id="cmp-p-${i}" style="width:0%"></div>
            <div class="co-sc-cmp-bar enemy"  id="cmp-e-${i}" style="width:0%"></div>
          </div>
        </div>
        <span class="co-sc-stat-val enemy ${eWins ? "winner" : ""}">${row.e}</span>
      </div>
    `;
  });

   //console.log(
  //   "%c⚔️ BATTLE SUMMARY",
  //   "color:#7dffb2;font-family:monospace;font-size:13px;font-weight:bold;"
   //);
  // console.table({
  //   "Player Cat":   playerCat,
  //   "Enemy Cat":    enemyCat,
   //  "Player HP":    `${hpP} / ${maxHpP} (${hpPctPlayerDisp}%)`,
   //  "Enemy HP":     `${hpE} / ${maxHpE} (${hpPctEnemyDisp}%)`,
   //  "Rounds":       roundsPlayed,
   //  "Total DMG (P)":totalDmgByPlayer,
   //  "Total DMG (E)":totalDmgByEnemy,
     //"Specials (P)": specialsByPlayer,
   //  "Specials (E)": specialsByEnemy,
   //  "Crits (P)":    critsByPlayer,
   //  "Crits (E)":    critsByEnemy,
   //  "Max Hit (P)":  maxHitPlayer,
   //  "Max Hit (E)":  maxHitEnemy,
   //  "Type Adv":     typeAdvLabel || "None",
   //  "Player Seer":  playerIsSeer,
   //  "Enemy Seer":   enemyIsSeer,
   //});
  // console.log(
  //   "%c📊 ATK %d  DEF %d  SPD %d  CRIT %d%%  →  Result: %s",
  //   "color:#53b6ff;font-family:monospace;",
  //   Math.round(playerStats.atk), Math.round(playerStats.def),
  //   Math.round(playerStats.spd), Math.round(playerStats.crit * 100),
  //   result
  // );

  body.innerHTML = `
    <div class="co-scorecard">

      <!-- VS Header -->
      <div class="co-sc-vs-header">
        <div class="co-sc-fighter player">
          <span class="co-sc-fighter-role">Your NFT</span>
          <span class="co-sc-fighter-name player">
            ${playerCat.toUpperCase()}${playerIsSeer ? '<span class="co-seer-tag">SEER</span>' : ""}
          </span>
        </div>
        <div class="co-sc-vs-sep">VS</div>
        <div class="co-sc-fighter enemy">
          <span class="co-sc-fighter-role">Enemy NFT</span>
          <span class="co-sc-fighter-name enemy">
            ${enemyCat.toUpperCase()}${enemyIsSeer ? '<span class="co-seer-tag">SEER</span>' : ""}
          </span>
        </div>
      </div>

      <!-- Type advantage -->
      ${typeAdvLabel ? `
        <div class="co-sc-adv-banner">
          <span class="co-sc-adv-icon">⚡</span>
          <span>${typeAdvLabel}</span>
        </div>
      ` : ""}

      <!-- HP Bars -->
      <div class="co-sc-hp-block">
        <div class="co-sc-hp-row">
          <div class="co-sc-hp-meta">
            <span class="co-sc-hp-who player">⚔️ YOUR HP</span>
            <span class="co-sc-hp-numbers">
              ${hpP} / ${maxHpP}
              <span class="co-sc-hp-pct" style="color:${hpPctPlayerDisp > 55 ? "#7dffb2" : hpPctPlayerDisp > 25 ? "#ffd700" : "#ff6b6b"}">
                ${hpPctPlayerDisp}%
              </span>
            </span>
          </div>
          <div class="co-sc-bar-track">
            <div class="co-sc-bar-fill ${hpClass(hpPctPlayerDisp)}" id="hp-fill-player" style="width:0%"></div>
          </div>
        </div>

        <div class="co-sc-hp-row">
          <div class="co-sc-hp-meta">
            <span class="co-sc-hp-who enemy">🛡️ ENEMY HP</span>
            <span class="co-sc-hp-numbers">
              ${hpE} / ${maxHpE}
              <span class="co-sc-hp-pct" style="color:${hpPctEnemyDisp > 55 ? "#ff6b6b" : hpPctEnemyDisp > 25 ? "#ffd700" : "#7dffb2"}">
                ${hpPctEnemyDisp}%
              </span>
            </span>
          </div>
          <div class="co-sc-bar-track">
            <div class="co-sc-bar-fill ${hpClass(hpPctEnemyDisp)}" id="hp-fill-enemy" style="width:0%"></div>
          </div>
        </div>

        <div class="co-rounds-badge" style="padding:0;border:none;margin-top:2px;">
          ⏱ ${roundsPlayed} ROUNDS FOUGHT
        </div>
      </div>

      <!-- Damage dealt -->
      <div class="co-sc-dmg-row">
        <div class="co-sc-dmg-card player" style="animation-delay:.05s">
          <span class="co-sc-dmg-label">Total Damage Dealt</span>
          <span class="co-sc-dmg-value">${totalDmgByPlayer}</span>
          <span class="co-sc-dmg-sub">⚡ ${specialsByPlayer} special · 💥 ${critsByPlayer} crit · 🗡️ max ${maxHitPlayer}</span>
        </div>
        <div class="co-sc-dmg-card enemy" style="animation-delay:.10s">
          <span class="co-sc-dmg-label">Total Damage Taken</span>
          <span class="co-sc-dmg-value">${totalDmgByEnemy}</span>
          <span class="co-sc-dmg-sub">⚡ ${specialsByEnemy} special · 💥 ${critsByEnemy} crit · 🗡️ max ${maxHitEnemy}</span>
        </div>
      </div>

      <!-- Stats face-à-face -->
      <div class="co-sc-stats-title">⚔️ Stats Comparison</div>
      <div class="co-sc-stats-grid">${statsRowsHtml}</div>

    </div>
  `;

  /* ── Anime les barres HP ── */
  await _delay(80);
  const fillP = document.getElementById("hp-fill-player");
  const fillE = document.getElementById("hp-fill-enemy");
  if (fillP) fillP.style.width = hpPctPlayerDisp + "%";
  if (fillE) fillE.style.width = hpPctEnemyDisp  + "%";

  /* ── Anime les mini barres comparatives ── */
  statsRows.forEach((row, i) => {
    const pNum = row.pNum ?? (typeof row.p === "number" ? row.p : parseFloat(row.p));
    const eNum = row.eNum ?? (typeof row.e === "number" ? row.e : parseFloat(row.e));
    const maxV = Math.max(pNum, eNum, 1);
    const pw   = Math.round((pNum / maxV) * 50);
    const ew   = Math.round((eNum / maxV) * 50);
    setTimeout(() => {
      const bp = document.getElementById(`cmp-p-${i}`);
      const be = document.getElementById(`cmp-e-${i}`);
      if (bp) bp.style.width = pw + "%";
      if (be) be.style.width = ew + "%";
    }, 120 + i * 80);
  });

  showBtn("See Battle Highlights →");
  await _waitForBtn("co-btn-next");
  hideBtn();

  /* ════════════════════════════════════════
     PHASE 3 — Combat Log (highlights)
  ════════════════════════════════════════ */
  setStep(2, "Battle Highlights");

   //console.log(
    // "%c⚡ BATTLE HIGHLIGHTS  ━━━━━━━━━━━━━━━━━━━━━━━━━",
    // "color:#53b6ff;font-family:monospace;font-size:12px;font-weight:bold;"
   //);
  const _logSpecials = log.filter(e => e.action === "special");
  const _logCrits    = log.filter(e => e.action === "crit");
  const _logDodges   = log.filter(e => e.action === "dodge");
   //console.log("%c  Total events in log: " + log.length, "color:#aaa;font-family:monospace;");
   //console.log("%c  Specials: " + _logSpecials.length + "  Crits: " + _logCrits.length + "  Dodges: " + _logDodges.length, "color:#aaa;font-family:monospace;");
   //if (_logSpecials.length) {
   //  console.groupCollapsed("%c  ⚡ Special moves", "color:#ffd700;font-family:monospace;");
   //  _logSpecials.forEach(e => console.log("  R" + e.round + " | " + (e.attacker === "P" ? "PLAYER" : "ENEMY") + " → " + e.specialName + " | " + e.dmg + " dmg"));
   //  console.groupEnd();
   //}
  // if (_logCrits.length) {
  //   console.groupCollapsed("%c  💥 Critical hits", "color:#ff9b3b;font-family:monospace;");
   //  _logCrits.forEach(e => console.log("  R" + e.round + " | " + (e.attacker === "P" ? "PLAYER" : "ENEMY") + " → " + e.dmg + " dmg CRIT"));
    // console.groupEnd();
   //}

  /* ── Calcul du max dmg pour les barres proportionnelles ── */
  const maxDmgInLog = Math.max(1, ...log.map(e => e.dmg || 0));

  /* ── Filtrage : on prend les events marquants + on complète avec les plus forts ── */
  const keyEvents = [
    ...log.filter(e => e.action === "special" || e.action === "crit" || e.action === "dodge" || e.action === "stunned"),
    ...log.filter(e => e.action === "normal" && e.dmg >= 16)
  ]
    .filter((e, i, arr) => arr.indexOf(e) === i) // deduplique
    .sort((a, b) => a.round - b.round)           // ordre chronologique
    .slice(0, 6);

  /* ── Config visuelle par type d'action ── */
  const ACTION_CFG = {
    special: { icon: "⚡", cls: "special", color: "#ffd700",  label: "SPECIAL MOVE"  },
    crit:    { icon: "💥", cls: "crit",    color: "#ff9b3b",  label: "CRITICAL HIT"  },
    dodge:   { icon: "🌀", cls: "dodge",   color: "#53b6ff",  label: "DODGE"         },
    stunned: { icon: "😵", cls: "stun",    color: "#b47cff",  label: "STUNNED"       },
    normal:  { icon: "⚔️", cls: "heavy",  color: "#ff6b6b",  label: "HEAVY HIT"     },
  };

  /* ── Styles supplémentaires injectés une seule fois ── */
  if (!document.getElementById("co-log-ext-styles")) {
    const ext = document.createElement("style");
    ext.id = "co-log-ext-styles";
    ext.textContent = `
      /* Timeline container */
      .co-timeline {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0;
        position: relative;
      }
      /* Ligne verticale centrale */
      .co-timeline::before {
        content: '';
        position: absolute;
        left: 38px;
        top: 0; bottom: 0;
        width: 2px;
        background: linear-gradient(180deg, rgba(255,255,255,.12) 0%, rgba(255,255,255,.03) 100%);
        border-radius: 2px;
      }

      /* Chaque entrée de timeline */
      .co-tl-entry {
        display: grid;
        grid-template-columns: 78px 1fr;
        gap: 0 14px;
        align-items: start;
        padding: 10px 0 10px 0;
        animation: co-tl-in .38s cubic-bezier(.22,1,.36,1) both;
      }
      @keyframes co-tl-in {
        from { opacity:0; transform: translateX(-14px); }
        to   { opacity:1; transform: translateX(0); }
      }

      /* Colonne gauche : round + icône */
      .co-tl-left {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        position: relative;
        z-index: 1;
      }
      .co-tl-round {
        font-family: 'Cinzel', serif;
        font-size: .58rem;
        letter-spacing: .12em;
        color: rgba(255,255,255,.35);
        text-transform: uppercase;
      }
      .co-tl-icon-wrap {
        width: 36px; height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        border: 2px solid;
        background: #0f1117;
        flex-shrink: 0;
      }

      /* Colonne droite : contenu */
      .co-tl-right {
        padding-top: 2px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      /* Ligne d'identité : QUI fait QUOI */
      .co-tl-headline {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .co-tl-who {
        font-family: 'Cinzel', serif;
        font-size: .82rem;
        font-weight: 900;
        letter-spacing: .06em;
        padding: 1px 8px;
        border-radius: 4px;
      }
      .co-tl-who.player {
        background: rgba(125,255,178,.12);
        color: #7dffb2;
        border: 1px solid rgba(125,255,178,.25);
      }
      .co-tl-who.enemy {
        background: rgba(255,107,107,.12);
        color: #ff6b6b;
        border: 1px solid rgba(255,107,107,.25);
      }
      .co-tl-action-label {
        font-family: 'Cinzel', serif;
        font-size: .7rem;
        font-weight: 700;
        letter-spacing: .1em;
      }

      /* Nom du coup spécial */
      .co-tl-special-name {
        font-family: 'Cinzel', serif;
        font-size: .75rem;
        font-style: italic;
        color: rgba(255,255,255,.55);
        padding-left: 2px;
      }

      /* Barre de dégâts */
      .co-tl-dmg-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .co-tl-dmg-bar-track {
        flex: 1;
        height: 6px;
        background: rgba(255,255,255,.07);
        border-radius: 999px;
        overflow: hidden;
      }
      .co-tl-dmg-bar-fill {
        height: 100%;
        border-radius: 999px;
        transition: width .7s cubic-bezier(.22,1,.36,1);
      }
      .co-tl-dmg-value {
        font-family: 'Cinzel', serif;
        font-size: .82rem;
        font-weight: 900;
        min-width: 44px;
        text-align: right;
        flex-shrink: 0;
      }

      /* Séparateur fin entre entries */
      .co-tl-entry + .co-tl-entry {
        border-top: 1px solid rgba(255,255,255,.05);
      }

      /* Cas vide */
      .co-tl-empty {
        font-family: 'Cinzel', serif;
        font-size: .82rem;
        color: rgba(255,255,255,.3);
        text-align: center;
        padding: 24px 0;
        font-style: italic;
      }

      /* Header de section */
      .co-log-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(255,255,255,.08);
        margin-bottom: 4px;
      }
      .co-log-header-title {
        font-family: 'Cinzel', serif;
        font-size: .78rem;
        font-weight: 700;
        letter-spacing: .18em;
        color: rgba(255,255,255,.6);
        text-transform: uppercase;
      }
      .co-log-header-count {
        font-family: 'Cinzel', serif;
        font-size: .65rem;
        letter-spacing: .1em;
        color: rgba(255,255,255,.25);
      }
    `;
    document.head.appendChild(ext);
  }

  /* ── Construction du HTML de la timeline ── */
  let timelineHtml = "";

  if (keyEvents.length === 0) {
    timelineHtml = `<div class="co-tl-empty">No notable events — a balanced, steady fight.</div>`;
  } else {
    keyEvents.forEach((e, i) => {
      const who      = e.attacker === "P" ? "player" : "enemy";
      const whoLabel = e.attacker === "P" ? "YOU" : "ENEMY";
      const cfg      = ACTION_CFG[e.action] || ACTION_CFG.normal;
      const delay    = i * 0.09;

      /* Barre de dégâts proportionnelle */
      const dmgPct   = e.dmg > 0 ? Math.round((e.dmg / maxDmgInLog) * 100) : 0;
      const barColor = e.attacker === "P"
        ? "linear-gradient(90deg,#7dffb2,#28c970)"
        : "linear-gradient(90deg,#ff6b6b,#cc1111)";

      /* Description secondaire selon action */
      let subLine = "";
      if (e.action === "special" && e.specialName) {
        subLine = `<div class="co-tl-special-name">"${e.specialName}"</div>`;
      } else if (e.action === "dodge") {
        subLine = `<div class="co-tl-special-name">Attack completely evaded</div>`;
      } else if (e.action === "stunned") {
        subLine = `<div class="co-tl-special-name">Turn skipped — cannot act</div>`;
      }

      /* Bloc dégâts (masqué si 0) */
      const dmgBlock = e.dmg > 0 ? `
        <div class="co-tl-dmg-row">
          <div class="co-tl-dmg-bar-track">
            <div class="co-tl-dmg-bar-fill"
                 id="co-bar-${i}"
                 style="width:0%; background:${barColor};">
            </div>
          </div>
          <span class="co-tl-dmg-value" style="color:${cfg.color};">
            ${e.dmg} dmg
          </span>
        </div>
      ` : "";

      timelineHtml += `
        <div class="co-tl-entry" style="animation-delay:${delay}s">

          <!-- Gauche : round + icône -->
          <div class="co-tl-left">
            <span class="co-tl-round">R${e.round}</span>
            <div class="co-tl-icon-wrap"
                 style="border-color:${cfg.color}33; box-shadow:0 0 10px ${cfg.color}22;">
              ${cfg.icon}
            </div>
          </div>

          <!-- Droite : contenu -->
          <div class="co-tl-right">
            <div class="co-tl-headline">
              <span class="co-tl-who ${who}">${whoLabel}</span>
              <span class="co-tl-action-label" style="color:${cfg.color};">${cfg.label}</span>
            </div>
            ${subLine}
            ${dmgBlock}
          </div>

        </div>
      `;
    });
  }

  body.innerHTML = `
    <div class="co-log-header">
      <span class="co-log-header-title">⚡ Key Moments</span>
      <span class="co-log-header-count">${keyEvents.length} event${keyEvents.length !== 1 ? "s" : ""} · ${roundsPlayed} rounds</span>
    </div>
    <div class="co-timeline">${timelineHtml}</div>
  `;

  /* Anime les barres de dégâts après render */
  await _delay(60);
  keyEvents.forEach((e, i) => {
    if (e.dmg > 0) {
      const bar = document.getElementById(`co-bar-${i}`);
      const pct = Math.round((e.dmg / maxDmgInLog) * 100);
      if (bar) bar.style.width = pct + "%";
    }
  });

  showBtn("See Result →");
  await _waitForBtn("co-btn-next");
  hideBtn();

  /* ════════════════════════════════════════
     PHASE 4 — Résultat final + Grade
  ════════════════════════════════════════ */
  setStep(3, "Result");

  // console.log(
  //   "%c🏆 FINAL RESULT  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
   //  "color:" + (result === "WIN" ? "#7dffb2" : result === "DRAW" ? "#53b6ff" : "#ff6b6b") + ";font-family:monospace;font-size:12px;font-weight:bold;"
   //);
   //console.log("%c  Result  : " + result, "color:#fff;font-family:monospace;");
   //console.log("%c  Grade   : " + (grade ? grade.grade + " (" + grade.label + ") — score: " + Math.round(hpPctP * 70 + Math.max(0, ((12 - roundsPlayed) / 12) * 30)) + "/100" : "N/A"), "color:#ffd700;font-family:monospace;");
   //console.log("%c  Score   : Player " + combatData.scoreP + "/100   Enemy " + combatData.scoreE + "/100   Δ " + combatData.diff, "color:#53b6ff;font-family:monospace;");
   //console.log("%c            └─ 60% HP restants + 25% dégâts infligés + 15% rapidité", "color:rgba(83,182,255,.55);font-family:monospace;font-size:10px;");
   //console.log("%c  XP      : +" + xpP + " (enemy: +" + xpE + ")", "color:#7dffb2;font-family:monospace;");
  // console.log("%c  Streak  : " + streak, "color:#ffa500;font-family:monospace;");
  // console.log("%c  KO: " + isKO + "  Perfect: " + isPerfect + "  BraveKO: " + isBraveKO, "color:#aaa;font-family:monospace;");
   //console.log(
  //   "%c  HP left  Player %d/%d (%d%%)   Enemy %d/%d (%d%%)",
  //   "color:#aaa;font-family:monospace;",
  //   hpP, maxHpP, Math.round(hpPctP * 100),
  //   hpE, maxHpE, Math.round(hpPctE * 100)
  // );

  let resultTitle = "";
  let resultCls   = "";
  if (result === "WIN") {
    if (isPerfect)    { resultTitle = "✨ PERFECT VICTORY"; resultCls = "win"; }
    else if (isKO)    { resultTitle = "💀 KO VICTORY";      resultCls = "win"; }
    else              { resultTitle = "🏆 VICTORY";          resultCls = "win"; }
  } else if (result === "DRAW") {
    resultTitle = "🌀 DRAW"; resultCls = "draw";
  } else {
    if (isBraveKO)    { resultTitle = "☠️ BRAVE DEFEAT";    resultCls = "lose"; }
    else              { resultTitle = "💀 DEFEAT";            resultCls = "lose"; }
  }

  /* Badges spéciaux */
  let specialBadges = "";
  if (isKO)      specialBadges += `<span class="co-special-badge ko">💀 KO</span>`;
  if (isPerfect) specialBadges += `<span class="co-special-badge perfect">✨ Perfect</span>`;
  if (isBraveKO) specialBadges += `<span class="co-special-badge brave">☠️ Brave</span>`;

  /* Grade */
  const gradeHtml = (result !== "DRAW" && grade)
    ? `<div class="co-grade-badge" style="color:${grade.color};border:1px solid ${grade.color}44;background:${grade.color}11;">
        GRADE <strong style="font-size:1.3em;">${grade.grade}</strong> — ${grade.label}
       </div>`
    : "";

  /* Streak */
  const streakHtml = streak >= 2
    ? `<div class="co-streak-badge">🔥 ${streak} WIN STREAK${streak >= 5 ? " — LEGENDARY!" : streak >= 3 ? " — ON FIRE!" : ""}</div>`
    : "";

  body.innerHTML = `
    <div class="co-result-wrapper">
      <div class="co-result-title ${resultCls}">${resultTitle}</div>

      <div class="co-xp-row">
        <div class="co-xp-card player">
          <span class="co-xp-label">YOUR XP</span>
          <span class="co-xp-value">+${xpP}</span>
        </div>
        <div class="co-xp-card enemy">
          <span class="co-xp-label">ENEMY XP</span>
          <span class="co-xp-value">+${xpE}</span>
        </div>
      </div>

      ${gradeHtml}

      <div class="co-badges-row">
        ${specialBadges}
        ${streakHtml}
      </div>
    </div>
  `;

  showBtn("Close");
  await _waitForBtn("co-btn-next");

  /* ── Fermeture ── */
  overlay.classList.remove("active");
  await _delay(450);
  await updateCombatStats();
}

// Raccourcir adresse
function shortAddress(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

// ================= RECORD COMBAT RESULT =================
async function recordCombatResult(result, overlay = null) {

  const userWallet = window.currentUserAddress;
  if (!userWallet || !db) return false;

  // ================= NORMALIZE =================
  // result est maintenant toujours l'objet complet retourné par weightedWin()
  let combatResult;

  if (typeof result === "object" && result?.result) {
    combatResult = result.result;
  } else {
    combatResult = result;
  }

  if (!["WIN", "LOSS", "DRAW"].includes(combatResult)) {
    combatResult = "LOSS";
  }

  // ================= DOC =================
  const ref     = doc(db, "combatStats", userWallet);
  const docSnap = await getDoc(ref);
  const existing = docSnap.exists() ? docSnap.data() : {};

  // ================= COMPTEURS DE BASE =================
  let wins   = Number(existing.wins   ?? 0);
  let losses = Number(existing.losses ?? 0);
  let draws  = Number(existing.draws  ?? 0);

  if      (combatResult === "WIN")  wins++;
  else if (combatResult === "LOSS") losses++;
  else if (combatResult === "DRAW") draws++;

  const totalCombats = wins + losses + draws;

  // WinRate : draw compte pour 0.5
  const winRate = totalCombats > 0
    ? Number((((wins + draws * 0.5) / totalCombats) * 100).toFixed(2))
    : 0;

  // ================= STATS ÉTENDUES RPG =================
  let kos        = Number(existing.kos        ?? 0);
  let perfects   = Number(existing.perfects   ?? 0);
  let braveKOs   = Number(existing.braveKOs   ?? 0);
  let totalXP    = Number(existing.totalXP    ?? 0);
  let bestStreak = Number(existing.bestStreak ?? 0);

  if (typeof result === "object") {
    if (result.isKO)      kos++;
    if (result.isPerfect) perfects++;
    if (result.isBraveKO) braveKOs++;
    totalXP += (result.xpP || 0);
    if ((result.streak || 0) > bestStreak) bestStreak = result.streak;
  }

  // =====================================================
  // MATCH — données alignées sur le nouveau système RPG
  // =====================================================
  const playerNft = window.selectedCombatNft || {};
  const enemyNft  = window.enemyCombatNft    || {};

  const match = {

    matchId:      `match_${Date.now()}`,
    result:       combatResult,
    at:           Date.now(),
    readableDate: new Date().toLocaleString("fr-FR"),

    // ── Combat metadata ──────────────────────────────
    roundsPlayed:  result?.roundsPlayed  ?? null,
    isKO:          result?.isKO          ?? false,
    isPerfect:     result?.isPerfect     ?? false,
    isBraveKO:     result?.isBraveKO     ?? false,
    grade:         result?.grade?.grade  ?? null,
    streak:        result?.streak        ?? 0,
    typeAdvLabel:  result?.typeAdvLabel  ?? null,

    // ── Player ───────────────────────────────────────
    player: {
      nftName:    playerNft.name                       ?? null,
      nonce:      playerNft.nonce                      ?? null,
      identifier: playerNft.identifier                 ?? null,
      category:   result?.playerCat                    ?? null,
      hpFinal:    result?.hpP                          ?? null,
      hpMax:      result?.maxHpP                       ?? null,
      hpPct:      result?.hpPctP != null
                    ? Number((result.hpPctP * 100).toFixed(1))
                    : null,
      xp:         result?.xpP                          ?? null,
      isSeer:     SEER_IDS.has(Number(playerNft.nonce))
    },

    // ── Enemy ────────────────────────────────────────
    enemy: {
      nftName:    enemyNft.name                        ?? null,
      nonce:      enemyNft.nonce                       ?? null,
      identifier: enemyNft.identifier                  ?? null,
      category:   result?.enemyCat                     ?? null,
      hpFinal:    result?.hpE                          ?? null,
      hpMax:      result?.maxHpE                       ?? null,
      hpPct:      result?.hpPctE != null
                    ? Number((result.hpPctE * 100).toFixed(1))
                    : null,
      xp:         result?.xpE                          ?? null,
      isSeer:     SEER_IDS.has(Number(enemyNft.nonce))
    }
  };

  // =====================================================
  // PAYLOAD FIRESTORE
  // =====================================================
  const payload = {

    walletAddress: userWallet,

    // ── Compteurs ────────────────────────────────────
    wins,
    losses,
    draws,
    totalCombats,
    winRate,

    // ── Stats RPG ────────────────────────────────────
    kos,
    perfects,
    braveKOs,
    totalXP,
    bestStreak,

    // ── Timestamps ───────────────────────────────────
    updatedAt:        Date.now(),
    updatedAtReadable: new Date().toLocaleString("fr-FR"),

    // ── Dernier combat (accès rapide) ─────────────────
    lastCombat: {
      result:      combatResult,
      at:          Date.now(),
      readableDate: new Date().toLocaleString("fr-FR"),
      playerCat:   result?.playerCat  ?? null,
      enemyCat:    result?.enemyCat   ?? null,
      isKO:        result?.isKO       ?? false,
      isPerfect:   result?.isPerfect  ?? false,
      grade:       result?.grade?.grade ?? null,
      xpEarned:    result?.xpP        ?? 0
    },

    // ── Historique complet ────────────────────────────
    matches: arrayUnion(match)
  };

  // ================= SAVE =================
  await setDoc(ref, payload, { merge: true });

  // ================= UI =================
  if (overlay) {
    setTimeout(async () => {
      overlay.classList.remove("active");
      await new Promise(r => setTimeout(r, 600));
      await updateCombatStats();
    }, 4800);
  }

  return true;
}

/* ================= UPDATE COMBAT STATS ================= */
async function updateCombatStats() {

  const tbody =
    document.getElementById("combatStatsBody");

  if (!tbody) return;

  tbody.innerHTML = "";

  try {

    const snapshot =
      await getDocs(
        collection(db, "combatStats")
      );

    const entries = [];

    snapshot.forEach(docSnap => {

      const d = docSnap.data();

      // ================= SAFE VALUES =================
      const wins =
        Math.max(0, Number(d.wins || 0));

      const losses =
        Math.max(0, Number(d.losses || 0));

      const draws =
        Math.max(0, Number(d.draws || 0));

      const total =
        wins + losses + draws;

      // ================= WINRATE =================
      let winRate = 0;

      if (total > 0) {

        // 🔥 draw compte pour 0.5
        winRate =
          (
            (wins + (draws * 0.5))
            / total
          ) * 100;
      }

      // ================= DETECT ANOMALY =================
      const isCorrupted =

        wins < 0 ||
        losses < 0 ||
        draws < 0 ||
        !Number.isFinite(winRate);

      // ================= REWARDS =================
      const rewards =
        (wins * 14) +
        (draws * 2);

      entries.push({

        addr: docSnap.id,

        wins,
        losses,
        draws,

        total,

        winRate,

        rewards,

        kos:        Math.max(0, Number(d.kos        || 0)),
        perfects:   Math.max(0, Number(d.perfects   || 0)),
        totalXP:    Math.max(0, Number(d.totalXP    || 0)),
        bestStreak: Math.max(0, Number(d.bestStreak || 0)),

        corrupted:
          isCorrupted
      });
    });

    // =====================================================
    // 🔥 SORTING IMPORTANT
    // =====================================================
    // PRIORITÉ :
    //
    // 1. PLUS DE VICTOIRES
    // 2. MEILLEUR WINRATE
    // 3. MOINS DE DÉFAITES
    // 4. PLUS DE COMBATS
    // =====================================================

    entries.sort((a, b) => {

      // 🔥 priorité absolue aux wins
      if (b.wins !== a.wins) {

        return b.wins - a.wins;
      }

      // 🔥 ensuite meilleur winrate
      if (b.winRate !== a.winRate) {

        return b.winRate - a.winRate;
      }

      // 🔥 moins de défaites
      if (a.losses !== b.losses) {

        return a.losses - b.losses;
      }

      // 🔥 activité
      return b.total - a.total;
    });

    // ================= RENDER =================
    entries.forEach((e, i) => {

      const tr =
        document.createElement("tr");

      if (
        e.addr ===
        window.currentUserAddress
      ) {

        tr.classList.add(
          "current-user"
        );
      }

      if (e.corrupted) {

        tr.classList.add(
          "warning-row"
        );
      }

      const rankClass =
        i < 3
          ? `rank-${i + 1}`
          : "";

      // Grade global basé sur winRate + KOs
      const gradeScore = e.winRate * 0.6 + Math.min(e.kos * 5, 30) + Math.min(e.perfects * 8, 20);
      const globalGrade = COMBAT_GRADES.find(g => gradeScore >= g.min) || COMBAT_GRADES[COMBAT_GRADES.length - 1];

      tr.innerHTML = `
        <td class="${rankClass}">
          ${i + 1}
        </td>

        <td title="${e.addr}">
          ${shortAddress(e.addr)}
        </td>

        <td>${e.wins}</td>

        <td>${e.losses}</td>

        <td>${e.draws}</td>

        <td>
          ${e.winRate.toFixed(2)}%
        </td>

        <td>${e.kos}</td>

        <td>${e.perfects}</td>

        <td>🔥 ${e.bestStreak}</td>

        <td>${e.totalXP.toLocaleString()}</td>

        <td style="color:${globalGrade.color};font-weight:900;font-family:'Cinzel',serif;">${globalGrade.grade}</td>

        <td>${e.rewards}</td>
      `;

      tbody.appendChild(tr);
    });

  } catch (err) {

    console.error(
      "❌ Leaderboard error:",
      err
    );
  }
}


function disableCombatArena() {
  const arena = document.getElementById("combatArena");
  if (!arena) return;

  arena.classList.add("arena-disabled");
  document.getElementById("startCombatBtn").disabled = true;
}

function enableCombatArena() {
  const arena = document.getElementById("combatArena");
  if (!arena) return;

  arena.classList.remove("arena-disabled");
}




function getNftId(nft) {
  if (!nft?.collection || nft.nonce === undefined) return null;
  return `${nft.collection}-${nft.nonce}`;
}

async function loadCooldownsFromFirebase() {

  const wallet = window.currentUserAddress;

  if (!wallet) {
    console.warn("❌ No wallet");
    return;
  }

 // console.log("🔥 Loading Firebase cooldowns...");

  const ref = doc(
    db,
    "combatCooldowns",
    wallet
  );

  const snap = await getDoc(ref);

  nftCooldowns.clear();

  if (!snap.exists()) {

    //console.log(
   //   "🧊 No cooldown document found"
  //  );

    return;
  }

  const data = snap.data();

 // console.log(
 //   "📦 RAW FIREBASE COOLDOWNS:",
 //   data
  //);

  const cooldownData =
    data.cooldowns ||
    data.nftCooldowns ||
    data ||
    {};

 // console.log(
  //  "📦 Parsed cooldownData:",
  //  cooldownData
 // );

  const now = Date.now();

  Object.entries(cooldownData).forEach(
    ([nftId, value]) => {

     // console.log(
    // //   "🔍 Checking:",
     //   nftId,
      //  value
     // );

      // 🔥 FIX IMPORTANT
      // support :
      // { ts: 123456 }
      // ou timestamp direct

      const timestamp =
        typeof value === "object"
          ? Number(value.ts)
          : Number(value);

    //  console.log(
    //    "⏱️ Parsed timestamp:",
   //     timestamp
     // );

      // invalid
      if (isNaN(timestamp)) {

     //   console.warn(
     //    "❌ Invalid timestamp for",
      //    nftId
      //  );

        return;
      }

      const elapsed =
        now - timestamp;

      const remaining =
        COOLDOWN_MS - elapsed;

     // console.log("🕒 Timing:", {
     //   elapsed,
     //   remaining
    //  });

      // cooldown expiré
      if (elapsed >= COOLDOWN_MS) {

       // console.log(
       //   "⌛ Cooldown expired:",
       //   nftId
      //  );

        return;
      }

      nftCooldowns.set(
        nftId,
        timestamp
      );

      //console.log(
     //   "✅ Cooldown restored:",
     //   nftId
     // );
    }
  );

  //console.log(
  //  "🧊 Final cooldown count:",
  //  nftCooldowns.size
 // );

  updateCombatCounter();
}


async function saveCooldownToFirebase(address, nft) {
  const nftId = getNftId(nft);
  if (!nftId) {
    console.error("❌ NFT ID introuvable", nft);
    return;
  }

  const ts = Date.now();

	await setDoc(
	  doc(db, "combatCooldowns", address),
	  {
		[nftId]: {
		  ts: ts,
		  readable: new Date(ts).toLocaleString("fr-FR")
		}
	  },
	  { merge: true }
	);

  // 🔥 mettre à jour la Map locale
  nftCooldowns.set(nftId, ts);

  //console.log("🧊 Cooldown sauvegardé:", nftId);
}

// ================= CHALLENGE CONFIG =================

// ================= CHALLENGE CONFIG =================
// Valeurs par défaut (fallback si Firestore indisponible)
let CHALLENGE_CONFIG = {
  enabled: true,
  name:    "Arena Season I",
  startAt: new Date("2026-06-10T12:00:00Z").getTime(),
  endAt:   new Date("2026-06-17T18:00:00Z").getTime()
};

// ── Chargement Firestore ──
// Document : challengeConfig/current
// Champs   : enabled (bool), name (string),
//            startAt (ISO string ou timestamp ms),
//            endAt   (ISO string ou timestamp ms)
async function loadChallengeConfig() {
  try {
    const ref  = doc(db, "challengeConfig", "current");
    const snap = await getDoc(ref);

    if (snap.exists()) {
      const d = snap.data();

      CHALLENGE_CONFIG = {
        enabled: d.enabled ?? false,
        name:    d.name    ?? "Arena Season",

        // Accepte ISO string "2026-06-01T17:00:00Z" OU timestamp ms
        startAt: typeof d.startAt === "string"
          ? new Date(d.startAt).getTime()
          : Number(d.startAt ?? 0),

        endAt: typeof d.endAt === "string"
          ? new Date(d.endAt).getTime()
          : Number(d.endAt ?? 0)
      };

      //console.log(
       // "%c⚔️ Challenge config loaded from Firestore:",
      //  "color:#5cffa0;font-family:monospace;font-weight:bold;"
     // );
     // console.table({
     //   enabled: CHALLENGE_CONFIG.enabled,
     //   name:    CHALLENGE_CONFIG.name,
     //  startAt: new Date(CHALLENGE_CONFIG.startAt).toISOString(),
      //  endAt:   new Date(CHALLENGE_CONFIG.endAt).toISOString()
     // });

    } else {

      // ── Document absent : on l'initialise avec les valeurs par défaut ──
      // Il apparaîtra alors dans Firebase Console et sera éditable
      const defaults = {
        enabled:   CHALLENGE_CONFIG.enabled,
        name:      CHALLENGE_CONFIG.name,
        startAt:   new Date(CHALLENGE_CONFIG.startAt).toISOString(),
        endAt:     new Date(CHALLENGE_CONFIG.endAt).toISOString(),
        createdAt: new Date().toISOString(),
        note:      "Editable from Firebase Console — modify startAt/endAt/enabled/name"
      };

      await setDoc(ref, defaults);

     // console.log(
     //   "%c⚔️ challengeConfig/current created in Firestore with defaults",
     //   "color:#ffd700;font-family:monospace;font-weight:bold;"
     // );
      console.table(defaults);
    }
  } catch (err) {
    console.warn("⚠️ Failed to load challenge config:", err);
  }
}

function getChallengeStatus() {

  const now = Date.now();

  if (!CHALLENGE_CONFIG.enabled) {
    return "DISABLED";
  }

  if (now < CHALLENGE_CONFIG.startAt) {
    return "BEFORE";
  }

  if (now > CHALLENGE_CONFIG.endAt) {
    return "ENDED";
  }

  return "ACTIVE";
}

function getRemainingTime(ms) {

  if (ms <= 0) {
    return "00d 00h 00m 00s";
  }

  const days =
    Math.floor(ms / 86400000);

  const hours =
    Math.floor((ms % 86400000) / 3600000);

  const minutes =
    Math.floor((ms % 3600000) / 60000);

  const seconds =
    Math.floor((ms % 60000) / 1000);

  return (
    `${days.toString().padStart(2, "0")}d ` +
    `${hours.toString().padStart(2, "0")}h ` +
    `${minutes.toString().padStart(2, "0")}m ` +
    `${seconds.toString().padStart(2, "0")}s`
  );
}
function startChallengeCountdown() {

  const el =
    document.getElementById(
      "challengeCountdown"
    );

  if (!el) return;

  const update = () => {

    const status =
      getChallengeStatus();

    const now =
      Date.now();

    // ================= BEFORE =================

    if (status === "BEFORE") {

      const remaining =
        CHALLENGE_CONFIG.startAt - now;

      el.innerHTML = `
        🕒 Starts in<br>
        <span class="challenge-time">
          ${getRemainingTime(remaining)}
        </span>
      `;

      // Griser la zone comme quand le challenge est terminé
      lockCombatSection(
        "⏳ Challenge Not Started",
        `${CHALLENGE_CONFIG.name || "Arena Season"} — starts in ${getRemainingTime(remaining)}`
      );

      return;
    }

    // ================= ACTIVE =================
    // Déverrouiller si le challenge vient de démarrer (transition BEFORE → ACTIVE)
    unlockCombatSection();

    if (status === "ACTIVE") {

      const remaining =
        CHALLENGE_CONFIG.endAt - now;

      el.innerHTML = `
        ⚔️ Challenge Ends In<br>
        <span class="challenge-time">
          ${getRemainingTime(remaining)}
        </span>
      `;

      return;
    }

    // ================= ENDED =================

    el.innerHTML = `This season has ended. Stay tuned for the next one.`;
    lockCombatSection("🏆 Challenge Finished");

  };

  // DISABLED
  if (getChallengeStatus() === "DISABLED") {
    lockCombatSection("⛔ No Active Challenge", "No challenge is currently running.");
  }

  update();
  setInterval(update, 1000);
}

/* ── Grise et bloque toute la section combat ── */
function lockCombatSection(title, subtitle) {
  const arena  = document.getElementById("combatArena");
  const select = document.getElementById("combatSelect");
  const btn    = document.getElementById("startCombatBtn");

  if (arena)  arena.classList.add("arena-disabled");
  if (select) select.classList.add("arena-disabled");
  if (btn)    { btn.disabled = true; btn.textContent = "⛔ Challenge Ended"; }

  // Banner si pas déjà présent
  const wrap = document.getElementById("combatTabContent");
  if (wrap && !wrap.querySelector(".challenge-lock-banner")) {
    const banner = document.createElement("div");
    banner.className = "challenge-lock-banner";
    banner.innerHTML = `
      <div class="clb-icon">🏆</div>
      <div class="clb-title">${title}</div>
      <div class="clb-sub">${subtitle}</div>
    `;
    const header = wrap.querySelector(".other-coll-header");
    if (header) header.after(banner);
    else wrap.prepend(banner);
  }
}

/* ── Déverrouille (nouveau season) ── */
function unlockCombatSection() {
  const arena  = document.getElementById("combatArena");
  const select = document.getElementById("combatSelect");
  const btn    = document.getElementById("startCombatBtn");

  if (arena)  arena.classList.remove("arena-disabled");
  if (select) select.classList.remove("arena-disabled");
  if (btn)    { btn.disabled = false; btn.textContent = "⚔️ Start Battle"; }

  document.querySelectorAll(".challenge-lock-banner").forEach(b => b.remove());
}

/* ========= Animation ========= */
const isMobile = window.innerWidth < 768;
const SNOW_COUNT = isMobile ? 12 : 30; // 🔥 énorme gain perf

function createSnow() {
  if (document.querySelector(".snow-container")) return;

  const snowContainer = document.createElement("div");
  snowContainer.className = "snow-container";
  document.body.appendChild(snowContainer);

  const symbols = ["ᚠ", "ᚦ", "ᚨ", "ᛉ", "✧"]; // runes + léger

  for (let i = 0; i < SNOW_COUNT; i++) {
    const flake = document.createElement("div");
    flake.className = "snowflake";

    flake.style.left = Math.random() * 100 + "vw";
    flake.style.setProperty(
      "--drift",
      Math.random() * 30 - 15 + "px" // drift doux
    );

    flake.style.animationDuration =
      (isMobile ? 14 : 10) + Math.random() * 10 + "s";

    flake.style.animationDelay = Math.random() * 10 + "s";

    flake.textContent =
      symbols[Math.floor(Math.random() * symbols.length)];

    snowContainer.appendChild(flake);
  }
}
document.addEventListener("visibilitychange", () => {
  const snow = document.querySelector(".snow-container");
  if (!snow) return;

  snow.style.display = document.hidden ? "none" : "block";
});


  createSnow();
  resetUI();
  loadRandomOdinsPreview();

  // Charge la config depuis Firestore PUIS démarre le countdown
  loadChallengeConfig().then(() => {
    startChallengeCountdown();
  });
  
});

