/**
 * Wraps a base64 encoded claim and a base64 encoded requirement into an x402 compliant payload.
 *
 * @param {string} claimBase64 - The base64 encoded claim object.
 * @param {string} paymentRequirementBase64 - The base64 encoded payment requirement object.
 * @returns {string} The base64 encoded x402 payment payload.
 */
function wrapAsX402PaymentPayload(claimBase64, paymentRequirementBase64) {
    const decodedClaim = JSON.parse(
        Buffer.from(claimBase64, "base64").toString("utf-8")
    );
    let req = JSON.parse(
        Buffer.from(paymentRequirementBase64, "base64").toString("utf-8")
    );

    if (req.accepts) {
        req = Array.isArray(req.accepts) ? req.accepts[0] : req.accepts;
    }

    // Normalize fields to match Dhali-wallet's PaymentRequirements defaults (camelCase)
    const normalizedReq = {
        scheme: req.scheme || "",
        network: req.network || "",
        asset: req.asset || (req.price ? req.price.asset : "") || "",
        amount: String(req.amount || (req.price ? req.price.amount : "0")),
        payTo: req.payTo || req.pay_to || "",
        maxTimeoutSeconds: parseInt(
            req.maxTimeoutSeconds || req.max_timeout_seconds || 1209600
        ),
        extra: req.extra || {},
    };

    const x402Payload = {
        x402Version: 2,
        payload: decodedClaim,
        accepted: normalizedReq,
    };

    return Buffer.from(JSON.stringify(x402Payload)).toString("base64");
}

class ChannelNotFound extends Error {
    constructor(message = "No open payment channel found.") {
        super(message);
        this.name = "ChannelNotFound";
    }
}

module.exports = {
    wrapAsX402PaymentPayload,
    ChannelNotFound
};
