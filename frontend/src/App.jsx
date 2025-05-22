import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import Login from './components/Login';
import PropertyList from './components/PropertyList';
import RaffleDetails from './components/RaffleDetails';
import TicketPurchase from './components/TicketPurchase';
import KYCForm from './components/KYCForm';
import RaffleStatus from './components/RaffleStatus';
import UserManagement from './components/UserManagement';

// Hardcode the wallet keypair for local testing (replace with your actual keypair)
const walletSecretKey = Uint8Array.from([
  // Replace with the array from /Users/keerthirao/.config/solana/id.json
218,198,117,107,136,42,2,42,61,228,152,23,35,215,92,145,12,85,55,142,28,167,152,121,105,181,64,106,161,70,95,188,155,198,193,21,147,201,132,143,39,253,14,201,197,16,173,81,215,96,163,118,122,214,44,45,225,119,231,64,197,8,16,43
]);
const walletKeypair = Keypair.fromSecretKey(walletSecretKey);

const wallet = {
  publicKey: walletKeypair.publicKey,
  signTransaction: async (tx) => {
    tx.partialSign(walletKeypair);
    return tx;
  },
  signAllTransactions: async (txs) => {
    txs.forEach(tx => tx.partialSign(walletKeypair));
    return txs;
  },
};

const connection = new Connection('http://localhost:8899', 'confirmed');

function App() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(true);

  const fetchTokens = async () => {
    setLoading(true);
    try {
      const propertyTokenMint = new PublicKey('HcRaffle11111111111111111111111111111111');
      const tokenAccount = await getAssociatedTokenAddress(propertyTokenMint, wallet.publicKey);
      const accountInfo = await getAccount(connection, tokenAccount);
      setTokens([{ mint: propertyTokenMint.toString(), amount: accountInfo.amount.toString() }]);
    } catch (error) {
      console.error('Error fetching tokens:', error);
      setTokens([]);
    }
    setLoading(false);
  };

  const tradeOnOrca = (mint) => {
    window.open(`https://www.orca.so/trade/${mint}`, '_blank');
  };

  useEffect(() => {
    if (connected) {
      fetchTokens();
    }
  }, [connected]);

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-blue-600 text-white p-4 flex justify-between items-center">
        <div className="text-xl font-bold">
          <Link to="/">HomeChance</Link>
        </div>
        <div className="space-x-4">
          <Link to="/properties" className="hover:underline">Browse Properties</Link>
          <Link to="/status" className="hover:underline">Raffle Status</Link>
          <Link to="/manage" className="hover:underline">User Management</Link>
          <span>{wallet.publicKey.toBase58()}</span>
        </div>
      </nav>
      <div className="p-4">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/properties" element={<PropertyList />} />
          <Route path="/raffle/:id" element={<RaffleDetails />} />
          <Route path="/purchase/:id" element={<TicketPurchase />} />
          <Route path="/kyc" element={<KYCForm />} />
          <Route path="/status" element={<RaffleStatus />} />
          <Route path="/manage" element={<UserManagement />} />
          <Route path="/tokens" element={
            <div className="flex flex-col items-center justify-center p-4">
              <h1 className="text-3xl font-bold mb-6">Your Fractional Ownership Tokens</h1>
              {loading ? (
                <p>Loading...</p>
              ) : tokens.length > 0 ? (
                <div className="w-full max-w-md">
                  {tokens.map((token, index) => (
                    <div key={index} className="bg-white p-4 rounded-lg shadow-md mb-4">
                      <p><strong>Property Mint:</strong> {token.mint}</p>
                      <p><strong>Amount:</strong> {token.amount / 1000000 * 100}% ownership</p>
                      <button
                        onClick={() => tradeOnOrca(token.mint)}
                        className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                      >
                        Trade on Orca
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No tokens found.</p>
              )}
            </div>
          } />
        </Routes>
      </div>
    </div>
  );
}

export default App;
