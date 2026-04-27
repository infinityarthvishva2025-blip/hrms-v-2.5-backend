import cron from 'node-cron';
import { Employee } from '../models/Employee.model.js';
import { sendNotification, sendMulticastNotification } from '../services/notification.service.js';
import { logger } from '../utils/logger.js';

/**
 * Initialize all cron jobs
 */
export const initCronJobs = () => {
  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    logger.info('⏰ Running daily birthday notification cron job...');
    await processBirthdayNotifications();
  });

  logger.info('🚀 Cron jobs initialized');
};

/**
 * Process and send birthday notifications
 */
export const processBirthdayNotifications = async () => {
  try {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const tMonth = today.getMonth() + 1;
    const tDay = today.getDate();

    const tmMonth = tomorrow.getMonth() + 1;
    const tmDay = tomorrow.getDate();

    // 1. Fetch today's birthdays
    const todayBirthdays = await Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, tMonth] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, tDay] }
        ]
      }
    }).select('name employeeCode fcmToken');

    // 2. Fetch tomorrow's birthdays
    const tomorrowBirthdays = await Employee.find({
      status: 'Active',
      $expr: {
        $and: [
          { $eq: [{ $month: '$dateOfBirth' }, tmMonth] },
          { $eq: [{ $dayOfMonth: '$dateOfBirth' }, tmDay] }
        ]
      }
    }).select('name employeeCode fcmToken');

    // 3. Fetch all active employees with tokens (to send public announcements)
    const allEmployeesWithTokens = await Employee.find({
      status: 'Active',
      fcmToken: { $exists: true, $ne: null }
    }).select('fcmToken');

    const allTokens = allEmployeesWithTokens.map(emp => emp.fcmToken);

    // --- Process Today's Birthdays ---
    for (const birthdayEmp of todayBirthdays) {
      // A. Send public notification to everyone else
      const otherTokens = allTokens.filter(token => token !== birthdayEmp.fcmToken);
      if (otherTokens.length > 0) {
        await sendMulticastNotification(otherTokens, {
          title: '🎂 Happy Birthday!',
          body: `Today is ${birthdayEmp.name}'s birthday! Let's wish them a wonderful day! 🎉`,
        });
      }

      // B. Send personalized notification to the birthday person
      if (birthdayEmp.fcmToken) {
        await sendNotification(birthdayEmp.fcmToken, {
          title: `Happy Birthday, ${birthdayEmp.name}! 🥳`,
          body: 'Infinity Arthvishva wishes you a fantastic birthday! May your day be as special as you are to us. Have a great one! 🎂🎈',
        });
      }
    }

    // --- Process Tomorrow's Birthdays ---
    for (const birthdayEmp of tomorrowBirthdays) {
      // Send public notification to everyone
      if (allTokens.length > 0) {
        await sendMulticastNotification(allTokens, {
          title: '🎈 Upcoming Birthday',
          body: `Tomorrow is ${birthdayEmp.name}'s birthday! Get ready to celebrate! 🎂`,
        });
      }
    }

    logger.info(`✅ Birthday cron job finished. Processed ${todayBirthdays.length} today and ${tomorrowBirthdays.length} tomorrow.`);
  } catch (error) {
    logger.error('❌ Error in processBirthdayNotifications:', error.message);
  }
};
