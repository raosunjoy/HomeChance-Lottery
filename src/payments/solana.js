import { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import Raffle from '../models/Raffle.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

export const paySellerAndCharitySol = async (amountSol, raffleId) => {
    try {
        console.log('Fetching raffle with raffleId:', raffleId);
        const raffle = await Raffle.findOne({ raffleId });
        if (!raffle) throw new Error('Raffle not found');
        console.log('Raffle found:', raffle);

        console.log('Creating escrow keypair');
        const escrowKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ESCROW_WALLET_PRIVATE_KEY));
        console.log('Escrow public key:', escrowKeypair.publicKey.toBase58());

        const ownerPubkey = new PublicKey(raffle.sellerWallet);
        console.log('Owner public key:', ownerPubkey.toBase58());
        const charityPubkey = new PublicKey(process.env.CHARITY_WALLET);
        console.log('Charity public key:', charityPubkey.toBase58());
        const platformPubkey = new PublicKey('BJLZeGiWModDYmKTfSHLFHQYT8oBuGNy4CxTfjLf3fwW');
        console.log('Platform public key:', platformPubkey.toBase58());

        const ownerLamports = amountSol * 0.9 * 1_000_000_000;
        const charityLamports = amountSol * 0.01 * 1_000_000_000;
        const platformLamports = amountSol * 0.09 * 1_000_000_000;
        console.log('Transaction amounts:', { ownerLamports, charityLamports, platformLamports });

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
        console.log('Sending transaction');
        const signature = await sendAndConfirmTransaction(connection, transaction, [escrowKeypair], {
            commitment: 'confirmed',
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 5,
            abortSignal: AbortSignal.timeout(5000),
        });
        console.log('Transaction signature:', signature);
        return signature;
    } catch (error) {
        console.error('Error in paySellerAndCharitySol:', error.message, error.stack);
        if (error instanceof Error && 'logs' in error) {
            console.error('Transaction logs:', error.logs);
        } else if (error.name === 'AbortError') {
            console.error('Transaction timed out after 5 seconds');
        }
        throw new Error(`SOL payout failed: ${error.message}`);
    }
};

export const processSolPayment = async (userWallet, ticketCount, ticketPrice) => {
    try {
        console.log('Processing Solana payment:', { userWallet, ticketCount, ticketPrice });
        const userPubkey = new PublicKey(userWallet);
        console.log('User public key:', userPubkey.toBase58());
        const escrowKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ESCROW_WALLET_PRIVATE_KEY));
        console.log('Escrow public key:', escrowKeypair.publicKey.toBase58());
        const requiredLamports = ticketCount * ticketPrice * 1_000_000_000;
        console.log('Required lamports:', requiredLamports);

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: userPubkey,
                toPubkey: escrowKeypair.publicKey,
                lamports: requiredLamports
            })
        );
        console.log('Sending transaction');
        // Use a funded user keypair for testing (mocked in test)
        const userKeypair = Keypair.fromSecretKey(bs58.decode(process.env.USER_WALLET_PRIVATE_KEY || bs58.encode(Buffer.from(new Uint8Array(64).fill(0)))));
        const signature = await sendAndConfirmTransaction(connection, transaction, [userKeypair], {
            commitment: 'confirmed',
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 5,
            abortSignal: AbortSignal.timeout(5000),
        });
        console.log('Transaction signature:', signature);
        return signature;
    } catch (error) {
        console.error('Error in processSolPayment:', error.message, error.stack);
        if (error instanceof Error && 'logs' in error) {
            console.error('Transaction logs:', error.logs);
        }
        throw new Error(`SOL payment failed: ${error.message}`);
    }
};

