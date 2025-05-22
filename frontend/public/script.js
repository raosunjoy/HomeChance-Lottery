const { Connection, PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } = window.solanaWeb3;
const { Program, AnchorProvider, web3 } = window.Anchor;

const connection = new Connection("http://localhost:8899", "confirmed");
const wallet = Keypair.generate(); // Replace with user's wallet
const provider = new AnchorProvider(connection, null, { commitment: "confirmed" });
const programId = new PublicKey("BAkZeFEefRiGYj8des7zXoTpWwNNcfj6NB5694PCTHKo");

// Simulated IDL (replace with actual IDL after `anchor build`)
const idl = {
    version: "0.1.0",
    name: "homechance_raffle",
    instructions: [
        { name: "initializeRaffle", accounts: [], args: [] },
        { name: "purchaseTicket", accounts: [], args: [] },
        { name: "requestRandomness", accounts: [], args: [] },
        { name: "fulfillRandomness", accounts: [], args: [] },
    ],
    accounts: [
        {
            name: "Raffle",
            type: {
                kind: "struct",
                fields: [
                    { name: "raffleId", type: "string" },
                    { name: "propertyId", type: "string" },
                    { name: "seller", type: "publicKey" },
                    { name: "escrowAccount", type: "publicKey" },
                    { name: "ticketPriceSol", type: "u64" },
                    { name: "totalTickets", type: "u64" },
                    { name: "ticketsSold", type: "u64" },
                    { name: "winner", type: { option: "publicKey" } },
                    { name: "propertyNftMint", type: "publicKey" },
                    { name: "propertyTokenMint", type: "publicKey" },
                    { name: "isCompleted", type: "bool" },
                    { name: "allowFractional", type: "bool" },
                    { name: "ticketHolders", type: { vec: { defined: "TicketHolder" } } },
                    { name: "randomValue", type: { option: "u64" } },
                ],
            },
        },
        {
            name: "TicketHolder",
            type: {
                kind: "struct",
                fields: [
                    { name: "buyer", type: "publicKey" },
                    { name: "numTickets", type: "u64" },
                    { name: "tokenAccount", type: "publicKey" },
                    { name: "kycVerified", type: "bool" },
                    { name: "paymentMethod", type: "u8" },
                ],
            },
        },
    ],
    events: [
        { name: "TicketPurchased", fields: [] },
        { name: "RaffleClosed", fields: [] },
        { name: "PayoutProcessed", fields: [] },
        { name: "TicketHolderProcessed", fields: [] },
    ],
    errors: [],
};

const program = new Program(idl, programId, provider);
const stripe = Stripe("pk_test_your_key_here"); // Replace with your Stripe public key
let kycCompleted = false;
let raffleAccounts = {}; // Cache raffle account addresses by raffleId
let zillowListings = []; // Store Zillow listings

// Mock Zillow data (replace with actual API call in production)
const mockZillowData = [
    {
        propertyId: "Z12345",
        address: "123 Maple St, Seattle, WA 98101",
        price: 750000,
        size: "3 beds, 2 baths, 1500 sqft",
        listingDate: "2025-05-20",
        listingUrl: "https://www.zillow.com/homedetails/123-Maple-St-Seattle-WA-98101/Z12345"
    },
    {
        propertyId: "Z67890",
        address: "456 Oak Ave, Portland, OR 97201",
        price: 620000,
        size: "4 beds, 3 baths, 2000 sqft",
        listingDate: "2025-05-21",
        listingUrl: "https://www.zillow.com/homedetails/456-Oak-Ave-Portland-OR-97201/Z67890"
    },
    {
        propertyId: "Z24680",
        address: "789 Pine Rd, San Francisco, CA 94101",
        price: 1200000,
        size: "2 beds, 1 bath, 1200 sqft",
        listingDate: "2025-05-19",
        listingUrl: "https://www.zillow.com/homedetails/789-Pine-Rd-San-Francisco-CA-94101/Z24680"
    }
];

