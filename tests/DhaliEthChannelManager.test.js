const { DhaliEthChannelManager } = require("../src/dhali/DhaliEthChannelManager");
const Currency = require("../src/dhali/Currency");
const { keccak256, encodeAbiParameters, parseAbiParameters } = require("viem");
const configUtils = require("../src/dhali/configUtils");

jest.mock("../src/dhali/configUtils");

describe("DhaliEthChannelManager", () => {
    let mockWalletClient;
    let mockPublicClient;
    let currency;
    let publicConfig;
    let manager;

    beforeEach(() => {
        mockWalletClient = {
            getAddresses: jest.fn().mockResolvedValue(["0x0000000000000000000000000000000000000001"]),
            sendTransaction: jest.fn(),
            signTypedData: jest.fn()
        };
        mockPublicClient = {
            getGasPrice: jest.fn().mockResolvedValue(BigInt(1000000000)),
            estimateGas: jest.fn().mockResolvedValue(BigInt(21000)),
            getTransactionCount: jest.fn().mockResolvedValue(10),
            waitForTransactionReceipt: jest.fn(),
            call: jest.fn()
        };
        currency = new Currency("ETHEREUM", "ETH", 18);
        publicConfig = {
            DHALI_PUBLIC_ADDRESSES: {
                ETHEREUM: {
                    ETH: { wallet_id: "0x0000000000000000000000000000000000000002" }
                }
            },
            CONTRACTS: {
                ETHEREUM: { contract_address: "0x0000000000000000000000000000000000000003" }
            }
        };
        configUtils.fetchPublicConfig.mockResolvedValue(publicConfig);
        manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, null, publicConfig);
        jest.clearAllMocks();
    });

    test("initializes without default http client", () => {
        const localManager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, null, publicConfig);
        expect(localManager.httpClient).toBe(fetch);
        expect(localManager.chainId).toBe(1);
    });

    test("initializes with provided http client", () => {
        const mockHttp = jest.fn();
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, mockHttp, publicConfig);
        expect(manager.httpClient).toBe(mockHttp);
    });

    test("initializes without config or addresses (lazy resolution)", () => {
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, null);
        expect(manager.destinationAddress).toBeUndefined();
        expect(manager.contractAddress).toBeUndefined();
    });

    test("resolves addresses lazily", async () => {
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, null);

        await manager._resolveAddresses();

        expect(manager.destinationAddress).toBe("0x0000000000000000000000000000000000000002");
        expect(manager.contractAddress).toBe("0x0000000000000000000000000000000000000003");
        expect(configUtils.fetchPublicConfig).toHaveBeenCalled();
    });

    test("resolves destination and contract addresses from provided config", async () => {
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, null, publicConfig);
        await manager._resolveAddresses();
        expect(manager.destinationAddress).toBe("0x0000000000000000000000000000000000000002");
        expect(manager.contractAddress).toBe("0x0000000000000000000000000000000000000003");
        expect(configUtils.fetchPublicConfig).not.toHaveBeenCalled();
    });

    test("calculates channel ID correctly", async () => {
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, null, publicConfig);
        const sender = "0x0000000000000000000000000000000000000001";
        const receiver = "0x0000000000000000000000000000000000000002";
        const token = "0x0000000000000000000000000000000000000003";
        const nonce = 12345n;

        const expectedId = keccak256(
            encodeAbiParameters(
                parseAbiParameters("address, address, address, uint256"),
                [sender, receiver, token, nonce]
            )
        );

        const id = await manager._calculateChannelId(receiver, token, nonce);
        expect(id).toBe(expectedId);
    });

    test("deposit with polling when creating a new channel", async () => {
        const mockHttp = jest.fn();
        configUtils.retrieveChannelIdFromFirestoreRest
            .mockResolvedValueOnce(null) // First check in deposit()
            .mockResolvedValueOnce(null) // First poll
            .mockResolvedValueOnce("0x0000000000000000000000000000000000000000000000000000000000000004"); // Second poll

        const localManager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, mockHttp, publicConfig);
        localManager._generateNonce = jest.fn().mockReturnValue(54321n);
        localManager._calculateChannelId = jest.fn().mockReturnValue("0xCalculatedId");

        mockWalletClient.sendTransaction.mockResolvedValue("0xTxHash");
        mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

        configUtils.notifyAdminGateway.mockResolvedValue();

        const originalTimeout = global.setTimeout;
        global.setTimeout = (cb) => cb();

        const receipt = await localManager.deposit(100);

        expect(receipt.status).toBe("success");
        expect(configUtils.notifyAdminGateway).toHaveBeenCalledWith(
            "ETHEREUM",
            "ETH",
            "0x0000000000000000000000000000000000000001",
            "0xCalculatedId",
            mockHttp
        );

        expect(configUtils.retrieveChannelIdFromFirestoreRest).toHaveBeenCalledTimes(3);

        global.setTimeout = originalTimeout;
    });

    test("getAuthToken throws if channel not found after polling (REST)", async () => {
        const mockHttp = jest.fn();
        configUtils.retrieveChannelIdFromFirestoreRest.mockResolvedValue(null);
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, mockHttp, publicConfig);

        const originalTimeout = global.setTimeout;
        global.setTimeout = (cb) => cb();

        await expect(manager.getAuthToken(100)).rejects.toThrow(/No open payment channel found in Firestore/);

        global.setTimeout = originalTimeout;
    });

    test("getAuthToken defaults to channel capacity if amount is null", async () => {
        const mockHttp = jest.fn();
        configUtils.retrieveChannelIdFromFirestoreRest.mockResolvedValue("0x0000000000000000000000000000000000000000000000000000000000000005");
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, mockHttp, publicConfig);

        // Mock on-chain response for getChannel
        // Selector (4) + 5 words (5 * 32 bytes = 160 bytes = 320 chars)
        // Amount is word 4 (index 4).
        // 0x + 64*4 chars of padding + 5000 in hex (padded to 64 chars)
        const amountHex = BigInt(5000).toString(16).padStart(64, '0');
        const mockResult = { data: "0x" + "0".repeat(64 * 4) + amountHex };
        mockPublicClient.call = jest.fn().mockResolvedValue(mockResult);

        mockWalletClient.signTypedData.mockResolvedValue("0xSignature");

        const originalTimeout = global.setTimeout;
        global.setTimeout = (cb) => cb();

        const token = await manager.getAuthToken(); // No amount
        const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));

        expect(decoded.authorized_to_claim).toBe("5000");
        expect(decoded.channel_id).toBe("0x0000000000000000000000000000000000000000000000000000000000000005");
        expect(mockPublicClient.call).toHaveBeenCalled();

        global.setTimeout = originalTimeout;
    });

    test("deposit notifies admin gateway with lowercase address", async () => {
        const mockHttp = jest.fn();
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, mockHttp, publicConfig);

        // Setup state for new channel creation
        manager._retrieveChannelIdFromFirestore = jest.fn().mockResolvedValue(null);
        // Provide a valid mixed-case 40-character EIP-55 Ethereum address
        mockWalletClient.getAddresses.mockResolvedValue(["0x71C7656EC7ab88b098defB751B7401B5f6d8976F"]);
        mockWalletClient.sendTransaction = jest.fn().mockResolvedValue("0xhash");
        mockPublicClient.waitForTransactionReceipt = jest.fn().mockResolvedValue({ status: 1 });

        // Mock polling so deposit finishes
        manager._retrieveChannelIdFromFirestoreWithPolling = jest.fn().mockResolvedValue("0xnewid");

        // Mock crypto so we can predict channel id or at least verify it's called
        const originalBytes = crypto.randomBytes;
        crypto.randomBytes = jest.fn().mockReturnValue(Buffer.from("00".repeat(32), "hex"));

        await manager.deposit(100);

        expect(configUtils.notifyAdminGateway).toHaveBeenCalledWith(
            "ETHEREUM",
            "ETH",
            "0x71c7656ec7ab88b098defb751b7401b5f6d8976f", // Expect perfect lowercase
            expect.any(String),
            mockHttp
        );

        crypto.randomBytes = originalBytes;
    });

    test("getAuthToken polls Firestore (REST)", async () => {
        const mockHttp = jest.fn();
        configUtils.retrieveChannelIdFromFirestoreRest
            .mockResolvedValueOnce(null) // First poll
            .mockResolvedValueOnce("0x0000000000000000000000000000000000000000000000000000000000000005"); // Second poll

        const amountHex = BigInt(1000).toString(16).padStart(64, '0');
        const mockResult = { data: "0x" + "0".repeat(64 * 4) + amountHex };
        mockPublicClient.call = jest.fn().mockResolvedValue(mockResult);

        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, mockHttp, publicConfig);
        mockWalletClient.signTypedData.mockResolvedValue("0xSignature");

        const originalTimeout = global.setTimeout;
        global.setTimeout = (cb) => cb();

        const token = await manager.getAuthToken(100);

        expect(token).toBeDefined();
        expect(configUtils.retrieveChannelIdFromFirestoreRest).toHaveBeenCalledTimes(2);

        global.setTimeout = originalTimeout;
    });

    test("queries Firestore with lowercase address (REST)", async () => {
        const mockHttp = jest.fn();
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, mockHttp, publicConfig);
        mockWalletClient.getAddresses.mockResolvedValue(["0xMixEdCaSeAdDrEsS"]);

        await manager._retrieveChannelIdFromFirestore();

        expect(configUtils.retrieveChannelIdFromFirestoreRest).toHaveBeenCalledWith(
            "ETHEREUM",
            currency,
            "0xmixedcaseaddress",
            mockHttp
        );
    });

    test("uses default REST if no function provided", async () => {
        const manager = new DhaliEthChannelManager(mockWalletClient, mockPublicClient, currency, null, publicConfig);
        mockWalletClient.getAddresses.mockResolvedValue(["0xMyAddr"]);
        configUtils.retrieveChannelIdFromFirestoreRest.mockResolvedValue("0xRestId");

        const id = await manager._retrieveChannelIdFromFirestore();
        expect(id).toBe("0xRestId");
        expect(configUtils.retrieveChannelIdFromFirestoreRest).toHaveBeenCalledWith(
            "ETHEREUM",
            currency,
            "0xmyaddr",
            fetch
        );
    });
});
