let provider;

    async function connectWallet() {
        const status = document.getElementById("status");
        const addressEl = document.getElementById("address");

        status.innerText = "🔄 Connexion au wallet...";
        addressEl.innerText = "";

        try {
            const walletConnectBridge = "https://bridge.walletconnect.org";
            const chainId = "1"; // Mainnet | D = Devnet | T = Testnet

            provider = new window.MultiversXWalletConnectProvider.WalletConnectProvider(
                walletConnectBridge,
                {
                    projectId: "odinverse-dapp",
                    chainId: chainId
                }
            );

            const initialized = await provider.init();

            if (!initialized) {
                status.innerText = "❌ Impossible d'initialiser WalletConnect";
                return;
            }

            await provider.login(); // ➜ QR code xPortal

            const address = await provider.getAddress();

            status.innerText = "✅ Wallet connecté";
            addressEl.innerText = "🟢 Adresse : " + address;

            localStorage.setItem("mx_wallet", address);

        } catch (err) {
            console.error(err);
            status.innerText = "❌ Connexion annulée ou erreur wallet";
        }
    }