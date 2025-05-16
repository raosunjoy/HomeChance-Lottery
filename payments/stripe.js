const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.createCheckoutSession = async (ticketPrice) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Raffle Ticket' },
          unit_amount: Math.round(ticketPrice * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: 'https://homechance.io/success',
      cancel_url: 'https://homechance.io/cancel',
      payment_intent_data: {
        transfer_data: {
          destination: 'homechance-escrow-account'
        }
      }
    });
    return session;
  } catch (error) {
    throw new Error(`Stripe Checkout failed: ${error.message}`);
  }
};

exports.paySellerAndCharity = async (amount) => {
  const ownerAmount = amount * 0.9;
  const charityAmount = amount * 0.01;
  const platformAmount = amount * 0.09;

  console.log(`Paying seller ${ownerAmount} USD, charity ${charityAmount} USD, platform ${platformAmount} USD`);
  return { ownerAmount, charityAmount, platformAmount };
};
