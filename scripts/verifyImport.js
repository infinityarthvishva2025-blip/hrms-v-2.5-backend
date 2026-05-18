import 'dotenv/config';
import mongoose from 'mongoose';
import { Attendance } from '../src/models/Attendance.model.js';
import { config } from '../src/config/index.js';

const verify = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('✅ Connected to MongoDB');

    const targetDate = new Date('2026-05-05T00:00:00.000Z');
    const records = await Attendance.find({ date: targetDate });

    console.log(`\n📊 Found ${records.length} records for 2026-05-05:`);
    records.forEach(r => {
      console.log(`- Employee: ${r.employeeCode} (${r.employeeName})`);
      console.log(`  Date: ${r.date.toISOString().split('T')[0]}`);
      console.log(`  Status: ${r.status}`);
      console.log(`  In Time: ${r.inTime ? r.inTime.toISOString() : 'N/A'}`);
      console.log(`  Out Time: ${r.outTime ? r.outTime.toISOString() : 'N/A'}`);
      console.log(`  Hours: ${r.totalHours} hrs, Minutes: ${r.totalMinutes} mins`);
      console.log(`  Is Late: ${r.isLate}, Late Minutes: ${r.lateMinutes}`);
      console.log(`  WorkMode: ${r.workMode}`);
      console.log('--------------------------------------------------');
    });

  } catch (err) {
    console.error('❌ Error verifying:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected');
    process.exit(0);
  }
};

verify();
