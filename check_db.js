import mongoose from 'mongoose';
import { Holiday } from './src/models/Holiday.model.js';
import { Attendance } from './src/models/Attendance.model.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected');
  
  const holidays = await Holiday.find();
  console.log('Holidays:', holidays.map(h => ({ date: h.date, name: h.name })));
  
  const atts = await Attendance.find({ 
    date: { 
      $gte: new Date('2026-05-01T00:00:00Z'), 
      $lte: new Date('2026-05-01T23:59:59Z') 
    } 
  });
  console.log('Attendance records for May 1st:', atts.map(a => ({ emp: a.employeeCode, status: a.status })));
  
  await mongoose.disconnect();
}

check();