async function fetchZillowListings() {
    try {
        // In production, replace with actual API call to Zillow or third-party provider
        zillowListings = mockZillowData;

        // Display listings
        const listingsDiv = document.getElementById("zillowListings");
        listingsDiv.innerHTML = "";
        zillowListings.forEach(listing => {
            const listingElement = document.createElement("div");
            listingElement.innerHTML = `
                <p><strong>Property ID:</strong> ${listing.propertyId}</p>
                <p><strong>Address:</strong> ${listing.address}</p>
                <p><strong>Price:</strong> $${listing.price.toLocaleString()}</p>
                <p><strong>Size:</strong> ${listing.size}</p>
                <p><strong>Listed On:</strong> ${listing.listingDate}</p>
                <p><a href="${listing.listingUrl}" target="_blank">View on Zillow</a></p>
                <hr>
            `;
            listingsDiv.appendChild(listingElement);
        });
        listingsDiv.style.display = "block";

        // Populate property dropdown
        const propertySelect = document.getElementById("listPropertyId");
        propertySelect.innerHTML = '<option value="">Select a Property</option>';
        zillowListings.forEach(listing => {
            const option = document.createElement("option");
            option.value = listing.propertyId;
            option.text = `${listing.propertyId} - ${listing.address}`;
            propertySelect.appendChild(option);
        });

        document.getElementById("result").innerText = "Zillow listings fetched successfully.";
    } catch (err) {
        document.getElementById("result").innerText = `Error fetching Zillow listings: ${err.message}`;
    }
}

async function listProperty() {
    const raffleId = document.getElementById("listRaffleId").value;
    const propertyId = document.getElementById("listPropertyId").value;
    const ticketPrice = parseFloat(document.getElementById("listTicketPrice").value) * web3.LAMPORTS_PER_SOL;

    if (!propertyId) {
        document.getElementById("result").innerText = "Please select a property to list.";
        return;
    }

    const [escrowAccount, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), Buffer.from(raffleId, "utf8")],
        programId
    );

    const propertyNftMint = Keypair.generate().publicKey;
    const propertyTokenMint = Keypair.generate().publicKey;
    const raffleAccount = Keypair.generate();

    try {
        const tx = await program.methods.initializeRaffle(
            raffleId,
            propertyId,
            ticketPrice
        ).accounts({
            raffle: raffleAccount.publicKey,
            seller: wallet.publicKey,
            escrowAccount,
            propertyNftMint,
            propertyTokenMint,
            systemProgram: SystemProgram.programId,
            rent: web3.SYSVAR_RENT_PUBKEY,
            metadataProgram: new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
        }).signers([wallet, raffleAccount]).rpc();

        raffleAccounts[raffleId] = raffleAccount.publicKey;
        document.getElementById("result").innerText = `Property listed: ${tx}`;

        // Update dropdown
        const select = document.getElementById("viewRaffleId");
        const option = document.createElement("option");
        option.value = raffleId;
        option.text = `Raffle: ${raffleId}`;
        select.appendChild(option);
    } catch (err) {
        document.getElementById("result").innerText = `Error listing property: ${err.message}`;
    }
}

