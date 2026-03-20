const { Wallet, Client } = require('xrpl');
const { createWalletClient, createPublicClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { sepolia } = require('viem/chains');
const WebSocket = require('ws');
const { DhaliAssetManager } = require('../src/dhali/DhaliAssetManager');
const { DhaliChannelManager } = require('../src/dhali/DhaliChannelManager');
const { WalletDescriptor } = require('../src/dhali/WalletDescriptor');
const Currency = require('../src/dhali/Currency');
const { AssetUpdates } = require('../src/dhali/AssetUpdates');
const { fetchPublicConfig } = require('../src/dhali/configUtils');
const { wrapAsX402PaymentPayload } = require('../src/dhali/utils');

// Secrets from environment variables
const XRPL_SECRET = process.env.XRPL_TESTNET_SECRET;
const SEPOLIA_SECRET = process.env.SEPOLIA_TESTNET_SECRET; // Should be 0x prefixed

function getFacilitatorUrl(publicConfig) {
    const envUrl = process.env.DHALI_FACILITATOR_URL;
    if (envUrl) {
        return envUrl;
    }
    return publicConfig.ROOT_X402_FACILITATOR_URL || "https://x402.api.dhali.io";
}

describe('Dhali-js Comprehensive Integration Tests', () => {
    let publicConfig;

    beforeAll(async () => {
        publicConfig = await fetchPublicConfig();
    });

    test('should perform comprehensive XRPL integration', async () => {
        if (!XRPL_SECRET) {
            console.warn('XRPL_TESTNET_SECRET not set, skipping test');
            return;
        }

        // 1. Setup Wallet and Asset Manager
        const wallet = Wallet.fromSeed(XRPL_SECRET);
        const assetManager = DhaliAssetManager.xrpl(wallet);
        const walletDescriptor = new WalletDescriptor(wallet.classicAddress, "XRPL.TESTNET");
        const currency = new Currency("XRPL.TESTNET", "XRP", 6);

        // 2. Create Asset
        console.log(`\nCreating XRPL asset for wallet: ${wallet.classicAddress}`);
        const createResult = await assetManager.createAsset(walletDescriptor, currency);
        expect(createResult.schema).toBe('api_admin_gateway_create_successful');
        const assetUuid = createResult.uuid;
        console.log(`Asset created with UUID: ${assetUuid}`);

        // 3. Update Asset
        console.log("Updating XRPL asset...");
        const updates = new AssetUpdates({
            name: "Comprehensive Integration Test Asset XRPL",
            earning_rate: 100,
            earning_type: "per_request"
        });
        const updateResult = await assetManager.updateAsset(assetUuid, walletDescriptor, updates);
        expect(updateResult.schema).toBe('api_admin_gateway_update_response');
        console.log("Asset updated successfully");

        // 4. Create Channel (Deposit)
        const client = new Client("wss://s.altnet.rippletest.net:51233");
        await client.connect();
        const channelManager = DhaliChannelManager.xrpl(wallet, client, currency);
        console.log("Performing XRPL deposit...");
        const amountDrops = 1000000; // 1 XRP
        const depositResult = await channelManager.deposit(amountDrops);
        expect(depositResult).toBeDefined();
        console.log("XRPL Deposit successful");

        // 5. Generate Auth Token
        console.log("Generating XRPL auth token...");
        const authToken = await channelManager.getAuthToken();
        expect(authToken).toBeDefined();
        console.log(`XRPL Auth Token generated: ${authToken.substring(0, 20)}...`);

        // 6. Settle via Facilitator using the newly created asset
        console.log(`Settling via facilitator using asset ${assetUuid}...`);
        const facilitatorUrl = getFacilitatorUrl(publicConfig);
        const settleUrl = `${facilitatorUrl}/v2/${assetUuid}/settle`;

        // Use the wrap function as suggested by the user
        const requirements = {
            scheme: "dhali",
            network: "xrpl:1",
            asset: "xrpl:1/native:xrp",
            amount: "100",
            payTo: assetUuid,
            maxTimeoutSeconds: 60
        };
        const requirementsBase64 = Buffer.from(JSON.stringify(requirements)).toString('base64');
        const wrappedBase64 = wrapAsX402PaymentPayload(authToken, requirementsBase64);
        const wrappedPayload = JSON.parse(Buffer.from(wrappedBase64, 'base64').toString());

        const settlePayload = {
            paymentRequirements: requirements,
            paymentPayload: wrappedPayload
        };

        const response = await fetch(settleUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settlePayload)
        });
        expect(response.status).toBe(200);
        const settleResult = await response.json();
        if (!settleResult.success) { console.error("XRPL Facilitator settlement failed:", JSON.stringify(settleResult, null, 2)); }
        expect(settleResult.success).toBe(true);
        console.log("Facilitator settlement successful");

        // 7. Close Channel via WebSockets
        console.log("Closing channel via Admin Gateway...");
        let wsUrl = publicConfig.ROOT_API_ADMIN_URL;
        wsUrl = wsUrl.replace(/^http/, 'ws') + '/ws/close-channel';

        await new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    schema: "api_admin_gateway_closure_request",
                    schema_version: "1.0",
                    wallet: {
                        type: "Dhali-js",
                        address: wallet.classicAddress,
                        protocol: "XRPL.TESTNET",
                        publicKey: wallet.publicKey,
                        currency: {
                            code: "XRP",
                            scale: 6,
                            issuer: null
                        }
                    },
                    protocol: "XRPL.TESTNET",
                    currency: "XRP",
                    issuer: null
                }));
            });

            ws.on('message', async (data) => {
                const msg = JSON.parse(data);
                console.log("WebSocket message received:", JSON.stringify(msg, null, 2));

                if (msg.schema === "api_admin_gateway_message_to_be_signed") {
                    const rippleKeypairs = require('ripple-keypairs');
                    const signature = rippleKeypairs.sign(Buffer.from(JSON.stringify(msg.message, null, 0), 'utf8').toString('hex'), wallet.privateKey);

                    ws.send(JSON.stringify({
                        schema: "api_admin_gateway_signed_message_response",
                        schema_version: "1.1",
                        signature: signature,
                        public_key: wallet.publicKey
                    }));
                } else if (msg.schema === "api_admin_gateway_authentication_successful") {
                    // Wait
                } else if (msg.success) {
                    console.log('Channel closure initiated:', msg.message);
                    ws.close();
                } else if (msg.error) {
                    reject(new Error(msg.error));
                    ws.close();
                }
            });

            ws.on('error', (err) => {
                console.error("WebSocket error (XRPL):", err);
                reject(err);
            });
            ws.on('close', (code, reason) => {
                console.log(`WebSocket closed (XRPL): ${code} ${reason}`);
                resolve();
            });
        });

        await client.disconnect();
    }, 300000);

    test('should perform comprehensive EVM integration', async () => {
        if (!SEPOLIA_SECRET) {
            console.warn('SEPOLIA_TESTNET_SECRET not set, skipping test');
            return;
        }

        // 1. Setup Wallet and Asset Manager
        const account = privateKeyToAccount(SEPOLIA_SECRET);
        const assetManager = DhaliAssetManager.evm(createWalletClient({
            account,
            chain: sepolia,
            transport: http()
        }));
        const walletDescriptor = new WalletDescriptor(account.address, "SEPOLIA");
        const currency = new Currency("SEPOLIA", "ETH", 18);

        // 2. Create Asset
        console.log(`\nCreating EVM asset for wallet: ${account.address}`);
        const createResult = await assetManager.createAsset(walletDescriptor, currency);
        expect(createResult.schema).toBe('api_admin_gateway_create_successful');
        const assetUuid = createResult.uuid;
        console.log(`EVM Asset created with UUID: ${assetUuid}`);

        // 3. Update Asset
        console.log("Updating EVM asset...");
        const updates = new AssetUpdates({
            name: "Comprehensive Integration Test Asset EVM",
            earning_rate: 0.001,
            earning_type: "per_request"
        });
        const updateResult = await assetManager.updateAsset(assetUuid, walletDescriptor, updates);
        expect(updateResult.schema).toBe('api_admin_gateway_update_response');
        console.log("EVM Asset updated successfully");

        // 4. Create Channel (Deposit)
        const walletClient = createWalletClient({
            account,
            chain: sepolia,
            transport: http()
        });
        const publicClient = createPublicClient({
            chain: sepolia,
            transport: http()
        });
        const channelManager = DhaliChannelManager.evm(walletClient, publicClient, currency);
        console.log("Performing EVM deposit...");
        const amountWei = 100000000000000n; // 0.0001 ETH
        const receipt = await channelManager.deposit(amountWei.toString());
        expect(receipt.status).toBe('success');
        console.log("EVM Deposit successful");

        // 5. Generate Auth Token
        console.log("Generating EVM auth token...");
        const authToken = await channelManager.getAuthToken();
        expect(authToken).toBeDefined();
        console.log(`EVM Auth Token generated: ${authToken.substring(0, 20)}...`);

        // 6. Settle via Facilitator using the newly created asset
        console.log(`Settling via facilitator using asset ${assetUuid}...`);
        const facilitatorUrl = getFacilitatorUrl(publicConfig);
        const settleUrl = `${facilitatorUrl}/v2/${assetUuid}/settle`;

        // Use the wrap function as suggested by the user
        const requirements = {
            scheme: "dhali",
            network: "eip155:11155111",
            asset: "eip155:11155111/native:eth",
            amount: "100",
            payTo: assetUuid,
            maxTimeoutSeconds: 60
        };
        const requirementsBase64 = Buffer.from(JSON.stringify(requirements)).toString('base64');
        const wrappedBase64 = wrapAsX402PaymentPayload(authToken, requirementsBase64);
        const wrappedPayload = JSON.parse(Buffer.from(wrappedBase64, 'base64').toString());

        const settlePayload = {
            paymentRequirements: requirements,
            paymentPayload: wrappedPayload
        };

        const response = await fetch(settleUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settlePayload)
        });
        expect(response.status).toBe(200);
        const settleResult = await response.json();
        if (!settleResult.success) { console.error("EVM Facilitator settlement failed:", JSON.stringify(settleResult, null, 2)); }
        expect(settleResult.success).toBe(true);
        console.log("Facilitator settlement successful");

        // 7. Close Channel via WebSockets
        console.log("Closing channel via Admin Gateway...");
        let wsUrl = publicConfig.ROOT_API_ADMIN_URL;
        wsUrl = wsUrl.replace(/^http/, 'ws') + '/ws/close-channel';

        await new Promise((resolve, reject) => {
            const ws = new WebSocket(wsUrl);

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    schema: "api_admin_gateway_closure_request",
                    schema_version: "1.0",
                    wallet: {
                        type: "Dhali-js",
                        address: account.address,
                        protocol: "SEPOLIA",
                        publicKey: null,
                        currency: {
                            code: "ETH",
                            scale: 18,
                            issuer: null
                        }
                    },
                    protocol: "SEPOLIA",
                    currency: "ETH",
                    issuer: null
                }));
            });

            ws.on('message', async (data) => {
                const msg = JSON.parse(data);
                console.log("WebSocket message received:", JSON.stringify(msg, null, 2));

                if (msg.schema === "api_admin_gateway_message_to_be_signed") {
                    console.log("Signing challenge message (EVM)...");
                    const signature = await walletClient.signTypedData({
                        domain: msg.message.domain,
                        types: msg.message.types,
                        primaryType: msg.message.primaryType,
                        message: msg.message.message
                    });
                    ws.send(JSON.stringify({
                        schema: "api_admin_gateway_signed_message_response",
                        schema_version: "1.1",
                        signature: signature
                    }));
                } else if (msg.schema === "api_admin_gateway_authentication_successful") {
                    // Wait
                } else if (msg.success) {
                    console.log('Channel closure initiated:', msg.message);
                    ws.close();
                } else if (msg.error) {
                    reject(new Error(msg.error));
                    ws.close();
                }
            });

            ws.on('error', (err) => {
                console.error("WebSocket error:", err);
                reject(err);
            });
            ws.on('close', (code, reason) => {
                console.log(`WebSocket closed: ${code} ${reason}`);
                resolve();
            });
        });
    }, 300000);
});
