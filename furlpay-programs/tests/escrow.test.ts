import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FurlpayEscrow } from "../target/types/furlpay_escrow";

describe("furlpay_escrow", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  // Wait, wait we don't actually build it here in the environment,
  // just the stub.
  it("Is initialized!", async () => {
    // Add your test here.
    // const program = anchor.workspace.FurlpayEscrow as Program<FurlpayEscrow>;
    // const tx = await program.methods.createEscrow(...).rpc();
    // console.log("Your transaction signature", tx);
  });
});
