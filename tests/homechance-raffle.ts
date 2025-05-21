import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount } from "@solana/spl-token";
import { assert } from "chai";
import BN from "bn.js"; // Import BN from bn.js

describe("homechance-raffle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.HomechanceRaffle;
  const wallet = provider.wallet as anchor.Wallet;

  it("Is initialized!", async () => {
    // Generate keypairs
    const raffle = anchor.web3.Keypair.generate();
    const seller = wallet.publicKey;

    // Create and initialize the escrow account (SPL token account)
    const escrowAccount = anchor.web3.Keypair.generate();
    const escrowTokenAccount = await createAccount(
      provider.connection,
      wallet.payer,
      anchor.web3.PublicKey.default, // Use a dummy mint for now (SOL-like behavior)
      escrowAccount.publicKey,
      escrowAccount
    );

    // Create and initialize the property NFT mint
    const propertyNftMint = await createMint(
      provider.connection,
      wallet.payer,
      seller,
      null,
      0 // NFT (0 decimals)
    );

    // Create and initialize the property token mint (for fractional tokens)
    const propertyTokenMint = await createMint(
      provider.connection,
      wallet.payer,
      seller,
      null,
      6 // 6 decimals for fractional tokens
    );

    // Call initializeRaffle
    await program.methods
      .initializeRaffle(
        "raffle1",
        "property1",
        new BN(1_000_000), // ticket_price_sol (1 SOL in lamports)
        true, // allow_fractional
        "Property NFT", // property_name
        "PROP", // property_symbol
        "https://example.com/metadata.json" // property_uri
      )
      .accounts({
        raffle: raffle.publicKey,
        seller: seller,
        escrowAccount: escrowTokenAccount,
        propertyNftMint: propertyNftMint,
        propertyTokenMint: propertyTokenMint,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        metadataProgram: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
      })
      .signers([raffle])
      .rpc();

    // Fetch and verify the raffle account
    const raffleAccount = await program.account.raffle.fetch(raffle.publicKey);
    assert.strictEqual(raffleAccount.raffleId, "raffle1");
    assert.strictEqual(raffleAccount.propertyId, "property1");
    assert.strictEqual(raffleAccount.ticketPriceSol.toNumber(), 1_000_000);
    assert.strictEqual(raffleAccount.totalTickets.toNumber(), 10_000);
    assert.strictEqual(raffleAccount.ticketsSold.toNumber(), 0);
    assert.strictEqual(raffleAccount.isCompleted, false);
    assert.strictEqual(raffleAccount.allowFractional, true);
  });
});

