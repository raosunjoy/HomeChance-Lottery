const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { signTransaction } = require('./sign_Transaction');

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

app.post('/api/purchase-ticket', async (req, res) => {
    console.log('Processing /api/purchase-ticket request:', req.body);
    try {
        const { raffleId, userId, userWallet, ticketCount } = req.body;

        // Validate inputs
        if (!raffleId || !userId || !userWallet || !ticketCount) {
            console.log('Validation failed: Missing required fields');
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const userPubkey = new PublicKey(userWallet);
        const ticketPriceLamports = 41 * LAMPORTS_PER_SOL;
        const totalCost = ticketPriceLamports * ticketCount;

        console.log(`Checking balance for user wallet: ${userWallet}`);
        const balance = await connection.getBalance(userPubkey);
        console.log(`User wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);

        if (balance < totalCost) {
            console.log(`Insufficient funds: Required ${totalCost / LAMPORTS_PER_SOL} SOL, but only ${balance / LAMPORTS_PER_SOL} SOL available`);
            return res.status(400).json({ error: `Insufficient funds: Required ${totalCost / LAMPORTS_PER_SOL} SOL, but only ${balance / LAMPORTS_PER_SOL} SOL available` });
        }

        // Use the signTransaction utility
        console.log('Generating and signing transaction...');
        const { signature, transaction } = await signTransaction(userWallet, ticketCount);

        // Send transaction
        console.log('Sending transaction...');
        const txid = await connection.sendRawTransaction(transaction.serialize());
        console.log('Transaction sent, confirming:', txid);

        // Confirm transaction
        await connection.confirmTransaction(txid);
        console.log('Transaction confirmed:', txid);

        // Send email (placeholder)
        console.log('Sending confirmation email to sunjoyrao@gmail.com');
        // Replace with actual SES code if implemented

        res.json({ success: true, signature: txid });
    } catch (error) {
        console.error('Error in /api/purchase-ticket:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});