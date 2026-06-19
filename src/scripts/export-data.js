import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to format date for logging
const getTimestamp = () => new Date().toISOString();

const runExport = async () => {
  const args = process.argv.slice(2);
  const isSingleFile = args.includes('--single');
  
  // Find custom directory option if provided
  let targetDirArg = './seed-data';
  const dirIndex = args.indexOf('--dir');
  if (dirIndex !== -1 && args[dirIndex + 1]) {
    targetDirArg = args[dirIndex + 1];
  }

  // Resolve absolute paths
  // By default, targetDir is resolved relative to the backend root directory (2 levels up from src/scripts)
  const backendRootDir = path.resolve(__dirname, '../..');
  const targetDir = path.resolve(backendRootDir, targetDirArg);
  const singleFilePath = path.resolve(backendRootDir, 'DATABASE.js');

  logger.info(`[${getTimestamp()}] 🚀 Starting Database Export Script...`);
  
  try {
    // 1. Database Connection
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is missing in .env file.');
    }

    logger.info(`[${getTimestamp()}] 🔌 Connecting to database...`);
    await mongoose.connect(mongoUri);
    logger.info(`[${getTimestamp()}] ✅ Database connected successfully.`);

    const db = mongoose.connection.db;

    // 2. Fetch all collections
    logger.info(`[${getTimestamp()}] 🔍 Fetching database collections...`);
    const collections = await db.listCollections().toArray();
    
    // Filter out system collections
    const activeCollections = collections.filter(c => !c.name.startsWith('system.'));
    
    if (activeCollections.length === 0) {
      logger.warn(`[${getTimestamp()}] ⚠️ No active collections found in the database.`);
      await mongoose.disconnect();
      process.exit(0);
    }

    logger.info(`[${getTimestamp()}] Found ${activeCollections.length} collections to export.`);

    // 3. Retrieve data for all collections
    const databaseBackup = {};

    for (const col of activeCollections) {
      const colName = col.name;
      logger.info(`[${getTimestamp()}] 📥 Fetching records from collection: "${colName}"...`);
      
      try {
        const records = await db.collection(colName).find({}).toArray();
        databaseBackup[colName] = records;
        logger.info(`[${getTimestamp()}] ✅ Retrieved ${records.length} records from "${colName}".`);
      } catch (colErr) {
        logger.error(`[${getTimestamp()}] ❌ Failed to fetch records from "${colName}": ${colErr.message}`);
        throw colErr;
      }
    }

    // Custom serializer to handle ObjectId and Date objects cleanly in standard JSON
    const cleanJSONStringify = (data) => {
      return JSON.stringify(data, (key, value) => {
        // Convert MongoDB ObjectId to simple hex string
        if (value && typeof value === 'object' && value.$oid) {
          return value.$oid;
        }
        return value;
      }, 2);
    };

    // 4. Exporting to target format
    if (isSingleFile) {
      // Option 1: Single File DATABASE.js
      logger.info(`[${getTimestamp()}] 📄 Exporting as single file to: ${singleFilePath}`);
      
      const fileHeader = `/**\n * Auto-generated Database Export\n * Generated at: ${getTimestamp()}\n */\n\n`;
      const exportContent = `${fileHeader}module.exports = ${cleanJSONStringify(databaseBackup)};\n`;
      
      await fs.writeFile(singleFilePath, exportContent, 'utf-8');
      
      // Verify file
      const stats = await fs.stat(singleFilePath);
      if (stats.size === 0) {
        throw new Error('Export file is empty.');
      }
      logger.info(`[${getTimestamp()}] 🎉 Successfully generated DATABASE.js (${(stats.size / 1024).toFixed(2)} KB).`);

    } else {
      // Option 2: Individual JSON Files (Preferred for Scalability)
      logger.info(`[${getTimestamp()}] 📂 Exporting as individual files under: ${targetDir}`);
      
      // Ensure target directory exists
      await fs.mkdir(targetDir, { recursive: true });

      for (const [colName, records] of Object.entries(databaseBackup)) {
        const filePath = path.join(targetDir, `${colName}.json`);
        logger.info(`[${getTimestamp()}] 💾 Writing "${colName}.json" to disk...`);
        
        await fs.writeFile(filePath, cleanJSONStringify(records), 'utf-8');
        
        // Verify file
        const stats = await fs.stat(filePath);
        if (stats.size === 0) {
          throw new Error(`File ${colName}.json is empty after writing.`);
        }
        logger.info(`[${getTimestamp()}] ✅ Verified ${colName}.json (${(stats.size / 1024).toFixed(2)} KB).`);
      }
      
      logger.info(`[${getTimestamp()}] 🎉 Successfully exported all ${activeCollections.length} collections under "${targetDirArg}/".`);
    }

    // 5. Clean disconnect
    await mongoose.disconnect();
    logger.info(`[${getTimestamp()}] 🔌 Disconnected from database.`);
    logger.info(`[${getTimestamp()}] ✨ Database export finished successfully.`);
    process.exit(0);

  } catch (error) {
    logger.error(`[${getTimestamp()}] ❌ Database export failed: ${error.message}`);
    
    // Attempt clean disconnect if connected
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        logger.info(`[${getTimestamp()}] 🔌 Disconnected from database.`);
      }
    } catch (disErr) {
      // ignore disconnect error during cleanup
    }
    
    process.exit(1);
  }
};

runExport();
