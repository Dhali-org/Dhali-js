const { Client } = require("xrpl");
const { buildPaychanAuthHexStringToBeSigned } = require("./createSignedClaim");
const { sign: signClaim } = require("ripple-keypairs");

const { fetchPublicConfig, notifyAdminGateway, retrieveChannelIdFromFirestoreRest } = require("./configUtils");

const { ChannelNotFound } = require("./utils");

/**
 * A management tool for generating payment claims for use with Dhali APIs (XRPL).
 */
class DhaliXrplChannelManager {
  /**
   * @param {import("xrpl").Wallet} wallet
   * @param {import("xrpl").Client} rpc_client
   * @param {import("./Currency")} currency
   * @param {typeof fetch} [httpClient]
   * @param {object} [public_config]
   */
  constructor(wallet, rpc_client, currency, httpClient = fetch, public_config) {
    this.wallet = wallet;
    this.rpc_client = rpc_client;
    this.currency = currency;
    this.httpClient = httpClient || fetch;
    this.public_config = public_config;
    this.ready = Promise.resolve(); // Assuming client is ready or handled by caller
    this.destination = undefined;
  }

  async _resolveAddresses() {
    if (this.destination) return;

    if (!this.public_config) {
      this.public_config = await fetchPublicConfig(this.httpClient);
    }

    if (!this.destination) {
      try {
        this.destination = this.public_config.DHALI_PUBLIC_ADDRESSES[this.currency.network][this.currency.code].wallet_id;
      } catch (e) {
        // Fallback to default if needed, or throw
        this.destination = "rJiAX3Xk2Fq3KJrjsGajrB5LENZq7VCwAd";
      }
    }
  }

  /**
   * Queries Firestore for an existing open channel.
   * Path: public_claim_info/<protocol>/<currency_identifier>
   * Filter: account == wallet.classicAddress, closed != true
   */
  async _retrieveChannelIdFromFirestore() {
    return await retrieveChannelIdFromFirestoreRest(
      this.currency.network,
      this.currency,
      this.wallet.address,
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

  async _findChannel(timeoutSeconds = 0) {
    await this.ready;
    await this._resolveAddresses();

    // Prioritize Firestore
    let firestoreChannelId;
    if (timeoutSeconds > 0) {
      firestoreChannelId = await this._retrieveChannelIdFromFirestoreWithPolling(timeoutSeconds);
    } else {
      firestoreChannelId = await this._retrieveChannelIdFromFirestore();
    }

    if (firestoreChannelId === null) {
      throw new ChannelNotFound(
        `No open payment channel from ${this.wallet.classicAddress} to ${this.destination}`,
      );
    }

    const resp = await this.rpc_client.request({
      command: "account_channels",
      account: this.wallet.classicAddress,
      destination_account: this.destination,
      ledger_index: "validated",
    });
    const channels = resp.result.channels || [];

    for (const ch of channels) {
      if (ch.channel_id === firestoreChannelId) {
        return ch;
      }
    }

    throw new ChannelNotFound(
      `Firestore channel ${firestoreChannelId} not found on-chain for ` +
      `${this.wallet.classicAddress} to ${this.destination}`
    );
  }

  /**
   * Create or fund a payment channel.
   * @param {number} amountDrops
   * @returns {Promise<object>}
   */
  async deposit(amountDrops) {
    await this.ready;
    let tx;
    try {
      const ch = await this._findChannel(0);
      tx = {
        TransactionType: "PaymentChannelFund",
        Account: this.wallet.classicAddress,
        Channel: ch.channel_id,
        Amount: amountDrops.toString(),
      };
    } catch (err) {
      if (!(err instanceof ChannelNotFound)) throw err;
      tx = {
        TransactionType: "PaymentChannelCreate",
        Account: this.wallet.classicAddress,
        Destination: this.destination,
        Amount: amountDrops.toString(),
        SettleDelay: 86400 * 14,
        PublicKey: this.wallet.publicKey,
      };
    }
    // autofill sequence, fee, etc.
    // @ts-ignore
    const prepared = await this.rpc_client.autofill(tx);
    // sign
    const signed = this.wallet.sign(prepared);
    // @ts-ignore
    const txBlob = signed.tx_blob || signed.signedTransaction;
    // submit & wait
    const result = await this.rpc_client.submitAndWait(txBlob);

    // If we just created a channel, notify the gateway
    if (tx.TransactionType === "PaymentChannelCreate") {
      // @ts-ignore
      const meta = result.result.meta || result.result.metaData || {};
      const affectedNodes = meta.AffectedNodes || [];
      for (const node of affectedNodes) {
        const createdNode = node.CreatedNode;
        if (createdNode && createdNode.LedgerEntryType === "PayChannel") {
          const channelId = createdNode.LedgerIndex;
          if (channelId) {
            let currencyIdentifier = this.currency.code;
            if (this.currency.tokenAddress) {
              currencyIdentifier = `${this.currency.code}.${this.currency.tokenAddress}`;
            }
            await notifyAdminGateway(
              this.currency.network,
              currencyIdentifier,
              this.wallet.classicAddress,
              channelId,
              this.httpClient
            );
          }
          break;
        }
      }
      // Poll Firestore to match DhaliEthChannelManager behavior
      await this._retrieveChannelIdFromFirestoreWithPolling(30);
    }

    return result.result;
  }

  /**
   * Generate a base64-encoded payment claim.
   * @param {number=} amountDrops
   * @returns {Promise<string>}
   */
  async getAuthToken(amountDrops) {
    await this.ready;
    const ch = await this._findChannel(10);
    const total = BigInt(ch.amount);
    const allowed = amountDrops != null ? BigInt(amountDrops) : total;
    if (allowed > total) {
      throw new Error(
        `Requested auth ${allowed} exceeds channel capacity ${total}`,
      );
    }
    const claimHex = buildPaychanAuthHexStringToBeSigned(
      ch.channel_id,
      allowed.toString(),
    );
    const signature = signClaim(claimHex, this.wallet.privateKey);
    const claim = {
      version: "2",
      account: this.wallet.classicAddress,
      protocol: this.currency.network,
      currency: { code: "XRP", scale: 6 },
      destination_account: this.destination,
      authorized_to_claim: allowed.toString(),
      channel_id: ch.channel_id,
      signature,
    };
    return Buffer.from(JSON.stringify(claim)).toString("base64");
  }
}

module.exports = { DhaliXrplChannelManager, ChannelNotFound };
