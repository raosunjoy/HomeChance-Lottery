import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function KYCForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    fullName: '',
    dateOfBirth: '',
    address: '',
    idNumber: '',
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    try {
      // Replace with actual backend endpoint for KYC submission
      await axios.post('http://localhost:3000/submit-kyc', formData);
      alert('KYC submitted successfully!');
      navigate('/status');
    } catch (error) {
      console.error('Error submitting KYC:', error);
      alert('Failed to submit KYC.');
    }
  };

  return (
    <div className="p-4 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-4">KYC Verification</h1>
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="mb-4">
          <label className="block mb-2">Full Name:</label>
          <input
            type="text"
            name="fullName"
            value={formData.fullName}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <div className="mb-4">
          <label className="block mb-2">Date of Birth:</label>
          <input
            type="date"
            name="dateOfBirth"
            value={formData.dateOfBirth}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <div className="mb-4">
          <label className="block mb-2">Address:</label>
          <textarea
            name="address"
            value={formData.address}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <div className="mb-4">
          <label className="block mb-2">ID Number:</label>
          <input
            type="text"
            name="idNumber"
            value={formData.idNumber}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <button
          onClick={handleSubmit}
          className="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Submit KYC
        </button>
      </div>
    </div>
  );
}

export default KYCForm;