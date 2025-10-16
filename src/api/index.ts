import { Router } from 'express';
import findingsRouter from './routes/findings';
import slackRouter from './routes/slack';

const router: Router = Router();

// Mount route handlers
router.use('/findings', findingsRouter);
router.use('/slack', slackRouter);

export default router;
