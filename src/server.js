import mongoose from 'mongoose';
import express from 'express';
import { processSolPayment, paySellerAndCharitySol } from './payments/solana.js';
import { createCheckoutSession, paySellerAndCharity } from './payments/stripe.js';

const app = express();
app.use(express.json());

// Wrap MongoDB connection in an async IIFE
(async () => {
    try {
        await mongoose.connect('mongodb://localhost:27017/Homechance', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
})();

// Routes
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' });
});

app.get('/generate-keypair', async (req, res) => {
    const { Keypair } = await import('@solana/web3.js');
    const keypair = Keypair.generate();
    res.status(200).json({
        publicKey: keypair.publicKey.toBase58(),
        secretKey: Buffer.from(keypair.secretKey).toString('hex'),
    });
});

app.post('/process-payment', async (req, res) => {
    const { ticketPrice } = req.body;
    try {
        const session = await createCheckoutSession(ticketPrice);
        res.status(200).json({ message: 'Checkout session created', sessionId: session.id, url: session.url });
    } catch (error) {
        res.status(500).json({ error: 'Payment processing failed', details: error.message });
    }
});

app.post('/payout', async (req, res) => {
    const { amount } = req.body;
    try {
        const result = await paySellerAndCharity(amount);
        res.status(200).json({ message: 'Payout calculated', result });
    } catch (error) {
        res.status(500).json({ error: 'Payout failed', details: error.message });
    }
});

app.post('/process-solana-payment', async (req, res) => {
    const { userWallet, ticketCount, ticketPrice } = req.body;
    try {
        const signature = await processSolPayment(userWallet, ticketCount, ticketPrice);
        res.status(200).json({ message: 'Solana payment processed', signature });
    } catch (error) {
        res.status(500).json({ error: 'Solana payment failed', details: error.message });
    }
});

app.post('/payout-sol', async (req, res) => {
    const { amountSol, raffleId } = req.body;
    try {
        const signature = await paySellerAndCharitySol(amountSol, raffleId);
        res.status(200).json({ message: 'Solana payout processed', signature });
    } catch (error) {
        res.status(500).json({ error: 'Solana payout failed', details: error.message });
    }
});

export default app;

