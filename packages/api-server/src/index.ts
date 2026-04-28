import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { AppEnv } from './types';
import { patientRoutes } from './routes/patient';
import { doctorRoutes } from './routes/doctor';
import { nurseRoutes } from './routes/nurse';
import { adminRoutes } from './routes/admin';
import { frontdeskRoutes } from './routes/frontdesk';
import { pharmacyRoutes } from './routes/pharmacy';
import { labRoutes } from './routes/lab';
import { billingRoutes } from './routes/billing';
import { smartFhirRoutes } from './routes/smart-fhir';
import { authMiddleware } from './middleware/auth';
import { db } from './db';

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors({ origin: ['http://localhost:3000', 'http://localhost:3001'], credentials: true }));
app.use('*', logger());

// Health check (no auth)
app.get('/health', (c) => c.json({
  status: 'ok',
  version: '0.1.0',
  solana: 'devnet',
  timestamp: new Date().toISOString(),
}));

// SMART on FHIR routes (no auth — these handle their own OAuth)
app.route('/smart', smartFhirRoutes);

// Auth middleware for all /api routes
app.use('/api/*', authMiddleware);

// Role-based route groups
app.route('/api/patient', patientRoutes);
app.route('/api/doctor', doctorRoutes);
app.route('/api/nurse', nurseRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/frontdesk', frontdeskRoutes);
app.route('/api/pharmacy', pharmacyRoutes);
app.route('/api/lab', labRoutes);
app.route('/api/billing', billingRoutes);

const port = parseInt(process.env.PORT ?? '4000');

console.log(`Medi-Hive API starting on port ${port}...`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Medi-Hive API running at http://localhost:${info.port}`);
  console.log(`  Solana: devnet`);
  console.log(`  FHIR: sandbox mode`);
  console.log(`  Routes: 8 portals + SMART on FHIR loaded`);
  console.log(`  SMART: ${process.env.SMART_BASE_URL ?? 'http://localhost:4000'}/smart/launch`);
});

export { app };
