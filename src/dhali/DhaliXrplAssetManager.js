const { BaseAssetManager } = require('./BaseAssetManager');
const { sign: signClaim } = require("ripple-keypairs");

/**
 * DhaliAssetManager for XRPL protocol.
 */
class DhaliXrplAssetManager extends BaseAssetManager {
    /**
     * @param {import("xrpl").Wallet} wallet
     * @param {string} [baseUrl]
     */
    constructor(wallet, baseUrl) {
        super(wallet, baseUrl);
    }

    /**
     * @protected
     */
    async _performSigning(typedData, walletDescriptor) {
        // The backend expects the message as a JSON string for XRPL
        const messageToSign = JSON.stringify(typedData);
        const signature = signClaim(Buffer.from(messageToSign).toString('hex'), this.wallet.privateKey);

        return {
            schema: 'api_admin_gateway_signed_message_response',
            signature: signature.toUpperCase(),
            public_key: this.wallet.publicKey
        };
    }
}

module.exports = { DhaliXrplAssetManager };
