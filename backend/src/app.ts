import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import emailRoutes from './routes/emails.js';
import healthRoutes from './routes/health.js';
import scheduleRoutes from './routes/schedule.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

const allowedOrigin = env.FRONTEND_URL.replace(/\/$/, '');

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === allowedOrigin) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => {
  res.json({
    service: 'reachinbox-scheduler-api',
    status: 'ok',
    docs: 'See backend/README.md',
  });
});

app.use('/health', healthRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/emails/schedule', scheduleRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
