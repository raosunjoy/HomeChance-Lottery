import React from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Link } from 'react-router-dom';

function Login() {
  const { connected } = useWallet();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-4xl font-bold mb-6">Welcome to HomeChance</h1>
      <p className="text-lg mb-4">Connect your wallet to get started</p>
      <WalletMultiButton />
      {connected && (
        <Link to="/properties" className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
          Browse Properties
        </Link>
      )}
    </div>
  );
}

export default Login;