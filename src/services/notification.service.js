import admin from 'firebase-admin';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccountPath = path.join(__dirname, '../config/serviceAccountKey.json');


let firebaseApp = null;

try {
  const serviceAccount = process.env.FIREBASE_PROJECT_ID 
    ? {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
      }
    : null;

  if (serviceAccount && serviceAccount.project_id && serviceAccount.private_key) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    logger.info('✅ Firebase Admin initialized successfully using environment variables');
  } else if (fs.existsSync(serviceAccountPath)) {
    const serviceAccountFromFile = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccountFromFile),
    });
    logger.info('✅ Firebase Admin initialized successfully from serviceAccountKey.json');
  } else {
    logger.warn('⚠️ Firebase credentials not found in .env or serviceAccountKey.json. Notifications will be disabled.');
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