async function viewListing() {
    const raffleId = document.getElementById("viewRaffleId").value;
    if (!raffleId) {
        document.getElementById("raffleDetails").style.display = "none";
        document.getElementById("result").innerText = "Please select a raffle to view.";
        return;
    }

    try {
        const rafflePubkey = raffleAccounts[raffleId];
        if (!rafflePubkey) {
            document.getElementById("result").innerText = `Raffle ${raffleId} not found.`;
            return;
        }

        const raffle = await program.account.raffle.fetch(rafflePubkey);
        document.getElementById("propertyId").innerText = raffle.propertyId;
        document.getElementById("ticketPrice").innerText = raffle.ticketPriceSol / web3.LAMPORTS_PER_SOL;
        document.getElementById("totalTickets").innerText = raffle.totalTickets.toString();
        document.getElementById("ticketsSold").innerText = raffle.ticketsSold.toString();
        document.getElementById("raffleStatus").innerText = raffle.isCompleted ? "Completed" : "Open";

        const raffleDetails = document.getElementById("raffleDetails");
        raffleDetails.style.display = "block";

        // Show randomness trigger button if 10,000 tickets sold and raffle not completed
        const triggerBtn = document.getElementById("triggerRandomnessBtn");
        if (raffle.ticketsSold >= 10000 && !raffle.isCompleted) {
            triggerBtn.style.display = "inline-block";
        } else {
            triggerBtn.style.display = "none";
        }

        document.getElementById("result").innerText = `Loaded details for raffle ${raffleId}.`;
    } catch (err) {
        document.getElementById("result").innerText = `Error fetching raffle details: ${err.message}`;
    }
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

    const rafflePubkey = raffleAccounts[raffleId];
    if (!rafflePubkey) {
        document.getElementById("result").innerText = `Raffle ${raffleId} not found.`;
        return;
    }

    try {
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
                raffle: rafflePubkey,
                buyer: wallet.publicKey,
                buyerTokenAccount,
                escrowAccount,
                systemProgram: SystemProgram.programId,
            }).signers([wallet]).rpc();

            document.getElementById("result").innerText = `Tickets bought with SOL: ${tx}`;

            // Check if 10,000 tickets are sold and trigger randomness
            const raffle = await program.account.raffle.fetch(rafflePubkey);
            if (raffle.ticketsSold >= 10000 && !raffle.isCompleted) {
                await triggerRandomness(raffleId, rafflePubkey);
            }
        }
    } catch (err) {
        document.getElementById("result").innerText = `Error buying tickets: ${err.message}`;
    }
}

async function triggerRandomness(raffleId = null, rafflePubkey = null) {
    if (!raffleId || !rafflePubkey) {
        raffleId = document.getElementById("viewRaffleId").value;
        rafflePubkey = raffleAccounts[raffleId];
        if (!rafflePubkey) {
            document.getElementById("result").innerText = `Raffle ${raffleId} not found.`;
            return;
        }
    }

    try {
        const raffle = await program.account.raffle.fetch(rafflePubkey);
        if (raffle.ticketsSold < 10000) {
            document.getElementById("result").innerText = "Not enough tickets sold to select a winner.";
            return;
        }
        if (raffle.isCompleted) {
            document.getElementById("result").innerText = "Raffle is already completed.";
            return;
        }

        const [escrowAccount, bump] = PublicKey.findProgramAddressSync(
            [Buffer.from("escrow"), Buffer.from(raffleId, "utf8")],
            programId
        );

        // Request randomness
        const requestTx = await program.methods.requestRandomness().accounts({
            raffle: rafflePubkey,
            escrowAccount,
            chainlinkVrfProgram: new PublicKey("VRF111111111111111111111111111111111111111"),
        }).signers([wallet]).rpc();

        document.getElementById("result").innerText += `\nRandomness requested: ${requestTx}`;

        // Simulate Chainlink VRF callback (in production, Chainlink would call fulfillRandomness)
        const randomValue = Math.floor(Math.random() * 1000000); // Simulated random value
        const fulfillTx = await program.methods.fulfillRandomness(randomValue).accounts({
            raffle: rafflePubkey,
        }).signers([wallet]).rpc();

        document.getElementById("result").innerText += `\nRandomness fulfilled: ${fulfillTx}`;

        // Fetch winner
        const updatedRaffle = await program.account.raffle.fetch(rafflePubkey);
        if (updatedRaffle.winner) {
            document.getElementById("result").innerText += `\nWinner selected: ${updatedRaffle.winner.toBase58()}`;
        } else {
            document.getElementById("result").innerText += `\nNo winner selected.`;
        }

        // Refresh display
        viewListing();
    } catch (err) {
        document.getElementById("result").innerText = `Error triggering randomness: ${err.message}`;
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