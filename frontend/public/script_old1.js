const { Connection, PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } = window.solanaWeb3;
const { Program, AnchorProvider, web3 } = window.Anchor;

const connection = new Connection("http://localhost:8899", "confirmed");
const wallet = Keypair.generate(); // Replace with user's wallet
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

const stripe = Stripe("pk_test_your_key_here"); // Replace with your Stripe public key
let kycCompleted = false;

async function listProperty() {
    const raffleId = document.getElementById("listRaffleId").value;
    const propertyId = document.getElementById("listPropertyId").value;
    const ticketPrice = parseFloat(document.getElementById("listTicketPrice").value) * web3.LAMPORTS_PER_SOL;

    const [escrowAccount, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), Buffer.from(raffleId, "utf8")],
        programId
    );

    const propertyNftMint = Keypair.generate().publicKey;
    const propertyTokenMint = Keypair.generate().publicKey;

    const tx = await program.methods.initializeRaffle(
        raffleId,
        propertyId,
        ticketPrice
    ).accounts({
        raffle: Keypair.generate().publicKey,
        seller: wallet.publicKey,
        escrowAccount,
        propertyNftMint,
        propertyTokenMint,
        systemProgram: SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
        metadataProgram: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
    }).signers([wallet]).rpc();

    document.getElementById("result").innerText = `Property listed: ${tx}`;
}

async function viewListing() {
    const raffleId = document.getElementById("viewRaffleId").value;
    // Simulate fetching listing (replace with real API call)
    document.getElementById("result").innerText = `Viewing ${raffleId} details...`;
}

async function completeKYC() {
    kycCompleted = true;
    document.getElementById("kycStatus").innerText = "KYC Status: Completed";
    // In production, call KYC provider API
}

async function buyTickets() {
    if (!kycCompleted && document.querySelector('input[name="payment"]:checked').value == 1) {
        document.getElementById("result").innerText = "Complete KYC for fiat purchase!";
        return;
    }

    const raffleId = document.getElementById("buyRaffleId").value;
    const numTickets = parseInt(document.getElementById("numTickets").value);
    const paymentMethod = parseInt(document.querySelector('input[name="payment"]:checked').value);
    const ticketPriceSol = 0.1 * web3.LAMPORTS_PER_SOL;

    if (paymentMethod === 1) { // Fiat
        const totalFiat = numTickets * 10; // $10 per ticket

        const { error } = await stripe.redirectToCheckout({
            lineItems: [{ price: "price_1YourPriceId", quantity: numTickets }],
            mode: "payment",
            successUrl: window.location.href + "?success=true",
            cancelUrl: window.location.href + "?cancel=true",
            clientReferenceId: raffleId,
        });

        if (error) {
            document.getElementById("result").innerText = `Stripe Error: ${error.message}`;
            return;
        }
    } else { // SOL
        const totalCost = ticketPriceSol * numTickets;

        const [escrowAccount, bump] = PublicKey.findProgramAddressSync(
            [Buffer.from("escrow"), Buffer.from(raffleId, "utf8")],
            programId
        );
        const buyerTokenAccount = Keypair.generate().publicKey;

        const tx = await program.methods.purchaseTicket(numTickets, paymentMethod).accounts({
            raffle: Keypair.generate().publicKey, // Fetch real raffle address
            buyer: wallet.publicKey,
            buyerTokenAccount,
            escrowAccount,
            systemProgram: SystemProgram.programId,
        }).signers([wallet]).rpc();

        document.getElementById("result").innerText = `Tickets bought with SOL: ${tx}`;
    }
}

window.addEventListener("load", () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("success")) {
        document.getElementById("result").innerText = "Payment successful!";
        // Backend will handle fiat-to-SOL and call purchase_ticket
    } else if (urlParams.get("cancel")) {
        document.getElementById("result").innerText = "Payment canceled.";
    }
});