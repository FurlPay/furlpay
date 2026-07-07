import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

// Fork validation against Arbitrum One mainnet: real native USDC and the real
// Chainalysis Sanctions Oracle, so the guardrail is proven against production
// state WITHOUT spending any mainnet funds. Requires an archive RPC:
//   ARBITRUM_FORK_RPC=<alchemy/infura arb1 url> npx hardhat test test/compliance.fork.test.ts
// Skips cleanly when unset.

const USDC_ADDR = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // native Circle USDC, Arbitrum One
const CHAINALYSIS_ORACLE = "0x40C57923924B5c5c5455c48D93317139ADDaC8fb"; // OFAC SDN oracle
// A large USDC holder on Arbitrum used to fund a test signer (impersonated).
const USDC_WHALE = "0x47c031236e19d024b42f8AE6780E44A573170703"; // GMX vault, deep USDC
// Candidate OFAC SDN addresses; we probe the live oracle and use whichever it
// currently flags (the pushed set can differ per chain / over time).
const SANCTIONED_CANDIDATES = [
  "0x098B716B8Aaf21512996dC57EB0615e2383E2f96", // Ronin bridge exploiter (Lazarus)
  "0x722122dF12D4e14e13Ac3b6895a86e84145b6967", // Tornado Cash: Proxy
  "0xDD4c48C0B24039969fC16D1cdF626eaB821d3384", // Tornado Cash
  "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b", // Tornado Cash: Router
  "0x8576acC5C05D6Ce88f4e49bf65BdF0C62F91353C", // Blender.io (Lazarus)
];

const ORACLE_ABI = ["function isSanctioned(address) view returns (bool)"];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function version() view returns (string)",
  "function name() view returns (string)",
];

const USDC = (n: string) => ethers.parseUnits(n, 6);

describe("Fork: guardrail against real Arbitrum One USDC + Chainalysis oracle", function () {
  this.timeout(180_000);

  before(function () {
    if (!process.env.ARBITRUM_FORK_RPC) this.skip();
  });

  async function setup() {
    const [deployer, recipient] = await ethers.getSigners();
    const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, ethers.provider);

    // Compliance stack pointing at the REAL oracle; registry seeded on demand.
    const registry = await ethers.deployContract("SanctionsRegistry", [deployer.address]);
    const attestations = await ethers.deployContract("AttestationRegistry", [deployer.address]);
    const sanctionsCheck = await ethers.deployContract("SanctionsCheck", [
      deployer.address, CHAINALYSIS_ORACLE, await registry.getAddress(),
    ]);
    const sofCheck = await ethers.deployContract("SourceOfFundsCheck", [
      deployer.address, await attestations.getAddress(), USDC("1000"),
    ]);
    const policyManager = await ethers.deployContract("PolicyManager", [deployer.address]);
    await policyManager.addCheck(await sanctionsCheck.getAddress());
    await policyManager.addCheck(await sofCheck.getAddress());
    const escrow = await ethers.deployContract("ComplianceEscrow", [
      USDC_ADDR, await attestations.getAddress(), deployer.address,
    ]);
    const wrapper = await ethers.deployContract("X402PolicyWrapper", [
      USDC_ADDR, await policyManager.getAddress(), await attestations.getAddress(), await escrow.getAddress(), deployer.address,
    ]);
    await escrow.setWrapper(await wrapper.getAddress());
    await attestations.setWriter(await wrapper.getAddress(), true);
    await attestations.setWriter(await escrow.getAddress(), true);

    return { deployer, recipient, usdc, wrapper, attestations, policyManager };
  }

  it("enforces the real Chainalysis oracle → FAIL for a live-sanctioned address", async function () {
    const { policyManager, recipient } = await setup();
    const oracle = new ethers.Contract(CHAINALYSIS_ORACLE, ORACLE_ABI, ethers.provider);

    // Find an address the live oracle currently flags on this chain.
    let flagged: string | undefined;
    for (const addr of SANCTIONED_CANDIDATES) {
      if (await oracle.isSanctioned(addr)) { flagged = addr; break; }
    }
    if (!flagged) {
      console.warn("      (no candidate flagged by the Arbitrum oracle on this fork — skipping)");
      this.skip();
    }

    const [outcome, reason] = await policyManager.evaluate({
      payer: recipient.address, recipient: flagged as string, amount: USDC("1"), txId: ethers.id("fork-fail"),
    });
    expect(outcome).to.equal(1n); // FAIL
    expect(reason).to.equal(ethers.encodeBytes32String("SANCTIONS"));
  });

  it("settles a real USDC transfer via EIP-3009 on the PASS path", async () => {
    const { deployer, recipient, usdc, wrapper } = await setup();

    // Fund the deployer (a signer with a known key, so it can sign EIP-3009)
    // by impersonating a whale.
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [USDC_WHALE] });
    await network.provider.request({ method: "hardhat_setBalance", params: [USDC_WHALE, "0x56BC75E2D63100000"] });
    const whale = await ethers.getSigner(USDC_WHALE);
    const whaleBal = await usdc.balanceOf(USDC_WHALE);
    if (whaleBal < USDC("10")) this.skip?.();
    await (usdc.connect(whale) as any).transfer(deployer.address, USDC("10"));

    // Sign an EIP-3009 authorization against the real USDC EIP-712 domain.
    const value = USDC("2");
    const now = await time.latest();
    const msg = {
      from: deployer.address, to: recipient.address, value,
      validAfter: 0, validBefore: now + 3600, nonce: ethers.hexlify(ethers.randomBytes(32)),
    };
    const domain = {
      name: await usdc.name(),
      version: await usdc.version(),
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: USDC_ADDR,
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    };
    const sig = ethers.Signature.from(await deployer.signTypedData(domain, types, msg));
    const auth = { value, validAfter: msg.validAfter, validBefore: msg.validBefore, nonce: msg.nonce, v: sig.v, r: sig.r, s: sig.s };

    const before = await usdc.balanceOf(recipient.address);
    await wrapper.settleWithPolicy(deployer.address, recipient.address, auth, ethers.ZeroHash, ethers.id("fork-pass"));
    expect((await usdc.balanceOf(recipient.address)) - before).to.equal(value);
  });
});
