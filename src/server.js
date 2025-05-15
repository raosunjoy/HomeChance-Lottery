const express = require('express');
const jwt = require('jsonwebtoken');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { signTransaction } = require('./sign_transaction');

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// JWT Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        console.log('No token provided');
        return res.status(401).json({ error: 'No token provided' });
    }

    console.log(`Authenticating token: ${token}`);
    jwt.verify(token, process.env.JWT_SECRET || 'your-exact-secret-from-task-definition', (err, user) => {
        if (err) {
            console.log('Token verification failed:', err.message);
            return res.status(403).json({ error: 'Invalid or expired token' });
        }

        console.log('Token verified, user:', user);
        req.user = user;
        next();
    });
};

app.post('/api/purchase-ticket', authenticateToken, async (req, res) => {
    console.log('Processing /api/purchase-ticket request:', req.body);
    try {
        const { raffleId, userId, userWallet, ticketCount } = req.body;

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

        console.log('Generating and signing transaction...');
        const { signature, transaction } = await signTransaction(userWallet, ticketCount);

        console.log('Sending transaction...');
        const txid = await connection.sendRawTransaction(transaction.serialize());
        console.log('Transaction sent, confirming:', txid);

        await connection.confirmTransaction(txid);
        console.log('Transaction confirmed:', txid);

        console.log('Sending confirmation email to sunjoyrao@gmail.com');
        res.json({ success: true, signature: txid });
    } catch (error) {
        console.error('Error in /api/purchase-ticket:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});