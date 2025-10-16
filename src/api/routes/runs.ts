import { Router, Request, Response } from 'express';

const router: Router = Router();

// GET /api/runs/:id
router.get('/:id', (_req: Request, res: Response) => {
  // Stub implementation
  res.json({ ok: true });
});

// POST /api/runs
router.post('/', (_req: Request, res: Response) => {
  // Stub implementation
  res.json({ ok: true });
});

export default router;
