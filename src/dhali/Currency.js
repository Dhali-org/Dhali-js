class Currency {
    constructor(network, code, scale, tokenAddress = null) {
        this.network = network;
        this.code = code;
        this.scale = scale;
        this.tokenAddress = tokenAddress;
    }
}

module.exports = Currency;
