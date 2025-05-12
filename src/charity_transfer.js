const mongoose = require('mongoose');
const { Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58');
const AWS = require('aws-sdk');
const axios = require('axios');

AWS.config.update({ region: 'us-east-1' });
const secretsManager = new AWS.SecretsManager();

async function getSecret(secretName) {
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    return JSON.parse(data.SecretString);
}

(async () => {
    try {
        const secrets = await getSecret('homechance/preprod/secrets');
        const { MONGO_URI, PLATFORM_WALLET_PRIVATE_KEY, CHARITY_PUBLIC_KEY, SLACK_WEBHOOK_URL } = secrets;

        mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const platformWallet = Keypair.fromSecretKey(bs58.decode(PLATFORM_WALLET_PRIVATE_KEY));
        const charityPublicKey = new PublicKey(CHARITY_PUBLIC_KEY);

        const Raffle = mongoose.model('Raffle', new mongoose.Schema({
            raffleId: String,
            fundsRaised: Number,
            charityTransferred: { type: Number, default: 0 }
        }));

        const raffles = await Raffle.find();
        for (const raffle of raffles) {
            const profit = raffle.fundsRaised * 0.7; // 70% margin
            const charityAmount = profit * 0.1; // 10% of profit
            if (charityAmount > raffle.charityTransferred) {
                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: platformWallet.publicKey,
                        toPubkey: charityPublicKey,
                        lamports: Math.floor(charityAmount * 1e9) // Convert to lamports
                    })
                );
                const signature = await sendAndConfirmTransaction(connection, transaction, [platformWallet]);
                console.log(`Transferred ${charityAmount} SOL to charity for raffle ${raffle.raffleId}. Tx: ${signature}`);

                raffle.charityTransferred += charityAmount;
                await raffle.save();

                await axios.post(SLACK_WEBHOOK_URL, {
                    text: `Charity transfer of ${charityAmount} SOL completed for raffle ${raffle.raffleId}. Transaction: ${signature}`
                });
            }
        }

        mongoose.connection.close();
    } catch (error) {
        console.error('Error in charity transfer:', error);
    }
})();