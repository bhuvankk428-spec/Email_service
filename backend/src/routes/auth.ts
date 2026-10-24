import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { toUserDto } from '../dto.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { ensureSendersForUser } from '../services/senders.js';

const router = Router();

interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatar: string | null;
}

const cookieOptions = () => {
  const sameSite =
    env.COOKIE_SAMESITE ?? (env.NODE_ENV === 'production' ? 'none' : 'lax');
  return {
    httpOnly: true,
    sameSite,
    secure: env.NODE_ENV === 'production' || sameSite === 'none',
    path: '/',
  } as const;
};

function setSessionCookie(res: Response, token: string): void {
  res.cookie('sid', token, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie('sid', cookieOptions());
}

function frontendUrl(path = '/'): string {
  const base = env.FRONTEND_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

function createClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_CALLBACK_URL,
  });
}

function assertOAuthConfigured(): void {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(
      503,
      'AUTH_NOT_CONFIGURED',
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    );
  }
}

async function upsertUser(profile: GoogleProfile) {
  const data = {
    email: profile.email,
    name: profile.name,
    avatar: profile.avatar,
  };

  return prisma.user.upsert({
    where: { googleId: profile.googleId },
    update: data,
    create: { googleId: profile.googleId, ...data },
  });
}

function issueSession(res: Response, userId: string): void {
  const token = jwt.sign({ uid: userId }, env.JWT_SECRET, { expiresIn: '7d' });
  setSessionCookie(res, token);
}

function warmSenders(userId: string): void {
  void ensureSendersForUser(userId).catch((error) => {
    logger.warn({ err: error, userId }, 'sender provisioning deferred');
  });
}

router.get('/google', (req, res, next) => {
  try {
    assertOAuthConfigured();

    const state = crypto.randomBytes(24).toString('hex');
    res.cookie('oauth_state', state, {
      ...cookieOptions(),
      maxAge: 10 * 60 * 1000,
    });

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      response_type: 'code',
      scope: 'openid profile email',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    res.json({
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    });
  } catch (error) {
    next(error);
  }
});

async function handleCallback(req: Request, res: Response): Promise<void> {
  try {
    assertOAuthConfigured();

    const error = typeof req.query.error === 'string' ? req.query.error : undefined;
    if (error) {
      res.redirect(frontendUrl(`/?error=${encodeURIComponent(error)}`));
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const expectedState = req.cookies?.oauth_state as string | undefined;

    if (!code || !state || !expectedState || state !== expectedState) {
      res.redirect(frontendUrl('/?error=invalid_state'));
      return;
    }

    res.clearCookie('oauth_state', cookieOptions());

    const client = createClient();
    const { tokens } = await client.getToken(code);

    let profile: GoogleProfile | null = null;

    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (payload?.sub && payload.email && payload.email_verified) {
        profile = {
          googleId: payload.sub,
          email: payload.email,
          name: payload.name ?? payload.email,
          avatar: payload.picture ?? null,
        };
      }
    }

    if (!profile && tokens.access_token) {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (response.ok) {
        const data = (await response.json()) as {
          id?: string;
          email?: string;
          name?: string;
          picture?: string;
        };
        if (data.id && data.email) {
          profile = {
            googleId: data.id,
            email: data.email,
            name: data.name ?? data.email,
            avatar: data.picture ?? null,
          };
        }
      }
    }

    if (!profile) {
      res.redirect(frontendUrl('/?error=google_profile_missing'));
      return;
    }

    const user = await upsertUser(profile);
    warmSenders(user.id);
    issueSession(res, user.id);
    res.redirect(frontendUrl('/?auth=success'));
  } catch (err) {
    logger.error({ err }, 'google oauth callback failed');
    res.redirect(frontendUrl('/?error=auth_failed'));
  }
}

router.get('/google/callback', (req, res) => {
  void handleCallback(req, res);
});

router.get('/callback', (req, res) => {
  void handleCallback(req, res);
});

router.post('/google', async (req, res, next) => {
  try {
    assertOAuthConfigured();
    const { credential } = z
      .object({ credential: z.string().min(10) })
      .parse(req.body);

    const client = createClient();
    const ticket = await client
      .verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID })
      .catch(() => null);
    const payload = ticket?.getPayload();

    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new HttpError(401, 'INVALID_TOKEN', 'Google sign-in failed');
    }

    const user = await upsertUser({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email,
      avatar: payload.picture ?? null,
    });

    warmSenders(user.id);
    issueSession(res, user.id);
    res.json(toUserDto(user));
  } catch (error) {
    next(error);
  }
});

router.post('/dev-login', async (_req, res, next) => {
  try {
    if (!env.DEV_AUTH_ENABLED || env.NODE_ENV === 'production') {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }

    const user = await prisma.user.upsert({
      where: { googleId: 'local-dev-user' },
      update: {
        email: env.DEV_AUTH_EMAIL,
        name: env.DEV_AUTH_NAME,
        avatar: null,
      },
      create: {
        googleId: 'local-dev-user',
        email: env.DEV_AUTH_EMAIL,
        name: env.DEV_AUTH_NAME,
        avatar: null,
      },
    });

    warmSenders(user.id);
    issueSession(res, user.id);
    logger.warn({ userId: user.id }, 'local development login used');
    res.json(toUserDto(user));
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(toUserDto(req.user!));
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
