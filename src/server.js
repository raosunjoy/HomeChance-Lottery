const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const AWS = require('aws-sdk');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const Raffle = require('../models/Raffle');
const TransactionLog = require('../models/TransactionLog');

const app = express();
const secretsManager = new AWS.SecretsManager({ region: 'ap-southeast-2' });
const cloudwatch = new AWS.CloudWatch({ region: 'ap-southeast-2' });

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'https://homechance.io',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Fetch secrets from AWS Secrets Manager
async function getSecrets() {
  const secretData = await secretsManager.getSecretValue({ SecretId: 'homechance-secrets' }).promise();
  const secrets = JSON.parse(secretData.SecretString);
  process.env.PLATFORM_WALLET_PRIVATE_KEY = secrets.PLATFORM_WALLET_PRIVATE_KEY;
  process.env.MONGO_URI = secrets.MONGO_URI;
  process.env.JWT_SECRET = secrets.JWT_SECRET;
}

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Connect to MongoDB and start server
(async () => {
  try {
    await getSecrets();
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB');
    app.listen(3000, () => console.log('Server running on port 3000'));
  } catch (error) {
    console.error('Error starting server:', error);
  }
})();

// Endpoints
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

app.get('/api/raffle-status/:raffleId', authenticateToken, async (req, res) => {
  try {
    const { raffleId } = req.params;
    const raffle = await Raffle.findOne({ raffleId });
    if (!raffle) {
      return res.status(404).json({ error: 'Raffle not found' });
    }
    res.status(200).json({
      raffleId: raffle.raffleId,
      ticketsSold: raffle.ticketsSold || 0,
      fundsRaised: raffle.fundsRaised || 0,
      status: raffle.status || 'active'
    });
  } catch (error) {
    console.error('Error fetching raffle status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/compliance-report', async (req, res) => {
  try {
    const transactions = await TransactionLog.find().select('userId wallet amount timestamp');
    res.status(200).json({
      report: transactions,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating compliance report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/charity-transfer', async (req, res) => {
  try {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const platformWalletPrivateKey = process.env.PLATFORM_WALLET_PRIVATE_KEY;
    const platformKeypair = Keypair.fromSecretKey(bs58.decode(platformWalletPrivateKey));
    const charityWallet = new PublicKey('CHARITY_WALLET_ADDRESS'); // Replace with actual address

    const raffle = await Raffle.findOne({ raffleId: 'raffle1' });
    const profit = (raffle.fundsRaised || 0) * 0.7; // 70% margin
    const amountToTransfer = profit * 0.1; // 10% of profit
    const lamports = amountToTransfer * 1_000_000_000; // Convert SOL to lamports

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: platformKeypair.publicKey,
        toPubkey: charityWallet,
        lamports
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [platformKeypair]);
    console.log(`Charity transfer successful: ${signature}`);
    res.status(200).json({ success: true, signature });
  } catch (error) {
    console.error('Error processing charity transfer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/purchase-ticket', authenticateToken, async (req, res) => {
  try {
    const { raffleId, userId, userWallet, ticketCount } = req.body;
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const userPublicKey = new PublicKey(userWallet);
    const platformPublicKey = new PublicKey('BJLZeGiWModDYmKTfSHLFHQYT8oBuGNy4CxTfjLf3fwW');

    // Balance check
    const balance = await connection.getBalance(userPublicKey);
    const requiredLamports = ticketCount * 41_000_000_000; // 41 SOL per ticket
    if (balance < requiredLamports) {
      return res.status(400).json({ error: 'Insufficient funds' });
    }

    // Transaction (simulated for testing; in production, client signs)
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userPublicKey,
        toPubkey: platformPublicKey,
        lamports: requiredLamports
      })
    );
    const signature = "simulated-signature-for-testing";

    // Log to TransactionLog
    await TransactionLog.create({
      userId,
      wallet: userWallet,
      amount: ticketCount * 41,
      raffleId,
      timestamp: new Date()
    });

    // Update Raffle
    await Raffle.findOneAndUpdate(
      { raffleId },
      { $inc: { ticketsSold: ticketCount, fundsRaised: ticketCount * 41 } },
      { upsert: true }
    );

    // Log CloudWatch metrics
    await cloudwatch.putMetricData({
      MetricData: [
        { MetricName: 'TicketsSold', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'Count', Value: ticketCount },
        { MetricName: 'FundsRaised', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'None', Value: ticketCount * 41 }
      ],
      Namespace: 'HomeChance'
    }).promise();

    res.status(200).json({ success: true, signature });
  } catch (error) {
    console.error('Error processing ticket purchase:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});