const { getEthereumClaimTypedData } = require("./createSignedClaim");
const { ethers } = require("ethers");

const { fetchPublicConfig, notifyAdminGateway, retrieveChannelIdFromFirestoreRest } = require("./configUtils");

class DhaliEthChannelManager {
    /**
    * @param {ethers.Signer} signer
    * @param {import("ethers").Provider} rpc_client
    * @param {string} protocol
    * @param {import("./Currency")} currency
    * @param {typeof fetch} [httpClient] - Injected HTTP client
    * @param {object} [public_config] - Dhali public configuration
    */
    constructor(signer, rpc_client, protocol, currency, httpClient = fetch, public_config) {
        this.signer = signer;
        this.rpc_client = rpc_client;
        this.protocol = protocol;
        this.currency = currency;
        this.httpClient = httpClient || fetch;
        this.public_config = public_config;
        this.chainId = this._getChainIdFromProtocol(protocol);
        this.destinationAddress = undefined;
        this.contractAddress = undefined;
    }

    _getChainIdFromProtocol(protocol) {
        switch (protocol) {
            case "ETHEREUM": return 1;
            case "SEPOLIA": return 11155111;
            case "HOLESKY": return 17000;
            case "LOCALHOST": return 31337;
            default: throw new Error(`Unsupported protocol: ${protocol}`);
        }
    }

    _getProtocolName() {
        return this.protocol;
    }

    async _resolveAddresses() {
        if (this.destinationAddress && this.contractAddress) return;

        if (!this.public_config) {
            this.public_config = await fetchPublicConfig(this.httpClient);
        }

        if (!this.destinationAddress) {
            try {
                this.destinationAddress = this.public_config.DHALI_PUBLIC_ADDRESSES[this.protocol][this.currency.code].wallet_id;
            } catch (e) {
                throw new Error("Destination address not found in public_config for this protocol/currency: " + e.message);
            }
        }

        if (!this.contractAddress) {
            try {
                // @ts-ignore
                this.contractAddress = this.public_config.CONTRACTS[this.protocol].contract_address;
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
        const address = (await this.signer.getAddress()).toLowerCase();
        return await retrieveChannelIdFromFirestoreRest(
            this.protocol,
            this.currency,
            address,
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
        const sender = await this.signer.getAddress();
        return ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "address", "uint256"],
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
        const feeData = await this.rpc_client.getFeeData();
        // Add 10% buffer to gas price
        const gasPrice = (feeData.gasPrice * BigInt(110)) / BigInt(100);

        const txParams = {
            from: await this.signer.getAddress(),
            to: to,
            value: value,
            data: data,
            gasPrice: gasPrice,
            // Use pending nonce
            nonce: await this.signer.getNonce("pending"),
            chainId: this.chainId
        };

        // Estimate gas
        const gasLimit = await this.signer.estimateGas(txParams);
        // Add 10% buffer to gas limit
        txParams.gasLimit = (gasLimit * BigInt(110)) / BigInt(100);

        return txParams;
    }

    /**
     * Deposits funds into a payment channel.
     * If an open channel exists, funds it.
     * If not, opens a new one.
     * @param {string|number} amount Amount in base units (wei/drops)
     * @returns {Promise<ethers.TransactionReceipt>}
     */
    async deposit(amount) {
        await this._resolveAddresses();
        const existingChannelId = await this._retrieveChannelIdFromFirestore();
        const tokenAddress = this.currency.tokenAddress || "0x0000000000000000000000000000000000000000";
        const isNative = (tokenAddress === "0x0000000000000000000000000000000000000000");
        const amountBig = BigInt(amount);

        const OPEN_CHANNEL_SELECTOR = "3cd880a5";
        const DEPOSIT_SELECTOR = "264d06c8";
        const SETTLE_DELAY = 1209600; // 2 weeks

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

            const txParams = await this._buildTx(this.contractAddress, calldata, isNative ? amountBig : 0);
            const tx = await this.signer.sendTransaction(txParams);
            return await tx.wait();

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

            const txParams = await this._buildTx(this.contractAddress, calldata, isNative ? amountBig : 0);
            const tx = await this.signer.sendTransaction(txParams);
            const receipt = await tx.wait();

            // Calculate channel ID and notify gateway
            const calculatedChannelId = await this._calculateChannelId(receiver, tokenAddress, nonce);

            let currencyIdentifier = this.currency.code;
            if (this.currency.tokenAddress) {
                currencyIdentifier = `${this.currency.code}.${this.currency.tokenAddress}`;
            }

            // Proactive notification
            await notifyAdminGateway(
                this.protocol,
                currencyIdentifier,
                await this.signer.getAddress(),
                calculatedChannelId,
                this.httpClient
            );

            // Poll Firestore to match setupBalanceListener behavior
            await this._retrieveChannelIdFromFirestoreWithPolling(30);

            return receipt;
        }
    }

    _generateNonce() {
        const bytes = ethers.randomBytes(32);
        return BigInt(ethers.hexlify(bytes));
    }

    async _approveToken(tokenAddress, spender, amount) {
        const APPROVE_SELECTOR = "095ea7b3";
        const calldata = "0x" +
            APPROVE_SELECTOR +
            this._encodeAddress(spender) +
            this._encodeUint(amount);

        const txParams = await this._buildTx(tokenAddress, calldata, 0);
        const tx = await this.signer.sendTransaction(txParams);
        await tx.wait();
    }
    async _getOnChainChannelAmount(channelId) {
        const cleanId = channelId.replace("0x", "").padStart(64, "0");
        const calldata = "0x831c2b82" + cleanId;

        try {
            const result = await this.rpc_client.call({
                to: this.contractAddress,
                data: calldata
            });

            if (result === "0x" || result.length < 322) {
                throw new Error("Invalid getChannel response length");
            }

            // The amount is the 5th 32-byte word (index 4).
            // Result is a hex string "0x...".
            // Word 0: 2 to 66
            // Word 1: 66 to 130
            // Word 2: 130 to 194
            // Word 3: 194 to 258
            // Word 4: 258 to 322
            const amountHex = "0x" + result.substring(258, 322);
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
            throw new Error("No open payment channel found in Firestore. Please deposit first.");
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
            allowed,
            this.chainId,
            this.contractAddress
        );

        const signature = await this.signer.signTypedData(domain, types, value);

        const claim = {
            version: "2",
            account: await this.signer.getAddress(),
            protocol: this.protocol,
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
