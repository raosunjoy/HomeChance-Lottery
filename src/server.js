require('dotenv').config({ path: './.env' });
console.log('MONGO_URI:', process.env.MONGO_URI);

const express = require('express');
const mongoose = require('mongoose');
const { Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const AWS = require('aws-sdk');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Sentry = require('@sentry/node');
const Stripe = require('stripe');
const { Parser } = require('json2csv');
const ses = new AWS.SES({ region: 'ap-southeast-2' });

AWS.config.update({ region: 'ap-southeast-2' });

const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://preprod.homechance.io' }));
Sentry.init({ dsn: 'https://example@sentry.io/1234' });

// Load secrets from environment variables
const MONGO_URI = process.env.MONGO_URI;
const PLATFORM_WALLET_PRIVATE_KEY = process.env.PLATFORM_WALLET_PRIVATE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SES_ACCESS_KEY = process.env.SES_ACCESS_KEY;
const SES_SECRET_KEY = process.env.SES_SECRET_KEY;
const SES_REGION = process.env.SES_REGION;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Initialize Stripe and AWS SES with environment variables
const stripe = Stripe(STRIPE_SECRET_KEY);
AWS.config.update({ accessKeyId: SES_ACCESS_KEY, secretAccessKey: SES_SECRET_KEY, region: SES_REGION });

// Connect to MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const platformWallet = Keypair.fromSecretKey(bs58.decode(PLATFORM_WALLET_PRIVATE_KEY));

const verifyKycAml = async (userId) => {
    try {
        const userVerification = await mongoose.model('UserVerification').findOne({ userId });
        if (userVerification && userVerification.status === 'verified') {
            return { verified: true };
        }

        const verificationSession = await stripe.identity.verificationSessions.create({
            type: 'document',
            metadata: { userId },
            options: { document: { allowed_types: ['id_card', 'passport'], require_matching_selfie: true } },
            return_url: 'https://preprod.homechance.io/verification-complete'
        });

        await mongoose.model('UserVerification', new mongoose.Schema({
            userId: String,
            sessionId: String,
            status: String
        })).create({
            userId,
            sessionId: verificationSession.id,
            status: 'pending'
        });

        return { verified: false, verificationUrl: verificationSession.url };
    } catch (error) {
        Sentry.captureException(error);
        throw new Error('KYC/AML verification failed');
    }
};

app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        Sentry.captureException(err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'identity.verification_session.verified') {
        const session = event.data.object;
        const userId = session.metadata.userId;
        await mongoose.model('UserVerification').updateOne(
            { userId, sessionId: session.id },
            { status: 'verified' }
        );
    } else if (event.type === 'identity.verification_session.requires_input') {
        const session = event.data.object;
        const userId = session.metadata.userId;
        await mongoose.model('UserVerification').updateOne(
            { userId, sessionId: session.id },
            { status: 'failed' }
        );
    }

    res.status(200).json({ received: true });
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        req.user = user;
        next();
    });
};

const raffleSchema = new mongoose.Schema({
    raffleId: String,
    fundsRaised: { type: Number, default: 0 },
    charityTransferred: { type: Number, default: 0 },
    status: { type: String, default: 'active' }
});
const Raffle = mongoose.model('Raffle', raffleSchema);

const transactionLogSchema = new mongoose.Schema({
    userId: String,
    userWallet: String,
    raffleId: String,
    amount: Number,
    timestamp: { type: Date, default: Date.now },
    refunded: { type: Boolean, default: false }
});
const TransactionLog = mongoose.model('TransactionLog', transactionLogSchema);

async function sendEmail(to, subject, body) {
    const params = {
        Source: SES_FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Message: { Subject: { Data: subject }, Body: { Text: { Data: body } } }
    };
    try {
        await ses.sendEmail(params).promise();
    } catch (error) {
        Sentry.captureException(error);
        console.error('Email sending failed:', error);
    }
}

