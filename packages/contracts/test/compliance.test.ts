import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const USDC = (n: string) => ethers.parseUnits(n, 6);
const SoF_THRESHOLD = USDC("1000");

// Outcome enum ordering must match IComplianceCheck.sol.
const Outcome = { PASS: 0n, FAIL: 1n, PENDING: 2n };

describe("Programmable compliance guardrail", () => {
  async function deployFixture() {
    const [owner, payer, recipient, relayer, attestor, sanctioned] = await ethers.getSigners();

    const usdc = await ethers.deployContract("MockUSDC");
    const oracle = await ethers.deployContract("MockSanctionsOracle");
    const registry = await ethers.deployContract("SanctionsRegistry", [owner.address]);
    const attestations = await ethers.deployContract("AttestationRegistry", [owner.address]);

    const sanctionsCheck = await ethers.deployContract("SanctionsCheck", [
      owner.address,
      await oracle.getAddress(),
      await registry.getAddress(),
    ]);
    const sofCheck = await ethers.deployContract("SourceOfFundsCheck", [
      owner.address,
      await attestations.getAddress(),
      SoF_THRESHOLD,
    ]);

    const policyManager = await ethers.deployContract("PolicyManager", [owner.address]);
    await policyManager.addCheck(await sanctionsCheck.getAddress());
    await policyManager.addCheck(await sofCheck.getAddress());

    const escrow = await ethers.deployContract("ComplianceEscrow", [
      await usdc.getAddress(),
      await attestations.getAddress(),
      owner.address,
    ]);
    const wrapper = await ethers.deployContract("X402PolicyWrapper", [
      await usdc.getAddress(),
      await policyManager.getAddress(),
      await attestations.getAddress(),
      await escrow.getAddress(),
      owner.address,
    ]);

    // Wiring: escrow trusts only the wrapper; attestation writers are the
    // wrapper + escrow; the compliance operator can record SoF attestations.
    await escrow.setWrapper(await wrapper.getAddress());
    await attestations.setWriter(await wrapper.getAddress(), true);
    await attestations.setWriter(await escrow.getAddress(), true);
    await attestations.setAttestor(attestor.address, true);

    await usdc.mint(payer.address, USDC("100000"));

    return {
      usdc, oracle, registry, attestations, sanctionsCheck, sofCheck, policyManager, escrow, wrapper,
      owner, payer, recipient, relayer, attestor, sanctioned,
    };
  }

  // Sign an EIP-3009 transferWithAuthorization for MockUSDC and return the
  // wrapper's Authorization tuple (value, validAfter, validBefore, nonce, v,r,s).
  async function signAuth(
    usdc: any,
    from: any,
    to: string,
    value: bigint,
  ) {
    const now = await time.latest();
    const msg = {
      from: from.address,
      to,
      value,
      validAfter: 0,
      validBefore: now + 3600,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
    };
    const domain = {
      name: "USD Coin",
      version: "2",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await usdc.getAddress(),
    };
    const types = {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    };
    const sig = ethers.Signature.from(await from.signTypedData(domain, types, msg));
    const auth = {
      value,
      validAfter: msg.validAfter,
      validBefore: msg.validBefore,
      nonce: msg.nonce,
      v: sig.v,
      r: sig.r,
      s: sig.s,
    };
    return auth;
  }

  describe("PolicyManager.evaluate (dry-run)", () => {
    it("PASS for a clean, below-threshold payment", async () => {
      const { policyManager, payer, recipient } = await loadFixture(deployFixture);
      const [outcome] = await policyManager.evaluate({
        payer: payer.address, recipient: recipient.address, amount: USDC("10"), txId: ethers.id("t1"),
      });
      expect(outcome).to.equal(Outcome.PASS);
    });

    it("FAIL when the payer is on the registry", async () => {
      const { policyManager, registry, payer, recipient } = await loadFixture(deployFixture);
      await registry.setSanctioned(payer.address, true);
      const [outcome, reason] = await policyManager.evaluate({
        payer: payer.address, recipient: recipient.address, amount: USDC("10"), txId: ethers.id("t2"),
      });
      expect(outcome).to.equal(Outcome.FAIL);
      expect(reason).to.equal(ethers.encodeBytes32String("SANCTIONS"));
    });

    it("FAIL when the recipient is on the Chainalysis-style oracle", async () => {
      const { policyManager, oracle, payer, recipient } = await loadFixture(deployFixture);
      await oracle.setSanctioned(recipient.address, true);
      const [outcome] = await policyManager.evaluate({
        payer: payer.address, recipient: recipient.address, amount: USDC("10"), txId: ethers.id("t3"),
      });
      expect(outcome).to.equal(Outcome.FAIL);
    });

    it("PENDING when above the source-of-funds threshold without an attestation", async () => {
      const { policyManager, payer, recipient } = await loadFixture(deployFixture);
      const [outcome, reason] = await policyManager.evaluate({
        payer: payer.address, recipient: recipient.address, amount: USDC("5000"), txId: ethers.id("t4"),
      });
      expect(outcome).to.equal(Outcome.PENDING);
      expect(reason).to.equal(ethers.encodeBytes32String("SOURCE_OF_FUNDS"));
    });

    it("FAIL dominates PENDING (sanctioned AND above threshold)", async () => {
      const { policyManager, registry, payer, recipient } = await loadFixture(deployFixture);
      await registry.setSanctioned(payer.address, true);
      const [outcome] = await policyManager.evaluate({
        payer: payer.address, recipient: recipient.address, amount: USDC("5000"), txId: ethers.id("t5"),
      });
      expect(outcome).to.equal(Outcome.FAIL);
    });
  });

  describe("Scenario I — compliance-aware settlement", () => {
    it("PASS settles the transfer and records a PASS attestation", async () => {
      const { usdc, wrapper, attestations, payer, recipient, relayer } = await loadFixture(deployFixture);
      const auth = await signAuth(usdc, payer, recipient.address, USDC("25"));
      const resourceHash = ethers.id("GET /api/agent/purchase");
      const txId = ethers.id("scenario-1-pass");

      await expect(
        wrapper.connect(relayer).settleWithPolicy(payer.address, recipient.address, auth, resourceHash, txId),
      ).to.emit(wrapper, "Settled").withArgs(txId, payer.address, recipient.address, USDC("25"), resourceHash);

      expect(await usdc.balanceOf(recipient.address)).to.equal(USDC("25"));
      const att = await attestations.txAttestations(txId);
      expect(att.outcome).to.equal(Outcome.PASS);
      expect(att.exists).to.equal(true);
    });

    it("FAIL records the attestation and does NOT settle (no revert)", async () => {
      const { usdc, wrapper, registry, attestations, payer, recipient, relayer } = await loadFixture(deployFixture);
      await registry.setSanctioned(payer.address, true);
      const auth = await signAuth(usdc, payer, recipient.address, USDC("25"));
      const txId = ethers.id("scenario-1-fail");

      await expect(
        wrapper.connect(relayer).settleWithPolicy(payer.address, recipient.address, auth, ethers.ZeroHash, txId),
      ).to.emit(wrapper, "Rejected");

      expect(await usdc.balanceOf(recipient.address)).to.equal(0n);
      const att = await attestations.txAttestations(txId);
      expect(att.outcome).to.equal(Outcome.FAIL);
    });

    it("PASSes a large payment once a source-of-funds attestation exists", async () => {
      const { usdc, wrapper, attestations, payer, recipient, attestor } = await loadFixture(deployFixture);
      const future = (await time.latest()) + 365 * 24 * 3600;
      await attestations.connect(attestor).recordSoF(payer.address, ethers.id("evidence-doc"), future);

      const auth = await signAuth(usdc, payer, recipient.address, USDC("5000"));
      const txId = ethers.id("scenario-1-large-pass");
      await wrapper.settleWithPolicy(payer.address, recipient.address, auth, ethers.ZeroHash, txId);
      expect(await usdc.balanceOf(recipient.address)).to.equal(USDC("5000"));
    });

    it("PENDING does not settle and records a PENDING attestation", async () => {
      const { usdc, wrapper, attestations, payer, recipient } = await loadFixture(deployFixture);
      const auth = await signAuth(usdc, payer, recipient.address, USDC("5000"));
      const txId = ethers.id("scenario-1-pending");
      await expect(
        wrapper.settleWithPolicy(payer.address, recipient.address, auth, ethers.ZeroHash, txId),
      ).to.emit(wrapper, "Pending");
      expect(await usdc.balanceOf(recipient.address)).to.equal(0n);
      expect((await attestations.txAttestations(txId)).outcome).to.equal(Outcome.PENDING);
    });

    it("respects pause", async () => {
      const { usdc, wrapper, owner, payer, recipient } = await loadFixture(deployFixture);
      await wrapper.connect(owner).pause();
      const auth = await signAuth(usdc, payer, recipient.address, USDC("25"));
      await expect(
        wrapper.settleWithPolicy(payer.address, recipient.address, auth, ethers.ZeroHash, ethers.id("p")),
      ).to.be.revertedWithCustomError(wrapper, "EnforcedPause");
    });
  });

  describe("Scenario II — pending compliance & escrow-mediated settlement", () => {
    async function tranched() {
      const f = await loadFixture(deployFixture);
      const txId = ethers.id("scenario-2");
      const releaseDeadline = (await time.latest()) + 7 * 24 * 3600;
      // Payment intent 1500 (> threshold). Split: 1000 compliant + 500 escrow.
      const compliantAuth = await signAuth(f.usdc, f.payer, f.recipient.address, USDC("1000"));
      const escrowAuth = await signAuth(f.usdc, f.payer, await f.escrow.getAddress(), USDC("500"));

      await f.wrapper.connect(f.relayer).settleTranche(
        f.payer.address, f.recipient.address, compliantAuth, escrowAuth, ethers.ZeroHash, txId, releaseDeadline,
      );
      return { ...f, txId, releaseDeadline };
    }

    it("settles the compliant tranche and escrows the remainder", async () => {
      const { usdc, escrow, recipient } = await tranched();
      expect(await usdc.balanceOf(recipient.address)).to.equal(USDC("1000"));
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(USDC("500"));
    });

    it("releases the escrow to the recipient once SoF is attested", async () => {
      const { usdc, escrow, attestations, recipient, payer, attestor, txId } = await tranched();
      const future = (await time.latest()) + 365 * 24 * 3600;
      await attestations.connect(attestor).recordSoF(payer.address, ethers.id("sof-evidence"), future);

      await expect(escrow.release(txId)).to.emit(escrow, "EscrowReleased");
      expect(await usdc.balanceOf(recipient.address)).to.equal(USDC("1500"));
      expect((await attestations.txAttestations(txId)).outcome).to.equal(Outcome.PASS);
    });

    it("refuses to release without a valid SoF attestation", async () => {
      const { escrow, txId } = await tranched();
      await expect(escrow.release(txId)).to.be.revertedWithCustomError(escrow, "SoFMissing");
    });

    it("refunds the payer after the release deadline", async () => {
      const { usdc, escrow, payer, releaseDeadline, txId } = await tranched();
      const before = await usdc.balanceOf(payer.address);
      await expect(escrow.refund(txId)).to.be.revertedWithCustomError(escrow, "DeadlineNotReached");
      await time.increaseTo(releaseDeadline + 1);
      await escrow.refund(txId);
      expect((await usdc.balanceOf(payer.address)) - before).to.equal(USDC("500"));
    });

    it("enforces the per-tx escrow cap", async () => {
      const f = await loadFixture(deployFixture);
      await f.escrow.connect(f.owner).setPerTxCap(USDC("100"));
      const txId = ethers.id("scenario-2-capped");
      const releaseDeadline = (await time.latest()) + 7 * 24 * 3600;
      const compliantAuth = await signAuth(f.usdc, f.payer, f.recipient.address, USDC("1000"));
      const escrowAuth = await signAuth(f.usdc, f.payer, await f.escrow.getAddress(), USDC("500"));
      await expect(
        f.wrapper.connect(f.relayer).settleTranche(
          f.payer.address, f.recipient.address, compliantAuth, escrowAuth, ethers.ZeroHash, txId, releaseDeadline,
        ),
      ).to.be.revertedWithCustomError(f.escrow, "CapExceeded");
    });

    it("only the wrapper can open an escrow entry", async () => {
      const { escrow, owner, payer, recipient } = await loadFixture(deployFixture);
      const deadline = (await time.latest()) + 3600;
      await expect(
        escrow.connect(owner).open(ethers.id("x"), payer.address, recipient.address, USDC("1"), deadline),
      ).to.be.revertedWithCustomError(escrow, "NotWrapper");
    });
  });

  describe("AttestationRegistry access control", () => {
    it("rejects unauthorized writers and attestors", async () => {
      const { attestations, payer } = await loadFixture(deployFixture);
      await expect(
        attestations.connect(payer).recordOutcome(ethers.id("z"), Outcome.PASS, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(attestations, "NotWriter");
      await expect(
        attestations.connect(payer).recordSoF(payer.address, ethers.id("e"), 9_999_999_999),
      ).to.be.revertedWithCustomError(attestations, "NotAttestor");
    });
  });
});
