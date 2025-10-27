import { Router } from 'express';
import findingsRouter from './routes/findings';
import slackRouter from './routes/slack';
import runsRouter from './routes/runs';
import adminRouter from './routes/admin';
import { adminAuth } from './middleware/adminAuth';
import { config } from '../config';

const router: Router = Router();

// Mount route handlers
router.use('/findings', findingsRouter);
router.use('/slack', slackRouter);
router.use('/runs', runsRouter); // Canonical public entry point
router.use('/scan', runsRouter); // Internal alias - delegates to same handler

// Only mount admin routes when admin is enabled
if (config.admin.enabled) {
  console.log('[DEBUG] Mounting admin routes - admin.enabled:', config.admin.enabled);
  router.use('/admin', adminAuth, adminRouter);
} else {
  console.log('[DEBUG] Admin routes NOT mounted - admin.enabled:', config.admin.enabled);
}

export default router;
