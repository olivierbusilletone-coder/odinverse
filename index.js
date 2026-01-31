// Import Firebase Functions v2
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const fetch = require("node-fetch"); // nécessaire pour Node.js 18
admin.initializeApp();
const db = admin.firestore();

// ================= UTILS =================
function shortAddress(addr) {
  if (!addr || addr.length < 8) return addr;
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

// ================= TELEGRAM =================
async function sendLeaderboardToTelegram() {
  const BOT_TOKEN = "7823072208:AAFsdaY16cURF83_awbe9UdB528NpkWQLHY";
  const CHAT_ID = "-1002248734729"; // ton supergroup

  // Lecture Firestore
  const snapshot = await db.collection("combatStats").get();
  const entries = [];
  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    entries.push({
      addr: docSnap.id,
      wins: d.wins || 0,
      losses: d.losses || 0
    });
  });

  entries.sort((a, b) => b.wins - a.wins || a.losses - b.losses);

  // Compose message
  let message = "⚔️ *ARENA OF THE IMMORTALS LEADERBOARD* ⚔️\n";
  message += "🔥 Update 🔥\n\n";

  entries.slice(0, 10).forEach((e, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] || "🛡️";
    message += `${medal} *${i + 1}.* ${shortAddress(e.addr)}\n`;
    message += `   ⚔️ Victories: ${e.wins} | 💀 Defeats: ${e.losses}\n`;
    message += "────────────────────────\n";
  });

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    })
  });

  const data = await res.json();
  console.log("Telegram response:", data);
}

// ================= EXPORT FUNCTION =================
exports.sendLeaderboard = onRequest(async (req, res) => {
  try {
    await sendLeaderboardToTelegram();
    res.status(200).send("Leaderboard envoyé sur Telegram !");
  } catch (err) {
    console.error("Erreur Telegram :", err);
    res.status(500).send("Erreur lors de l'envoi du leaderboard.");
  }
});
