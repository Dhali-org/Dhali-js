class AssetUpdates {
    /**
     * @param {Object} options
     * @param {string} [options.name]
     * @param {number} [options.earningRate]
     * @param {string} [options.earningType]
     * @param {string} [options.url]
     * @param {Object} [options.headers]
     * @param {string} [options.docs]
     * @param {number} [options.maxSurcharge]
     * @param {number} [options.assetPricingRate]
     * @param {number} [options.assetPricingMaxSurcharge]
     * @param {Object} [options.assetPricingCurrency]
     */
    constructor({
        name,
        earningRate,
        earningType,
        url,
        headers,
        docs,
        maxSurcharge,
        assetPricingRate,
        assetPricingMaxSurcharge,
        assetPricingCurrency
    } = {}) {
        this.name = name;
        this.earningRate = earningRate;
        this.earningType = earningType;
        this.url = url;
        this.headers = headers;
        this.docs = docs;
        this.maxSurcharge = maxSurcharge;
        this.assetPricingRate = assetPricingRate;
        this.assetPricingMaxSurcharge = assetPricingMaxSurcharge;
        this.assetPricingCurrency = assetPricingCurrency;
    }

    /**
     * Converts the updates to the format expected by api-admin-gateway
     * @returns {Object}
     */
    toGatewayFormat() {
        const updates = {};
        if (this.name !== undefined) updates["name"] = this.name;
        if (this.earningRate !== undefined) updates["asset_earning_rate"] = this.earningRate;
        if (this.earningType !== undefined) updates["asset_earning_type"] = this.earningType;
        if (this.docs !== undefined) updates["docs"] = this.docs;
        if (this.maxSurcharge !== undefined) updates["asset_earning_max_surcharge"] = this.maxSurcharge;
        if (this.assetPricingRate !== undefined) updates["asset_pricing_rate"] = this.assetPricingRate;
        if (this.assetPricingMaxSurcharge !== undefined) updates["asset_pricing_max_surcharge"] = this.assetPricingMaxSurcharge;
        if (this.assetPricingCurrency !== undefined) updates["asset_pricing_currency"] = this.assetPricingCurrency;

        // Credentials/URL and headers are special
        if (this.url !== undefined || this.headers !== undefined) {
            updates["api_credentials"] = {};
            if (this.url !== undefined) updates["api_credentials"]["url"] = this.url;
            if (this.headers !== undefined) {
                Object.assign(updates["api_credentials"], this.headers);
            }
        }

        return updates;
    }
}

module.exports = { AssetUpdates };
