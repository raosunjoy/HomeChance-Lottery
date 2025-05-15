const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const bs58 = require('bs58');

const keypair = Keypair.generate();
fs.writeFileSync('devnet.json', JSON.stringify(Array.from(keypair.secretKey)));
console.log('Public Key:', keypair.publicKey.toString());
console.log('Private Key (base58):', bs58.encode(keypair.secretKey));
