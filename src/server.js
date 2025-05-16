const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const AWS = require('aws-sdk');
const { Connection, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
const Raffle = require('../models/Raffle');
const TransactionLog = require('../models/TransactionLog');
const { createCheckoutSession, paySellerAndCharity } = require('../payments/stripe');
const { processSolPayment, paySellerAndCharitySol } = require('../payments/solana');
const { getSolToUsdRate, getUsdToSolRate } = require('../utils/exchangeRate');
const { generateRandomNumber } = require('../utils/rng');

const app = express();
const secretsManager = new AWS.SecretsManager({ region: 'ap-southeast-2' });
const cloudwatch = new AWS.CloudWatch({ region: 'ap-southeast-2' });

app.use(express.json());
app.use(cors({
  origin: 'https://homechance.io',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

async function getSecrets() {
  const secretData = await secretsManager.getSecretValue({ SecretId: 'homechance-secrets' }).promise();
  const secrets = JSON.parse(secretData.SecretString);
  process.env.PLATFORM_WALLET_PRIVATE_KEY = secrets.PLATFORM_WALLET_PRIVATE_KEY;
  process.env.MONGO_URI = secrets.MONGO_URI;
  process.env.JWT_SECRET = secrets.JWT_SECRET;
  process.env.STRIPE_PUBLISHABLE_KEY = secrets.STRIPE_PUBLISHABLE_KEY;
  process.env.STRIPE_SECRET_KEY = secrets.STRIPE_SECRET_KEY;
  process.env.CHARITY_WALLET = secrets.CHARITY_WALLET;
  process.env.ESCROW_WALLET = secrets.ESCROW_WALLET;
  process.env.ESCROW_WALLET_PRIVATE_KEY = secrets.ESCROW_WALLET_PRIVATE_KEY;
}

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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

app.get('/api/raffle-status/:raffleId', authenticateToken, async (req, res) => {
  try {
    const { raffleId } = req.params;
    const raffle = await Raffle.findOne({ raffleId });
    if (!raffle) return res.status(404).json({ error: 'Raffle not found' });

    const solToUsdRate = await getSolToUsdRate();
    const ticketPriceUsd = raffle.ticketPrice * solToUsdRate;

    res.status(200).json({
      raffleId: raffle.raffleId,
      propertyValue: raffle.propertyValue,
      ticketPriceSol: raffle.ticketPrice,
      ticketPriceUsd: ticketPriceUsd,
      ticketsSold: raffle.ticketsSold || 0,
      fundsRaisedSol: raffle.fundsRaised || 0,
      fundsRaisedUsd: raffle.fundsRaised * solToUsdRate,
      status: raffle.status || 'active',
      winnerId: raffle.winnerId,
      propertyTransferred: raffle.propertyTransferred
    });
  } catch (error) {
    console.error('Error fetching raffle status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/compliance-report', async (req, res) => {
  try {
    const transactions = await TransactionLog.find().select('userId wallet amount amountUsd timestamp');
    res.status(200).json({
      report: transactions,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating compliance report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/create-raffle', async (req, res) => {
  try {
    const { raffleId, propertyValueUsd, sellerWallet, paymentType } = req.body;
    
    const usdToSolRate = await getUsdToSolRate();
    const propertyValueSol = propertyValueUsd * usdToSolRate;
    const ticketPriceSol = (11 * propertyValueSol) / (90 * 1000);
    const ticketPriceUsd = ticketPriceSol / usdToSolRate;

    const raffle = new Raffle({
      raffleId,
      propertyValue: propertyValueSol,
      ticketPrice: ticketPriceSol,
      sellerWallet,
      paymentType,
      maxTickets: 10000
    });
    await raffle.save();

    res.status(201).json({
      success: true,
      raffleId,
      ticketPriceSol,
      ticketPriceUsd
    });
  } catch (error) {
    console.error('Error creating raffle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/purchase-ticket-fiat', async (req, res) => {
  try {
    const { raffleId, userId } = req.body;
    const raffle = await Raffle.findOne({ raffleId });
    if (!raffle) return res.status(404).json({ error: 'Raffle not found' });
    if (raffle.ticketsSold >= raffle.maxTickets) return res.status(400).json({ error: 'Tickets sold out' });
    if (raffle.status !== 'active') return res.status(400).json({ error: 'Raffle not active' });

    const solToUsdRate = await getSolToUsdRate();
    const ticketPriceUsd = raffle.ticketPrice * solToUsdRate;
    const session = await createCheckoutSession(ticketPriceUsd);

    await TransactionLog.create({
      userId,
      wallet: 'fiat_payment',
      amount: raffle.ticketPrice,
      amountUsd: ticketPriceUsd,
      raffleId,
      timestamp: new Date()
    });

    await Raffle.findOneAndUpdate(
      { raffleId },
      { $inc: { ticketsSold: 1, fundsRaised: raffle.ticketPrice } }
    );

    await cloudwatch.putMetricData({
      MetricData: [
        { MetricName: 'TicketsSold', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'Count', Value: 1 },
        { MetricName: 'FundsRaised', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'None', Value: raffle.ticketPrice }
      ],
      Namespace: 'HomeChance'
    }).promise();

    res.json({ id: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/purchase-ticket-sol', authenticateToken, async (req, res) => {
  try {
    const { raffleId, userId, userWallet, ticketCount } = req.body;
    const raffle = await Raffle.findOne({ raffleId });
    if (!raffle) return res.status(404).json({ error: 'Raffle not found' });
    if (raffle.ticketsSold + ticketCount > raffle.maxTickets) return res.status(400).json({ error: 'Not enough tickets available' });
    if (raffle.status !== 'active') return res.status(400).json({ error: 'Raffle not active' });

    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const userPublicKey = new PublicKey(userWallet);
    const escrowPublicKey = new PublicKey(process.env.ESCROW_WALLET);

    const balance = await connection.getBalance(userPublicKey);
    const requiredLamports = ticketCount * raffle.ticketPrice * 1_000_000_000;
    if (balance < requiredLamports) return res.status(400).json({ error: 'Insufficient funds' });

    const solToUsdRate = await getSolToUsdRate();
    const ticketPriceUsd = raffle.ticketPrice * solToUsdRate;

    const signature = await processSolPayment(userWallet, ticketCount, raffle.ticketPrice);

    await TransactionLog.create({
      userId,
      wallet: userWallet,
      amount: ticketCount * raffle.ticketPrice,
      amountUsd: ticketCount * ticketPriceUsd,
      raffleId,
      timestamp: new Date()
    });

    await Raffle.findOneAndUpdate(
      { raffleId },
      { $inc: { ticketsSold: ticketCount, fundsRaised: ticketCount * raffle.ticketPrice } }
    );

    await cloudwatch.putMetricData({
      MetricData: [
        { MetricName: 'TicketsSold', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'Count', Value: ticketCount },
        { MetricName: 'FundsRaised', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'None', Value: ticketCount * raffle.ticketPrice }
      ],
      Namespace: 'HomeChance'
    }).promise();

    const updatedRaffle = await Raffle.findOne({ raffleId });
    if (updatedRaffle.ticketsSold >= updatedRaffle.maxTickets) {
      await Raffle.findOneAndUpdate({ raffleId }, { status: 'completed' });
    }

    res.status(200).json({ success: true, signature, ticketPriceUsd });
  } catch (error) {
    console.error('Error processing ticket purchase:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/pick-winner', async (req, res) => {
  try {
    const { raffleId } = req.body;
    const raffle = await Raffle.findOne({ raffleId });
    if (!raffle) return res.status(404).json({ error: 'Raffle not found' });
    if (raffle.status !== 'completed') return res.status(400).json({ error: 'Raffle not ready for winner selection' });

    const transactions = await TransactionLog.find({ raffleId });
    if (transactions.length === 0) return res.status(400).json({ error: 'No participants found' });

    const randomNumber = await generateRandomNumber();
    const randomIndex = randomNumber % transactions.length;
    const winner = transactions[randomIndex].userId;

    await Raffle.findOneAndUpdate(
      { raffleId },
      { winnerId: winner, status: 'pending_transfer' }
    );

    await cloudwatch.putMetricData({
      MetricData: [
        { MetricName: 'WinnerSelected', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'Count', Value: 1 }
      ],
      Namespace: 'HomeChance'
    }).promise();

    res.status(200).json({ success: true, winnerId: winner, randomNumber });
  } catch (error) {
    console.error('Error picking winner:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/confirm-property-transfer', async (req, res) => {
  try {
    const { raffleId } = req.body;
    const raffle = await Raffle.findOne({ raffleId });
    if (!raffle) return res.status(404).json({ error: 'Raffle not found' });
    if (raffle.status !== 'pending_transfer') return res.status(400).json({ error: 'Property transfer not ready' });

    await Raffle.findOneAndUpdate(
      { raffleId },
      { propertyTransferred: true }
    );

    const amount = raffle.fundsRaised || 0;
    const paymentType = raffle.paymentType;

    if (paymentType === 'fiat') {
      const solToUsdRate = await getSolToUsdRate();
      const amountUsd = amount * solToUsdRate;
      const { ownerAmount, charityAmount, platformAmount } = await paySellerAndCharity(amountUsd);
      await Raffle.findOneAndUpdate({ raffleId }, { status: 'paid' });
      res.json({ success: true, ownerAmount, charityAmount, platformAmount });
    } else {
      const signature = await paySellerAndCharitySol(amount, raffleId);
      await Raffle.findOneAndUpdate({ raffleId }, { status: 'paid' });
      res.json({ success: true, signature });
    }

    await cloudwatch.putMetricData({
      MetricData: [
        { MetricName: 'OwnerPayout', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'None', Value: amount * 0.9 },
        { MetricName: 'CharityPayout', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'None', Value: amount * 0.01 },
        { MetricName: 'PlatformProfit', Dimensions: [{ Name: 'RaffleId', Value: raffleId }], Unit: 'None', Value: amount * 0.09 }
      ],
      Namespace: 'HomeChance'
    }).promise();
  } catch (error) {
    console.error('Error confirming property transfer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});