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

> [!TIP]
> The examples below use CommonJS (`require`). Because they use `await`, the code is wrapped in an `async function main() { ... }` which is called immediately. To run these, simply save them to a `.js` file and run `node document.js`.

---

## Quick Start: Machine-to-Machine Payments

### 1. XRPL

Uses `xrpl.js` for local signing.

```js
const { Client, Wallet } = require('xrpl')
const { DhaliChannelManager, ChannelNotFound, Currency } = require('dhali-js')

async function main() {
    const seed    = "sXXX..."
    const wallet  = Wallet.fromSeed(seed)
    const client  = new Client("wss://s.altnet.rippletest.net:51233")
    await client.connect()

    const currency = new Currency("XRPL.TESTNET", "XRP", 6)

    // Use Factory
    const manager = DhaliChannelManager.xrpl(wallet, client, currency)

    // Generate Claim
    const amount = Math.floor(1.0 * Math.pow(10, currency.scale)); // 1 XRP
    let token;
    try {
        token = await manager.getAuthToken();
    } catch (error) {
        if (error.name === "ChannelNotFound") {
           await manager.deposit(amount);
           token = await manager.getAuthToken();
        } else {
           throw error;
        }
    }
    console.log('XRPL Token:', token);
}

main();
```

### 2. Ethereum (EVM)

Uses `viem` for EIP-712 signing.

```js
const { createWalletClient, createPublicClient, http } = require('viem')
const { privateKeyToAccount } = require('viem/accounts')
const { mainnet, sepolia } = require('viem/chains')
const { DhaliChannelManager, getAvailableDhaliCurrencies } = require('dhali-js')

async function main() {
    // 1. Setup Clients
    const account = privateKeyToAccount('0x...')
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http()
    })
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http()
    })

    // 2. Fetch Available Currencies
    const currencies = await getAvailableDhaliCurrencies()
    const sepoliaUsdc = currencies.find(c => c.network === "SEPOLIA" && c.code === "USDC")

    // 3. Instantiate Manager with Dynamic Config
    const manager = DhaliChannelManager.evm(
        walletClient,
        publicClient,
        sepoliaUsdc
    )

    // 4. Generate Claim
    const amount = Math.floor(0.1 * Math.pow(10, sepoliaUsdc.scale)); // 0.10 USDC
    let token;
    try {
        token = await manager.getAuthToken(amount);
    } catch (error) {
        if (error.name === "ChannelNotFound") {
           await manager.deposit(amount);
           token = await manager.getAuthToken(amount);
        } else {
           throw error;
        }
    }
    console.log('EVM Token:', token);
}

main();
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

async function main() {
    // 1. Get your token as usual
    const token = await manager.getAuthToken();

    // 2. Get the payment requirement from the 'payment-required' header of a 402 response
    const paymentRequirement = response.headers.get("payment-required");

    // 3. Wrap into an x402 payload
    const x402Payload = wrapAsX402PaymentPayload(token, paymentRequirement);

    // 4. Use 'x402Payload' in the 'Payment' header
}

main();
```


---

## Asset Management (for Providers)

If you have an API you want to monetize on Dhali, you can use the `DhaliAssetManager` to create and update your asset on the network.

### 1. Create an Asset

This generates an **Asset ID (UUID)**.

#### XRPL Setup
```js
const { Wallet } = require('xrpl');
const wallet = Wallet.fromSeed("s..."); // Your XRPL seed
```

#### EVM Setup
```js
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { sepolia } = require('viem/chains');

const walletClient = createWalletClient({
    account: privateKeyToAccount("0x..."),
    chain: sepolia,
    transport: http()
});
```

#### Initialization & Creation
```js
const { DhaliAssetManager, WalletDescriptor, Currency } = require('dhali-js');

async function main() {
    // For XRPL
    const manager = DhaliAssetManager.xrpl(wallet);
    const walletDescriptor = new WalletDescriptor(wallet.classicAddress, "XRPL.TESTNET");
    
    // OR For EVM
    // const manager = DhaliAssetManager.evm(walletClient);
    // const walletDescriptor = new WalletDescriptor(walletClient.account.address, "SEPOLIA");

    const currency = new Currency("XRPL.TESTNET", "XRP", 6);

    // Create the asset
    const result = await manager.createAsset(walletDescriptor, currency);
    console.log("Your new Asset ID:", result.uuid);
}
```

Once created, your asset is represented by an **off-chain facilitator address**:  
`https://x402.api.dhali.io/<uuid>`

This facilitator is used for protocol-level concerns like verification and settlement, while your actual service requests are sent to your **Resource Server**.

### 2. Update an Asset

You can update your asset's metadata (name, rates, etc.) at any time.

```js
const { AssetUpdates } = require('dhali-js');

async function main() {
    const updates = new AssetUpdates({
        name: "My Optimized AI API",
        earning_rate: 100,            // 100 drops per request
        earning_type: "per_request"   // or "per_second"
    });

    const result = await manager.updateAsset(assetId, walletDescriptor, updates);
    console.log("Asset updated successfully");
}
```

---

## API Reference

### `DhaliChannelManager` (Factory)

* `.xrpl(wallet, client, currency)`: Returns `DhaliXrplChannelManager`.
* `.evm(walletClient, publicClient, currency)`: Returns `DhaliEthChannelManager`.

### `DhaliEthChannelManager` & `DhaliXrplChannelManager`

Both managers provide the following core methods:

* `async deposit(amount)`: Deposits funds into a payment channel. For EVM/XRPL, `amount` is in base units (wei/drops, etc). If no channel exists, it creates one; if it exists, it funds it.
* `async getAuthToken(amount = null)`: Generates a base64-encoded payment claim. If `amount` is provided, the claim is authorized up to that value. Defaults to total channel capacity if `amount` is `null`.

### `getAvailableDhaliCurrencies()`

Returns a Promise resolving to an array of `Currency` objects:
```js
[
    { network: "SEPOLIA", code: "USDC", scale: 6, tokenAddress: "..." },
    ...
]
```

---

## Utilities

### `wrapAsX402PaymentPayload(token, paymentRequirement)`

Wraps an auth token and a payment requirement (retrieved from a 402 response header) into a base64-encoded x402-compliant payload.

* **`token`**: The base64-encoded claim generated by `getAuthToken()`.
* **`paymentRequirement`**: The base64-encoded requirement string from the `payment-required` header.

---