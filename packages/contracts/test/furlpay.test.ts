import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const USDC = (n: string) => ethers.parseUnits(n, 6);

describe("Furlpay contracts", () => {
  async function deployFixture() {
    const [owner, treasury, payer, merchant, provider, oracle, relayer] =
      await ethers.getSigners();

    const usdc = await ethers.deployContract("MockUSDC");
    const router = await ethers.deployContract("FurlPayRouter", [
      await usdc.getAddress(),
      treasury.address,
      owner.address,
    ]);
    const receipt = await ethers.deployContract("BookingReceipt", [
      owner.address,
      "https://furlpay.com/api/travel/bookings/receipt/",
    ]);
    const escrow = await ethers.deployContract("FurlPayEscrow", [
      await usdc.getAddress(),
      await receipt.getAddress(),
      oracle.address,
      owner.address,
    ]);
    await receipt.connect(owner).setMinter(await escrow.getAddress());
    const facilitator = await ethers.deployContract("X402Facilitator", [
      await usdc.getAddress(),
      owner.address,
      relayer.address, // endorsed facilitator (fee-payer that submits settlements)
    ]);

    await usdc.mint(payer.address, USDC("10000"));
    return { usdc, router, receipt, escrow, facilitator, owner, treasury, payer, merchant, provider, oracle, relayer };
  }

  // EIP-712 payment authorization matching POST /api/payments/create signData.
  async function signPayment(
    router: Awaited<ReturnType<typeof ethers.deployContract>>,
    payer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    payment: {
      paymentId: string;
      recipient: string;
      amount: bigint;
      fee: bigint;
      nonce: string;
      deadline: number;
    }
  ) {
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
    return payer.signTypedData(domain, types, payment);
  }

  describe("FurlPayRouter", () => {
    it("executes a signed payment: merchant gets amount-fee, treasury gets fee", async () => {
      const { usdc, router, treasury, payer, merchant, relayer } = await loadFixture(deployFixture);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));

      const payment = {
        paymentId: "pay_test_1",
        recipient: merchant.address,
        amount: USDC("150"),
        fee: USDC("0.75"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      const sig = await signPayment(router, payer, payment);

      await expect(router.connect(relayer).pay(payment, payer.address, sig))
        .to.emit(router, "PaymentExecuted")
        .withArgs("pay_test_1", payer.address, merchant.address, USDC("150"), USDC("0.75"), payment.nonce);

      expect(await usdc.balanceOf(merchant.address)).to.equal(USDC("149.25"));
      expect(await usdc.balanceOf(treasury.address)).to.equal(USDC("0.75"));
    });

    it("rejects a replayed nonce", async () => {
      const { usdc, router, payer, merchant, relayer } = await loadFixture(deployFixture);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const payment = {
        paymentId: "pay_test_2",
        recipient: merchant.address,
        amount: USDC("10"),
        fee: USDC("0.05"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      const sig = await signPayment(router, payer, payment);
      await router.connect(relayer).pay(payment, payer.address, sig);
      await expect(router.connect(relayer).pay(payment, payer.address, sig))
        .to.be.revertedWithCustomError(router, "NonceAlreadyUsed");
    });

    it("rejects an expired authorization", async () => {
      const { usdc, router, payer, merchant } = await loadFixture(deployFixture);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const payment = {
        paymentId: "pay_test_3",
        recipient: merchant.address,
        amount: USDC("10"),
        fee: USDC("0.05"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) - 1,
      };
      const sig = await signPayment(router, payer, payment);
      await expect(router.pay(payment, payer.address, sig))
        .to.be.revertedWithCustomError(router, "AuthorizationExpired");
    });

    it("rejects a signature from the wrong signer", async () => {
      const { usdc, router, payer, merchant, relayer } = await loadFixture(deployFixture);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const payment = {
        paymentId: "pay_test_4",
        recipient: merchant.address,
        amount: USDC("10"),
        fee: USDC("0.05"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      // Signed by the merchant, submitted claiming the payer authorized it.
      const sig = await signPayment(router, merchant, payment);
      await expect(router.connect(relayer).pay(payment, payer.address, sig))
        .to.be.revertedWithCustomError(router, "InvalidSigner");
    });

    it("enforces the 1% on-chain fee ceiling", async () => {
      const { usdc, router, payer, merchant } = await loadFixture(deployFixture);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const payment = {
        paymentId: "pay_test_5",
        recipient: merchant.address,
        amount: USDC("100"),
        fee: USDC("2"), // 2% > MAX_FEE_BPS
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      const sig = await signPayment(router, payer, payment);
      await expect(router.pay(payment, payer.address, sig))
        .to.be.revertedWithCustomError(router, "FeeTooHigh");
    });

    it("batchPay settles multiple payments in one tx", async () => {
      const { usdc, router, payer, merchant, provider, relayer } = await loadFixture(deployFixture);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      const deadline = (await time.latest()) + 900;
      const p1 = {
        paymentId: "pay_batch_1",
        recipient: merchant.address,
        amount: USDC("50"),
        fee: USDC("0.25"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline,
      };
      const p2 = {
        paymentId: "pay_batch_2",
        recipient: provider.address,
        amount: USDC("80"),
        fee: USDC("0.40"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline,
      };
      const s1 = await signPayment(router, payer, p1);
      const s2 = await signPayment(router, payer, p2);

      await router.connect(relayer).batchPay([p1, p2], [payer.address, payer.address], [s1, s2]);
      expect(await usdc.balanceOf(merchant.address)).to.equal(USDC("49.75"));
      expect(await usdc.balanceOf(provider.address)).to.equal(USDC("79.60"));
    });

    it("pause blocks payments until unpause", async () => {
      const { usdc, router, owner, payer, merchant } = await loadFixture(deployFixture);
      await usdc.connect(payer).approve(await router.getAddress(), USDC("1000"));
      await router.connect(owner).pause();
      const payment = {
        paymentId: "pay_test_6",
        recipient: merchant.address,
        amount: USDC("10"),
        fee: USDC("0.05"),
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        deadline: (await time.latest()) + 900,
      };
      const sig = await signPayment(router, payer, payment);
      await expect(router.pay(payment, payer.address, sig))
        .to.be.revertedWithCustomError(router, "EnforcedPause");
      await router.connect(owner).unpause();
      await router.pay(payment, payer.address, sig);
      expect(await usdc.balanceOf(merchant.address)).to.equal(USDC("9.95"));
    });
  });

  describe("FurlPayEscrow + BookingReceipt", () => {
    const bookingId = ethers.id("HOTEL-2026-0710");

    async function fundedBooking() {
      const f = await loadFixture(deployFixture);
      const now = await time.latest();
      const checkIn = now + 7 * 24 * 3600;
      const cancelBy = now + 5 * 24 * 3600;
      await f.usdc.connect(f.payer).approve(await f.escrow.getAddress(), USDC("300"));
      await f.escrow
        .connect(f.payer)
        .createBooking(bookingId, USDC("300"), f.provider.address, checkIn, cancelBy);
      return { ...f, checkIn, cancelBy };
    }

    it("funds a booking, escrows USDC and mints the receipt NFT", async () => {
      const { usdc, escrow, receipt, payer } = await fundedBooking();
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(USDC("300"));
      expect(await receipt.ownerOf(BigInt(bookingId))).to.equal(payer.address);
    });

    it("oracle check-in releases funds to the provider", async () => {
      const { usdc, escrow, provider, oracle } = await fundedBooking();
      await expect(escrow.connect(oracle).confirmCheckIn(bookingId))
        .to.emit(escrow, "BookingReleased");
      expect(await usdc.balanceOf(provider.address)).to.equal(USDC("300"));
    });

    it("non-oracle cannot confirm check-in", async () => {
      const { escrow, merchant } = await fundedBooking();
      await expect(escrow.connect(merchant).confirmCheckIn(bookingId))
        .to.be.revertedWithCustomError(escrow, "NotOracle");
    });

    it("traveler refund inside the cancellation window", async () => {
      const { usdc, escrow, payer } = await fundedBooking();
      const before = await usdc.balanceOf(payer.address);
      await escrow.connect(payer).cancel(bookingId);
      expect((await usdc.balanceOf(payer.address)) - before).to.equal(USDC("300"));
    });

    it("refund rejected after the cancellation deadline", async () => {
      const { escrow, payer, cancelBy } = await fundedBooking();
      await time.increaseTo(cancelBy + 1);
      await expect(escrow.connect(payer).cancel(bookingId))
        .to.be.revertedWithCustomError(escrow, "CancellationWindowClosed");
    });

    it("permissionless release after the grace period protects the provider", async () => {
      const { usdc, escrow, provider, merchant, checkIn } = await fundedBooking();
      await expect(escrow.connect(merchant).releaseAfterGrace(bookingId))
        .to.be.revertedWithCustomError(escrow, "GracePeriodNotReached");
      await time.increaseTo(checkIn + 7 * 24 * 3600 + 1);
      await escrow.connect(merchant).releaseAfterGrace(bookingId);
      expect(await usdc.balanceOf(provider.address)).to.equal(USDC("300"));
    });

    it("double-funding the same bookingId is rejected", async () => {
      const f = await fundedBooking();
      await f.usdc.connect(f.payer).approve(await f.escrow.getAddress(), USDC("300"));
      await expect(
        f.escrow
          .connect(f.payer)
          .createBooking(bookingId, USDC("300"), f.provider.address, f.checkIn, f.cancelBy)
      ).to.be.revertedWithCustomError(f.escrow, "BookingExists");
    });
  });

  describe("X402Facilitator", () => {
    async function signAuthorization(
      usdc: Awaited<ReturnType<typeof ethers.deployContract>>,
      payer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
      to: string,
      value: bigint
    ) {
      const now = await time.latest();
      const auth = {
        from: payer.address,
        to,
        value,
        validAfter: 0,
        validBefore: now + 300,
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
      const sig = ethers.Signature.from(await payer.signTypedData(domain, types, auth));
      return { auth, sig };
    }

    it("settles an EIP-3009 agent payment and records it", async () => {
      const { usdc, facilitator, payer, merchant, relayer } = await loadFixture(deployFixture);
      const { auth, sig } = await signAuthorization(usdc, payer, merchant.address, USDC("0.01"));
      const resourceHash = ethers.id("GET /api/travel/search");

      await expect(
        facilitator
          .connect(relayer)
          .settle(auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, resourceHash, sig.v, sig.r, sig.s)
      )
        .to.emit(facilitator, "X402Settled")
        .withArgs(payer.address, merchant.address, USDC("0.01"), resourceHash, auth.nonce);

      expect(await usdc.balanceOf(merchant.address)).to.equal(USDC("0.01"));
      const record = await facilitator.settlements(auth.nonce);
      expect(record.payer).to.equal(payer.address);
      expect(record.amount).to.equal(USDC("0.01"));
    });

    it("rejects settling the same nonce twice", async () => {
      const { usdc, facilitator, payer, merchant, relayer } = await loadFixture(deployFixture);
      const { auth, sig } = await signAuthorization(usdc, payer, merchant.address, USDC("0.01"));
      const resourceHash = ethers.id("GET /api/travel/search");
      await facilitator.connect(relayer).settle(auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, resourceHash, sig.v, sig.r, sig.s);
      await expect(
        facilitator.connect(relayer).settle(auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, resourceHash, sig.v, sig.r, sig.s)
      ).to.be.revertedWithCustomError(facilitator, "AlreadySettled");
    });

    it("rejects a tampered amount (signature is over the original value)", async () => {
      const { usdc, facilitator, payer, merchant, relayer } = await loadFixture(deployFixture);
      const { auth, sig } = await signAuthorization(usdc, payer, merchant.address, USDC("0.01"));
      const resourceHash = ethers.id("GET /api/travel/search");
      await expect(
        facilitator.connect(relayer).settle(auth.from, auth.to, USDC("100"), auth.validAfter, auth.validBefore, auth.nonce, resourceHash, sig.v, sig.r, sig.s)
      ).to.be.revertedWithCustomError(usdc, "InvalidSignature");
    });

    it("rejects settlement from an unendorsed caller (Attack I-B preemption)", async () => {
      const { usdc, facilitator, payer, merchant, provider } = await loadFixture(deployFixture);
      const { auth, sig } = await signAuthorization(usdc, payer, merchant.address, USDC("0.01"));
      const resourceHash = ethers.id("GET /api/travel/search");
      // `provider` is an observer who copied the signed X-PAYMENT header. It is
      // not an endorsed facilitator, so it cannot forge a settlement record here.
      await expect(
        facilitator.connect(provider).settle(auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, resourceHash, sig.v, sig.r, sig.s)
      ).to.be.revertedWithCustomError(facilitator, "NotFacilitator");
      expect((await facilitator.settlements(auth.nonce)).settledAt).to.equal(0);
    });

    it("lets the owner rotate the facilitator allow-list", async () => {
      const { usdc, facilitator, owner, payer, merchant, provider } = await loadFixture(deployFixture);
      const { auth, sig } = await signAuthorization(usdc, payer, merchant.address, USDC("0.01"));
      const resourceHash = ethers.id("GET /api/travel/search");
      await expect(facilitator.connect(owner).setFacilitator(provider.address, true))
        .to.emit(facilitator, "FacilitatorSet")
        .withArgs(provider.address, true);
      await facilitator.connect(provider).settle(auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce, resourceHash, sig.v, sig.r, sig.s);
      expect((await facilitator.settlements(auth.nonce)).payer).to.equal(payer.address);
    });
  });
});
