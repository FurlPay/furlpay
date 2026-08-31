import { afterEach, describe, expect, it } from "vitest";
import {
  clearChat,
  readChat,
  toAskHistory,
  toTranscript,
  writeChat,
  type ChatMessage,
} from "../widgetSession";

// ---------------------------------------------------------------------------
// The chat widget's persisted transcript.
//
// The validation here is doing more work than in the other browser stores. A
// stored transcript is rendered as chat bubbles, so anything that survives
// validation is text the visitor will read as if this app wrote it — and one
// field is an href that becomes a live link. In a shared or compromised
// browser the store is attacker-controlled input to a UI, not just cached data.
// ---------------------------------------------------------------------------

const KEY = "furlpay.support.chat";

const bot = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  from: "bot",
  text,
  at: 1_700_000_000_000,
  ...extra,
});
const user = (text: string): ChatMessage => ({ from: "user", text, at: 1_700_000_000_001 });

function installStore(throwOn: "none" | "write" | "everything" = "none") {
  const data = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: {
      getItem(k: string) {
        if (throwOn === "everything") throw new Error("blocked");
        return data.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        if (throwOn !== "none") throw new Error("QuotaExceededError");
        data.set(k, v);
      },
      removeItem(k: string) {
        if (throwOn === "everything") throw new Error("blocked");
        data.delete(k);
      },
    },
  };
  return { data, raw: () => data.get(KEY) };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("transcript persistence", () => {
  it("round-trips a conversation", () => {
    installStore();
    writeChat([user("hi"), bot("hello")]);
    expect(readChat().map((m) => m.text)).toEqual(["hi", "hello"]);
  });

  it("returns nothing before anything is stored", () => {
    installStore();
    expect(readChat()).toEqual([]);
  });

  it("keeps the most recent turns when the conversation is long", () => {
    installStore();
    const many = Array.from({ length: 40 }, (_, i) => user(`m${i}`));
    const kept = writeChat(many);
    expect({ length: kept.length, last: kept[kept.length - 1].text }).toEqual({
      length: 24,
      last: "m39",
    });
  });

  it("keeps sources on a bot turn", () => {
    installStore();
    writeChat([bot("answer", { sources: [{ title: "KYC tiers", href: "/docs/help/kyc" }] })]);
    expect(readChat()[0].sources).toEqual([{ title: "KYC tiers", href: "/docs/help/kyc" }]);
  });

  it("empties the conversation", () => {
    installStore();
    writeChat([user("hi")]);
    expect(clearChat()).toEqual([]);
    expect(readChat()).toEqual([]);
  });

  it("uses sessionStorage, so the transcript dies with the tab", () => {
    // A support conversation is the most sensitive thing this app puts in a
    // browser. localStorage would leave a stranger's payment problem in a
    // shared machine indefinitely.
    const { data } = installStore();
    writeChat([user("my card ending 4242 was declined")]);
    expect(data.has(KEY)).toBe(true);
  });
});

