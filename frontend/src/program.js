import { AnchorProvider, Program, web3 } from '@coral-xyz/anchor';
import { Connection } from '@solana/web3.js';
import idl from './homechance_raffle.json';

const PROGRAM_ID = new web3.PublicKey('BAkZeFEefRiGYj8des7zXoTpWwNNcfj6NB5694PCTHKo');
const connection = new Connection('http://localhost:8899', 'confirmed');

const provider = (wallet) => {
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
};

const getProgram = (wallet) => {
  return new Program(idl, PROGRAM_ID, provider(wallet));
};

export { connection, provider, getProgram };

