import { Router } from 'express';
import findingsRouter from './routes/findings';
import slackRouter from './routes/slack';
import runsRouter from './routes/runs';
import adminRouter from './routes/admin';
import { adminAuth } from './middleware/adminAuth';

const router: Router = Router();

// Mount route handlers
router.use('/findings', findingsRouter);
router.use('/slack', slackRouter);
router.use('/runs', runsRouter); // Canonical public entry point
router.use('/scan', runsRouter); // Internal alias - delegates to same handler
router.use('/admin', adminAuth, adminRouter);

export default router;
