const { getEthereumClaimTypedData } = require("./createSignedClaim");
const {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex
} = require("viem");
const crypto = require("crypto");

const { fetchPublicConfig, notifyAdminGateway, retrieveChannelIdFromFirestoreRest } = require("./configUtils");
const { ChannelNotFound } = require("./utils");

class DhaliEthChannelManager {
  /**
  * @param {import("viem").WalletClient} walletClient
  * @param {import("viem").PublicClient} publicClient
  * @param {import("./Currency")} currency
  * @param {typeof fetch} [httpClient] - Injected HTTP client
  * @param {object} [public_config] - Dhali public configuration
  */
  constructor(walletClient, publicClient, currency, httpClient = fetch, public_config) {
    this.walletClient = walletClient;
    this.publicClient = publicClient;
    this.currency = currency;
    this.httpClient = httpClient || fetch;
    this.public_config = public_config;
    this.chainId = this._getChainIdFromProtocol(this.currency.network);
    this.destinationAddress = undefined;
    this.contractAddress = undefined;
  }

  _getChainIdFromProtocol(protocol) {
    switch (protocol.toUpperCase()) {
      case "ETHEREUM": return 1;
      case "SEPOLIA": return 11155111;
      case "HOLESKY": return 17000;
      case "HARDHAT": return 31337;
      default: throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }


  async _resolveAddresses() {
    if (this.destinationAddress && this.contractAddress) return;

    if (!this.public_config) {
      this.public_config = await fetchPublicConfig(this.httpClient);
    }

    if (!this.destinationAddress) {
      try {
        this.destinationAddress = this.public_config.DHALI_PUBLIC_ADDRESSES[this.currency.network][this.currency.code].wallet_id;
      } catch (e) {
        throw new Error("Destination address not found in public_config for this protocol/currency: " + e.message);
      }
    }

    if (!this.contractAddress) {
      try {
        // @ts-ignore
        this.contractAddress = this.public_config.CONTRACTS[this.currency.network].contract_address;
      } catch (e) {
        throw new Error("Contract address not found in public_config for this protocol: " + e.message);
      }
    }

    if (!this.contractAddress) {
      throw new Error("Contract address must be provided or resolved for this chainId");
    }
  }

  /**
   * Queries Firestore for an existing open channel.
   * Path: public_claim_info/<protocol>/<currency_identifier>
   * Filter: account == my_address, closed != true
   */
  async _retrieveChannelIdFromFirestore() {
    const [address] = await this.walletClient.getAddresses();
    return await retrieveChannelIdFromFirestoreRest(
      this.currency.network,
      this.currency,
      address.toLowerCase(),
      this.httpClient
    );
  }

  async _retrieveChannelIdFromFirestoreWithPolling(timeoutSeconds = 30) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      const channelId = await this._retrieveChannelIdFromFirestore();
      if (channelId) return channelId;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return null;
  }

  async _calculateChannelId(receiver, tokenAddress, nonce) {
    // Matches Dhali-wallet: keccak256(abi.encode(sender, receiver, token, nonce))
    const [sender] = await this.walletClient.getAddresses();
    return keccak256(
      encodeAbiParameters(
        parseAbiParameters("address, address, address, uint256"),
        [sender, receiver, tokenAddress, nonce]
      )
    );
  }

  _encodeAddress(address) {
    return address.toLowerCase().replace("0x", "").padStart(64, '0');
  }

  _encodeUint(value) {
    return BigInt(value).toString(16).padStart(64, '0');
  }

  _encodeBool(value) {
    return value ? "1".padStart(64, '0') : "0".padStart(64, '0');
  }

  _encodeBytes32(value) {
    return value.replace("0x", "").padStart(64, '0');
  }

  async _buildTx(to, data, value) {
    const accountString = (await this.walletClient.getAddresses())[0];
    const account = this.walletClient.account || accountString;
    const gasPrice = await this.publicClient.getGasPrice();
    // Add 10% buffer to gas price
    const gasPriceWithBuffer = (gasPrice * BigInt(110)) / BigInt(100);

    /** @type {any} */
    const txParams = {
      account: account,
      to: to,
      value: value,
      data: data,
      gasPrice: gasPriceWithBuffer,
      nonce: await this.publicClient.getTransactionCount({ address: accountString, blockTag: "pending" }),
      chain: { id: this.chainId }
    };

    // Estimate gas
    const gasLimit = await this.publicClient.estimateGas(txParams);
    // Add 10% buffer to gas limit
    txParams.gas = (gasLimit * BigInt(110)) / BigInt(100);

    return txParams;
  }

