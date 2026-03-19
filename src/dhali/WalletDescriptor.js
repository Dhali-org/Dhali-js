class WalletDescriptor {
    /**
     * @param {string} address - The classic address of the wallet
     * @param {string} protocol - The network protocol (e.g., 'XRPL.TESTNET', 'ETHEREUM')
     * @param {string} [type='Dhali-js'] - The type of wallet (defaults to 'Dhali-js')
     */
    constructor(address, protocol, type = 'Dhali-js') {
        this.address = address;
        this.protocol = protocol;
        this.type = type;
    }

    /**
     * Converts to JSON format expected by Dhali backend
     * @returns {Object}
     */
    toJson() {
        return {
            address: this.address,
            wallet_id: this.address, // Backward compatibility or specific gateway requirement
            type: this.type,
            protocol: this.protocol
        };
    }
}

module.exports = { WalletDescriptor };
