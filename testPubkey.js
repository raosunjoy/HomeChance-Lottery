const { PublicKey } = require('@solana/web3.js');
try {
    const pubkey = new PublicKey('AnjjTZc1CrYtAWUFfmYALwfvGS8pbBbZQ48wedMmpATz');
    console.log('Valid public key:', pubkey.toString());
} catch (error) {
    console.error('Invalid public key:', error.message);
}
