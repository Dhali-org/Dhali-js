const { DhaliXrplChannelManager } = require("./DhaliXrplChannelManager");
const { DhaliEthChannelManager } = require("./DhaliEthChannelManager");

const DhaliChannelManager = {
  /**
   * @param {import("xrpl").Wallet} wallet
   * @param {import("xrpl").Client} client
   * @param {import("./Currency")} currency
   * @param {typeof fetch} [httpClient] - Injected HTTP client
   * @param {object} [publicConfig]
   * @returns {DhaliXrplChannelManager}
   */
  xrpl: (wallet, client, currency, httpClient, publicConfig) => {
    return new DhaliXrplChannelManager(wallet, client, currency, httpClient, publicConfig);
  },

  /**
   * @param {import("viem").WalletClient} walletClient
   * @param {import("viem").PublicClient} publicClient
   * @param {import("./Currency")} currency
   * @param {typeof fetch} [httpClient] - Injected HTTP client
   * @param {object} [publicConfig]
   * @returns {DhaliEthChannelManager}
   */
  evm: (walletClient, publicClient, currency, httpClient, publicConfig) => {
    return new DhaliEthChannelManager(
      walletClient,
      publicClient,
      currency,
      httpClient,
      publicConfig
    );
  }
};

module.exports = { DhaliChannelManager };
