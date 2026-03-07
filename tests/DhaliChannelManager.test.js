const {
  DhaliXrplChannelManager,
  ChannelNotFound,
} = require("../src/dhali/DhaliXrplChannelManager");
const createSignedClaim = require("../src/dhali/createSignedClaim");
const rippleKeypairs = require("ripple-keypairs");
const Currency = require("../src/dhali/Currency");

jest.mock("xrpl", () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(),
      request: jest.fn(),
      submitAndWait: jest.fn(),
      autofill: jest.fn().mockResolvedValue({}),
    })),
    Wallet: {
      fromSeed: jest.fn(),
    },
  };
});

jest.mock("ripple-keypairs", () => ({
  sign: jest.fn(),
}));



const configUtils = require("../src/dhali/configUtils");
jest.mock("../src/dhali/configUtils", () => ({
  fetchPublicConfig: jest.fn().mockResolvedValue({}),
  retrieveChannelIdFromFirestoreRest: jest.fn(),
}));

describe("DhaliChannelManager", () => {
  let manager;
  let mockClient;
  let wallet;
  let currency;
  const CHANNEL_ID = "0000000000000000000000000000000000000000000000000000000000000000";

  beforeEach(() => {
    wallet = {
      address: "rTestAddress",
      classicAddress: "rTestAddress",
      publicKey: "TEST_PUB_KEY",
      privateKey: "TEST_PRIV_KEY",
      sign: jest.fn().mockReturnValue({ tx_blob: "BLOB" }),
    };
    mockClient = {
      connect: jest.fn().mockResolvedValue(),
      request: jest.fn(),
      submitAndWait: jest.fn(),
      autofill: jest.fn().mockResolvedValue({}),
    };
    currency = new Currency("XRPL.MAINNET", "XRP", 6);

    const mockHttp = jest.fn();
    configUtils.retrieveChannelIdFromFirestoreRest.mockResolvedValue("CHAN123");
    manager = new DhaliXrplChannelManager(wallet, mockClient, currency, mockHttp);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("deposit", () => {
    test("funds existing channel if found", async () => {
      mockClient.rpc_client = { request: jest.fn() }; // not really how it works but let's see
      mockClient.request.mockResolvedValue({
        result: {
          channels: [{ channel_id: CHANNEL_ID }],
        },
      });
      mockClient.submitAndWait.mockResolvedValue({ result: "SUCCESS" });
      mockClient.autofill = jest.fn().mockResolvedValue({});

      const result = await manager.deposit(100);
      expect(result).toBe("SUCCESS");
    });

    test("throws ChannelNotFound if firestore returns null", async () => {
      const mockHttp = jest.fn();
      configUtils.retrieveChannelIdFromFirestoreRest.mockResolvedValue(null);
      manager = new DhaliXrplChannelManager(wallet, mockClient, currency, mockHttp);
      await expect(manager.getAuthToken(100)).rejects.toThrow(ChannelNotFound);
      await expect(manager.getAuthToken(100)).rejects.toThrow(/No open payment channel from/);
      expect(configUtils.retrieveChannelIdFromFirestoreRest).toHaveBeenCalledWith(
        "XRPL.MAINNET",
        currency,
        wallet.classicAddress,
        mockHttp
      );
    });

    test("throws ChannelNotFound if firestore ID does not match on-chain channels", async () => {
      configUtils.retrieveChannelIdFromFirestoreRest.mockResolvedValue("FIRESTORE_ID");
      mockClient.request.mockResolvedValue({
        result: {
          channels: [{ channel_id: "XRPL_ID", amount: "1000" }],
        },
      });

      await expect(manager.getAuthToken(100)).rejects.toThrow(ChannelNotFound);
      await expect(manager.getAuthToken(100)).rejects.toThrow(/FIRESTORE_ID not found on-chain/);
    });
  });

  describe("getAuthToken", () => {
    test("success with default amount", async () => {
      manager._findChannel = jest.fn().mockResolvedValue({
        channel_id: CHANNEL_ID,
        amount: "1001",
      });

      rippleKeypairs.sign.mockReturnValue("SIG");

      const token = await manager.getAuthToken();
      const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));

      expect(decoded).toMatchObject({
        channel_id: CHANNEL_ID,
        authorized_to_claim: "1001",
        signature: "SIG",
      });
    });

    test("success with specific amount", async () => {
      manager._findChannel = jest.fn().mockResolvedValue({
        channel_id: CHANNEL_ID,
        amount: "500",
      });
      rippleKeypairs.sign.mockReturnValue("SIG2");

      const token = await manager.getAuthToken(200);
      const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
      expect(decoded.authorized_to_claim).toBe("200");
    });

    test("throws if amount exceeds capacity", async () => {
      manager._findChannel = jest.fn().mockResolvedValue({
        channel_id: CHANNEL_ID,
        amount: "100",
      });
      await expect(manager.getAuthToken(200)).rejects.toThrow(
        /exceeds channel capacity/,
      );
    });
  });
});
