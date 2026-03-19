const { Wallet } = require('xrpl');
const { DhaliAssetManager } = require('../src/dhali/DhaliAssetManager');
const { WalletDescriptor } = require('../src/dhali/WalletDescriptor');
const Currency = require('../src/dhali/Currency');
const { AssetUpdates } = require('../src/dhali/AssetUpdates');

describe('Dhali-js Integration Test', () => {
    let wallet;
    let manager;

    beforeAll(() => {
        wallet = Wallet.generate();
        manager = DhaliAssetManager.xrpl(wallet);
    });

    test('should create and update an asset', async () => {
        const walletDescriptor = new WalletDescriptor(wallet.address, "XRPL.TESTNET");
        const currency = new Currency("XRPL.TESTNET", "XRP", 6);

        // 1. Create Asset
        console.log('Creating asset...');
        const createResult = await manager.createAsset(walletDescriptor, currency);
        expect(createResult.schema).toBe('api_admin_gateway_create_successful');
        expect(createResult.uuid).toBeDefined();
        const assetId = createResult.uuid;
        console.log('Asset created with UUID:', assetId);

        // 2. Update Asset
        console.log('Updating asset...');
        const updates = new AssetUpdates({
            name: "Integration Test Asset",
            earning_rate: 100,
            earning_type: "per_request"
        });

        const updateResult = await manager.updateAsset(assetId, walletDescriptor, updates);
        expect(updateResult.schema).toBe('api_admin_gateway_update_response');
        console.log('Asset updated successfully');
    }, 30000); // Increased timeout for live API calls

    test('should create and update an EVM asset', async () => {
        const { createWalletClient, http } = require('viem');
        const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
        const { sepolia } = require('viem/chains');

        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);
        const walletClient = createWalletClient({
            account,
            chain: sepolia,
            transport: http()
        });

        const evmManager = DhaliAssetManager.evm(walletClient);
        const walletDescriptor = new WalletDescriptor(account.address, "SEPOLIA");
        const currency = new Currency("SEPOLIA", "ETH", 18);

        // 1. Create Asset
        console.log('Creating EVM asset...');
        const createResult = await evmManager.createAsset(walletDescriptor, currency);
        expect(createResult.schema).toBe('api_admin_gateway_create_successful');
        expect(createResult.uuid).toBeDefined();
        const assetId = createResult.uuid;
        console.log('EVM Asset created with UUID:', assetId);

        // 2. Update Asset
        console.log('Updating EVM asset...');
        const updates = new AssetUpdates({
            name: "Integration Test Asset EVM",
            earning_rate: 0.001,
            earning_type: "per_request"
        });

        const updateResult = await evmManager.updateAsset(assetId, walletDescriptor, updates);
        expect(updateResult.schema).toBe('api_admin_gateway_update_response');
        console.log('EVM Asset updated successfully');
    }, 30000);
});
