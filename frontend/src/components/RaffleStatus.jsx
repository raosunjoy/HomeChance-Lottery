import React, { useState, useEffect } from 'react';
import axios from 'axios';

function RaffleStatus() {
  const [raffles, setRaffles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRaffles = async () => {
      try {
        // Replace with actual backend endpoint
        const response = await axios.get('http://localhost:3000/raffles');
        setRaffles(response.data);
      } catch (error) {
        console.error('Error fetching raffles:', error);
        setRaffles([]);
      }
      setLoading(false);
    };
    fetchRaffles();
  }, []);

  // Mock data for demonstration
  const mockRaffles = [
    { id: 'raffle_001', ticketsSold: 4500, totalTickets: 10000, winner: null, isCompleted: false },
    { id: 'raffle_002', ticketsSold: 10000, totalTickets: 10000, winner: 'user123', isCompleted: true },
  ];

  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold mb-6">Raffle Status</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="space-y-4">
          {mockRaffles.map((raffle) => (
            <div key={raffle.id} className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-xl font-semibold">Raffle: {raffle.id}</h2>
              <p><strong>Tickets Sold:</strong> {raffle.ticketsSold} / {raffle.totalTickets}</p>
              {raffle.isCompleted ? (
                <p><strong>Winner:</strong> {raffle.winner || 'Fractional Ownership'}</p>
              ) : (
                <p><strong>Status:</strong> In Progress</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default RaffleStatus;