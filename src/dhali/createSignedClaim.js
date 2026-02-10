const HASH_PREFIX_PAYMENT_CHANNEL_CLAIM = 0x434c4d00;

/**
 * @private
 */
function _serializePaychanAuthorization(channelIdBytes, dropsBigInt) {
  if (!Buffer.isBuffer(channelIdBytes) || channelIdBytes.length !== 32) {
    throw new Error(
      `Invalid channelId length ${channelIdBytes.length}; must be 32 bytes.`,
    );
  }
  // 1) 4-byte prefix
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(HASH_PREFIX_PAYMENT_CHANNEL_CLAIM, 0);

  // 2) channelIdBytes (32 bytes)
  // 3) split drops into two 4-byte words
  const highBig = dropsBigInt >> 32n;
  const lowBig = dropsBigInt & 0xffffffffn;
  const high = Number(highBig);
  const low = Number(lowBig);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeUInt32BE(high, 0);
  amountBuf.writeUInt32BE(low, 4);

  return Buffer.concat([prefix, channelIdBytes, amountBuf]);
}

/**
 * Build the hex-string that you pass to an XRPL signer to sign a payment-channel claim.
 *
 * @param {string} channelIdHex 64-char hex string
 * @param {string} amountStr    integer string of drops
 * @returns {string} uppercase hex
 */
function buildPaychanAuthHexStringToBeSigned(channelIdHex, amountStr) {
  let channelIdBytes;

  channelIdBytes = Buffer.from(channelIdHex, "hex");

  if (channelIdBytes.length !== 32) {
    throw new Error(
      `Invalid channelId length ${channelIdBytes.length}; must be 32 bytes.`,
    );
  }

  let dropsBig;
  try {
    dropsBig = BigInt(amountStr);
  } catch {
    throw new Error("Invalid amount format.");
  }

  if (dropsBig < 0n) {
    throw new Error("Amount cannot be negative.");
  }

  const msg = _serializePaychanAuthorization(channelIdBytes, dropsBig);
  return msg.toString("hex").toUpperCase();
}

/**
 * Get Typed Data structure for EIP-712 signing
 */
function getEthereumClaimTypedData(channelId, tokenAddress, maxAmount, chainId, contractAddress) {
  const domain = {
    name: "DhaliPaymentChannel",
    version: "2.1.0",
    chainId: chainId,
    verifyingContract: contractAddress,
  };

  const types = {
    DhaliClaim: [
      { name: "channelId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "maxAmount", type: "uint256" },
    ],
  };

  if (typeof channelId === "string" && !channelId.startsWith("0x")) {
    channelId = "0x" + channelId;
  }

  const value = {
    channelId: channelId,
    token: tokenAddress,
    maxAmount: maxAmount
  };

  return { domain, types, value };
}


module.exports = {
  buildPaychanAuthHexStringToBeSigned,
  // exposed for testing
  _serializePaychanAuthorization,
  getEthereumClaimTypedData
};
