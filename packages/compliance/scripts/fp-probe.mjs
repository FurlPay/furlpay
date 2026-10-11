// False-positive / true-positive probe for the name matcher against the real
// bundled OFAC SDN list. Run after `npm run build:test`:
//   node scripts/fp-probe.mjs
import { screenName, getOfacSdnList } from "../dist/index.js";

const list = getOfacSdnList();
const innocent = [
  "Acme Corporation", "Northwind Analytics Ltd", "Northwind", "Jordan Lee", "Avery Quinn",
  "Globex GmbH", "Stripe Payments Europe Ltd", "Blue Bottle Coffee", "Emily Chen", "Maria Garcia",
  "John Smith", "Priya Sharma", "Contoso Pharmaceuticals", "Fabrikam Logistics BV", "Initech LLC",
  "Wayne Enterprises", "Umbrella Health Inc", "Tan Wei Ming", "Olusegun Adebayo", "Sofia Rossi",
];
const sanctioned = [
  "BANCO NACIONAL DE CUBA", "National Bank of Cuba", "Ayman Al-Zawahiri", "Ayman Al Zawahri",
  "Abu Abbas", "Abboud Al Zumor", "Anglo Caribbean Co", "Osama bin Laden", "Usama Bin Ladin",
];
const row = (name) => {
  const r = screenName({ name }, list);
  const top = r.candidates[0];
  return `${r.decision.padEnd(6)} ${String(r.candidates.length).padStart(3)}  ${name.padEnd(28)} ${top ? `${top.score.toFixed(2)} ${top.signals.matchedOn}` : ""}`;
};
console.log("INNOCENT (want allow)");
for (const n of innocent) console.log(row(n));
console.log("\nSANCTIONED (want review/block)");
for (const n of sanctioned) console.log(row(n));
