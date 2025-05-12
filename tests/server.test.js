const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../src/server');

jest.mock('@solana/web3.js');
jest.mock('stripe');
jest.mock('aws-sdk', () => ({
    SecretsManager: jest.fn().mockImplementation(() => ({
        getSecretValue: jest.fn().mockReturnValue({
            promise: jest.fn().mockResolvedValue({
                SecretString: JSON.stringify({
                    MONGO_URI: 'mongodb://localhost:27017/test',
                    PLATFORM_WALLET_PRIVATE_KEY: 'mock-key',
                    JWT_SECRET: 'test-secret',
                    STRIPE_SECRET_KEY: 'stripe-key',
                    SES_ACCESS_KEY: 'ses-key',
                    SES_SECRET_KEY: 'ses-secret',
                    SES_REGION: 'us-east-1',
                    SES_FROM_EMAIL: 'noreply@homechance.io'
                })
            })
        })
    })),
    SES: jest.fn().mockImplementation(() => ({
        sendEmail: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) })
    }))
}));

describe('HomeChance API', () => {
    let token;

    beforeAll(async () => {
        await mongoose.connect('mongodb://localhost:27017/test', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        token = jwt.sign({ userId: 'testuser', email: 'testuser@example.com' }, 'test-secret', { expiresIn: '1h' });
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        await mongoose.connection.db.dropDatabase();
    });

    describe('POST /api/purchase-ticket', () => {
        it('should return 401 without token', async () => {
            const res = await request(app)
                .post('/api/purchase-ticket')
                .send({ raffleId: 'raffle_001', userId: 'testuser', userWallet: 'mock-wallet', ticketCount: 1, signature: 'mock-sig' });
            expect(res.statusCode).toEqual(401);
            expect(res.body).toHaveProperty('error', 'Access token required');
        });

        it('should return 403 if KYC fails', async () => {
            const res = await request(app)
                .post('/api/purchase-ticket')
                .set('Authorization', `Bearer ${token}`)
                .send({ raffleId: 'raffle_001', userId: 'newuser', userWallet: 'mock-wallet', ticketCount: 1, signature: 'mock-sig' });
            expect(res.statusCode).toEqual(403);
            expect(res.body).toHaveProperty('error', 'KYC verification required');
        });
    });

    describe('GET /api/raffle-status/:raffleId', () => {
        it('should return raffle status', async () => {
            await mongoose.model('Raffle').create({ raffleId: 'raffle_001', fundsRaised: 100 });
            const res = await request(app)
                .get('/api/raffle-status/raffle_001')
                .set('Authorization', `Bearer ${token}`);
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('fundsRaised', 100);
        });
    });

    describe('GET /api/compliance-report', () => {
        it('should return CSV report', async () => {
            await mongoose.model('TransactionLog').create({
                userId: 'testuser',
                userWallet: 'mock-wallet',
                raffleId: 'raffle_001',
                amount: 41,
                timestamp: new Date()
            });

            const res = await request(app)
                .get('/api/compliance-report')
                .set('Authorization', `Bearer ${token}`);
            expect(res.statusCode).toEqual(200);
            expect(res.header['content-type']).toEqual('text/csv');
            expect(res.text).toContain('userId,userWallet,raffleId,amount,timestamp,refunded');
        });
    });

    describe('POST /api/cancel-raffle', () => {
        it('should cancel raffle and process refunds', async () => {
            await mongoose.model('Raffle').create({ raffleId: 'raffle_001', fundsRaised: 82 });
            await mongoose.model('TransactionLog').create({
                userId: 'testuser',
                userWallet: 'mock-wallet',
                raffleId: 'raffle_001',
                amount: 41,
                timestamp: new Date()
            });
            await mongoose.model('TransactionLog').create({
                userId: 'testuser2',
                userWallet: 'mock-wallet2',
                raffleId: 'raffle_001',
                amount: 41,
                timestamp: new Date()
            });

            const res = await request(app)
                .post('/api/cancel-raffle')
                .set('Authorization', `Bearer ${token}`)
                .send({ raffleId: 'raffle_001' });
            expect(res.statusCode).toEqual(200);
            expect(res.body).toHaveProperty('message', 'Raffle cancelled and refunds processed');
            expect(res.body).toHaveProperty('affectedUsers', 2);

            const raffle = await mongoose.model('Raffle').findOne({ raffleId: 'raffle_001' });
            expect(raffle.fundsRaised).toEqual(0);
            expect(raffle.status).toEqual('cancelled');

            const logs = await mongoose.model('TransactionLog').find({ raffleId: 'raffle_001' });
            expect(logs.every(log => log.refunded)).toBe(true);
        });

        it('should return 404 for non-existent raffle', async () => {
            const res = await request(app)
                .post('/api/cancel-raffle')
                .set('Authorization', `Bearer ${token}`)
                .send({ raffleId: 'raffle_999' });
            expect(res.statusCode).toEqual(404);
            expect(res.body).toHaveProperty('error', 'Raffle not found or already cancelled');
        });
    });
});