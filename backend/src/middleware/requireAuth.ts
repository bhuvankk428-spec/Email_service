import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.sid as string | undefined;
  if (!token) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in'));
    return;
  }

  let payload: { uid?: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as { uid?: string };
  } catch {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in'));
    return;
  }

  if (!payload.uid) {
    next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in'));
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.uid } });
    if (!user) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in'));
      return;
    }

    req.user = user;
    next();
  } catch (error) {

    next(error);
  }
};
