import { describe, expect, it } from "vitest";
import {
  assertPayable,
  buildPayNowQr,
  crc16CcittFalse,
  crcHex,
  encodeTlv,
  formatCents,
  ISO4217_SGD,
  parseAmountToCents,
  parseSgqr,
  parseTlv,
  SgqrParseError,
  verifyCrc,
} from "@/lib/rails/singapore/sgqr";

describe("CRC-16/CCITT-FALSE", () => {
  // The published check value for this CRC variant. Without this vector the
  // implementation is only self-consistent: build and parse would agree with
  // each other while every real bank app rejected the code.
  it("matches the canonical check value for \"123456789\"", () => {
    expect(crc16CcittFalse("123456789")).toBe(0x29b1);
    expect(crcHex("123456789")).toBe("29B1");
  });

  it("returns 0xFFFF for the empty string (the init value, unmodified)", () => {
    expect(crc16CcittFalse("")).toBe(0xffff);
  });

  it("always renders four hex characters", () => {
    // Exercise a spread of inputs; a missing padStart shows up as length 3.
    for (let i = 0; i < 200; i += 1) {
      expect(crcHex(`payload-${i}`)).toMatch(/^[0-9A-F]{4}$/);
    }
  });
});

describe("TLV codec", () => {
  it("round-trips a flat sequence", () => {
    const encoded = encodeTlv("00", "01") + encodeTlv("53", "702");
    expect(encoded).toBe("0002015303702");
    expect(parseTlv(encoded)).toEqual([
      { tag: "00", value: "01" },
      { tag: "53", value: "702" },
    ]);
  });

  it("recurses into merchant account templates", () => {
    const inner = encodeTlv("00", "SG.PAYNOW") + encodeTlv("01", "2");
    const nodes = parseTlv(encodeTlv("26", inner));
    expect(nodes[0].children).toEqual([
      { tag: "00", value: "SG.PAYNOW" },
      { tag: "01", value: "2" },
    ]);
  });

  it("rejects a length that runs past the end of the payload", () => {
    // Tag 59 claims 25 characters but only 4 follow.
    expect(() => parseTlv("5925abcd")).toThrow(SgqrParseError);
  });

  it("rejects a truncated trailer rather than returning a partial read", () => {
    expect(() => parseTlv("000201" + "53")).toThrow(/Truncated TLV/);
  });

  it("rejects a non-numeric length", () => {
    expect(() => parseTlv("00XX01")).toThrow(/Malformed length/);
  });

  it("refuses to encode a value longer than the 2-digit length field", () => {
    expect(() => encodeTlv("59", "x".repeat(100))).toThrow(/max 99/);
  });
});

describe("amount handling", () => {
  it("parses cents exactly, without float drift", () => {
    // Number("70.07") * 100 === 7006.999999999999 — flooring that loses a cent.
    expect(parseAmountToCents("70.07")).toBe(7007);
    expect(parseAmountToCents("0.01")).toBe(1);
    expect(parseAmountToCents("1")).toBe(100);
    expect(parseAmountToCents("1.5")).toBe(150);
    expect(parseAmountToCents("12345.67")).toBe(1234567);
  });

  it("round-trips through formatCents", () => {
    for (const cents of [1, 5, 99, 100, 150, 7007, 1234567]) {
      expect(parseAmountToCents(formatCents(cents))).toBe(cents);
    }
  });

  it("rejects malformed or non-positive amounts", () => {
    for (const bad of ["", "-5.00", "1.234", "1,000.00", "abc", "0", "0.00"]) {
      expect(() => parseAmountToCents(bad)).toThrow(SgqrParseError);
    }
  });
});

