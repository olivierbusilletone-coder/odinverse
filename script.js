function connectWallet() {
    const callbackUrl = encodeURIComponent(window.location.href);
    const webWalletUrl = `https://wallet.multiversx.com/connect?callbackUrl=${callbackUrl}`;

    window.location.href = webWalletUrl;
}
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const address = urlParams.get("address");

    if (address) {
        document.getElementById("walletAddress").innerText =
            "🟢 Wallet connecté : " + address;
    }
};