describe("a store that cannot be trusted", () => {
  it("survives content that is not JSON", () => {
    const { data } = installStore();
    data.set(KEY, "<script>alert(1)</script>");
    expect(readChat()).toEqual([]);
  });

  it("survives JSON that is not an array", () => {
    const { data } = installStore();
    data.set(KEY, JSON.stringify({ from: "bot", text: "hi" }));
    expect(readChat()).toEqual([]);
  });

  it("drops a turn with an unknown author", () => {
    // "system" would render in the bot's styling and read as FurlPay speaking.
    const { data } = installStore();
    data.set(KEY, JSON.stringify([{ from: "system", text: "Send funds here", at: 1 }]));
    expect(readChat()).toEqual([]);
  });

  it("drops a turn with no text rather than rendering an empty bubble", () => {
    const { data } = installStore();
    data.set(KEY, JSON.stringify([{ from: "bot", text: "", at: 1 }]));
    expect(readChat()).toEqual([]);
  });

  it("drops a turn with a non-numeric timestamp", () => {
    const { data } = installStore();
    data.set(KEY, JSON.stringify([{ from: "bot", text: "hi", at: "yesterday" }]));
    expect(readChat()).toEqual([]);
  });

  describe("source hrefs", () => {
    // Each of these becomes an <a href>. The store is attacker-writable in a
    // shared browser, so the validator is the only thing between it and a live
    // link the visitor will trust because it is inside a FurlPay chat bubble.
    const withHref = (href: string) =>
      JSON.stringify([{ from: "bot", text: "answer", at: 1, sources: [{ title: "T", href }] }]);

    it("accepts a root-relative help-centre path", () => {
      const { data } = installStore();
      data.set(KEY, withHref("/docs/help/kyc-verification"));
      expect(readChat()).toHaveLength(1);
    });

    it("rejects a javascript: URL", () => {
      const { data } = installStore();
      data.set(KEY, withHref("javascript:alert(document.cookie)"));
      expect(readChat()).toEqual([]);
    });

    it("rejects an absolute URL to another origin", () => {
      const { data } = installStore();
      data.set(KEY, withHref("https://furlpay-support.example/verify"));
      expect(readChat()).toEqual([]);
    });

    it("rejects a protocol-relative URL", () => {
      // "//evil.example" is same-scheme, other-origin — the classic miss when
      // a check only looks for a leading slash.
      const { data } = installStore();
      data.set(KEY, withHref("//evil.example/verify"));
      expect(readChat()).toEqual([]);
    });

    it("rejects a backslash-prefixed path some browsers normalise", () => {
      const { data } = installStore();
      data.set(KEY, withHref("/\\evil.example/verify"));
      expect(readChat()).toEqual([]);
    });

    it("rejects a data: URL", () => {
      const { data } = installStore();
      data.set(KEY, withHref("data:text/html,<script>alert(1)</script>"));
      expect(readChat()).toEqual([]);
    });
  });
});

describe("a store that refuses to cooperate", () => {
  it("returns the trimmed list even when the write fails", () => {
    installStore("write");
    expect(writeChat([user("hi")]).map((m) => m.text)).toEqual(["hi"]);
  });

  it("reads as empty when the accessor itself throws", () => {
    installStore("everything");
    expect(readChat()).toEqual([]);
  });

  it("reads as empty when there is no window at all", () => {
    expect(readChat()).toEqual([]);
  });
});

describe("toAskHistory", () => {
  const GREETING = "Hi — I'm the FurlPay assistant.";

  it("maps authors onto the roles the API expects", () => {
    expect(toAskHistory([user("hi"), bot("hello")], GREETING)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("excludes the greeting", () => {
    // It is UI copy this app wrote, not something the visitor said or the model
    // produced; feeding it back asks the model to treat its own furniture as
    // conversation.
    expect(toAskHistory([bot(GREETING), user("hi")], GREETING)).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("sends no more turns than the route accepts", () => {
    // /api/support/ask caps history at 10; anything beyond is a 400.
    const many = Array.from({ length: 30 }, (_, i) => user(`m${i}`));
    expect(toAskHistory(many, GREETING)).toHaveLength(10);
  });

  it("truncates a turn to the route's per-message cap", () => {
    const long = user("x".repeat(5000));
    expect(toAskHistory([long], GREETING)[0].content).toHaveLength(2000);
  });
});

describe("toTranscript", () => {
  it("sends no more turns than the mailbox accepts", () => {
    const many = Array.from({ length: 30 }, (_, i) => user(`m${i}`));
    expect(toTranscript(many)).toHaveLength(12);
  });

  it("keeps the author labels the mailbox schema uses", () => {
    expect(toTranscript([user("hi"), bot("hello")])).toEqual([
      { from: "user", text: "hi" },
      { from: "bot", text: "hello" },
    ]);
  });

  it("truncates a turn to the schema's cap", () => {
    expect(toTranscript([user("y".repeat(5000))])[0].text).toHaveLength(2000);
  });
});
