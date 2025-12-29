let provider;

async function connectWallet() {
    const status = document.getElementById("status");
    status.innerText = "🔄 Connexion en cours...";

    const walletConnectBridge = "https://bridge.walletconnect.org";
    const chainId = "1"; // Mainnet (D = devnet, T = testnet)

    provider = new window.MultiversXWalletConnectProvider.WalletConnectProvider(
        walletConnectBridge,
        {
            projectId: "multiversx-dapp",
            chainId: chainId
        }
    );

    const isInitialized = await provider.init();

    if (!isInitialized) {
        status.innerText = "❌ Erreur WalletConnect";
        return;
    }

    await provider.login();

    const address = await provider.getAddress();

    document.getElementById("address").innerText =
        "🟢 Wallet connecté : " + address;

    status.innerText = "✅ Connexion réussie";
}
