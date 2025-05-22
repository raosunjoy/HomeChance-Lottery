import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import axios from 'axios';

function UserManagement() {
  const { publicKey } = useWallet();
  const [userData, setUserData] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!publicKey) return;
      try {
        // Replace with actual backend endpoint
        const response = await axios.get(`http://localhost:3000/user/${publicKey.toString()}`);
        setUserData(response.data);
        setTickets(response.data.tickets || []);
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
      setLoading(false);
    };
    fetchUserData();
  }, [publicKey]);

  // Mock data for demonstration
  const mockUserData = {
    wallet: publicKey?.toString() || 'Not connected',
    kycStatus: 'Verified',
    tickets: [
      { raffleId: 'raffle_001', numTickets: 5 },
      { raffleId: 'raffle_002', numTickets: 3 },
    ],
  };

  if (loading) return <p>Loading...</p>;
  if (!publicKey) return <p>Please connect your wallet.</p>;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">User Management</h1>
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
        <h2 className="text-xl font-semibold">Profile</h2>
        <p><strong>Wallet:</strong> {mockUserData.wallet}</p>
        <p><strong>KYC Status:</strong> {mockUserData.kycStatus}</p>
      </div>
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">Your Tickets</h2>
        {mockUserData.tickets.length > 0 ? (
          <ul className="space-y-2">
            {mockUserData.tickets.map((ticket, index) => (
              <li key={index}>
                <p><strong>Raffle:</strong> {ticket.raffleId}</p>
                <p><strong>Number of Tickets:</strong> {ticket.numTickets}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No tickets purchased yet.</p>
        )}
      </div>
    </div>
  );
}

export default UserManagement;