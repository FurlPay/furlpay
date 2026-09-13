import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { CanonicalFURL } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ---------------------------------------------------------------------------
// Canonical FURL — the EVM spoke token.
//
// The three properties under test are the three ways a burn-and-mint bridge
// token silently breaks its own supply guarantee:
//
//   1. WRONG DECIMALS. 18 instead of 6 moves 10^12x the intended amount, and
//      every number involved looks ordinary.
//   2. UNBOUNDED MINT. A compromised bridge manager prints FURL that no locked
//      Solana balance backs, making the published 1B cap false.
//   3. ARBITRARY BURN. A role that can destroy any holder's balance is a
//      permanent delegate — an extension FURL deliberately omits on Solana,
//      where holders can verify its absence.
//
// The Solana side cannot be checked from here. What is checked is that this
// contract cannot be the thing that breaks the invariant.
// ---------------------------------------------------------------------------

const SIX_DECIMALS = 10n ** 6n;
const MAX_SUPPLY = 1_000_000_000n * SIX_DECIMALS; // 1e15 base units
const ADMIN_DELAY = 3n * 24n * 60n * 60n; // 3 days

describe("CanonicalFURL", () => {
  async function deploy() {
    const [admin, bridge, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CanonicalFURL");
    const token = (await Factory.deploy(admin.address, ADMIN_DELAY)) as unknown as CanonicalFURL;
    await token.waitForDeployment();

    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.connect(admin).grantRole(MINTER_ROLE, bridge.address);

    return { token, admin, bridge, alice, bob, MINTER_ROLE };
  }

  describe("token identity matches the Solana mint", () => {
    it("is named FurlPay with symbol FURL", async () => {
      const { token } = await loadFixture(deploy);
      expect(await token.name()).to.equal("FurlPay");
      expect(await token.symbol()).to.equal("FURL");
    });

    it("has SIX decimals, not eighteen", async () => {
      // The single most consequential line in the contract. An 18-decimal
      // spoke against a 6-decimal hub bridges 10^12x the intended amount.
      const { token } = await loadFixture(deploy);
      expect(await token.decimals()).to.equal(6);
    });

    it("caps supply at exactly the canonical 1,000,000,000 FURL", async () => {
      const { token } = await loadFixture(deploy);
      expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
      expect(await token.MAX_SUPPLY()).to.equal(1_000_000_000_000_000n);
    });

    it("starts with zero supply — every token here was bridged", async () => {
      const { token } = await loadFixture(deploy);
      expect(await token.totalSupply()).to.equal(0n);
      expect(await token.remainingMintable()).to.equal(MAX_SUPPLY);
    });
  });

  describe("minting is bridge-only and capped", () => {
    it("lets the bridge mint", async () => {
      const { token, bridge, alice } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, 1_000n * SIX_DECIMALS);
      expect(await token.balanceOf(alice.address)).to.equal(1_000n * SIX_DECIMALS);
      expect(await token.totalSupply()).to.equal(1_000n * SIX_DECIMALS);
    });

    it("REFUSES a non-minter, including the admin", async () => {
      const { token, admin, alice } = await loadFixture(deploy);
      await expect(token.connect(alice).mint(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
      // The admin can GRANT the role but does not hold it — granting and using
      // are separate acts, so a compromised admin key is still one step from
      // supply.
      await expect(token.connect(admin).mint(admin.address, 1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("REFUSES to exceed the canonical supply", async () => {
      const { token, bridge, alice } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, MAX_SUPPLY);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
      expect(await token.remainingMintable()).to.equal(0n);

      await expect(token.connect(bridge).mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "ExceedsCanonicalSupply")
        .withArgs(1n, 0n);
    });

    it("refuses a mint that would cross the cap, rather than partially filling", async () => {
      const { token, bridge, alice } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, MAX_SUPPLY - 100n);

      // A partial mint would leave the bridge believing it moved the full
      // amount. Reverting keeps the two sides reconcilable.
      await expect(token.connect(bridge).mint(alice.address, 101n))
        .to.be.revertedWithCustomError(token, "ExceedsCanonicalSupply")
        .withArgs(101n, 100n);

      await token.connect(bridge).mint(alice.address, 100n);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });

    it("rejects zero-address and zero-amount mints", async () => {
      const { token, bridge } = await loadFixture(deploy);
      await expect(
        token.connect(bridge).mint(ethers.ZeroAddress, 1n),
      ).to.be.revertedWithCustomError(token, "ZeroAddress");
      await expect(
        token.connect(bridge).mint((await ethers.getSigners())[3].address, 0n),
      ).to.be.revertedWithCustomError(token, "ZeroAmount");
    });

    it("frees headroom again after a burn — the cap is on supply, not cumulative mints", async () => {
      const { token, bridge, alice } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, MAX_SUPPLY);
      await token.connect(alice).burn(500n * SIX_DECIMALS);

      expect(await token.remainingMintable()).to.equal(500n * SIX_DECIMALS);
      // Bridging back in must work; otherwise round-tripping would permanently
      // shrink the spoke's capacity.
      await token.connect(bridge).mint(alice.address, 500n * SIX_DECIMALS);
      expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    });
  });

  describe("burning cannot destroy someone else's balance", () => {
    it("burns the caller's own tokens", async () => {
      const { token, bridge, alice } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, 1_000n * SIX_DECIMALS);
      await token.connect(alice).burn(400n * SIX_DECIMALS);

      expect(await token.balanceOf(alice.address)).to.equal(600n * SIX_DECIMALS);
      expect(await token.totalSupply()).to.equal(600n * SIX_DECIMALS);
    });

    it("burnFrom REQUIRES an allowance — there is no arbitrary-burn role", async () => {
      // FURL's Solana mint omits `permanentDelegate` precisely so no one can
      // destroy a holder's tokens. A BURNER_ROLE with unapproved burnFrom would
      // reintroduce that power on the EVM side.
      const { token, bridge, alice, bob } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, 1_000n * SIX_DECIMALS);

      await expect(
        token.connect(bob).burnFrom(alice.address, 1n),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

      // Even the bridge, which can mint, cannot burn an unapproved balance.
      await expect(
        token.connect(bridge).burnFrom(alice.address, 1n),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("burnFrom works within an approved allowance, and spends it", async () => {
      const { token, bridge, alice, bob } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, 1_000n * SIX_DECIMALS);
      await token.connect(alice).approve(bob.address, 300n * SIX_DECIMALS);

      await token.connect(bob).burnFrom(alice.address, 200n * SIX_DECIMALS);
      expect(await token.balanceOf(alice.address)).to.equal(800n * SIX_DECIMALS);
      expect(await token.allowance(alice.address, bob.address)).to.equal(100n * SIX_DECIMALS);

      await expect(
        token.connect(bob).burnFrom(alice.address, 200n * SIX_DECIMALS),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("cannot burn more than the holder has", async () => {
      const { token, bridge, alice } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, 10n);
      await expect(token.connect(alice).burn(11n)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientBalance",
      );
    });
  });

  describe("the bridge round trip preserves supply", () => {
    it("mint then burn returns supply to zero", async () => {
      // The spoke-side half of: Solana locked == sum(EVM supply).
      const { token, bridge, alice } = await loadFixture(deploy);
      const amount = 250_000n * SIX_DECIMALS;

      await token.connect(bridge).mint(alice.address, amount);
      expect(await token.totalSupply()).to.equal(amount);

      // Bridging out: the manager takes custody, then burns its own balance.
      await token.connect(alice).approve(bridge.address, amount);
      await token.connect(bridge).transferFrom(alice.address, bridge.address, amount);
      await token.connect(bridge).burn(amount);

      expect(await token.totalSupply()).to.equal(0n);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
      expect(await token.remainingMintable()).to.equal(MAX_SUPPLY);
    });

    it("supply equals exactly what was bridged in, across many transfers", async () => {
      const { token, bridge, alice, bob } = await loadFixture(deploy);
      const a = 12_345n * SIX_DECIMALS;
      const b = 67_890n * SIX_DECIMALS;

      await token.connect(bridge).mint(alice.address, a);
      await token.connect(bridge).mint(bob.address, b);
      // Transfers between holders never change supply.
      await token.connect(alice).transfer(bob.address, 45n * SIX_DECIMALS);

      expect(await token.totalSupply()).to.equal(a + b);
      expect(await token.balanceOf(alice.address)).to.equal(a - 45n * SIX_DECIMALS);
      expect(await token.balanceOf(bob.address)).to.equal(b + 45n * SIX_DECIMALS);
    });
  });

  describe("admin control", () => {
    it("admin handover is two-step and delayed, not instant", async () => {
      // A mistyped or malicious handover is visible and cancellable rather than
      // final the moment it is submitted.
      const { token, admin, alice } = await loadFixture(deploy);
      expect(await token.defaultAdminDelay()).to.equal(ADMIN_DELAY);

      await token.connect(admin).beginDefaultAdminTransfer(alice.address);
      // Not yet admin — the delay has not elapsed and it has not been accepted.
      expect(await token.defaultAdmin()).to.equal(admin.address);

      await expect(token.connect(alice).acceptDefaultAdminTransfer()).to.be.reverted;
    });

    it("admin can revoke a compromised bridge's minter role", async () => {
      const { token, admin, bridge, alice, MINTER_ROLE } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, 1n);

      await token.connect(admin).revokeRole(MINTER_ROLE, bridge.address);
      await expect(token.connect(bridge).mint(alice.address, 1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("no minter exists until the admin grants the role", async () => {
      const [admin, , alice] = await ethers.getSigners();
      const Factory = await ethers.getContractFactory("CanonicalFURL");
      const fresh = (await Factory.deploy(admin.address, ADMIN_DELAY)) as unknown as CanonicalFURL;
      await fresh.waitForDeployment();

      // A freshly deployed spoke cannot mint anything to anyone.
      await expect(fresh.connect(admin).mint(alice.address, 1n)).to.be.revertedWithCustomError(
        fresh,
        "AccessControlUnauthorizedAccount",
      );
      expect(await fresh.totalSupply()).to.equal(0n);
    });
  });

  describe("ERC20Permit", () => {
    it("supports gasless approval via signature", async () => {
      const { token, bridge, alice, bob } = await loadFixture(deploy);
      await token.connect(bridge).mint(alice.address, 100n * SIX_DECIMALS);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = await token.nonces(alice.address);
      const value = 50n * SIX_DECIMALS;

      const signature = await (alice as HardhatEthersSigner).signTypedData(
        {
          name: "FurlPay",
          version: "1",
          chainId: (await ethers.provider.getNetwork()).chainId,
          verifyingContract: await token.getAddress(),
        },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        { owner: alice.address, spender: bob.address, value, nonce, deadline },
      );
      const { v, r, s } = ethers.Signature.from(signature);

      await token.permit(alice.address, bob.address, value, deadline, v, r, s);
      expect(await token.allowance(alice.address, bob.address)).to.equal(value);
    });
  });
});
