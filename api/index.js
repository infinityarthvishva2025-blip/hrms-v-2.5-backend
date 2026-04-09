import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

let isConnected = false;

export default async (req, res) => {
  if (!isConnected) {
    try {
      await connectDB();
      isConnected = true;
    } catch (error) {
      console.error('Database connection error in Vercel function:', error);
      return res.status(500).json({ error: 'Internal Server Error (Database Connection)' });
    }
  }
  return app(req, res);
};
