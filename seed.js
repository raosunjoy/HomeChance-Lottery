// ~/HomeChance-Lottery-New/seed.js
const mongoose = require('mongoose');
const Raffle = require('./src/models/Raffle');

mongoose.connect('mongodb://localhost:27017/Homechance', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(async () => {
    console.log('Connected to MongoDB');
    const existingRaffle = await Raffle.findOne({ raffleId: 'raffle_001' });
    if (existingRaffle) {
        console.log('Raffle already exists:', existingRaffle);
        process.exit();
    }

    const raffle = new Raffle({
        raffleId: 'raffle_001',
        sellerWallet: '9bZkpqFRwG4C5Z7hZ9a9p2J2x6F8pN4k3Q5m8n7o1p2q',
        ticketPrice: 0.1,
        ticketCount: 10,
    });
    await raffle.save();
    console.log('Raffle seeded:', raffle);
    process.exit();
}).catch(err => {
    console.error('Error in seeding:', err);
    process.exit(1);
});
