const axios = require('axios');

// Function to fetch real-time SOL-USD price from CoinGecko
async function getSolUsdPrice() {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'solana',
        vs_currencies: 'usd'
      }
    });
    return response.data.solana.usd; // e.g., 200 (USD per SOL)
  } catch (error) {
    throw new Error('Failed to fetch SOL-USD price: ' + error.message);
  }
}

// Convert USD to SOL
async function usdToSol(usdAmount) {
  const solPrice = await getSolUsdPrice();
  return usdAmount / solPrice; // e.g., $33.33 / $200 = 0.16665 SOL
}

// Convert SOL to USD
async function solToUsd(solAmount) {
  const solPrice = await getSolUsdPrice();
  return solAmount * solPrice; // e.g., 0.16665 SOL * $200 = $33.33
}

// Example Express.js route to calculate ticket price in SOL
async function calculateTicketPrice(req, res) {
  try {
    const { ticketPriceUsd } = req.body; // e.g., 33.33
    const ticketPriceSol = await usdToSol(ticketPriceUsd);
    res.json({
      ticketPriceUsd,
      ticketPriceSol
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getSolUsdPrice,
  usdToSol,
  solToUsd,
  calculateTicketPrice
};