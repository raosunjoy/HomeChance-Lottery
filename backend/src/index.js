const express = require('express');
const conversionRoutes = require('./routes/conversion');
const config = require('./config');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { AnchorProvider, Program } = require('@coral-xyz/anchor');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

const connection = new Connection('http://localhost:8899', 'confirmed'); // Use local cluster for testing
const programId = new PublicKey('BAkZeFEefRiGYj8des7zXoTpWwNNcfj6NB5694PCTHKo');
const walletKeypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync('/Users/keerthirao/.config/solana/id.json', 'utf-8'))
  )
);
const provider = new AnchorProvider(connection, {
  publicKey: walletKeypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(walletKeypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    txs.forEach(tx => tx.partialSign(walletKeypair));
    return txs;
  },
}, { commitment: 'confirmed' });
const idl = require('./homechance_raffle.json');
const program = new Program(idl, programId, provider);

// Fetch ticket holders directly from the Solana program
async function fetchTicketHolders(raffleId) {
  try {
    const userTickets = await program.account.userTicket.all([
      {
        memcmp: {
          offset: 8,
          bytes: raffleId,
        },
      },
    ]);
    return userTickets.map(ticket => ({
      buyer: ticket.account.buyer.toBase58(),
      num_tickets: ticket.account.numTickets.toNumber(),
      token_account: 'mock-token-account', // Placeholder
    }));
  } catch (error) {
    throw new Error('Failed to fetch ticket holders: ' + error.message);
  }
}

const kycData = {};

app.post('/convert/ticket-price', conversionRoutes.calculateTicketPrice);

app.post('/list-property', (req, res) => {
  res.json({ message: 'Property listing endpoint placeholder' });
});

app.post('/purchase-ticket', (req, res) => {
  res.json({ message: 'Ticket purchase endpoint placeholder' });
});

app.post('/submit-kyc', (req, res) => {
  try {
    const { fullName, dateOfBirth, address, idNumber } = req.body;
    if (!fullName || !dateOfBirth || !address || !idNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    kycData[fullName] = { fullName, dateOfBirth, address, idNumber, status: 'Pending' };
    console.log('KYC submitted:', kycData[fullName]);
    res.status(200).json({ message: 'KYC submitted successfully' });
  } catch (error) {
    console.error('Error submitting KYC:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/user/:publicKey', async (req, res) => {
  const { publicKey } = req.params;
  try {
    const tickets = await program.account.userTicket.all([
      {
        memcmp: {
          offset: 8 + 32,
          bytes: publicKey,
        },
      },
    ]);

    const ticketsData = tickets.map((ticket) => ({
      raffleId: ticket.account.raffle.toBase58(),
      numTickets: ticket.account.numTickets.toNumber(),
    }));

    const userKyc = Object.values(kycData).find(data => data.idNumber === publicKey) || { status: 'Not Submitted' };

    res.status(200).json({
      wallet: publicKey,
      kycStatus: userKyc.status,
      tickets: ticketsData,
    });
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/close-raffle', async (req, res) => {
  const { raffleId } = req.body;
  try {
    const ticketHolders = await fetchTicketHolders(raffleId);
    const totalTicketsSold = ticketHolders.reduce((sum, holder) => sum + holder.num_tickets, 0);

    if (totalTicketsSold === 10000) {
      res.json({ message: 'Randomness requested for winner selection' });
    } else {
      const allowFractional = true;
      if (allowFractional) {
        const totalTokens = 1000000;
        const tokensPerTicket = totalTokens / 10000;
        for (const holder of ticketHolders) {
          const tokensToMint = holder.num_tickets * tokensPerTicket;
        }
        const unsoldTickets = 10000 - totalTicketsSold;
        const sellerTokens = unsoldTickets * tokensPerTicket;
        res.json({ message: 'Fractional ownership processed' });
      } else {
        for (const holder of ticketHolders) {
          const refundAmount = holder.num_tickets * 0.1;
        }
        res.json({ message: 'Raffle canceled, refunds processed' });
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/process-payout', (req, res) => {
  res.json({ message: 'Payout processing endpoint placeholder' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


