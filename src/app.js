import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { connectDB } from './config/db.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { verifyJWT } from './middleware/auth.middleware.js';

import authRoutes from './routes/auth.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import employeeRoutes from './routes/employee.routes.js';
import leaveRoutes from './routes/leave.routes.js';
import announcementRoutes from './routes/announcement.routes.js';
import holidayRoutes from './routes/holiday.routes.js';
import gurukulRoutes from './routes/gurukul.routes.js';
import payrollRoutes from './routes/payroll.routes.js';
import specialLoginRoutes from './routes/specialLogin.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import resignationRoutes from './routes/resignation.routes.js';
import complaintRoutes from './routes/complaint.routes.js';

import versionRoutes from './routes/version.routes.js';
import alertRoutes from './routes/alert.routes.js';




import { initAllCronJobs } from './cron/index.js';
import { processBirthdayNotifications } from './cron/birthday.cron.js';

import { ApiResponse } from './utils/ApiResponse.js';

const app = express();


// ─────────────────────────────────────────────────────────────
// CORS CONFIGURATION
// ─────────────────────────────────────────────────────────────

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://192.168.1.45:5173',

  'https://hrmsv2.infinityarthvishva.com',

  'https://hrms-frontend-smoky-ten.vercel.app',
  'https://tranquil-caramel-4d0998.netlify.app',

  'https://hrms-v-2-5-frontend.onrender.com',
  'https://hrms-v-2-5-frontend.vercel.app',

  process.env.FRONTEND_URL,
].filter(Boolean);

console.log('✅ Allowed Origins:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {

    console.log('🌐 Request Origin:', origin);

    if (!origin) {
      return callback(null, true);
    }

    if (
      allowedOrigins.includes(origin) ||
      process.env.NODE_ENV === 'development'
    ) {
      return callback(null, true);
    }

    console.error('❌ Blocked by CORS:', origin);

    return callback(new Error('CORS not allowed by policy'));
  },

  credentials: true,

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
  ],
};

// Apply CORS
app.use(cors(corsOptions));

// Handle OPTIONS requests safely
app.options(/.*/, cors(corsOptions));


// ─────────────────────────────────────────────────────────────
// BODY PARSERS
// ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));

app.use(express.urlencoded({
  extended: true,
  limit: '10mb',
}));

app.use(cookieParser());


// ─────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}


// ─────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'HRMS API v2',
    env: process.env.NODE_ENV,
  });
});


// ─────────────────────────────────────────────────────────────
// TEST ROUTES
// ─────────────────────────────────────────────────────────────

app.get('/api/test-birthday-notifications', async (req, res, next) => {
  try {

    await processBirthdayNotifications();

    res.json(
      new ApiResponse(
        200,
        null,
        'Birthday notifications triggered manually'
      )
    );

  } catch (error) {
    next(error);
  }
});

app.get('/api/test-my-notification', verifyJWT, async (req, res, next) => {
  try {

    const { sendNotification } = await import('./services/notification.service.js');

    const employeeModule = await import('./models/Employee.model.js');

    const employee = await employeeModule.Employee.findById(req.user._id);

    if (!employee?.fcmToken) {
      return res.status(400).json(
        new ApiResponse(
          400,
          null,
          'You have no FCM token registered'
        )
      );
    }

    const result = await sendNotification(employee.fcmToken, {
      title: 'Test Notification 🔔',
      body: 'If you see this, notifications are working perfectly!',
    });

    res.json(
      new ApiResponse(
        200,
        result,
        result
          ? 'Notification sent successfully'
          : 'Notification failed'
      )
    );

  } catch (error) {
    next(error);
  }
});


// ─────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────-----------------


app.use('/api/auth', authRoutes);

app.use('/api/attendance', attendanceRoutes);

app.use('/api/employees', employeeRoutes);

app.use('/api/leaves', leaveRoutes);

app.use('/api/announcements', announcementRoutes);

app.use('/api/holidays', holidayRoutes);

app.use('/api/v1/gurukul', gurukulRoutes);

app.use('/api/payroll', payrollRoutes);

app.use('/api/special-logins', specialLoginRoutes);

app.use('/api/dashboard', dashboardRoutes);

app.use('/api/resignations', resignationRoutes);
app.use('/api/complaints', complaintRoutes);



// alert and version code api
app.use('/api/alert', alertRoutes);
app.use('/api/version', versionRoutes);


// ─────────────────────────────────────────────────────────────
// NOT FOUND HANDLER
// ─────────────────────────────────────────────────────────────

app.use(notFoundHandler);


// ─────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {

  console.error('🔥 Global Error:', err);

  // CORS Errors
  if (err.message === 'CORS not allowed by policy') {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack:
      process.env.NODE_ENV === 'development'
        ? err.stack
        : undefined,
  });
});


// Existing Error Middleware
app.use(errorHandler);


// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

// Vercel automatically handles serverless deployment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {

  connectDB()
    .then(() => {

      app.listen(PORT, () => {

        logger.info(`🚀 Server running on port ${PORT}`);

        initAllCronJobs();

      });

    })
    .catch((err) => {

      logger.error('❌ Failed to connect to database', err);

    });
}

export default app;