import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { Employee } from '../models/Employee.model.js';
import { Payroll } from '../models/Payroll.model.js';

const query = async () => {
  await connectDB();
  const emp = await Employee.findOne({ employeeCode: 'IA00022' });
  console.log('Employee IA00022:', emp);
  if (emp) {
    const payrolls = await Payroll.find({ employeeId: emp._id });
    console.log('Payrolls for IA00022:', payrolls);
  }
  await mongoose.disconnect();
};

query();
