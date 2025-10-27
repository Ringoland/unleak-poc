import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';

/**
 * Basic authentication middleware for /admin/* routes.
 * This middleware only runs when admin routes are mounted (ADMIN_ENABLED=true).
 * Uses BULL_BOARD_USERNAME and BULL_BOARD_PASSWORD from config.
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    logger.warn('admin.auth_missing', { path: req.path });
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const base64Credentials = authHeader.substring('Basic '.length);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    if (username === config.admin.username && password === config.admin.password) {
      logger.debug('admin.auth_success', { username, path: req.path });
      return next();
    }

    logger.warn('admin.auth_failed', { username, path: req.path });
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    logger.error('admin.auth_error', { error: err });
    res.status(401).json({ error: 'Authentication failed' });
  }
}
