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

If you have an API you want to monetize on Dhali, you can use the `DhaliAssetManager` to receive off-chain payments.

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

Once created, youcan receive off-chain x402 payments using the facilitator:
`https://x402.api.dhali.io`


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

### 3. Closing a Channel

To close a channel and settle final balances, use the **Admin Gateway WebSocket**. This process involves a challenge-response signature to verify ownership.

```js
const WebSocket = require('ws');
const rippleKeypairs = require('ripple-keypairs'); // For XRPL

async function closeChannel() {
    const wsUrl = "wss://api.admin.gateway/ws/close-channel"; // or from public config
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
        // 1. Send Closure Request
        ws.send(JSON.stringify({
            schema: "api_admin_gateway_closure_request",
            schema_version: "1.0",
            wallet: {
                type: "Dhali-js",
                address: wallet.classicAddress,
                protocol: "XRPL.TESTNET",
                publicKey: wallet.publicKey,
                currency: { code: "XRP", scale: 6, issuer: null }
            },
            protocol: "XRPL.TESTNET",
            currency: "XRP"
        }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);

        // 2. Handle Signature Challenge
        if (msg.schema === "api_admin_gateway_message_to_be_signed") {
            const signature = rippleKeypairs.sign(
                Buffer.from(JSON.stringify(msg.message, null, 0), 'utf8').toString('hex'), 
                wallet.privateKey
            );

            ws.send(JSON.stringify({
                schema: "api_admin_gateway_signed_message_response",
                schema_version: "1.1",
                signature: signature,
                public_key: wallet.publicKey
            }));
        } else if (msg.success) {
            console.log('Channel closure initiated:', msg.message);
            ws.close();
        }
    });
}
```
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