import { buildUpiUri, looksLikeUpiUri, parseUpiUri } from "../upi";

const VPA = "merchant@ybl";

describe("parseUpiUri — well-formed QRs", () => {
  it("parses a dynamic merchant QR (amount fixed by the merchant)", () => {
    const req = parseUpiUri(
      `upi://pay?pa=${VPA}&pn=Chai%20Point&am=42.50&cu=INR&tr=TXN123&tn=Order%20Payment&mc=5812`
    );
    expect(req).toEqual({
      payeeVpa: VPA,
      payeeName: "Chai Point",
      amount: "42.50",
      currency: "INR",
      transactionRef: "TXN123",
      transactionNote: "Order Payment",
      merchantCode: "5812",
    });
  });

  it("parses a static QR — no amount, the user supplies it", () => {
    const req = parseUpiUri(`upi://pay?pa=${VPA}&pn=Corner%20Shop`);
    expect(req?.amount).toBeNull();
    expect(req?.payeeVpa).toBe(VPA);
  });

  it("accepts the spellings QR encoders actually emit", () => {
    // Uppercase scheme, and the authority-less `upi:pay?…` form.
    expect(parseUpiUri(`UPI://PAY?pa=${VPA}`)?.payeeVpa).toBe(VPA);
    expect(parseUpiUri(`upi:pay?pa=${VPA}`)?.payeeVpa).toBe(VPA);
    expect(parseUpiUri(`  upi://pay?pa=${VPA}  `)?.payeeVpa).toBe(VPA);
  });

  it("accepts real-world handle shapes with digits and hyphens", () => {
    expect(parseUpiUri("upi://pay?pa=shop.1_x@okhdfcbank")?.payeeVpa).toBe("shop.1_x@okhdfcbank");
    expect(parseUpiUri("upi://pay?pa=a-b@paytm-1")?.payeeVpa).toBe("a-b@paytm-1");
  });
});

describe("parseUpiUri — rejects what it cannot pay safely", () => {
  it("rejects a non-UPI string", () => {
    expect(parseUpiUri("0x7045E4f6C1B5EDf8b0C6b9d3D6bE9E4E1FAAa31e")).toBeNull();
    expect(parseUpiUri("https://furlpay.com/pay?to=x")).toBeNull();
    expect(parseUpiUri("")).toBeNull();
  });

  it("rejects a missing or malformed VPA — nothing routes money without it", () => {
    expect(parseUpiUri("upi://pay?pn=NoPayee&am=10")).toBeNull();
    expect(parseUpiUri("upi://pay?pa=nohandle")).toBeNull();
    expect(parseUpiUri("upi://pay?pa=@ybl")).toBeNull();
    expect(parseUpiUri("upi://pay?pa=a@1bank")).toBeNull(); // handle must start alpha
  });

  it("rejects a non-INR currency rather than showing an unpayable figure", () => {
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=10&cu=USD`)).toBeNull();
  });

  // A malformed amount is NOT a static QR. Treating it as one would drop the
  // charge the merchant intended and silently ask the user to type their own.
  it("rejects a malformed amount instead of falling back to 'static'", () => {
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=1,000`)).toBeNull();
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=1e6`)).toBeNull();
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=10.999`)).toBeNull();
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=-5`)).toBeNull();
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=0`)).toBeNull();
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=abc`)).toBeNull();
  });

  it("rejects an absurd amount", () => {
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=999999999`)).toBeNull();
  });

  it("treats an empty am= as a static QR (the field is simply blank)", () => {
    expect(parseUpiUri(`upi://pay?pa=${VPA}&am=`)?.amount).toBeNull();
  });
});

describe("parseUpiUri — hostile display text", () => {
  // `pn` and `tn` are attacker-controlled. They must not be able to forge extra
  // lines in a confirmation screen.
  it("strips control characters from the payee name and note", () => {
    const req = parseUpiUri(
      `upi://pay?pa=${VPA}&pn=${encodeURIComponent("Starbucks\nAmount: ₹1")}` +
        `&tn=${encodeURIComponent("note\r\nVerified: yes")}`
    );
    expect(req?.payeeName).toBe("StarbucksAmount: ₹1");
    expect(req?.payeeName).not.toContain("\n");
    expect(req?.transactionNote).not.toMatch(/[\r\n]/);
  });

  it("caps absurdly long display text", () => {
    const req = parseUpiUri(`upi://pay?pa=${VPA}&pn=${"A".repeat(5000)}`);
    expect(req?.payeeName?.length).toBe(128);
  });

  it("returns a null name rather than an empty string", () => {
    expect(parseUpiUri(`upi://pay?pa=${VPA}&pn=`)?.payeeName).toBeNull();
    expect(parseUpiUri(`upi://pay?pa=${VPA}&pn=%20%20`)?.payeeName).toBeNull();
  });
});

describe("looksLikeUpiUri", () => {
  it("distinguishes 'malformed UPI QR' from 'not a UPI QR'", () => {
    expect(looksLikeUpiUri("upi://pay?pa=broken")).toBe(true);
    expect(parseUpiUri("upi://pay?pa=broken")).toBeNull();
    expect(looksLikeUpiUri("0xabc")).toBe(false);
  });
});

describe("buildUpiUri", () => {
  it("round-trips a parsed request", () => {
    const original = `upi://pay?pa=${VPA}&pn=Chai%20Point&am=42.50&cu=INR&tr=TXN123`;
    const req = parseUpiUri(original)!;
    const rebuilt = buildUpiUri(req);
    expect(parseUpiUri(rebuilt)).toEqual(req);
  });

  it("encodes spaces as %20, not '+' (PSP apps pass '+' through literally)", () => {
    const req = parseUpiUri(`upi://pay?pa=${VPA}&pn=Chai%20Point`)!;
    expect(buildUpiUri(req)).toContain("pn=Chai%20Point");
    expect(buildUpiUri(req)).not.toContain("+");
  });

  it("applies an amount override for a static QR", () => {
    const req = parseUpiUri(`upi://pay?pa=${VPA}`)!;
    expect(buildUpiUri(req, "250.00")).toContain("am=250.00");
  });

  // A UI bug must not be able to hand a payment app a malformed amount.
  it("throws on an invalid override rather than emitting a bad URI", () => {
    const req = parseUpiUri(`upi://pay?pa=${VPA}`)!;
    expect(() => buildUpiUri(req, "abc")).toThrow();
    expect(() => buildUpiUri(req, "-1")).toThrow();
    expect(() => buildUpiUri(req, "999999999")).toThrow();
  });

  it("always emits INR", () => {
    const req = parseUpiUri(`upi://pay?pa=${VPA}`)!;
    expect(buildUpiUri(req)).toContain("cu=INR");
  });
});
