const mongoose = require('mongoose');

const transactionLogSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  wallet: { type: String, required: true },
  amount: { type: Number, required: true },
  raffleId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

transactionLogSchema.index({ raffleId: 1 });
transactionLogSchema.index({ timestamp: 1 });

module.exports = mongoose.model('TransactionLog', transactionLogSchema);
