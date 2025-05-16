const axios = require('axios');

exports.getSolToUsdRate = async () => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'solana',
        vs_currencies: 'usd'
      }
    });
    return response.data.solana.usd;
  } catch (error) {
    console.error('Error fetching SOL/USD rate:', error.message);
    throw new Error('Unable to fetch exchange rate');
  }
};

exports.getUsdToSolRate = async () => {
  const solToUsd = await exports.getSolToUsdRate();
  return 1 / solToUsd;
};
