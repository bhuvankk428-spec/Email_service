import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { reconcile } from '../queue/reconcile.js';

const router = Router();

router.post('/reconcile', requireAuth, async (_req, res, next) => {
  try {
    const result = await reconcile();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
