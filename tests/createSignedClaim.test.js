const {
  _serializePaychanAuthorization,
  buildPaychanAuthHexStringToBeSigned,
} = require("../src/dhali/createSignedClaim");

describe("_serializePaychanAuthorization", () => {
  test("throws if channelIdBytes length is not 32", () => {
    expect(() =>
      _serializePaychanAuthorization(Buffer.alloc(31), 1000n),
    ).toThrow("Invalid channelId length 31; must be 32 bytes.");
  });

  test("serializes correctly", () => {
    // 32 bytes of 0xAA
    const channelIdBytes = Buffer.alloc(32, 0xaa);
    // a 64-bit drops value
    const drops = 0x1122334455667788n;

    const buf = _serializePaychanAuthorization(channelIdBytes, drops);

    // prefix = 0x434C4D00
    expect(buf.slice(0, 4).toString("hex")).toBe("434c4d00");
    // next 32 bytes are the channelId
    expect(buf.slice(4, 4 + 32)).toEqual(channelIdBytes);
    // final 8 bytes = high + low words
    expect(buf.slice(36).toString("hex")).toBe("1122334455667788");
  });
});

describe("buildPaychanAuthHexStringToBeSigned", () => {
  const zeroHex64 = "00".repeat(32);

  test("negative amount throws", () => {
    expect(() => buildPaychanAuthHexStringToBeSigned(zeroHex64, "-1")).toThrow(
      "Amount cannot be negative.",
    );
  });

  test("non-numeric amount throws", () => {
    expect(() => buildPaychanAuthHexStringToBeSigned(zeroHex64, "foo")).toThrow(
      "Invalid amount format.",
    );
  });

  test("produces correct uppercase hex", () => {
    const channelHex = "AA".repeat(32);
    const amountStr = "123456";
    const hexStr = buildPaychanAuthHexStringToBeSigned(channelHex, amountStr);
    const expected = _serializePaychanAuthorization(
      Buffer.from(channelHex, "hex"),
      BigInt(amountStr),
    )
      .toString("hex")
      .toUpperCase();
    expect(hexStr).toBe(expected);
  });
});
