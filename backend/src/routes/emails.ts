import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { toScheduledDto, toSentDto } from '../dto.js';
import { HttpError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { removeQueuedJobs } from '../queue/index.js';

const router = Router();

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/scheduled', requireAuth, async (req, res, next) => {
  try {
    const { page, limit } = pageQuery.parse(req.query);
    const where: Prisma.EmailWhereInput = {
      userId: req.user!.id,
      status: { in: ['SCHEDULED', 'PROCESSING'] },
    };

    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        include: { sender: { select: { user: true } } },
        orderBy: [{ scheduledAt: 'asc' }, { seq: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.email.count({ where }),
    ]);

    res.json({
      items: rows.map(toScheduledDto),
      page,
      limit,
      total,
      nextCursor: null,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/sent', requireAuth, async (req, res, next) => {
  try {
    const { page, limit } = pageQuery.parse(req.query);
    const where: Prisma.EmailWhereInput = {
      userId: req.user!.id,
      status: { in: ['SENT', 'FAILED'] },
    };

    const [rows, total] = await Promise.all([
      prisma.email.findMany({
        where,
        include: { sender: { select: { user: true } } },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.email.count({ where }),
    ]);

    res.json({
      items: rows.map(toSentDto),
      page,
      limit,
      total,
      nextCursor: null,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const [scheduled, processing, sent, failed] = await Promise.all([
      prisma.email.count({ where: { userId, status: 'SCHEDULED' } }),
      prisma.email.count({ where: { userId, status: 'PROCESSING' } }),
      prisma.email.count({ where: { userId, status: 'SENT' } }),
      prisma.email.count({ where: { userId, status: 'FAILED' } }),
    ]);

    res.json({
      totalScheduled: scheduled,
      totalProcessing: processing,
      totalSent: sent,
      totalFailed: failed,
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/scheduled', requireAuth, async (req, res, next) => {
  try {
    const where: Prisma.EmailWhereInput = {
      userId: req.user!.id,
      status: 'SCHEDULED',
    };
    const rows = await prisma.email.findMany({ where, select: { id: true } });
    const deleted = await prisma.email.deleteMany({ where });

    await removeQueuedJobs(rows.map((row) => row.id));

    res.json({ ok: true, deleted: deleted.count });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const emailId = String(req.params.id);
    const deleted = await prisma.email.deleteMany({
      where: { id: emailId, userId: req.user!.id, status: 'SCHEDULED' },
    });

    if (deleted.count === 0) {
      const existing = await prisma.email.findFirst({
        where: { id: emailId, userId: req.user!.id },
        select: { id: true },
      });

      if (!existing) {
        throw new HttpError(404, 'NOT_FOUND', 'Email not found');
      }
      throw new HttpError(409, 'NOT_CANCELLABLE', 'Only scheduled emails can be cancelled');
    }

    await removeQueuedJobs([emailId]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
