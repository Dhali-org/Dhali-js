const { wrapAsX402PaymentPayload } = require("../src/dhali/utils");

describe("wrapAsX402PaymentPayload", () => {
    const mockClaim = {
        version: "2",
        account: "rAccount",
        protocol: "XRPL.MAINNET",
        currency: { code: "XRP", scale: 6 },
        destination_account: "rDest",
        authorized_to_claim: "1000000",
        channel_id: "chan123",
        signature: "sig123",
    };
    const claimBase64 = Buffer.from(JSON.stringify(mockClaim)).toString("base64");

    const mockReqFull = {
        accepts: [
            {
                scheme: "dhali",
                network: "xrpl:0",
                asset: "xrpl:0/native:xrp",
                amount: "70",
                pay_to: "rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR",
                max_timeout_seconds: 1209600,
                extra: {},
            },
        ],
    };
    const reqFullBase64 = Buffer.from(JSON.stringify(mockReqFull)).toString(
        "base64"
    );

    const mockReqDhaliApp = {
        scheme: "dhali",
        network: "eip155:1",
        payTo: "0x3D85634D9EA2854F4276eE5372Bf32Eb4ACDbf77",
        price: {
            amount: "10000000000",
            asset: "eip155:1/erc20:0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
        },
        maxTimeoutSeconds: 1209600,
        extra: {},
    };
    const reqDhaliAppBase64 = Buffer.from(JSON.stringify(mockReqDhaliApp)).toString(
        "base64"
    );

    test("should wrap claim and full requirements correctly", () => {
        const resultBase64 = wrapAsX402PaymentPayload(claimBase64, reqFullBase64);
        const result = JSON.parse(Buffer.from(resultBase64, "base64").toString());

        expect(result.x402Version).toBe(2);
        expect(result.payload).toEqual(mockClaim);
        expect(result.accepted.amount).toBe("70");
        expect(result.accepted.payTo).toBe("rLggTEwmTe3eJgyQbCSk4wQazow2TeKrtR");
    });

    test("should wrap and normalize Dhali-app style requirements correctly", () => {
        const resultBase64 = wrapAsX402PaymentPayload(claimBase64, reqDhaliAppBase64);
        const result = JSON.parse(Buffer.from(resultBase64, "base64").toString());

        expect(result.accepted.amount).toBe("10000000000");
        expect(result.accepted.asset).toBe(
            "eip155:1/erc20:0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD"
        );
        expect(result.accepted.payTo).toBe(
            "0x3D85634D9EA2854F4276eE5372Bf32Eb4ACDbf77"
        );
    });
});