  /**
   * Deposits funds into a payment channel.
   * If an open channel exists, funds it.
   * If not, opens a new one.
   * @param {string|number} amount Amount in base units (wei/drops)
   * @returns {Promise<import("viem").TransactionReceipt>}
   */
  async deposit(amount) {
    await this._resolveAddresses();
    const existingChannelId = await this._retrieveChannelIdFromFirestore();
    const tokenAddress = this.currency.tokenAddress || "0x0000000000000000000000000000000000000000";
    const isNative = (tokenAddress === "0x0000000000000000000000000000000000000000");
    const amountBig = BigInt(amount);

    const OPEN_CHANNEL_SELECTOR = "3cd880a5";
    const DEPOSIT_SELECTOR = "264d06c8";
    const SETTLE_DELAY = 1209600n; // 2 weeks

    if (existingChannelId) {
      // Deposit
      const calldata = "0x" +
        DEPOSIT_SELECTOR +
        this._encodeBytes32(existingChannelId) +
        this._encodeUint(amountBig) +
        this._encodeBool(true); // renew

      if (!isNative) {
        await this._approveToken(tokenAddress, this.contractAddress, amountBig);
      }

      const txParams = await this._buildTx(this.contractAddress, calldata, isNative ? amountBig : 0n);
      const hash = await this.walletClient.sendTransaction(txParams);
      return await this.publicClient.waitForTransactionReceipt({ hash });

    } else {
      // Open Channel
      const receiver = this.destinationAddress;
      const nonce = this._generateNonce();
      const dummySigner = "0x0000000000000000000000000000000000000000";

      const calldata = "0x" +
        OPEN_CHANNEL_SELECTOR +
        this._encodeAddress(receiver) +
        this._encodeAddress(tokenAddress) +
        this._encodeUint(amountBig) +
        this._encodeUint(SETTLE_DELAY) +
        this._encodeUint(nonce) +
        this._encodeAddress(dummySigner);

      if (!isNative) {
        await this._approveToken(tokenAddress, this.contractAddress, amountBig);
      }

      const txParams = await this._buildTx(this.contractAddress, calldata, isNative ? amountBig : 0n);
      const hash = await this.walletClient.sendTransaction(txParams);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      // Calculate channel ID and notify gateway
      const calculatedChannelId = await this._calculateChannelId(receiver, tokenAddress, nonce);

      let currencyIdentifier = this.currency.code;
      if (this.currency.tokenAddress) {
        currencyIdentifier = `${this.currency.code}.${this.currency.tokenAddress}`;
      }

      const [address] = await this.walletClient.getAddresses();
      // Proactive notification
      await notifyAdminGateway(
        this.currency.network,
        currencyIdentifier,
        address.toLowerCase(),
        calculatedChannelId,
        this.httpClient
      );

      // Poll Firestore to match setupBalanceListener behavior
      await this._retrieveChannelIdFromFirestoreWithPolling(30);

      return receipt;
    }
  }

  _generateNonce() {
    const bytes = crypto.randomBytes(32);
    return BigInt(toHex(bytes));
  }

  async _approveToken(tokenAddress, spender, amount) {
    const APPROVE_SELECTOR = "095ea7b3";
    const calldata = "0x" +
      APPROVE_SELECTOR +
      this._encodeAddress(spender) +
      this._encodeUint(amount);

    const txParams = await this._buildTx(tokenAddress, calldata, 0n);
    const hash = await this.walletClient.sendTransaction(txParams);
    await this.publicClient.waitForTransactionReceipt({ hash });
  }
  async _getOnChainChannelAmount(channelId) {
    const cleanId = channelId.replace("0x", "").padStart(64, "0");
    const calldata = "0x831c2b82" + cleanId;

    try {
      const result = await this.publicClient.call({
        to: this.contractAddress,
        data: calldata
      });

      if (!result || result.data === "0x" || result.data.length < 322) {
        throw new Error("Invalid getChannel response length");
      }

      // The amount is the 5th 32-byte word (index 4).
      // Result is a hex string "0x...".
      // Word 0: 2 to 66
      // Word 1: 66 to 130
      // Word 2: 130 to 194
      // Word 3: 194 to 258
      // Word 4: 258 to 322
      const amountHex = "0x" + result.data.substring(258, 322);
      return BigInt(amountHex).toString();
    } catch (e) {
      throw new Error(`Failed to retrieve on-chain channel amount: ${e.message}`);
    }
  }

  /**
   * Generate a base64-encoded payment claim.
   * @param {number|string|null} amount - Defaults to total channel capacity if null
   * @returns {Promise<string>}
   */
  async getAuthToken(amount = null) {
    await this._resolveAddresses();
    // Poll Firestore if not found (setupBalanceListener simulation)
    const channelIdRaw = await this._retrieveChannelIdFromFirestoreWithPolling(10);
    if (!channelIdRaw) {
      throw new ChannelNotFound("No open payment channel found in Firestore. Please deposit first.");
    }

    let channelId = channelIdRaw;
    if (!channelId.startsWith("0x")) {
      channelId = "0x" + channelId;
    }

    const totalAmount = await this._getOnChainChannelAmount(channelId);
    const allowed = amount !== null ? amount.toString() : totalAmount;

    // BigInt comparison if needed, but for now simple check if it exceeds
    if (BigInt(allowed) > BigInt(totalAmount)) {
      throw new Error(`Requested auth ${allowed} exceeds channel capacity ${totalAmount}`);
    }

    if (!channelId.startsWith("0x")) {
      channelId = "0x" + channelId;
    }

    const token = this.currency.tokenAddress || "0x0000000000000000000000000000000000000000";

    const { domain, types, value } = getEthereumClaimTypedData(
      channelId,
      token,
      BigInt(allowed),
      this.chainId,
      this.contractAddress
    );

    const accountString = (await this.walletClient.getAddresses())[0];
    const account = this.walletClient.account || accountString;
    const signature = await this.walletClient.signTypedData({
      account,
      domain,
      types,
      primaryType: 'DhaliClaim',
      message: value
    });

    const claim = {
      version: "2",
      account: accountString.toLowerCase(),
      protocol: this.currency.network,
      currency: {
        code: this.currency.code,
        scale: this.currency.scale,
        issuer: this.currency.tokenAddress || null
      },
      destination_account: this.destinationAddress,
      authorized_to_claim: allowed,
      channel_id: channelId,
      signature: signature
    };
    return Buffer.from(JSON.stringify(claim)).toString("base64");
  }
}

module.exports = { DhaliEthChannelManager };

