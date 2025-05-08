const { Keypair, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

// For testing, generate a mock keypair. In production, this should load a real user wallet.
const userId = process.argv[2] || 'default-user';

// Generate a mock keypair for the user
const userKeypair = Keypair.generate();
const publicKey = userKeypair.publicKey.toString();

// For testing, create a dummy transaction to sign (mimics the purchase transaction in server.js)
const platformPublicKey = new PublicKey('DummyPlatformPublicKey1234'); // Replace with actual platform wallet public key in production
const ticketPriceLamports = 41 * LAMPORTS_PER_SOL;
const ticketCount = 1; // Default for testing

const transaction = new Transaction().add(
    SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: platformPublicKey,
        lamports: ticketPriceLamports * ticketCount,
    })
);

// Sign the transaction with the mock keypair
const signature = bs58.encode(userKeypair.sign(transaction.instructions[0].data).signature);

// Output the public key and signature as JSON for load_test.py to consume
console.log(JSON.stringify({ publicKey, signature }));