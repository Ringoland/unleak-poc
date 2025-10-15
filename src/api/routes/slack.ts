import { Router, Request, Response } from 'express';

const router: Router = Router();

// POST /api/slack/actions - Handle Slack actions
router.post('/actions', (req: Request, res: Response) => {
  // Stub implementation
  res.json({ ok: true });
});

export default router;
