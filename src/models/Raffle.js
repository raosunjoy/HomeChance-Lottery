// ~/HomeChance-Lottery-New/src/models/Raffle.js
const mongoose = require('mongoose');

// Define the schema
const raffleSchema = new mongoose.Schema({
    raffleId: { type: String, required: true, unique: true },
    sellerWallet: { type: String, required: true },
    ticketPrice: { type: Number, required: true },
    ticketCount: { type: Number, required: true },
});

// Check if the model is already compiled, otherwise create it
module.exports = mongoose.models.Raffle || mongoose.model('Raffle', raffleSchema);

