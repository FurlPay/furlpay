import {
  classifySgqrScan,
  crc16CcittFalse,
  crcHex,
  looksLikeSgqr,
  parseAmountToCents,
  parseSgqr,
  parseTlv,
  SgqrParseError,
  verifyCrc,
} from "@/lib/sgqr";

// ---------------------------------------------------------------------------
// DIVERGENCE GUARD.
//
// lib/sgqr.ts is a deliberate duplicate of the web codec (native-app is not in
// the turborepo workspace and cannot import it). These are the SAME canonical
// vectors the web suite asserts — most importantly the published CRC-16/
// CCITT-FALSE check value 0x29B1. If the two copies ever drift, one of the two
// suites goes red instead of the drift being discovered by a user whose
// payment silently went nowhere.
// ---------------------------------------------------------------------------

/** Local TLV encoder — the decoder is what ships; this just builds fixtures. */
function tlv(tag: string, value: string): string {
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

function withCrc(body: string): string {
  const head = `${body}6304`;
  return `${head}${crcHex(head)}`;
}

function payNowTemplate(opts: {
  proxyType: "0" | "2";
  proxyValue: string;
  editable?: "0" | "1";
  expiry?: string;
}): string {
  return (
    tlv("00", "SG.PAYNOW") +
    tlv("01", opts.proxyType) +
    tlv("02", opts.proxyValue) +
    tlv("03", opts.editable ?? "0") +
    (opts.expiry ? tlv("04", opts.expiry) : "")
  );
}

function hawkerLabel(overrides: { amount?: string; currency?: string } = {}): string {
  return withCrc(
    tlv("00", "01") +
      tlv("01", "12") +
      tlv("26", payNowTemplate({ proxyType: "2", proxyValue: "201912345K" })) +
      tlv("53", overrides.currency ?? "702") +
      (overrides.amount !== undefined ? tlv("54", overrides.amount) : "") +
      tlv("58", "SG") +
      tlv("59", "MARINA HAWKER") +
      tlv("60", "Singapore")
  );
}

describe("CRC-16/CCITT-FALSE — pinned to the published check value", () => {
  it('matches 0x29B1 for "123456789"', () => {
    expect(crc16CcittFalse("123456789")).toBe(0x29b1);
    expect(crcHex("123456789")).toBe("29B1");
  });

  it("returns the init value for the empty string", () => {
    expect(crc16CcittFalse("")).toBe(0xffff);
  });

  it("always renders four hex characters", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(crcHex(`payload-${i}`)).toMatch(/^[0-9A-F]{4}$/);
    }
  });
});

describe("TLV decoding", () => {
  it("decodes a flat sequence", () => {
    expect(parseTlv("0002015303702")).toEqual([
      { tag: "00", value: "01" },
      { tag: "53", value: "702" },
    ]);
  });

  it("recurses into merchant account templates", () => {
    const nodes = parseTlv(tlv("26", tlv("00", "SG.PAYNOW") + tlv("01", "2")));
    expect(nodes[0].children).toEqual([
      { tag: "00", value: "SG.PAYNOW" },
      { tag: "01", value: "2" },
    ]);
  });

  it("rejects a length running past the payload", () => {
    expect(() => parseTlv("5925abcd")).toThrow(SgqrParseError);
  });
});

describe("amounts", () => {
  it("parses cents exactly, without float drift", () => {
    // Number("70.07") * 100 === 7006.999999999999
    expect(parseAmountToCents("70.07")).toBe(7007);
    expect(parseAmountToCents("0.01")).toBe(1);
    expect(parseAmountToCents("1")).toBe(100);
    expect(parseAmountToCents("12345.67")).toBe(1234567);
  });

  it("rejects malformed or non-positive amounts", () => {
    for (const bad of ["", "-5.00", "1.234", "1,000.00", "abc", "0"]) {
      expect(() => parseAmountToCents(bad)).toThrow(SgqrParseError);
    }
  });
});

describe("looksLikeSgqr", () => {
  it("accepts an EMVCo payload and rejects everything else the scanner sees", () => {
    expect(looksLikeSgqr(hawkerLabel({ amount: "4.80" }))).toBe(true);
    expect(looksLikeSgqr("0x1111111111111111111111111111111111111111")).toBe(false);
    expect(looksLikeSgqr("upi://pay?pa=merchant@bank")).toBe(false);
    expect(looksLikeSgqr("wc:abc123@2?relay-protocol=irn")).toBe(false);
    expect(looksLikeSgqr("")).toBe(false);
  });
});

