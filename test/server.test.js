import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import Raffle from '../src/models/Raffle';
import * as solanaModule from '../src/payments/solana.js';

// Mock dependencies
vi.mock('../src/payments/stripe.js', () => ({
    createCheckoutSession: vi.fn().mockResolvedValue({ id: 'session_123', url: 'https://checkout.stripe.com/pay/session_123' }),
    paySellerAndCharity: vi.fn().mockResolvedValue({ ownerAmount: 90, charityAmount: 1, platformAmount: 9 }),
}));

vi.mock('../src/payments/solana.js', async () => {
    const actual = await vi.importActual('../src/payments/solana.js');
    return {
        ...actual,
        processSolPayment: vi.fn().mockResolvedValue('solana_signature_123'),
        paySellerAndCharitySol: vi.fn().mockResolvedValue('solana_payout_signature_456'),
    };
});

describe('Server', () => {
    let app;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = (await import('../src/server.js')).default;
        
        await Raffle.deleteMany({});
        const raffle = new Raffle({
            raffleId: 'raffle_001',
            sellerWallet: '9bZkpqFRwG4C5Z7hZ9a9p2J2x6F8pN4k3Q5m8n7o1p2q',
            ticketPrice: 0.1,
            ticketCount: 10,
        });
        await raffle.save();
        console.log('Raffle seeded in beforeEach:', await Raffle.findOne({ raffleId: 'raffle_001' }));
    });

    it('should return health status', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ status: 'OK', message: 'Server is running' });
    });

    it('should generate a keypair', async () => {
        const response = await request(app).get('/generate-keypair');
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('publicKey');
        expect(response.body).toHaveProperty('secretKey');
    });

    it('should process a payment', async () => {
        const response = await request(app)
            .post('/process-payment')
            .send({ ticketPrice: 100 });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'Checkout session created');
        expect(response.body).toHaveProperty('sessionId');
        expect(response.body).toHaveProperty('url');
    });

    it('should calculate payouts', async () => {
        const response = await request(app)
            .post('/payout')
            .send({ amount: 100 });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'Payout calculated');
        expect(response.body.result).toEqual({ ownerAmount: 90, charityAmount: 1, platformAmount: 9 });
    });

    it('should process a Solana payment', async () => {
        const validUserWallet = '9bZkpqFRwG4C5Z7hZ9a9p2J2x6F8pN4k3Q5m8n7o1p2q';
        const spy = vi.spyOn(solanaModule, 'processSolPayment').mockResolvedValue('solana_signature_123');
        const response = await request(app)
            .post('/process-solana-payment')
            .send({ userWallet: validUserWallet, ticketCount: 1, ticketPrice: 0.1 });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'Solana payment processed');
        expect(response.body.signature).toBe('solana_signature_123');
        expect(spy).toHaveBeenCalledWith(validUserWallet, 1, 0.1);
        spy.mockRestore();
    });

    it('should process a Solana payout', async () => {
        const spy = vi.spyOn(solanaModule, 'paySellerAndCharitySol').mockResolvedValue('solana_payout_signature_456');
        const response = await request(app)
            .post('/payout-sol')
            .send({ amountSol: 1, raffleId: 'raffle_001' });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('message', 'Solana payout processed');
        expect(response.body.signature).toBe('solana_payout_signature_456');
        expect(spy).toHaveBeenCalledWith(1, 'raffle_001');
        spy.mockRestore();
    }, 10000);
});

