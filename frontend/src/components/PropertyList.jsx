import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

function PropertyList() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        // Replace with actual backend endpoint
        const response = await axios.get('http://localhost:3000/list-properties');
        setProperties(response.data);
      } catch (error) {
        console.error('Error fetching properties:', error);
        setProperties([]);
      }
      setLoading(false);
    };
    fetchProperties();
  }, []);

  // Mock data for demonstration
  const mockProperties = [
    { id: '1', address: '123 Main St, Miami, FL', value: 500000, raffleId: 'raffle_001' },
    { id: '2', address: '456 Ocean Dr, Miami, FL', value: 750000, raffleId: 'raffle_002' },
  ];

  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold mb-6">Available Properties</h1>
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockProperties.map((property) => (
            <div key={property.id} className="bg-white p-4 rounded-lg shadow-md">
              <h2 className="text-xl font-semibold">{property.address}</h2>
              <p className="text-gray-600">Value: ${property.value.toLocaleString()}</p>
              <Link
                to={`/raffle/${property.raffleId}`}
                className="mt-2 inline-block bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
              >
                View Raffle
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PropertyList;