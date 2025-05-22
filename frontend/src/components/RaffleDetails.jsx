import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

function RaffleDetails() {
  const { id } = useParams();
  const [raffle, setRaffle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRaffle = async () => {
      try {
        // Replace with actual backend endpoint
        const response = await axios.get(`http://localhost:3000/raffle/${id}`);
        setRaffle(response.data);
      } catch (error) {
        console.error('Error fetching raffle:', error);
      }
      setLoading(false);
    };
    fetchRaffle();
  }, [id]);

  // Mock data for demonstration
  const mockRaffle = {
    id: 'raffle_001',
    propertyAddress: '123 Main St, Miami, FL',
    propertyValue: 500000,
    ticketPriceUsd: 55.56,
    totalTickets: 10000,
    ticketsSold: 4500,
  };

  if (loading) return <p>Loading...</p>;
  if (!mockRaffle) return <p>Raffle not found.</p>;

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Raffle Details: {mockRaffle.id}</h1>
      <div className="bg-white p-6 rounded-lg shadow-md">
        <p><strong>Property Address:</strong> {mockRaffle.propertyAddress}</p>
        <p><strong>Property Value:</strong> ${mockRaffle.propertyValue.toLocaleString()}</p>
        <p><strong>Ticket Price:</strong> ${mockRaffle.ticketPriceUsd}</p>
        <p><strong>Total Tickets:</strong> {mockRaffle.totalTickets}</p>
        <p><strong>Tickets Sold:</strong> {mockRaffle.ticketsSold}</p>
        <Link
          to={`/purchase/${mockRaffle.id}`}
          className="mt-4 inline-block bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Purchase Tickets
        </Link>
      </div>
    </div>
  );
}

export default RaffleDetails;