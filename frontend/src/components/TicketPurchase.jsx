import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import axios from 'axios';

function TicketPurchase() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { publicKey, signTransaction } = useWallet();
  const [numTickets, setNumTickets] = useState(1);
  const [ticketPriceSol, setTicketPriceUsd] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await axios.post('http://localhost:3000/convert/ticket-price', {
          ticketPriceUsd: 55.56, // Replace with actual price from backend
        });
        setTicketPriceUsd(response.data.ticketPriceSol);
      } catch (error) {
        console.error('Error fetching price:', error);
      }
      setLoading(false);
    };
    fetchPrice();
  }, []);

  const handlePurchase = async () => {
    if (!publicKey) {
      alert('Please connect your wallet.');
      return;
    }

    try {
      const response = await axios.post('http://localhost:3000/purchase-ticket', {
        raffleId: id,
        numTickets,
        buyer: publicKey.toString(),
      });
      // Simulate transaction signing (replace with actual Solana transaction)
      alert(`Successfully purchased ${numTickets} tickets!`);
      navigate('/kyc');
    } catch (error) {
      console.error('Error purchasing tickets:', error);
      alert('Failed to purchase tickets.');
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div className="p-4 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-4">Purchase Tickets for Raffle: {id}</h1>
      <div className="bg-white p-6 rounded-lg shadow-md">
        <p><strong>Ticket Price:</strong> {ticketPriceSol} SOL (${(ticketPriceSol * 200).toFixed(2)} USD)</p>
        <div className="mt-4">
          <label className="block mb-2">Number of Tickets:</label>
          <input
            type="number"
            value={numTickets}
            onChange={(e) => setNumTickets(Math.max(1, parseInt(e.target.value)))}
            className="w-full p-2 border rounded"
            min="1"
          />
        </div>
        <p className="mt-2"><strong>Total Cost:</strong> {(numTickets * ticketPriceSol).toFixed(4)} SOL</p>
        <button
          onClick={handlePurchase}
          className="mt-4 w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Purchase Tickets
        </button>
      </div>
    </div>
  );
}

export default TicketPurchase;