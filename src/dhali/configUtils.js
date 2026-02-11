const Currency = require("./Currency");

/**
 * @typedef {Object} NetworkCurrencyConfig
 * @property {Currency} currency
 * @property {string} destinationAddress
 */

/**
 * Fetches and parses available Dhali currencies and configurations.
 * @returns {Promise<Object.<string, Object.<string, NetworkCurrencyConfig>>>}
 */
/**
 * @param {typeof fetch} [httpClient]
 * @returns {Promise<Object>}
 */
async function getAvailableDhaliCurrencies(httpClient = fetch) {
    const url = "https://raw.githubusercontent.com/Dhali-org/Dhali-config/master/public.prod.json";
    let data;
    try {
        const response = await httpClient(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        data = await response.json();
    } catch (e) {
        throw new Error(`Failed to fetch Dhali configuration: ${e.message}`);
    }

    const publicAddresses = data.DHALI_PUBLIC_ADDRESSES || {};
    /** @type {Object.<string, Object.<string, NetworkCurrencyConfig>>} */
    const result = {};

    for (const [network, currencies] of Object.entries(publicAddresses)) {
        result[network] = {};
        for (const [code, details] of Object.entries(currencies)) {
            const tokenAddress = details.issuer || null;
            const scale = details.scale || 6;
            const destination = details.wallet_id;

            if (!destination) continue;

            const curr = new Currency(code, scale, tokenAddress);

            result[network][code] = {
                currency: curr,
                destinationAddress: destination
            };
        }
    }
    return result;
}

/**
 * Fetches the raw Dhali public configuration JSON.
 * @returns {Promise<Object>}
 */
async function fetchPublicConfig(httpClient = fetch) {
    const url = "https://raw.githubusercontent.com/Dhali-org/Dhali-config/master/public.prod.json";
    try {
        const response = await httpClient(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (e) {
        throw new Error(`Failed to fetch Dhali configuration: ${e.message}`);
    }
}

/**
 * Proactively notifies the Dhali Admin Gateway about a new payment channel.
 * @param {string} protocol 
 * @param {string} currencyIdentifier 
 * @param {string} accountAddress 
 * @param {string} channelId 
 * @param {typeof fetch} [httpClient]
 */
async function notifyAdminGateway(protocol, currencyIdentifier, accountAddress, channelId, httpClient = fetch) {
    const config = await fetchPublicConfig(httpClient);
    const rootUrl = config.ROOT_API_ADMIN_URL;
    if (!rootUrl) return;

    const httpRootUrl = rootUrl.replace("wss://", "https://").replace("ws://", "http://");
    const url = `${httpRootUrl}/public_claim_info/${protocol}/${currencyIdentifier}`;

    if (!channelId.startsWith("0x")) {
        channelId = "0x" + channelId;
    }

    const payload = {
        account: accountAddress,
        channel_id: channelId
    };

    try {
        await httpClient(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        // Best effort notification
    }
}



const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBro8QN3zyJwyo92lYUMPwsyRVPLLGOTcs",
    authDomain: "dhali-prod.firebaseapp.com",
    projectId: "dhali-prod",
    storageBucket: "dhali-prod.firebasestorage.app",
    messagingSenderId: "1042340549063",
    appId: "1:1042340549063:web:3dc69cffe6d3c0746189e2",
    measurementId: "G-6TPZFK7NQ6",
};

/**
 * Queries Firestore via REST API using the public API key.
 * @param {string} protocol 
 * @param {import("./Currency")} currency 
 * @param {string} accountAddress 
 * @param {typeof fetch} [httpClient]
 * @returns {Promise<string|null>}
 */
async function retrieveChannelIdFromFirestoreRest(protocol, currency, accountAddress, httpClient = fetch) {
    let currencyIdentifier = currency.code;
    if (currency.tokenAddress) {
        currencyIdentifier = `${currency.code}.${currency.tokenAddress}`;
    }

    const projectId = FIREBASE_CONFIG.projectId;
    const apiKey = FIREBASE_CONFIG.apiKey;
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/public_claim_info/${protocol}:runQuery?key=${apiKey}`;

    const query = {
        structuredQuery: {
            from: [{ collectionId: currencyIdentifier }],
            where: {
                compositeFilter: {
                    op: "AND",
                    filters: [
                        {
                            fieldFilter: {
                                field: { fieldPath: "account" },
                                op: "EQUAL",
                                value: { stringValue: accountAddress },
                            }
                        },
                        {
                            fieldFilter: {
                                field: { fieldPath: "closed" },
                                op: "NOT_EQUAL",
                                value: { booleanValue: true },
                            }
                        },
                    ],
                }
            },
        }
    };

    try {
        const response = await httpClient(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(query)
        });

        if (!response.ok) return null;

        const results = await response.json();

        for (const result of results) {
            const doc = result.document;
            if (!doc) continue;

            const fields = doc.fields || {};
            const closing = fields.closing ? fields.closing.booleanValue : false;
            const closed = fields.closed ? fields.closed.booleanValue : false;

            if (closing || closed) continue;

            const channelId = fields.channel_id ? fields.channel_id.stringValue : null;
            if (channelId) return channelId;
        }
    } catch (e) {
        return null;
    }
    return null;
}

module.exports = {
    getAvailableDhaliCurrencies,
    fetchPublicConfig,
    notifyAdminGateway,
    retrieveChannelIdFromFirestoreRest
};