app.post('/api/purchase-ticket', authenticateToken, async (req, res) => {
    try {
        const { raffleId, userId, userWallet, ticketCount, signature } = req.body;
        const raffle = await Raffle.findOne({ raffleId });
        if (raffle && raffle.status === 'cancelled') {
            return res.status(400).json({ error: 'Raffle has been cancelled' });
        }

        const kycResult = await verifyKycAml(userId);
        if (!kycResult.verified) {
            return res.status(403).json({ error: 'KYC verification required', verificationUrl: kycResult.verificationUrl });
        }

        if (!signature) return res.status(400).json({ error: 'Invalid signature' });

        const ticketPriceLamports = 41 * LAMPORTS_PER_SOL;
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: new PublicKey(userWallet),
                toPubkey: platformWallet.publicKey,
                lamports: ticketPriceLamports * ticketCount,
            })
        );
        const confirmedTx = await sendAndConfirmTransaction(connection, transaction, [platformWallet]);
        console.log('Transaction confirmed:', confirmedTx);

        const raffleUpdate = await Raffle.findOneAndUpdate(
            { raffleId },
            { $inc: { fundsRaised: 41 * ticketCount } },
            { upsert: true, new: true }
        );

        await TransactionLog.create({
            userId,
            userWallet,
            raffleId,
            amount: 41 * ticketCount
        });

        const userEmail = req.user.email || userId;
        await sendEmail(userEmail, 'Ticket Purchase Confirmation', `You purchased ${ticketCount} tickets for raffle ${raffleId}. Transaction: ${confirmedTx}`);
        res.status(200).json({ message: 'Ticket purchased', transaction: confirmedTx });
    } catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/raffle-status/:raffleId', authenticateToken, async (req, res) => {
    try {
        const raffle = await Raffle.findOne({ raffleId: req.params.raffleId });
        if (!raffle) return res.status(404).json({ error: 'Raffle not found' });
        res.status(200).json({ fundsRaised: raffle.fundsRaised, status: raffle.status });
    } catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/cancel-raffle', authenticateToken, async (req, res) => {
    try {
        const { raffleId } = req.body;
        const raffle = await Raffle.findOneAndUpdate(
            { raffleId, status: 'active' },
            { status: 'cancelled' },
            { new: true }
        );
        if (!raffle) return res.status(404).json({ error: 'Raffle not found or already cancelled' });

        const transactions = await TransactionLog.find({ raffleId, refunded: false });
        for (const tx of transactions) {
            const refundTransaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: platformWallet.publicKey,
                    toPubkey: new PublicKey(tx.userWallet),
                    lamports: tx.amount * LAMPORTS_PER_SOL
                })
            );
            const refundTx = await sendAndConfirmTransaction(connection, refundTransaction, [platformWallet]);
            console.log(`Refunded ${tx.amount} SOL to ${tx.userWallet}. Tx: ${refundTx}`);

            tx.refunded = true;
            await tx.save();
            const userEmail = req.user.email || tx.userId;
            await sendEmail(userEmail, 'Raffle Cancellation and Refund', `Raffle ${raffleId} has been cancelled. You were refunded ${tx.amount} SOL. Transaction: ${refundTx}`);
        }

        raffle.fundsRaised = 0;
        await raffle.save();
        res.status(200).json({ message: 'Raffle cancelled and refunds processed', affectedUsers: transactions.length });
    } catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ error: 'Failed to cancel raffle or process refunds' });
    }
});

app.get('/api/compliance-report', authenticateToken, async (req, res) => {
    try {
        const transactions = await TransactionLog.find();
        const fields = ['userId', 'userWallet', 'raffleId', 'amount', 'timestamp', 'refunded'];
        const parser = new Parser({ fields });
        const csv = parser.parse(transactions);

        res.header('Content-Type', 'text/csv');
        res.attachment('compliance-report.csv');
        res.send(csv);
    } catch (error) {
        Sentry.captureException(error);
        res.status(500).json({ error: 'Failed to generate compliance report' });
    }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'healthy' }));

try {
    console.log('Fetching users...');
    const users = await User.find();
    console.log('Users fetched:', users);
    res.json(users);
  } catch (error) {
    console.error('Error in /api/users:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
  
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
