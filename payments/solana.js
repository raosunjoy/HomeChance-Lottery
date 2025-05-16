const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const Raffle = require('../models/Raffle');

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

exports.processSolPayment = async (userWallet, ticketCount, ticketPrice) => {
  try {
    const userPubkey = new PublicKey(userWallet);
    const escrowKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ESCROW_WALLET_PRIVATE_KEY));
    const requiredLamports = ticketCount * ticketPrice * 1_000_000_000;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userPubkey,
        toPubkey: escrowKeypair.publicKey,
        lamports: requiredLamports
      })
    );
    const signature = "simulated-signature-for-testing";
    return signature;
  } catch (error) {
    throw new Error(`SOL payment failed: ${error.message}`);
  }
};

exports.paySellerAndCharitySol = async (amountSol, raffleId) => {
  try {
    const raffle = await Raffle.findOne({ raffleId });
    if (!raffle) throw new Error('Raffle not found');

    const escrowKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ESCROW_WALLET_PRIVATE_KEY));
    const ownerPubkey = new PublicKey(raffle.sellerWallet);
    const charityPubkey = new PublicKey(process.env.CHARITY_WALLET);
    const platformPubkey = new PublicKey('BJLZeGiWModDYmKTfSHLFHQYT8oBuGNy4CxTfjLf3fwW');

    const ownerLamports = amountSol * 0.9 * 1_000_000_000;
    const charityLamports = amountSol * 0.01 * 1_000_000_000;
    const platformLamports = amountSol * 0.09 * 1_000_000_000;

    const transaction = new Transaction()
      .add(SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: ownerPubkey,
        lamports: ownerLamports
      }))
      .add(SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: charityPubkey,
        lamports: charityLamports
      }))
      .add(SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: platformPubkey,
        lamports: platformLamports
      }));
    const signature = await sendAndConfirmTransaction(connection, transaction, [escrowKeypair]);
    return signature;
  } catch (error) {
    throw new Error(`SOL payout failed: ${error.message}`);
  }
};
