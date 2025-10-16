import { Router } from 'express';
import findingsRouter from './routes/findings';
import slackRouter from './routes/slack';
import runsRouter from './routes/runs';

const router: Router = Router();

// Mount route handlers
router.use('/findings', findingsRouter);
router.use('/slack', slackRouter);
router.use('/runs', runsRouter);

export default router;
