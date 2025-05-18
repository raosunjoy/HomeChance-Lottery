import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createCheckoutSession = async (ticketPrice) => {
    try {
        console.log('Creating checkout session for ticket price:', ticketPrice);
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Lottery Ticket' },
                    unit_amount: Math.round(ticketPrice * 100), // Convert to cents
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/cancel`,
        });
        console.log('Checkout session created:', session.id);
        return session;
    } catch (error) {
        console.error('Error in createCheckoutSession:', error.message);
        throw new Error(`Checkout session creation failed: ${error.message}`);
    }
};

export const paySellerAndCharity = async (amount) => {
    try {
        console.log('Processing payout for amount:', amount);
        const ownerAmount = amount * 0.9;
        const charityAmount = amount * 0.01;
        const platformAmount = amount * 0.09;
        console.log('Paying seller', ownerAmount, 'USD, charity', charityAmount, 'USD, platform', platformAmount, 'USD');
        // Simulate payout (actual transfer would use Stripe Transfer API)
        return { ownerAmount, charityAmount, platformAmount };
    } catch (error) {
        console.error('Error in paySellerAndCharity:', error.message);
        throw new Error(`Payout failed: ${error.message}`);
    }
};