describe("parseSgqr", () => {
  it("decodes a dynamic hawker label", () => {
    const p = parseSgqr(hawkerLabel({ amount: "4.80" }));
    expect(p.crc.ok).toBe(true);
    expect(p.initiation).toBe("dynamic");
    expect(p.isSgd).toBe(true);
    expect(p.amountCents).toBe(480);
    expect(p.merchantName).toBe("MARINA HAWKER");
    expect(p.payNow).toMatchObject({ proxyType: "uen", proxyValue: "201912345K" });
  });

  it("finds PayNow outside tag 26 on a multi-scheme label", () => {
    const qr = withCrc(
      tlv("00", "01") +
        tlv("26", tlv("00", "SG.COM.NETS") + tlv("01", "999")) +
        tlv("27", payNowTemplate({ proxyType: "0", proxyValue: "+6591234567" })) +
        tlv("51", tlv("00", "SG.SGQR") + tlv("01", "180307B1B2C3D4")) +
        tlv("53", "702")
    );
    const p = parseSgqr(qr);
    expect(p.payNow?.templateTag).toBe("27");
    expect(p.payNow?.proxyValue).toBe("+6591234567");
    expect(p.sgqrId).toBe("180307B1B2C3D4");
  });

  it("reports a bad CRC rather than throwing", () => {
    const tampered = `${hawkerLabel({ amount: "4.80" }).slice(0, -4)}0000`;
    const p = parseSgqr(tampered);
    expect(p.crc.ok).toBe(false);
    expect(p.merchantName).toBe("MARINA HAWKER");
  });

  it("verifyCrc round-trips a built label", () => {
    expect(verifyCrc(hawkerLabel({ amount: "12.50" })).ok).toBe(true);
  });
});

describe("classifySgqrScan — the scanner contract", () => {
  it("returns not_sgqr for inputs the other parsers own", () => {
    expect(classifySgqrScan("0x1111111111111111111111111111111111111111").kind).toBe("not_sgqr");
    expect(classifySgqrScan("upi://pay?pa=x@y").kind).toBe("not_sgqr");
  });

  it("returns payable for a good hawker label", () => {
    const r = classifySgqrScan(hawkerLabel({ amount: "4.80" }));
    expect(r.kind).toBe("payable");
    if (r.kind === "payable") expect(r.payNow.proxyValue).toBe("201912345K");
  });

  it("refuses a tampered checksum with a distinct reason", () => {
    // The pasted-over-sticker case. Must NOT read as "not payable".
    const tampered = `${hawkerLabel({ amount: "4.80" }).slice(0, -4)}0000`;
    const r = classifySgqrScan(tampered);
    expect(r.kind).toBe("unpayable");
    if (r.kind === "unpayable") expect(r.reason).toBe("bad_crc");
  });

  it("refuses a non-SGD label", () => {
    const r = classifySgqrScan(hawkerLabel({ amount: "4.80", currency: "840" }));
    expect(r.kind).toBe("unpayable");
    if (r.kind === "unpayable") expect(r.reason).toBe("not_sgd");
  });

  it("refuses an EMVCo label with no PayNow scheme", () => {
    const qr = withCrc(
      tlv("00", "01") + tlv("26", tlv("00", "SG.COM.NETS") + tlv("01", "999")) + tlv("53", "702")
    );
    const r = classifySgqrScan(qr);
    expect(r.kind).toBe("unpayable");
    if (r.kind === "unpayable") expect(r.reason).toBe("no_paynow");
  });

  it("refuses a malformed EMVCo payload without throwing", () => {
    const r = classifySgqrScan("000201" + "53");
    expect(r.kind).toBe("unpayable");
    if (r.kind === "unpayable") expect(r.reason).toBe("malformed");
  });

  it("never throws on arbitrary camera input", () => {
    for (const junk of ["", "000201", "00020199", "0002010102", "000201" + "x".repeat(50)]) {
      expect(() => classifySgqrScan(junk)).not.toThrow();
    }
  });
});
