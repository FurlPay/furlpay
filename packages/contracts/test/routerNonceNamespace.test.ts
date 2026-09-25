import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const USDC = (n: string) => ethers.parseUnits(n, 6);

// ---------------------------------------------------------------------------
// Regression tests for four pre-deployment findings in FurlPayRouter.
//
// The first is the reason this file exists. Before the fix, an attacker holding
// NO USDC and granting NO allowance could permanently kill any payment
// authorization they could observe, for the price of gas. That was demonstrated
// against the previous contract — both exploit steps passed — and the tests
// below are the same scenarios, now asserting that they fail.
//
// These are written as attacks rather than as feature checks on purpose: the
// question is not "does the nonce map work" but "can one payer affect another".
// ---------------------------------------------------------------------------

describe("FurlPayRouter — pre-deployment hardening", () => {
  async function fx() {
    const [owner, treasury, payer, merchant, attacker, relayer] = await ethers.getSigners();
    const usdc = await ethers.deployContract("MockUSDC");
    const router = await ethers.deployContract("FurlPayRouter", [
      await usdc.getAddress(),
      treasury.address,
      owner.address,
    ]);
    await usdc.mint(payer.address, USDC("10000"));
    await usdc.mint(attacker.address, USDC("10000"));
    return { usdc, router, owner, treasury, payer, merchant, attacker, relayer };
  }

  async function sign(router: any, signer: any, p: any) {
    const domain = {
      name: "FurlPayRouter",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await router.getAddress(),
    };
    const types = {
      Payment: [
        { name: "paymentId", type: "string" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "fee", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, p);
  }

  describe("nonces are namespaced per payer", () => {
    it("an attacker CANNOT burn a victim's nonce, even holding funds and allowance", async () => {
      // The original griefing attack, with the attacker given every advantage the
      // fixed version could plausibly still let them use: real USDC, a real
      // allowance, and a non-zero amount so the ZeroAmount guard is not what
      // stops them. The nonce NAMESPACE has to be what stops them, because that
      // is the fix that removes the class rather than the cheapest route to it.
      const { usdc, router, payer, merchant, attacker, relayer } = await loadFixture(fx);
      const routerAddr = await router.getAddress();
      await usdc.connect(payer).approve(routerAddr, USDC("1000"));
      await usdc.connect(attacker).approve(routerAddr, USDC("1000"));

      const sharedNonce = ethers.hexlify(ethers.randomBytes(32));
      const deadline = (await time.latest()) + 900;

      const victim = {
        paymentId: "pay_victim",
        recipient: merchant.address,
        amount: USDC("150"),
        fee: USDC("0.75"),
        nonce: sharedNonce,
        deadline,
      };
      const victimSig = await sign(router, payer, victim);

      const grief = {
        paymentId: "grief",
        recipient: attacker.address,
        amount: USDC("1"),
        fee: 0n,
        nonce: sharedNonce,
        deadline,
      };
      await router.connect(relayer).pay(grief, attacker.address, await sign(router, attacker, grief));

      // The attacker consumed the nonce IN THEIR OWN NAMESPACE only.
      expect(await router.usedNonces(attacker.address, sharedNonce)).to.equal(true);
      expect(await router.usedNonces(payer.address, sharedNonce)).to.equal(false);

      // The victim's payment still settles, unaffected.
      await expect(router.connect(relayer).pay(victim, payer.address, victimSig)).to.emit(
        router,
        "PaymentExecuted"
      );
      expect(await usdc.balanceOf(merchant.address)).to.equal(USDC("149.25"));
    });

    it("still refuses the SAME payer replaying their own nonce", async () => {
      // The namespace must not weaken replay protection where it matters.
      const { usdc, router, payer, merchant, relayer } = await loadFixture(fx);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const p = {
        paymentId: "pay_replay",
        recipient: merchant.address,
        amount: USDC("10"),
        fee: USDC("0.05"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      const sig = await sign(router, payer, p);
      await router.connect(relayer).pay(p, payer.address, sig);
      await expect(
        router.connect(relayer).pay(p, payer.address, sig)
      ).to.be.revertedWithCustomError(router, "NonceAlreadyUsed");
    });

    it("lets two payers legitimately choose the same nonce", async () => {
      // The flip side, and a real case: nonces are client-chosen, so an
      // independently-generated collision between two payers must not be a
      // failure for either of them.
      const { usdc, router, payer, merchant, attacker: second, relayer } = await loadFixture(fx);
      const routerAddr = await router.getAddress();
      await usdc.connect(payer).approve(routerAddr, USDC("1000"));
      await usdc.connect(second).approve(routerAddr, USDC("1000"));
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const deadline = (await time.latest()) + 900;

      for (const signer of [payer, second]) {
        const p = {
          paymentId: `p_${signer.address}`,
          recipient: merchant.address,
          amount: USDC("5"),
          fee: 0n,
          nonce,
          deadline,
        };
        await expect(
          router.connect(relayer).pay(p, signer.address, await sign(router, signer, p))
        ).to.emit(router, "PaymentExecuted");
      }
      expect(await usdc.balanceOf(merchant.address)).to.equal(USDC("10"));
    });
  });

  describe("batchPay enforces the bound it documents", () => {
    async function batch(router: any, usdc: any, payer: any, merchant: any, n: number) {
      await usdc.connect(payer).approve(await router.getAddress(), USDC("100000"));
      const deadline = (await time.latest()) + 900;
      const ps: any[] = [];
      const payers: string[] = [];
      const sigs: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = {
          paymentId: `b${i}`,
          recipient: merchant.address,
          amount: USDC("1"),
          fee: 0n,
          nonce: ethers.hexlify(ethers.randomBytes(32)),
          deadline,
        };
        ps.push(p);
        payers.push(payer.address);
        sigs.push(await sign(router, payer, p));
      }
      return { ps, payers, sigs };
    }

    it("rejects a batch above MAX_BATCH", async () => {
      // Previously 150 went through while the docstring claimed a limit of 100.
      const { usdc, router, payer, merchant, relayer } = await loadFixture(fx);
      const { ps, payers, sigs } = await batch(router, usdc, payer, merchant, 101);
      await expect(
        router.connect(relayer).batchPay(ps, payers, sigs)
      ).to.be.revertedWithCustomError(router, "BatchTooLarge");
    });

    it("accepts a batch AT the bound, so the limit is not off by one", async () => {
      const { usdc, router, payer, merchant, relayer } = await loadFixture(fx);
      expect(await router.MAX_BATCH()).to.equal(100n);
      const { ps, payers, sigs } = await batch(router, usdc, payer, merchant, 100);
      await router.connect(relayer).batchPay(ps, payers, sigs);
      expect(await usdc.balanceOf(merchant.address)).to.equal(USDC("100"));
    });
  });

  describe("payments that move nothing are refused", () => {
    it("rejects a zero amount", async () => {
      // It used to pass every check, consume a nonce and emit PaymentExecuted —
      // a settlement event for a settlement that did not happen.
      const { usdc, router, payer, merchant, relayer } = await loadFixture(fx);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const p = {
        paymentId: "zero",
        recipient: merchant.address,
        amount: 0n,
        fee: 0n,
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      await expect(
        router.connect(relayer).pay(p, payer.address, await sign(router, payer, p))
      ).to.be.revertedWithCustomError(router, "ZeroAmount");
    });
  });

  describe("authorizations cannot be valid indefinitely", () => {
    it("rejects a deadline beyond the 24h window", async () => {
      // A signed authorization plus a standing allowance is a bearer instrument.
      // Unbounded, a year-3000 deadline was as valid as a 15-minute one.
      const { usdc, router, payer, merchant, relayer } = await loadFixture(fx);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const p = {
        paymentId: "far",
        recipient: merchant.address,
        amount: USDC("1"),
        fee: 0n,
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 25 * 3600,
      };
      await expect(
        router.connect(relayer).pay(p, payer.address, await sign(router, payer, p))
      ).to.be.revertedWithCustomError(router, "DeadlineTooFar");
    });

    it("accepts the API's own 15-minute quote comfortably", async () => {
      // The bound has to be generous enough that it can never reject a
      // legitimate quote. lib/services/payments.ts uses EXPIRY_SECONDS = 900.
      const { usdc, router, payer, merchant, relayer } = await loadFixture(fx);
      expect(await router.MAX_DEADLINE_WINDOW()).to.equal(86400n);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const p = {
        paymentId: "quote",
        recipient: merchant.address,
        amount: USDC("1"),
        fee: 0n,
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      await expect(
        router.connect(relayer).pay(p, payer.address, await sign(router, payer, p))
      ).to.emit(router, "PaymentExecuted");
    });
  });
});
