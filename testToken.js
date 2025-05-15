const jwt = require('jsonwebtoken');
const JWT_SECRET = 'DM64ybA2euQQk8ZEWUkQE8Zc0WyrUj9ATklmA53dd3M=';
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyMSIsImVtYWlsIjoic3Vuam95cmFvQGdtYWlsLmNvbSIsImlhdCI6MTc0NzIyMjQ5MiwiZXhwIjoxNzQ3MjI2MDkyfQ.5Ek8pHig9c371aHvGLI8bFe6O6FBrLYB_XzlUMRzJQE'; // Paste the new token
try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token is valid:', decoded);
} catch (error) {
    console.error('Token verification failed:', error.message);
}
