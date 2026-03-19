const { BaseAssetManager } = require('./BaseAssetManager');

/**
 * DhaliAssetManager for EVM protocol.
 */
class DhaliEthAssetManager extends BaseAssetManager {
    /**
     * @param {import("viem").WalletClient} walletClient
     * @param {string} [baseUrl]
     */
    constructor(walletClient, baseUrl) {
        super(walletClient, baseUrl);
    }

    /**
     * @protected
     */
    async _performSigning(typedData, walletDescriptor) {
        const [account] = await this.wallet.getAddresses();
        const signature = await this.wallet.signTypedData({
            account: this.wallet.account || account,
            domain: typedData.domain,
            types: typedData.types,
            primaryType: typedData.primaryType,
            message: typedData.message
        });

        return {
            schema: 'api_admin_gateway_signed_message_response',
            signature: signature
        };
    }
}

module.exports = { DhaliEthAssetManager };
