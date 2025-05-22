const { AnchorProvider, Program, web3, BN, utils } = require('@coral-xyz/anchor');
const { createMint } = require('@solana/spl-token');
const fs = require('fs');

// Setup connection and wallet
const connection = new web3.Connection('http://localhost:8899', 'confirmed');
const walletKeypair = web3.Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync('/Users/keerthirao/.config/solana/id.json', 'utf-8'))
  )
);
const wallet = {
  publicKey: walletKeypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(walletKeypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    txs.forEach(tx => tx.partialSign(walletKeypair));
    return txs;
  },
};
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

// Load program IDL and initialize
const programId = new web3.PublicKey('BAkZeFEefRiGYj8des7zXoTpWwNNcfj6NB5694PCTHKo');
const idl = require('./homechance_raffle.json');
const program = new Program(idl, programId, provider);

async function initializeRaffle() {
  let raffleAccount = web3.Keypair.generate();
  let propertyNftMint = web3.Keypair.generate();
  let propertyTokenMint = web3.Keypair.generate();

  const raffleId = "raffle-001";
  const propertyId = "property-001";
  const ticketPriceSol = new BN(web3.LAMPORTS_PER_SOL / 10); // 0.1 SOL
  const allowFractional = true;
  const propertyName = "Dream Home";
  const propertySymbol = "HOME";
  const propertyUri = "https://example.com/property.json";

  // Derive the escrow account PDA for reference
  const [escrowAccount, bump] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), Buffer.from(raffleId, "utf8")],
    programId
  );
  console.log('Derived escrow account (for reference):', escrowAccount.toBase58());
  console.log('Bump (for reference):', bump);

  try {
    // Check if raffleAccount already exists, and handle accordingly
    const minimumBalance = await connection.getMinimumBalanceForRentExemption(200); // Approximate size for raffle account

    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      const accountInfo = await connection.getAccountInfo(raffleAccount.publicKey, 'confirmed');
      if (!accountInfo) {
        console.log(`raffleAccount (${raffleAccount.publicKey.toBase58()}) does not exist, will fund it.`);
        break;
      }
      console.log(`raffleAccount (${raffleAccount.publicKey.toBase58()}) already exists with lamports: ${accountInfo.lamports}`);
      if (accountInfo.lamports >= minimumBalance) {
        console.log(`raffleAccount has sufficient balance (${accountInfo.lamports} >= ${minimumBalance}), skipping funding.`);
        break;
      }
      console.log(`raffleAccount exists but has insufficient balance (${accountInfo.lamports} < ${minimumBalance}), generating a new keypair...`);
      raffleAccount = web3.Keypair.generate();
      attempts++;
    }
    if (attempts >= maxAttempts) {
      throw new Error(`Failed to find an unused address for raffleAccount after ${maxAttempts} attempts`);
    }

    // Fund the raffleAccount if needed
    const raffleAccountInfo = await connection.getAccountInfo(raffleAccount.publicKey, 'confirmed');
    if (!raffleAccountInfo || raffleAccountInfo.lamports < minimumBalance) {
      const fundTx = new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: raffleAccount.publicKey,
          lamports: minimumBalance - (raffleAccountInfo ? raffleAccountInfo.lamports : 0),
        })
      );
      const { blockhash: fundBlockhash } = await connection.getLatestBlockhash();
      fundTx.recentBlockhash = fundBlockhash;
      fundTx.feePayer = wallet.publicKey;
      fundTx.partialSign(walletKeypair);
      await web3.sendAndConfirmTransaction(connection, fundTx, [walletKeypair]);
      console.log('Funded raffleAccount successfully.');
    } else {
      console.log('raffleAccount does not need funding.');
    }

    // Initialize the mint accounts (createMint will handle creation and funding)
    console.log(`Creating propertyNftMint (${propertyNftMint.publicKey.toBase58()})...`);
    await createMint(
      connection,
      walletKeypair, // Payer for the transaction
      wallet.publicKey, // Mint authority
      null, // Freeze authority (null means no freeze authority)
      0, // Decimals (0 for NFT)
      propertyNftMint, // Keypair for the mint account
      { commitment: 'confirmed' }
    );

    console.log(`Creating propertyTokenMint (${propertyTokenMint.publicKey.toBase58()})...`);
    await createMint(
      connection,
      walletKeypair, // Payer for the transaction
      wallet.publicKey, // Mint authority
      null, // Freeze authority
      6, // Decimals (6 for token)
      propertyTokenMint, // Keypair for the mint account
      { commitment: 'confirmed' }
    );

    // Build the instruction with the derived escrowAccount
    const instruction = await program.methods.initializeRaffle(
      raffleId,
      propertyId,
      ticketPriceSol,
      allowFractional,
      propertyName,
      propertySymbol,
      propertyUri
    )
      .accounts({
        raffle: raffleAccount.publicKey,
        seller: wallet.publicKey,
        escrowAccount: escrowAccount, // Explicitly provide the derived escrowAccount
        propertyNftMint: propertyNftMint.publicKey,
        propertyTokenMint: propertyTokenMint.publicKey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
        metadataProgram: new web3.PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),
      })
      .signers([raffleAccount])
      .instruction();

    // Create a new transaction and add the instruction
    const tx = new web3.Transaction();
    tx.add(instruction);

    // Set the recentBlockhash and feePayer
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;

    // Sign the transaction
    tx.partialSign(walletKeypair, raffleAccount);

    // Serialize the transaction and send it
    const serializedTx = tx.serialize();
    const signature = await connection.sendRawTransaction(serializedTx, {
      skipPreflight: false,
      commitment: 'confirmed',
    });

    // Confirm the transaction
    await connection.confirmTransaction(signature, 'confirmed');

    // Fetch the raffle account to inspect the escrow_account field
    const raffleData = await program.account.raffle.fetch(raffleAccount.publicKey);
    console.log('Program-derived escrow account:', raffleData.escrowAccount.toBase58());

    console.log('Initialized raffle. Transaction:', signature);
    console.log('Raffle account:', raffleAccount.publicKey.toBase58());
  } catch (error) {
    console.error('Error initializing raffle:', error);
    if (error.logs) {
      console.log('Transaction logs:', error.logs);
    }
  }
}

initializeRaffle();

