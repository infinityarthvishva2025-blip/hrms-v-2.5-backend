import admin from 'firebase-admin';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccountPath = path.join(__dirname, '../config/serviceAccountKey.json');

let firebaseApp = null;

try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    logger.info('✅ Firebase Admin initialized successfully');
  } else {
    logger.warn('⚠️ Firebase serviceAccountKey.json not found. Notifications will be disabled.');
  }
} catch (error) {
  logger.error('❌ Error initializing Firebase Admin:', error.message);
}

/**
 * Send a push notification to a specific device
 * @param {string} token - FCM device token
 * @param {Object} notification - { title, body }
 * @param {Object} data - Optional data payload
 */
export const sendNotification = async (token, notification, data = {}) => {
  if (!firebaseApp) {
    logger.warn('Push notification skipped: Firebase not initialized');
    return null;
  }

  if (!token) {
    logger.warn('Push notification skipped: No token provided');
    return null;
  }

  try {
    const message = {
      notification,
      data,
      token,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
          icon: 'notification_icon', // Make sure this exists in mobile app
          color: '#6366F1',
        },
      },
    };

    const response = await admin.messaging().send(message);
    logger.info(`Successfully sent notification: ${response}`);
    return response;
  } catch (error) {
    logger.error(`Error sending notification to token ${token}:`, error.message);
    return null;
  }
};

/**
 * Send a push notification to multiple devices
 * @param {string[]} tokens - Array of FCM device tokens
 * @param {Object} notification - { title, body }
 * @param {Object} data - Optional data payload
 */
export const sendMulticastNotification = async (tokens, notification, data = {}) => {
  if (!firebaseApp) {
    logger.warn('Multicast notification skipped: Firebase not initialized');
    return null;
  }

  const validTokens = tokens.filter(token => !!token);
  if (validTokens.length === 0) {
    logger.warn('Multicast notification skipped: No valid tokens provided');
    return null;
  }

  try {
    const message = {
      notification,
      data,
      tokens: validTokens,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    logger.info(`Successfully sent multicast notification: ${response.successCount} success, ${response.failureCount} failure`);
    return response;
  } catch (error) {
    logger.error('Error sending multicast notification:', error.message);
    return null;
  }
};
