const mongoose = require('mongoose');
const { connectDB } = require('./src/config/db.js');
const { Attendance } = require('./src/models/Attendance.model.js');

const checkDbDistribution = async () => {
    try {
        await connectDB();
        const all = await Attendance.find({}, { employeeCode: 1, date: 1 }).lean();
        
        let midnightCount = 0;
        let withTimeCount = 0;
        
        all.forEach(r => {
            const d = new Date(r.date);
            if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
                midnightCount++;
            } else {
                withTimeCount++;
            }
        });
        
        console.log('Total in DB:', all.length);
        console.log('Records @ Midnight:', midnightCount);
        console.log('Records with Time:', withTimeCount);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

checkDbDistribution();
