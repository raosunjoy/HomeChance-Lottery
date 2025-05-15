const { Connection, Keypair, Transaction, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58');
const AWS = require('aws-sdk');

AWS.config.update({ region: 'ap-southeast-2' });
const secretsManager = new AWS.SecretsManager();

async function getSecret(secretName) {
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    return JSON.parse(data.SecretString);
}

(async () => {
    try {
        const secrets = await getSecret('homechance/preprod/secrets');
        const { TEST_WALLET_PRIVATE_KEY, PLATFORM_WALLET_PUBLIC_KEY } = secrets;

        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const testWallet = Keypair.fromSecretKey(bs58.decode(TEST_WALLET_PRIVATE_KEY));
        const platformWallet = new PublicKey(PLATFORM_WALLET_PUBLIC_KEY);

        const userId = process.argv[2] || 'default_user';
        const ticketPriceLamports = 41 * 1e9;

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: testWallet.publicKey,
                toPubkey: platformWallet,
                lamports: ticketPriceLamports,
            })
        );
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = testWallet.publicKey;

        transaction.sign(testWallet);
        const signature = transaction.signature.toString('base64');

        console.log(JSON.stringify({
            publicKey: testWallet.publicKey.toBase58(),
            signature: signature
        }));
    } catch (error) {
        console.error('Error signing transaction:', error);
        console.log(JSON.stringify({ error: error.message }));
        process.exit(1);
    }
})();