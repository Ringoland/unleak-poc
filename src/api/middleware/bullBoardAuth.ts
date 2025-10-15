import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

const BULL_BOARD_USERNAME = process.env.BULL_BOARD_USERNAME || 'admin';
const BULL_BOARD_PASSWORD = process.env.BULL_BOARD_PASSWORD || 'admin';

export function bullBoardAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth in development if credentials are not set
  if (process.env.NODE_ENV === 'development' && !process.env.BULL_BOARD_PASSWORD) {
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

    if (username === BULL_BOARD_USERNAME && password === BULL_BOARD_PASSWORD) {
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
