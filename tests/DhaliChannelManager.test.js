// tests/DhaliChannelManager.test.js

// 1) MOCK xrpl.js BEFORE importing any code that instantiates Client
jest.mock("xrpl", () => {
  // Return an object with the Client class stubbed
  return {
    Client: jest.fn().mockImplementation(() => {
      return {
        // connect() returns a resolved Promise so await this.ready never hangs
        connect: () => Promise.resolve(),
        // stubbed methods your code calls:
        request: jest.fn(),
        autofill: jest.fn(),
        submitAndWait: jest.fn(),
        disconnect: jest.fn(),
        // preserve .url for the constructor test
        url: "wss://s1.ripple.com:51234/",
      };
    }),
  };
});

// 2) MOCK ripple-keypairs BEFORE importing DhaliChannelManager
jest.mock("ripple-keypairs", () => ({
  // We'll override this mock's behavior inside individual tests
  sign: jest.fn(),
}));

jest.mock("../src/dhali/createSignedClaim", () => ({
  buildPaychanAuthHexStringToBeSigned: jest.fn(),
  // If you need to expose _serializePaychanAuthorization, add it here too:
  // _serializePaychanAuthorization: jest.fn(),
}));

// 3) Now import everything under test
const createSignedClaim = require("../src/dhali/createSignedClaim");
const { sign: mockRippleSign } = require("ripple-keypairs");
const {
  DhaliChannelManager,
  ChannelNotFound,
} = require("../src/dhali/DhaliChannelManager");

describe("DhaliChannelManager", () => {
  const CHANNEL_ID = "AB".repeat(32);
  let wallet;
  let manager;

  beforeEach(() => {
    // 4) Create a minimal fake wallet
    wallet = {
      classicAddress: "rTESTADDRESS",
      publicKey: "PUBKEY",
      privateKey: "PRIVKEY",
      // sign() is used for transaction signing
      sign: jest.fn().mockReturnValue({ signedTransaction: "TX_BLOB" }),
    };
    // 5) Instantiate the manager. client.connect() is already stubbed.
    manager = new DhaliChannelManager(wallet);
    // 6) Short-circuit any `await this.ready` if your constructor awaits client.connect()
    manager.ready = Promise.resolve();
  });

  afterEach(() => {
    // 7) Restore any spies on createSignedClaim so tests remain isolated
    if (createSignedClaim.buildPaychanAuthHexStringToBeSigned.mockRestore) {
      createSignedClaim.buildPaychanAuthHexStringToBeSigned.mockRestore();
    }
  });

  test("constructor sets defaults", () => {
    expect(manager.wallet).toBe(wallet);
    expect(manager.protocol).toBe("XRPL.MAINNET");
    expect(manager.destination).toBe("rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR");
    // client.url comes from our mock above
    expect(manager.client.url).toBe("wss://s1.ripple.com:51234/");
  });

  describe("_findChannel", () => {
    test("returns first channel when present", async () => {
      const fakeChannel = { channel_id: "CHAN123", amount: "1000" };
      manager.client.request.mockResolvedValue({
        result: { channels: [fakeChannel] },
      });

      const ch = await manager._findChannel();
      expect(ch).toBe(fakeChannel);
      // verify the exact request payload
      expect(manager.client.request).toHaveBeenCalledWith({
        command: "account_channels",
        account: wallet.classicAddress,
        destination_account: manager.destination,
        ledger_index: "validated",
      });
    });

    test("throws ChannelNotFound when none", async () => {
      manager.client.request.mockResolvedValue({ result: { channels: [] } });

      await expect(manager._findChannel()).rejects.toThrow(ChannelNotFound);
      await expect(manager._findChannel()).rejects.toThrow(
        wallet.classicAddress,
      );
      await expect(manager._findChannel()).rejects.toThrow(manager.destination);
    });
  });

  describe("deposit", () => {
    test("funds existing channel", async () => {
      // _findChannel resolves => fund path
      const fakeChannel = { channel_id: "CHANID", amount: "500" };
      manager._findChannel = jest.fn().mockResolvedValue(fakeChannel);

      // stub autofill + submitAndWait from our Client mock
      manager.client.autofill.mockResolvedValue({ foo: "bar" });
      manager.client.submitAndWait.mockResolvedValue({
        result: { status: "funded" },
      });

      const res = await manager.deposit(100);
      expect(res).toEqual({ status: "funded" });

      // ensure autofill got the correct PaymentChannelFund payload
      expect(manager.client.autofill).toHaveBeenCalledWith({
        TransactionType: "PaymentChannelFund",
        Account: wallet.classicAddress,
        Channel: fakeChannel.channel_id,
        Amount: "100",
      });
      // ensure we submitted the signed blob returned by wallet.sign()
      expect(manager.client.submitAndWait).toHaveBeenCalledWith("TX_BLOB");
    });

    test("creates channel if none exists", async () => {
      // _findChannel rejects with ChannelNotFound => create path
      manager._findChannel = jest
        .fn()
        .mockRejectedValue(new ChannelNotFound("nope"));

      manager.client.autofill.mockResolvedValue({ baz: "qux" });
      manager.client.submitAndWait.mockResolvedValue({
        result: { status: "created" },
      });

      const res = await manager.deposit(200);
      expect(res).toEqual({ status: "created" });

      expect(manager.client.autofill).toHaveBeenCalledWith({
        TransactionType: "PaymentChannelCreate",
        Account: wallet.classicAddress,
        Destination: manager.destination,
        Amount: "200",
        SettleDelay: 86400 * 14,
        PublicKey: wallet.publicKey,
      });
      expect(manager.client.submitAndWait).toHaveBeenCalledWith("TX_BLOB");
    });
  });

  describe("getAuthToken", () => {
    test("success with default amount", async () => {
      // stub channel lookup
      manager._findChannel = jest.fn().mockResolvedValue({
        channel_id: CHANNEL_ID,
        amount: "1001",
      });

      // 8) SPY on the hex-builder instead of reassigning it
      const claimSpy = jest
        .spyOn(createSignedClaim, "buildPaychanAuthHexStringToBeSigned")
        .mockReturnValue("CLAIMHEX");

      // stub signature
      mockRippleSign.mockReturnValue("SIGVALUE");

      const token = await manager.getAuthToken();
      const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));

      expect(decoded).toMatchObject({
        version: "2",
        account: wallet.classicAddress,
        protocol: manager.protocol,
        currency: { code: "XRP", scale: 6 },
        destination_account: manager.destination,
        authorized_to_claim: "1001",
        channel_id: CHANNEL_ID,
        signature: "SIGVALUE",
      });

      // ensure our spy was called with correct args
      expect(claimSpy).toHaveBeenCalledWith(CHANNEL_ID, "1001");
    });

    test("success with specific amount", async () => {
      manager._findChannel = jest.fn().mockResolvedValue({
        channel_id: CHANNEL_ID,
        amount: "500",
      });

      const claimSpy = jest
        .spyOn(createSignedClaim, "buildPaychanAuthHexStringToBeSigned")
        .mockReturnValue("CLAIMHEX2");
      mockRippleSign.mockReturnValue("SIG2");

      const token = await manager.getAuthToken(200);
      const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
      expect(decoded.authorized_to_claim).toBe("200");
      expect(claimSpy).toHaveBeenCalledWith(CHANNEL_ID, "200");
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
