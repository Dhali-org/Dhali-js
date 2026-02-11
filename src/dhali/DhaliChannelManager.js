const { DhaliXrplChannelManager } = require("./DhaliXrplChannelManager");
const { DhaliEthChannelManager } = require("./DhaliEthChannelManager");

const DhaliChannelManager = {
  /**
   * @param {import("xrpl").Wallet} wallet
   * @param {import("xrpl").Client} client
   * @param {string} protocol
   * @param {import("./Currency")} currency
   * @param {typeof fetch} [httpClient] - Injected HTTP client
   * @param {object} [publicConfig]
   * @returns {DhaliXrplChannelManager}
   */
  xrpl: (wallet, client, protocol, currency, httpClient, publicConfig) => {
    return new DhaliXrplChannelManager(wallet, client, protocol, currency, httpClient, publicConfig);
  },

  /**
   * @param {import("ethers").Signer} signer
   * @param {import("ethers").Provider} provider
   * @param {string} protocol
   * @param {import("./Currency")} currency
   * @param {typeof fetch} [httpClient] - Injected HTTP client
   * @param {object} [publicConfig]
   * @returns {DhaliEthChannelManager}
   */
  evm: (signer, provider, protocol, currency, httpClient, publicConfig) => {
    return new DhaliEthChannelManager(
      signer,
      provider,
      protocol,
      currency,
      httpClient,
      publicConfig
    );
  }
};

module.exports = { DhaliChannelManager };
