const mongoose = require('mongoose');
const { connectDB } = require('./src/config/db.js');
const { Attendance } = require('./src/models/Attendance.model.js');

const checkCount = async () => {
    try {
        await connectDB();
        const count = await Attendance.countDocuments();
        console.log('--- Current Attendance Count in DB:', count, '---');
        process.exit(0);
    } catch (err) {
        console.error('Error checking count:', err.message);
        process.exit(1);
    }
};

checkCount();
