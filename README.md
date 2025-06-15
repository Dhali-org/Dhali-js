[![Package Tests](https://github.com/Dhali-org/Dhali-js/actions/workflows/tests.yaml/badge.svg)](https://github.com/Dhali-org/Dhali-js/actions/workflows/tests.yaml)
[![Release](https://github.com/Dhali-org/Dhali-js/actions/workflows/publish.yaml/badge.svg)](https://github.com/Dhali-org/Dhali-js/actions/workflows/publish.yaml)


# dhali-js

A JavaScript library for managing XRPL payment channels and generating auth tokens for use with [Dhali](https://dhali.io) APIs.  
Leverages [xrpl.js](https://github.com/XRPLF/xrpl.js) and **only ever performs local signing**—your private key never leaves your environment.

---

## Installation

```bash
npm install dhali-js
```

---

## Quick Start

```js
// ==== 0. Common setup ====
const { Wallet } = require('xrpl')
const { DhaliChannelManager, ChannelNotFound } = require('dhali-js')

const seed    = "sXXX"
const wallet  = Wallet.fromSeed(seed)
const manager = new DhaliChannelManager(wallet)
```


### 1. Create a Payment Claim

```js
let token
try {
  token = await manager.getAuthToken()
} catch (err) {
  if (err instanceof ChannelNotFound) {
    await manager.deposit(1_000_000)       // deposit 1 XRP
    token = await manager.getAuthToken()   // 🔑 regenerate after deposit
  } else throw err
}
console.log('New channel token:', token)
```

---

### 2. Top Up Later (and Regenerate)

```js
await manager.deposit(2_000_000)            // add 2 XRP
const updatedToken = await manager.getAuthToken()
console.log('Updated token:', updatedToken)
```

---

### 3. Using APIs and Handling 402 "Payment Required" Errors

```js
const fetchWithClaim = async (maxRetries = 5) => {
  for (let i = 1; i <= maxRetries; i++) {
    const token = await manager.getAuthToken()
    const url   = `https://xrplcluster.dhali.io?payment-claim=${token}`
    const resp  = await fetch(url, { /* …RPC call… */ })

    if (resp.status !== 402) return resp.json()

    console.warn(`Attempt ${i}: topping up…`)
    await manager.deposit(1_000_000)         // deposit 1 XRP
  }
  throw new Error(`402 after ${maxRetries} retries`)
}

;(async () => {
  const result = await fetchWithClaim()
  console.log(result)
})()
```

---

## Class reference

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
