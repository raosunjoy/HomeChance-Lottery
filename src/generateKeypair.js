
// ~/HomeChance-Lottery-New/src/generateKeypair.js
const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

function generateKeypair() {
    const keypair = Keypair.generate();
    return {
        publicKey: keypair.publicKey.toString(),
        secretKey: bs58.encode(keypair.secretKey)
    };
}

module.exports = { generateKeypair };
