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
const { Wallet } = require('xrpl')
const { DhaliChannelManager, ChannelNotFound } = require('dhali-js')

const seed = "sXXX"

;(async () => {
  const wallet = Wallet.fromSeed(seed)
  const manager = new DhaliChannelManager(wallet)
  
  let token
  try {
    token = await manager.getAuthToken()
  } catch (err) {
    if (err instanceof ChannelNotFound) {
      await manager.deposit(1_000_000)
      token = await manager.getAuthToken()
    } else {
      console.error(err)
      process.exit(1)
    }
  }

  const url = `https://xrplcluster.dhali.io?payment-claim=${token}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'account_info',
      params: [{ account: wallet.classicAddress, ledger_index: 'validated' }],
      id: 1,
    }),
  })
  const result = await resp.json()
  console.log(result)
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
