const mongoose = require('mongoose');

const raffleSchema = new mongoose.Schema({
  raffleId: { type: String, required: true, unique: true },
  ticketsSold: { type: Number, default: 0 },
  fundsRaised: { type: Number, default: 0 },
  status: { type: String, default: 'active' },
  timestamp: { type: Date, default: Date.now }
});

// Add indexes for performance (as per production_checklist.pdf)
raffleSchema.index({ raffleId: 1 });
raffleSchema.index({ timestamp: 1 });

module.exports = mongoose.model('Raffle', raffleSchema);
