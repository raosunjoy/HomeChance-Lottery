const { Connection, PublicKey, TransactionMessage, SystemProgram, LAMPORTS_PER_SOL, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');

async function signWithPhantom() {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

    const userWallet = new PublicKey('AnjjTZc1CrYtAWUFfmYALwfvGS8pbBbZQ48wedMmpATz');
    const platformWallet = new PublicKey('BJLZeGiWModDYmKTfSHLFHQYT8oBuGNy4CxTfjLf3fwW');

    const ticketPriceLamports = 41 * LAMPORTS_PER_SOL;
    const ticketCount = 1;

    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
        payerKey: platformWallet,
        recentBlockhash: blockhash,
        instructions: [
            SystemProgram.transfer({
                fromPubkey: userWallet,
                toPubkey: platformWallet,
                lamports: ticketPriceLamports * ticketCount,
            }),
        ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    const serializedTransaction = transaction.serialize();
    console.log('Serialized Transaction (hex):', Buffer.from(serializedTransaction).toString('hex'));
}

signWithPhantom().catch(console.error);