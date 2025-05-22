const express = require("express");
const Stripe = require("stripe");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require("@solana/web3.js");
const { Program, AnchorProvider } = require("@coral-xyz/anchor");

const app = express();
app.use(express.json());

const stripe = Stripe("sk_test_your_key_here"); // Replace with your Stripe secret key
const connection = new Connection("http://localhost:8899", "confirmed");
const wallet = Keypair.generate(); // Replace with admin wallet
const provider = new AnchorProvider(connection, null, { commitment: "confirmed" });
const programId = new PublicKey("BAkZeFEefRiGYj8des7zXoTpWwNNcfj6NB5694PCTHKo");
const program = new Program(
    {
        version: "0.1.0",
        name: "homechance_raffle",
        instructions: [
            // IDL would go here
        ]
    },
    programId,
    provider
);

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, "whsec_your_key_here"); // Replace with webhook secret
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const raffleId = session.client_reference_id;
        const numTickets = session.quantity;
        const totalFiat = session.amount_total / 100;
        const solAmount = totalFiat * 0.1; // Example conversion rate (1 USD = 0.1 SOL)

        const [escrowAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("escrow"), Buffer.from(raffleId, "utf8")],
            programId
        );
        const buyerTokenAccount = Keypair.generate().publicKey;

        const tx = await program.methods.purchaseTicket(numTickets, 1).accounts({
            raffle: Keypair.generate().publicKey, // Fetch real raffle address
            buyer: wallet.publicKey,
            buyerTokenAccount,
            escrowAccount,
            systemProgram: SystemProgram.programId,
        }).signers([wallet]).rpc();

        console.log(`Fiat ticket purchase processed: ${tx}`);
    }

    res.json({ received: true });
});

app.post("/payout", async (req, res) => {
    const { raffleId, sellerAddress, amountSol, isFullSale } = req.body;

    const totalProceeds = amountSol * 10_000; // Assuming 10,000 tickets
    const sellerPayout = (totalProceeds * 9) / 10;
    const platformRevenue = totalProceeds / 10;
    const charityContribution = platformRevenue / 10;

    if (isFullSale) {
        // Fiat payout to seller
        const fiatAmount = sellerPayout * 100; // Example rate (1 SOL = $100)
        const paymentIntent = await stripe.paymentIntents.create({
            amount: fiatAmount * 100, // Convert to cents
            currency: "usd",
            transfer_data: {
                destination: "seller_stripe_account_id", // Replace with seller's Stripe ID
            },
        });
        console.log(`Fiat payout to seller: ${paymentIntent.id}`);

        // Charity donation
        const charityFiat = charityContribution * 100;
        await stripe.paymentIntents.create({
            amount: charityFiat * 100,
            currency: "usd",
            transfer_data: {
                destination: "charity_stripe_account_id", // Replace with charity's Stripe ID
            },
        });
        console.log(`Charity donation: ${charityFiat}`);
    } else if (req.body.allowFractional) {
        // Fractional ownership payout (SOL to seller, tokens distributed)
        const [escrowAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("escrow"), Buffer.from(raffleId, "utf8")],
            programId
        );
        const sellerTokenAccount = Keypair.generate().publicKey;
        const propertyTokenMint = Keypair.generate().publicKey;

        await program.methods.processPayoutFractional().accounts({
            raffle: Keypair.generate().publicKey,
            escrowAccount,
            seller: new PublicKey(sellerAddress),
            sellerTokenAccount,
            charityAccount: Keypair.generate().publicKey,
            propertyTokenMint,
            tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            systemProgram: SystemProgram.programId,
        }).signers([wallet]).rpc();

        console.log(`Fractional payout processed`);
    } else {
        // Refunds
        const ticketHolders = await program.account.raffle.fetch(Keypair.generate().publicKey).ticket_holders; // Fetch holders
        for (let holder of ticketHolders) {
            if (holder.payment_method === 1) {
                await stripe.refunds.create({
                    payment_intent: "pi_your_intent_id", // Replace with real intent
                    amount: holder.num_tickets * 1000, // $10 per ticket in cents
                });
                console.log(`Fiat refund to ${holder.buyer}`);
            } else {
                // SOL refund handled on-chain in refund_or_distribute
            }
        }
    }

    res.json({ success: true });
});

app.listen(3000, () => console.log("Server running on port 3000"));