const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { SwitchboardProgram, Randomness } = require('@switchboard-xyz/solana.js');
const bs58 = require('bs58');

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

exports.generateRandomNumber = async () => {
  try {
    const program = await SwitchboardProgram.load(connection, Keypair.fromSecretKey(bs58.decode(process.env.PLATFORM_WALLET_PRIVATE_KEY)));
    
    const randomnessAccount = new PublicKey('7WduTbRevCNQSHughsNxuytsnmoH3DrsShedg5h4NHL');
    
    const randomness = Randomness.from(program, randomnessAccount);
    const result = await randomness.getRandomness();
    
    if (!result) {
      throw new Error('Randomness not available');
    }
    
    const randomNumber = result.value.toNumber();
    return randomNumber;
  } catch (error) {
    console.error('Error generating random number on Solana:', error);
    throw new Error('Failed to generate random number');
  }
};
