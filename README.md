# dhali-js

A JavaScript library for managing XRPL payment channels and generating auth tokens for use with [Dhali](https://dhali.io) APIs.  
Leverages [xrpl.js](https://github.com/XRPLF/xrpl.js) and **only ever performs local signing**—your private key never leaves your environment.

---

## Installation

```bash
npm install dhali-js
````

---

## Quick Start

```js
import { Wallet, Client } from 'xrpl'
import {
  ChannelNotFound,
  DhaliChannelManager
} from 'dhali-js'

// 1. Load your wallet from secret
const seed = 'sXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
const wallet = Wallet.fromSeed(seed)

// 2. Create the manager (connects automatically under the hood)
const dhaliManager = new DhaliChannelManager(wallet)

async function getPaymentClaim() {
  try {
    // Get an auth token
    return await dhaliManager.getAuthToken()
  } catch (err) {
    if (err instanceof ChannelNotFound) {
      // If no channel exists, create one with 1 XRP (1 000 000 drops)
      await dhaliManager.deposit(1_000_000)
      return await dhaliManager.getAuthToken()
    }
    throw err
  }
}

;(async () => {
  for (let i = 0; i < 2; i++) {
    const token = await getPaymentClaim()
    const url = `https://xrplcluster.dhali.io?payment-claim=${token}`
    // ... use token in your fetch/post to Dhali API ...
  }
})()
```

---

## API

### `new DhaliChannelManager(wallet: xrpl.Wallet)`

* **wallet**: an `xrpl.js` `Wallet` instance (e.g. `Wallet.fromSeed`).

---

### `async deposit(amountDrops: number) → Promise<object>`

* **amountDrops**: Number of XRP drops (e.g. `1_000_000` = 1 XRP).
* **Returns**: The JSON result of the `PaymentChannelCreate` or `PaymentChannelFund` transaction.

---

### `async getAuthToken(amountDrops?: number) → Promise<string>`

* **amountDrops** (optional): How many drops to authorize; defaults to full channel balance.
* **Returns**: A base64-encoded JSON string containing your signed claim.
* **Throws**:

  * `ChannelNotFound` if there is no open channel.
  * `Error` if `amountDrops` exceeds channel capacity.

---

## Errors

* **ChannelNotFound**
  Thrown when `getAuthToken` finds no channel from your wallet to Dhali’s receiver.

---

## Security

All XRPL interactions and claim-signatures are done locally via `xrpl.js` + `ripple-keypairs`.
Your private key never leaves your machine.
