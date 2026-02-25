[![Package Tests](https://github.com/Dhali-org/Dhali-js/actions/workflows/tests.yaml/badge.svg)](https://github.com/Dhali-org/Dhali-js/actions/workflows/tests.yaml)
[![Release](https://github.com/Dhali-org/Dhali-js/actions/workflows/publish.yaml/badge.svg)](https://github.com/Dhali-org/Dhali-js/actions/workflows/publish.yaml)


# dhali-js

A JavaScript library for managing payment channels (XRPL & Ethereum) and generating auth tokens for use with [Dhali](https://dhali.io) APIs. 

Includes support for **Machine-to-Machine (M2M) payments** using seamless off-chain claims.

---

## Installation

```bash
npm install dhali-js
```

---

## Quick Start: Machine-to-Machine Payments

### 1. XRPL

Uses `xrpl.js` for local signing.

```js
const { Client, Wallet } = require('xrpl')
const { DhaliChannelManager, ChannelNotFound, Currency } = require('dhali-js')

const seed    = "sXXX..."
const wallet  = Wallet.fromSeed(seed)
const client  = new Client("wss://s.altnet.rippletest.net:51233")
await client.connect()

const currency = new Currency("XRP", 6)

// Use Factory
const manager = DhaliChannelManager.xrpl(wallet, client, "XRPL.TESTNET", currency)

// Generate Claim
let token;
try {
    token = await manager.getAuthToken();
} catch (error) {
    if (error.name === "ChannelNotFound") {
       await manager.deposit(1000000); // Deposit 1 XRP
       token = await manager.getAuthToken();
    } else {
       throw error;
    }
}
console.log('XRPL Token:', token);
```

### 2. Ethereum (EVM)

Uses `ethers` (v6) for EIP-712 signing.

```js
const { ethers } = require('ethers')
const { DhaliChannelManager, getAvailableDhaliCurrencies } = require('dhali-js')

// 1. Setup Signer
const provider = new ethers.JsonRpcProvider("https://rpc.ankr.com/eth_sepolia")
const signer   = new ethers.Wallet("0x...", provider)

// 2. Fetch Available Currencies
const configs = await getAvailableDhaliCurrencies()
const sepoliaUsdc = configs["SEPOLIA"]["USDC"]

// 3. Instantiate Manager with Dynamic Config
const manager = DhaliChannelManager.evm(
    signer,
    provider,
    "SEPOLIA",
    sepoliaUsdc.currency
)

// 4. Generate Claim
// 4. Generate Claim
let token;
try {
    token = await manager.getAuthToken(1000000); // 1.00 USDC
} catch (error) {
    if (error.name === "ChannelNotFound") {
       await manager.deposit(1000000); // Deposit 1.00 USDC
       token = await manager.getAuthToken(1000000);
    } else {
       throw error;
    }
}
console.log('EVM Token:', token);
```

---

## Integration

Pass the token in your API calls to Dhali-enabled services.

```js
const url = `https://xrplcluster.dhali.io?payment-claim=${token}`
const response = await fetch(url, { method: 'POST', body: ... })
```

## Standardized x402 Payments

For APIs that follow the x402 standard, you may need to wrap your auth token with the payment requirement (retrieved from the `payment-required` header of a 402 response).

```js
const { wrapAsX402PaymentPayload } = require('dhali-js');

// 1. Get your token as usual
const token = await manager.getAuthToken();

// 2. Get the payment requirement from the 'payment-required' header of a 402 response
const paymentRequirement = response.headers.get("payment-required");

// 3. Wrap into an x402 payload
const x402Payload = wrapAsX402PaymentPayload(token, paymentRequirement);

// 4. Use 'x402Payload' in the 'Payment' header
```

---

## API Reference

### `DhaliChannelManager`

* `.xrpl(wallet, client, protocol, currency)`: Returns `DhaliXrplChannelManager`.
* `.evm(signer, provider, protocol, currency)`: Returns `DhaliEthChannelManager`.

### `getAvailableDhaliCurrencies()`

Returns a Promise resolving to:
```js
{
    "SEPOLIA": {
        "USDC": { currency: ..., destinationAddress: ... },
        ...
    },
    ...
}
```

---