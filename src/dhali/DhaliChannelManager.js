const { Client } = require("xrpl");
const { buildPaychanAuthHexStringToBeSigned } = require("./createSignedClaim");
const { sign: signClaim } = require("ripple-keypairs");

class ChannelNotFound extends Error {}

/**
 * A management tool for generating payment claims for use with Dhali APIs.
 */
class DhaliChannelManager {
  /**
   * @param {xrpl.Wallet} wallet
   */
  constructor(wallet) {
    this.client = new Client("wss://s1.ripple.com:51234/");
    this.ready = this.client.connect();
    this.wallet = wallet;
    this.destination = "rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR";
    this.protocol = "XRPL.MAINNET";
  }

  async _findChannel() {
    await this.ready;
    const resp = await this.client.request({
      command: "account_channels",
      account: this.wallet.classicAddress,
      destination_account: this.destination,
      ledger_index: "validated",
    });
    const channels = resp.result.channels || [];
    if (channels.length === 0) {
      throw new ChannelNotFound(
        `No open payment channel from ${this.wallet.classicAddress} to ${this.destination}`,
      );
    }
    return channels[0];
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
      const ch = await this._findChannel();
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
    const prepared = await this.client.autofill(tx);
    // sign
    const signed = this.wallet.sign(prepared);
    const txBlob = signed.tx_blob || signed.signedTransaction;
    // submit & wait
    const result = await this.client.submitAndWait(txBlob);
    return result.result;
  }

  /**
   * Generate a base64-encoded payment claim.
   * @param {number=} amountDrops
   * @returns {Promise<string>}
   */
  async getAuthToken(amountDrops) {
    await this.ready;
    const ch = await this._findChannel();
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
      protocol: this.protocol,
      currency: { code: "XRP", scale: 6 },
      destination_account: this.destination,
      authorized_to_claim: allowed.toString(),
      channel_id: ch.channel_id,
      signature,
    };
    return Buffer.from(JSON.stringify(claim)).toString("base64");
  }
}

module.exports = { DhaliChannelManager, ChannelNotFound };
