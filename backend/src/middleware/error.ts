import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
};

interface ParserError {
  status?: number;
  statusCode?: number;
  type?: string;
  message?: string;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: issue?.message ?? 'Invalid request',
        details: error.issues,
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  const parserError = error as ParserError;
  const status = parserError.status ?? parserError.statusCode;

  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code =
      status === 413
        ? 'PAYLOAD_TOO_LARGE'
        : parserError.type === 'entity.parse.failed'
          ? 'INVALID_JSON'
          : 'BAD_REQUEST';
    res.status(status).json({
      error: {
        code,
        message:
          code === 'INVALID_JSON'
            ? 'Request body is not valid JSON'
            : status === 413
              ? 'Request body is too large'
              : parserError.message || 'Invalid request',
      },
    });
    return;
  }

  if (typeof parserError.message === 'string' && parserError.message.includes('is not allowed by CORS')) {
    res.status(403).json({
      error: { code: 'CORS_FORBIDDEN', message: 'Origin is not allowed' },
    });
    return;
  }

  logger.error({ err: error, method: req.method, url: req.originalUrl }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Internal server error' : String(error?.message),
    },
  });
};
