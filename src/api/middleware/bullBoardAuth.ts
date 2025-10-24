import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export function bullBoardAuth(req: Request, res: Response, next: NextFunction) {
  // If admin auth is disabled, allow all requests
  if (!config.admin.enabled) {
    return next();
  }

  // Skip auth in development if credentials are not set and ADMIN_ENABLED is false
  if (process.env.NODE_ENV === 'development' && !process.env.BULL_BOARD_PASSWORD && !config.admin.enabled) {
    logger.warn('Bull Board authentication disabled in development mode');
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    if (username === config.admin.username && password === config.admin.password) {
      return next();
    }

    logger.warn(`Failed Bull Board authentication attempt from ${req.ip}`);
    res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    logger.error('Bull Board authentication error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}
