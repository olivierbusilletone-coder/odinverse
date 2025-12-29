import { WalletConnectProvider } from "https://cdn.jsdelivr.net/npm/@multiversx/sdk-wallet-connect-provider/out/walletConnectProvider.esm.js";

let provider;

const connectBtn = document.getElementById("connectBtn");
const status = document.getElementById("status");
const addressEl = document.getElementById("address");

connectBtn.addEventListener("click", connectWallet);

async function connectWallet() {
    status.innerText = "🔄 Connexion en cours...";

    try {
        // Initialisation du provider WalletConnect
        provider = new WalletConnectProvider({
            projectId: "multiversx-dapp",
            chainId: "1" // Mainnet, utiliser "T" pour Testnet
        });

        await provider.init(); // prépare le QR code

        const loginResult = await provider.login(); // ouvre le modal / QR code

        if (!loginResult) {
            status.innerText = "❌ Connexion annulée ou échouée";
            return;
        }

        const address = await provider.getAddress();
        addressEl.innerText = "🟢 Wallet connecté : " + address;
        status.innerText = "✅ Connexion réussie";

    } catch (err) {
        console.error(err);
        status.innerText = "❌ Erreur : " + err.message;
    }
}

// Fonction mint temporaire
window.mint = function() {
    if (!provider) {
        alert("Connecte ton wallet d'abord !");
        return;
    }
    alert("Mint NFT lancé (simulation) 🚀");
};