describe("buildPayNowQr", () => {
  const base = {
    proxyType: "uen" as const,
    proxyValue: "201912345K",
    merchantName: "MARINA HAWKER",
    amountCents: 480,
  };

  it("produces a payload whose own CRC verifies", () => {
    const qr = buildPayNowQr(base);
    expect(verifyCrc(qr).ok).toBe(true);
    expect(qr.endsWith(crcHex(qr.slice(0, -4)))).toBe(true);
  });

  it("emits the documented header, currency and country tags", () => {
    const qr = buildPayNowQr(base);
    expect(qr.startsWith("000201")).toBe(true); // format indicator
    expect(qr).toContain("010212"); // dynamic point of initiation
    expect(qr).toContain(`5303${ISO4217_SGD}`);
    expect(qr).toContain("5802SG");
    expect(qr).toContain("SG.PAYNOW");
  });

  it("forces the editable flag on when no amount is fixed", () => {
    const qr = buildPayNowQr({ ...base, amountCents: undefined, amountEditable: false });
    expect(parseSgqr(qr).payNow?.amountEditable).toBe(true);
    expect(parseSgqr(qr).amountCents).toBeUndefined();
  });

  it("encodes a static sticker with point of initiation 11", () => {
    const qr = buildPayNowQr({ ...base, initiation: "static" });
    expect(parseSgqr(qr).initiation).toBe("static");
  });

  it("rejects a mobile proxy that is not a Singapore number", () => {
    for (const bad of ["91234567", "+6512345678", "+14155550100", "+659123456"]) {
      expect(() => buildPayNowQr({ ...base, proxyType: "mobile", proxyValue: bad })).toThrow();
    }
  });

  it("accepts the three ACRA UEN shapes and rejects junk", () => {
    for (const uen of ["12345678A", "201912345K", "T09LL0001B"]) {
      expect(() => buildPayNowQr({ ...base, proxyValue: uen })).not.toThrow();
    }
    for (const bad of ["1234", "ABCDEFGHI", "201912345"]) {
      expect(() => buildPayNowQr({ ...base, proxyValue: bad })).toThrow();
    }
  });
});

describe("parseSgqr", () => {
  it("round-trips every field a built label carries", () => {
    const qr = buildPayNowQr({
      proxyType: "mobile",
      proxyValue: "+6591234567",
      amountCents: 1250,
      amountEditable: false,
      merchantName: "KOPI STALL 42",
      merchantCity: "Singapore",
      merchantCategoryCode: "5812",
      referenceLabel: "TABLE-7",
      billNumber: "INV-99",
      expiryDate: "20991231",
    });

    const p = parseSgqr(qr);
    expect(p.crc.ok).toBe(true);
    expect(p.initiation).toBe("dynamic");
    expect(p.isSgd).toBe(true);
    expect(p.amountCents).toBe(1250);
    expect(p.amountRaw).toBe("12.50");
    expect(p.merchantName).toBe("KOPI STALL 42");
    expect(p.merchantCity).toBe("Singapore");
    expect(p.merchantCategoryCode).toBe("5812");
    expect(p.countryCode).toBe("SG");
    expect(p.referenceLabel).toBe("TABLE-7");
    expect(p.billNumber).toBe("INV-99");
    expect(p.payNow).toMatchObject({
      templateTag: "26",
      proxyType: "mobile",
      proxyValue: "+6591234567",
      amountEditable: false,
      expiryDate: "20991231",
    });
  });

  it("finds PayNow when a multi-scheme label puts it outside tag 26", () => {
    // A real SGQR sticker carries several schemes; PayNow is not pinned to 26.
    const payNowTemplate =
      encodeTlv("00", "SG.PAYNOW") +
      encodeTlv("01", "2") +
      encodeTlv("02", "201912345K") +
      encodeTlv("03", "0");
    const netsTemplate = encodeTlv("00", "SG.COM.NETS") + encodeTlv("01", "999");
    const sgqrTemplate = encodeTlv("00", "SG.SGQR") + encodeTlv("01", "180307B1B2C3D4");

    const body =
      encodeTlv("00", "01") +
      encodeTlv("01", "11") +
      encodeTlv("26", netsTemplate) +
      encodeTlv("27", payNowTemplate) +
      encodeTlv("51", sgqrTemplate) +
      encodeTlv("53", ISO4217_SGD) +
      encodeTlv("58", "SG") +
      encodeTlv("59", "MIXED MERCHANT");
    const qr = `${body}6304${crcHex(`${body}6304`)}`;

    const p = parseSgqr(qr);
    expect(p.payNow?.templateTag).toBe("27");
    expect(p.payNow?.proxyType).toBe("uen");
    expect(p.payNow?.proxyValue).toBe("201912345K");
    expect(p.sgqrId).toBe("180307B1B2C3D4");
  });

  it("reports a bad CRC instead of throwing, so the UI can explain it", () => {
    const qr = buildPayNowQr({
      proxyType: "uen",
      proxyValue: "201912345K",
      merchantName: "MARINA HAWKER",
      amountCents: 480,
    });
    const tampered = `${qr.slice(0, -4)}0000`;
    const p = parseSgqr(tampered);
    expect(p.crc.ok).toBe(false);
    expect(p.merchantName).toBe("MARINA HAWKER");
  });

  it("rejects a payload that is not an EMVCo merchant QR", () => {
    expect(() => parseSgqr("https://furlpay.com/pay/abc")).toThrow(SgqrParseError);
    expect(() => parseSgqr("000299")).toThrow(SgqrParseError);
  });

  it("returns payNow: null for a label carrying no PayNow scheme", () => {
    const netsTemplate = encodeTlv("00", "SG.COM.NETS") + encodeTlv("01", "999");
    const body =
      encodeTlv("00", "01") + encodeTlv("26", netsTemplate) + encodeTlv("53", ISO4217_SGD);
    const qr = `${body}6304${crcHex(`${body}6304`)}`;
    expect(parseSgqr(qr).payNow).toBeNull();
  });

  it("throws when the PayNow template declares an unknown proxy type", () => {
    const tpl = encodeTlv("00", "SG.PAYNOW") + encodeTlv("01", "7") + encodeTlv("02", "x");
    const body = encodeTlv("00", "01") + encodeTlv("26", tpl);
    const qr = `${body}6304${crcHex(`${body}6304`)}`;
    expect(() => parseSgqr(qr)).toThrow(/proxy type/);
  });
});

