import 'dotenv/config';
import mongoose from 'mongoose';
import { Employee } from './models/Employee.model.js';

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  const employee = await Employee.findOne({ employeeCode: 'IA00091' });
  if (!employee) {
    console.log("Employee IA00091 NOT FOUND");
  } else {
    console.log("Employee found:", employee.employeeCode, employee.name);
    console.log("Password hash:", employee.password);
    const isValid = await employee.comparePassword("123456");
    console.log("comparePassword('123456') =>", isValid);
  }
  process.exit(0);
}
test();
