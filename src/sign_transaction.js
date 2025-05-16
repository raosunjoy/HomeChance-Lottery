const { Connection, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const AWS = require('aws-sdk');

AWS.config.update({ region: 'ap-southeast-2' });
const secretsManager = new AWS.SecretsManager();

async function getSecret(secretName) {
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    return JSON.parse(data.SecretString);
}

async function signTransaction(userWallet, ticketCount) {
    try {
        const secrets = await getSecret('homechance/preprod/secrets');
        const { TEST_WALLET_PRIVATE_KEY, PLATFORM_WALLET_PUBLIC_KEY } = secrets;

        const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        const testWallet = Keypair.fromSecretKey(bs58.decode(TEST_WALLET_PRIVATE_KEY));
        const platformWallet = new PublicKey(PLATFORM_WALLET_PUBLIC_KEY);
        const userPubkey = new PublicKey(userWallet);

        const ticketPriceLamports = 41 * LAMPORTS_PER_SOL;
        const totalCost = ticketPriceLamports * ticketCount;

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: userPubkey,
                toPubkey: platformWallet,
                lamports: totalCost,
            })
        );

        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = platformWallet;

        transaction.sign(testWallet);
        const signature = transaction.signature.toString('base64');

        return { publicKey: testWallet.publicKey.toBase58(), signature, transaction };
    } catch (error) {
        console.error('Error signing transaction:', error);
        throw new Error(error.message);
    }
}

module.exports = { signTransaction };