import { Router } from 'express';
import findingsRouter from './routes/findings';
import slackRouter from './routes/slack';
import runsRouter from './routes/runs';
import adminRouter from './routes/admin';
import stripeRouter from './routes/stripe';

const router: Router = Router();

// Mount route handlers
router.use('/findings', findingsRouter);
router.use('/slack', slackRouter);
router.use('/runs', runsRouter);
router.use('/admin', adminRouter);
router.use('/stripe', stripeRouter);

export default router;
