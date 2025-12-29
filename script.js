<div id="status">❌ Non connecté</div>
<div id="address"></div>
<button id="connectBtn">Connect Wallet</button>

<script type="module">
import { WalletConnectProvider } from "@multiversx/sdk-wallet-connect-provider";

let provider;

document.getElementById("connectBtn").addEventListener("click", connectWallet);

async function connectWallet() {
    const status = document.getElementById("status");
    status.innerText = "🔄 Connexion en cours...";

    try {
        provider = new WalletConnectProvider({
            projectId: "multiversx-dapp",
            chainId: "1", // Mainnet. Pour testnet : "T"
        });

        // Initialise le provider
        await provider.init();

        // Ouvre le QR code / wallet modal
        const loginResult = await provider.login();

        if (!loginResult) {
            status.innerText = "❌ Connexion annulée ou échouée";
            return;
        }

        const address = await provider.getAddress();
        document.getElementById("address").innerText =
            "🟢 Wallet connecté : " + address;
        status.innerText = "✅ Connexion réussie";

    } catch (err) {
        console.error(err);
        status.innerText = "❌ Erreur : " + err.message;
    }
}
</script>
