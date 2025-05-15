const jwt = require('jsonwebtoken');

// Replace with the actual JWT_SECRET from your task definition or .env
const JWT_SECRET = 'DM64ybA2euQQk8ZEWUkQE8Zc0WyrUj9ATklmA53dd3M=';

// Define the payload (customize as needed)
const payload = {
    userId: 'user1',
    email: 'sunjoyrao@gmail.com'
};

// Generate the token with a 1-hour expiration
const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
console.log('Generated JWT Token:', token);
