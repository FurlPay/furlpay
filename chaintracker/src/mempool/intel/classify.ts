// What shape is this transaction, and how sure are we?
//
// This replaces a boolean called `selfSpend` that was set when the largest
// output paid an address that also funded the inputs. That test is right often
// enough to be dangerous: it is also true of a merchant refunding change to a
// reused address, and it is FALSE for the overwhelmingly common case of a
// wallet consolidating into a fresh address it also owns. A boolean cannot say
// "probably, because of these three things", so it got replaced by one that can.
//
// The honest ceiling here: without address clustering across the whole chain,
// ownership is not knowable. Every verdict below is a reading of transaction
// STRUCTURE, and the confidence attached is confidence in the structural read,
// never a claim about who owns what. The wording in the embeds follows that —
// "likely consolidation", not "this wallet consolidated".

import type { TxFeatures } from "./features.js";

export type Shape =
  | "consolidation"
  | "distribution"
  | "transfer"
  | "sweep"
  | "unknown";

export interface Classification {
  shape: Shape;
  /** 0..1 confidence in the STRUCTURAL reading, not in ownership. */
  confidence: number;
  /** Each observation that moved the verdict, in plain language. */
  evidence: string[];
}

/**
 * Read the shape of a transaction from its structure.
 *
 * The four shapes are distinguished by fan-in versus fan-out, which is
 * observable, rather than by ownership, which is not:
 *
 *   consolidation  many inputs -> one or two outputs. Value gathered up.
 *   distribution   one or two inputs -> many outputs. A payout batch.
 *   sweep          many inputs -> exactly one output, no change at all.
 *   transfer       a small number of both, the ordinary payment shape.
 */
export function classify(f: TxFeatures): Classification {
  const evidence: string[] = [];
  const inputs = f.nIn;
  const outputs = f.nOut;

  // Change detection: a payment usually creates exactly one output back to the
  // payer, so two outputs is the signature of "payment plus change" and one
  // output is the signature of "everything moved, nothing kept".
  const noChange = outputs === 1;
  const fanIn = inputs / Math.max(1, outputs);
  const fanOut = outputs / Math.max(1, inputs);

  let shape: Shape = "unknown";
  let confidence = 0;

  // Classified by RATIO, not by an absolute output cap.
  //
  // An earlier version required `outputs <= 2`, and the Liquid federation
  // peg-out — 83 inputs into 13 outputs, every input from one address — came
  // back "unclassified movement". A 6.4-to-1 fan-in is a consolidation by any
  // reading; the output count only says it paid several recipients while doing
  // it. Ratio is what distinguishes the shapes, so ratio is what is tested.
  if (inputs >= 5 && fanIn >= 3) {
    shape = noChange ? "sweep" : "consolidation";
    // Confidence rises with how lopsided the fan-in is, saturating rather than
    // running away: 83-to-13 and 500-to-2 are both simply "very lopsided".
    confidence = clamp(0.5 + 0.12 * Math.log2(fanIn), 0.5, 0.97);
    evidence.push(`${inputs} inputs collapse into ${outputs} output${outputs === 1 ? "" : "s"}`);
    if (noChange) evidence.push("no change output — the inputs were emptied entirely");
  } else if (outputs >= 5 && fanOut >= 3) {
    shape = "distribution";
    confidence = clamp(0.5 + 0.12 * Math.log2(fanOut), 0.5, 0.97);
    evidence.push(`${inputs} input${inputs === 1 ? "" : "s"} fan out to ${outputs} outputs`);
    if ((f.outEntropy ?? 0) > 0.9) {
      confidence = clamp(confidence + 0.05, 0, 0.97);
      evidence.push("outputs are near-evenly sized, which is characteristic of a payout batch");
    }
  } else if (inputs <= 3 && outputs <= 3) {
    shape = "transfer";
    confidence = 0.6;
    evidence.push(`ordinary payment shape — ${inputs} in, ${outputs} out`);
    if (outputs === 2 && (f.topOutFrac ?? 0) > 0.8) {
      confidence = 0.72;
      evidence.push(
        `${pct(f.topOutFrac!)} of value went to one output, the rest looks like change`,
      );
    }
  } else {
    shape = "unknown";
    confidence = 0.35;
    evidence.push(`${inputs} inputs and ${outputs} outputs fit no clear pattern`);
  }

  // A single address funding nearly all the value is the strongest structural
  // hint that one party controlled the inputs. It is a hint, not proof: an
  // address is not an identity, and reuse is a choice some services make.
  if (f.topInputAddrFrac !== null && f.topInputAddrFrac > 0.9 && f.inputAddresses === 1) {
    if (shape === "consolidation" || shape === "sweep") {
      confidence = clamp(confidence + 0.08, 0, 0.97);
    }
    evidence.push(
      `every input came from one address, so a single party almost certainly controlled them`,
    );
  } else if (f.inputAddresses > 1 && f.topInputAddrFrac !== null) {
    evidence.push(
      `${f.inputAddresses} distinct addresses funded it` +
        (f.topInputAddrFrac > 0.5 ? `, ${pct(f.topInputAddrFrac)} of value from the largest` : ""),
    );
  }

  // The old boolean, kept as ONE piece of evidence rather than as the verdict.
  if (
    f.topOutputAddr &&
    f.topInputAddr &&
    f.topOutputAddr === f.topInputAddr
  ) {
    evidence.push(
      "the largest output pays back the address that funded most of the inputs — " +
        "consistent with self-transfer, though address reuse alone cannot prove ownership",
    );
    confidence = clamp(confidence + 0.05, 0, 0.97);
  }

  if (f.dustOuts > 0) {
    evidence.push(
      `${f.dustOuts} output${f.dustOuts === 1 ? " is" : "s are"} below the ${546} sat dust limit`,
    );
  }

  return { shape, confidence, evidence };
}

/** Human label for a shape at a given confidence. */
export function shapeLabel(c: Classification): string {
  const hedge = c.confidence >= 0.85 ? "" : c.confidence >= 0.6 ? "Likely " : "Possible ";
  const noun: Record<Shape, string> = {
    consolidation: "consolidation",
    distribution: "distribution",
    transfer: "transfer",
    sweep: "full sweep",
    unknown: "unclassified movement",
  };
  const label = `${hedge}${noun[c.shape]}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const pct = (x: number): string => `${Math.round(x * 100)}%`;
