const { WebSocket } = require('ws');
const Currency = require('./Currency');
const { AssetUpdates } = require('./AssetUpdates');
const { WalletDescriptor } = require('./WalletDescriptor');
const { fetchPublicConfig } = require('./configUtils');

class BaseAssetManager {
    /**
     * @param {any} wallet
     * @param {string} [baseUrl]
     */
    constructor(wallet, baseUrl) {
        this.baseUrl = baseUrl ? baseUrl.replace(/^http/, 'ws') : undefined;
        this.wallet = wallet;
    }

    async _resolveBaseUrl() {
        if (this.baseUrl) return;
        const config = await fetchPublicConfig();
        const rootUrl = config.ROOT_API_ADMIN_URL;
        if (!rootUrl) {
            throw new Error("ROOT_API_ADMIN_URL not found in public config");
        }
        this.baseUrl = rootUrl.replace(/^http/, 'ws');
    }

    /**
     * Abstract method to handle protocol-specific signing
     * @protected
     * @returns {Promise<any>}
     */
    async _performSigning(typedData, walletDescriptor) {
        throw new Error("_performSigning must be implemented by subclass");
    }

    async _handleAuth(ws, message, walletDescriptor) {
        if (message.schema === 'api_admin_gateway_message_to_be_signed') {
            const { message: typedData } = message;
            const authResponse = await this._performSigning(typedData, walletDescriptor);
            ws.send(JSON.stringify(authResponse));
            return true;
        }
        return false;
    }

    /**
     * @param {WalletDescriptor} walletDescriptor
     * @param {Currency} currency
     */
    async createAsset(walletDescriptor, currency) {
        await this._resolveBaseUrl();
        if (!(walletDescriptor instanceof WalletDescriptor)) {
            throw new Error('walletDescriptor must be an instance of WalletDescriptor');
        }
        if (!(currency instanceof Currency)) {
            throw new Error('currency must be an instance of Currency');
        }

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${this.baseUrl}/create`);

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    owner: walletDescriptor.toJson(),
                    currency: {
                        code: currency.code,
                        scale: currency.scale,
                        issuer: currency.tokenAddress
                    }
                }));
            });

            ws.on('message', async (data) => {
                const message = JSON.parse(data.toString());

                try {
                    if (await this._handleAuth(ws, message, walletDescriptor)) {
                        return;
                    }

                    if (message.schema === 'api_admin_gateway_request_wallet_json') {
                        ws.send(JSON.stringify({
                            schema: 'api_admin_gateway_wallet_json_response',
                            wallet: walletDescriptor.toJson()
                        }));
                    } else if (message.schema === 'api_admin_gateway_create_successful') {
                        resolve(message);
                        ws.close();
                    } else if (message.qr_code_url) {
                        console.log('Scan this QR code to authenticate:', message.qr_code_url);
                    } else if (message.error) {
                        reject(new Error(message.error));
                        ws.close();
                    }
                } catch (err) {
                    reject(err);
                    ws.close();
                }
            });

            ws.on('error', (error) => {
                reject(error);
            });

            ws.on('close', (code, reason) => {
                if (code !== 1000 && code !== 1005) {
                    reject(new Error(`WebSocket closed with code ${code}: ${reason}`));
                }
            });
        });
    }

    /**
     * @param {string} dhaliId
     * @param {WalletDescriptor} walletDescriptor
     * @param {AssetUpdates} updates
     */
    async updateAsset(dhaliId, walletDescriptor, updates) {
        await this._resolveBaseUrl();
        if (!(walletDescriptor instanceof WalletDescriptor)) {
            throw new Error('walletDescriptor must be an instance of WalletDescriptor');
        }
        if (!(updates instanceof AssetUpdates)) {
            throw new Error('updates must be an instance of AssetUpdates');
        }

        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${this.baseUrl}/${dhaliId}/update`);

            ws.on('message', async (data) => {
                const message = JSON.parse(data.toString());

                try {
                    if (await this._handleAuth(ws, message, walletDescriptor)) {
                        return;
                    }

                    if (message.schema === 'api_admin_gateway_request_wallet_json') {
                        ws.send(JSON.stringify({
                            schema: 'api_admin_gateway_wallet_json_response',
                            wallet: walletDescriptor.toJson()
                        }));
                    } else if (message.schema === 'api_admin_gateway_authentication_successful') {
                        ws.send(JSON.stringify({
                            schema: 'api_admin_gateway_prefill_request',
                            schema_version: '1.0'
                        }));
                    } else if (message.schema === 'api_admin_gateway_prefill_response') {
                        ws.send(JSON.stringify({
                            schema: 'api_admin_gateway_update_request',
                            schema_version: '1.0',
                            updates: updates.toGatewayFormat()
                        }));
                    } else if (message.schema === 'api_admin_gateway_update_response') {
                        resolve(message);
                        ws.close();
                    } else if (message.qr_code_url) {
                        console.log('Scan this QR code to authenticate:', message.qr_code_url);
                    } else if (message.error || message.status === 'failed') {
                        reject(new Error(message.error || 'Update failed'));
                        ws.close();
                    }
                } catch (err) {
                    reject(err);
                    ws.close();
                }
            });

            ws.on('error', (error) => {
                reject(error);
            });

            ws.on('close', (code, reason) => {
                if (code !== 1000 && code !== 1005) {
                    reject(new Error(`WebSocket closed with code ${code}: ${reason}`));
                }
            });
        });
    }
}

module.exports = { BaseAssetManager };
