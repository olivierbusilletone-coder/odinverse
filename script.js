// script.js
import { WalletConnectProvider } from "https://cdn.jsdelivr.net/npm/@multiversx/sdk-wallet-connect-provider/out/walletConnectProvider.esm.js";

let provider;

window.addEventListener("DOMContentLoaded", () => {
    const connectBtn = document.getElementById("connectBtn");
    const status = document.getElementById("status");
    const addressEl = document.getElementById("address");

    connectBtn.addEventListener("click", async () => {
        status.innerText = "🔄 Connexion en cours...";

        try {
            provider = new WalletConnectProvider({
                projectId: "multiversx-dapp",
                chainId: "1"
            });

            await provider.init();
            const loginResult = await provider.login();

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
    });
});