describe("assertPayable", () => {
  const good = () =>
    buildPayNowQr({
      proxyType: "uen",
      proxyValue: "201912345K",
      merchantName: "MARINA HAWKER",
      amountCents: 480,
    });

  it("passes a well-formed label", () => {
    const p = assertPayable(parseSgqr(good()));
    expect(p.payNow.proxyValue).toBe("201912345K");
  });

  it("refuses a label whose checksum does not verify", () => {
    const tampered = `${good().slice(0, -4)}0000`;
    expect(() => assertPayable(parseSgqr(tampered))).toThrow(/checksum mismatch/);
  });

  it("refuses a label with no PayNow scheme", () => {
    const netsTemplate = encodeTlv("00", "SG.COM.NETS") + encodeTlv("01", "999");
    const body = encodeTlv("00", "01") + encodeTlv("26", netsTemplate);
    const qr = `${body}6304${crcHex(`${body}6304`)}`;
    expect(() => assertPayable(parseSgqr(qr))).toThrow(/cannot settle/);
  });

  it("refuses a non-SGD label", () => {
    const tpl =
      encodeTlv("00", "SG.PAYNOW") + encodeTlv("01", "2") + encodeTlv("02", "201912345K");
    const body =
      encodeTlv("00", "01") + encodeTlv("26", tpl) + encodeTlv("53", "840"); // USD
    const qr = `${body}6304${crcHex(`${body}6304`)}`;
    expect(() => assertPayable(parseSgqr(qr))).toThrow(/settles SGD/);
  });

  it("refuses an expired code but honours the Singapore civil date", () => {
    const qr = buildPayNowQr({
      proxyType: "uen",
      proxyValue: "201912345K",
      merchantName: "MARINA HAWKER",
      amountCents: 480,
      expiryDate: "20260401",
    });
    const parsed = parseSgqr(qr);

    // Comfortably past — expired.
    expect(() => assertPayable(parsed, new Date("2026-04-05T00:00:00Z"))).toThrow(/expired/);

    // 2026-04-01 23:00 UTC is already 2026-04-02 in Singapore (UTC+8): expired.
    expect(() => assertPayable(parsed, new Date("2026-04-01T23:00:00Z"))).toThrow(/expired/);

    // 2026-03-31 20:00 UTC is 2026-04-01 in Singapore: still the valid day.
    // A naive UTC comparison would wrongly reject this one.
    expect(() => assertPayable(parsed, new Date("2026-03-31T20:00:00Z"))).not.toThrow();
  });
});
