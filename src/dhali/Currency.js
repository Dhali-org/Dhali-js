class Currency {
    constructor(code, scale, tokenAddress = null) {
        this.code = code;
        this.scale = scale;
        this.tokenAddress = tokenAddress;
    }
}

module.exports = Currency;
