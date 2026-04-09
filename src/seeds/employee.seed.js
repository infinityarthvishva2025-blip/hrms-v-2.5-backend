import xlsx from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { Employee } from '../models/Employee.model.js';
import { connectDB } from '../config/db.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to convert Excel serial date to JS Date
const excelDateToJSDate = (serial) => {
    if (!serial || serial === 'NULL' || serial === '-') return null;
    if (typeof serial === 'string') {
        const d = new Date(serial);
        return isNaN(d.getTime()) ? null : d;
    }
    // Excel base date is Dec 30, 1899
    const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
    return isNaN(date.getTime()) ? null : date;
};

// Helper to clean strings
const cleanStr = (val) => {
    if (val === undefined || val === null || val === 'NULL' || val === '-' || val === 'null' || val === '0') return undefined; // '0' for IFSC etc if it's numeric 0 but meant to be string
    return String(val).trim();
};

// Helper to map 0/1 to Boolean
const toBool = (val) => {
    if (val === 1 || val === '1' || val === true || val === 'true') return true;
    return false;
};

const seedEmployees = async () => {
    try {
        await connectDB();

        const filePath = path.join(__dirname, '..', 'employees.xlsx');
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        // Cache existing employees by code and email for fast lookup
        const existingEmployees = await Employee.find({}, { employeeCode: 1, email: 1 }).lean();
        const existingCodes = new Set(existingEmployees.map(e => e.employeeCode.toUpperCase()));
        const existingEmails = new Set(existingEmployees.map(e => e.email?.toLowerCase()));

        let insertedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const row of data) {
            const employeeCode = cleanStr(row.EmployeeCode)?.toUpperCase();
            let email = cleanStr(row.Email)?.toLowerCase();
            let password = cleanStr(row.Password);

            if (!employeeCode) {
                logger.warn('Skipping row: Missing EmployeeCode');
                skippedCount++;
                continue;
            }

            // Skip only if EmployeeCode already exists (avoid duplication on re-runs)
            if (existingCodes.has(employeeCode)) {
                logger.info(`Skipping ${employeeCode}: Employee code already exists.`);
                skippedCount++;
                continue;
            }

            // Fix Duplicate Email: Check if email already exists
            if (email && existingEmails.has(email)) {
                const [user, domain] = email.split('@');
                email = `${user}_${employeeCode}@${domain || 'infinity.com'}`;
                logger.warn(`Modifying email for ${employeeCode}: Duplicate email found, changed to ${email}`);
            }

            // Fix Password: Path `password` must be at least 6 characters
            if (!password || password.length < 6) {
                logger.warn(`Correcting password for ${employeeCode} (original length: ${password?.length || 0})`);
                password = '123456';
            }

            // Normalize experienceType (Fix "fresher" -> "Fresher" validation error)
            let experienceType = cleanStr(row.ExperienceType);
            if (experienceType?.toLowerCase() === 'fresher') experienceType = 'Fresher';
            if (experienceType?.toLowerCase() === 'experienced') experienceType = 'Experienced';

            const employeeData = {
                employeeCode,
                password, // Now fixed if it was too short
                role: cleanStr(row.Role) || 'Employee',
                status: cleanStr(row.Status) || 'Active',
                name: cleanStr(row.Name),
                email, // Now fixed if it was a duplicate
                mobileNumber: cleanStr(row.MobileNumber),
                alternateMobileNumber: cleanStr(row.AlternateMobileNumber),
                gender: cleanStr(row.Gender),
                dateOfBirth: excelDateToJSDate(row.DOB_Date),
                maritalStatus: cleanStr(row.MaritalStatus),
                
                // Address & Personal
                fatherName: cleanStr(row.FatherName),
                motherName: cleanStr(row.MotherName),
                currentAddress: cleanStr(row.Address),
                permanentAddress: cleanStr(row.PermanentAddress),
                district: cleanStr(row.District),
                state: cleanStr(row.State),
                pincode: cleanStr(row.Pincode),

                // Job
                joiningDate: excelDateToJSDate(row.JoiningDate),
                department: cleanStr(row.Department),
                position: cleanStr(row.Position),
                salary: Number(row.Salary) || 0,
                reportingManager: cleanStr(row.ReportingManager),
                
                // Experience
                experienceType, // Now normalized
                totalExperienceYears: Number(row.TotalExperienceYears) || 0,
                lastCompanyName: cleanStr(row.LastCompanyName),
                
                // Education
                hscPercent: Number(row.HSCPercent) || 0,
                graduationCourse: cleanStr(row.GraduationCourse),
                graduationPercent: Number(row.GraduationPercent) || 0,
                postGraduationCourse: cleanStr(row.PostGraduationCourse),
                postGraduationPercent: Number(row.PostGraduationPercent) || 0,

                // Bank
                accountHolderName: cleanStr(row.AccountHolderName),
                bankName: cleanStr(row.BankName),
                accountNumber: cleanStr(row.AccountNumber),
                ifsc: cleanStr(row.IFSC),
                branch: cleanStr(row.Branch),
                bankVerified: toBool(row.BankVerified),

                // Documents & Vertification
                aadhaarNumber: cleanStr(row.AadhaarNumber),
                panNumber: cleanStr(row.PanNumber),
                aadhaarVerified: toBool(row.AadhaarVerified),
                panVerified: toBool(row.PanVerified),
                
                // Emergency
                emergencyContactName: cleanStr(row.EmergencyContactName),
                emergencyContactRelationship: cleanStr(row.EmergencyContactRelationship),
                emergencyContactMobile: cleanStr(row.EmergencyContactMobile),
                emergencyContactAddress: cleanStr(row.EmergencyContactAddress),

                // Health
                hasDisease: cleanStr(row.HasDisease) === 'Yes' ? 'Yes' : 'No',
                diseaseName: cleanStr(row.DiseaseName),
                diseaseType: cleanStr(row.DiseaseType),
                diseaseSince: cleanStr(row.DiseaseSince),
                medicinesRequired: cleanStr(row.MedicinesRequired),
                doctorName: cleanStr(row.DoctorName),
                doctorContact: cleanStr(row.DoctorContact),

                // Balances
                compOffBalance: Number(row.CompOffBalance) || 0,
                lastWorkingDate: excelDateToJSDate(row.LastWorkingDate),
            };

            // Remove undefined fields
            Object.keys(employeeData).forEach(key => employeeData[key] === undefined && delete employeeData[key]);

            try {
                await Employee.create(employeeData);
                insertedCount++;
                // Update caches to prevent duplicates within the SAME excel file
                existingCodes.add(employeeCode);
                if (email) existingEmails.add(email);
            } catch (err) {
                logger.error(`Error inserting employee ${employeeCode}: ${err.message}`);
                errorCount++;
            }
        }

        logger.info(`Seeding completed. Inserted: ${insertedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
        process.exit(0);
    } catch (error) {
        logger.error(`Seeding failed: ${error.message}`);
        process.exit(1);
    }
};

seedEmployees();
