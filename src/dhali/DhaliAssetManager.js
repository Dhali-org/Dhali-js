const { DhaliXrplAssetManager } = require('./DhaliXrplAssetManager');
const { DhaliEthAssetManager } = require('./DhaliEthAssetManager');

/**
 * Factory for creating asset managers.
 */
const DhaliAssetManager = {
    /**
     * @param {import("xrpl").Wallet} wallet
     * @returns {DhaliXrplAssetManager}
     */
    xrpl: (wallet) => {
        return new DhaliXrplAssetManager(wallet);
    },

    /**
     * @param {import("viem").WalletClient} walletClient
     * @returns {DhaliEthAssetManager}
     */
    evm: (walletClient) => {
        return new DhaliEthAssetManager(walletClient);
    }
};

module.exports = { DhaliAssetManager };
