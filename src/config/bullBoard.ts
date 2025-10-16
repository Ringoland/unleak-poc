import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getScanQueue } from '../services/queueService';
import { logger } from '../utils/logger';

// Create Express adapter for Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

let bullBoard: ReturnType<typeof createBullBoard> | null = null;

/**
 * Initialize Bull Board with all queues
 */
export function initializeBullBoard() {
  try {
    const scanQueue = getScanQueue();

    bullBoard = createBullBoard({
      queues: [new BullMQAdapter(scanQueue)],
      serverAdapter,
    });

    logger.info('Bull Board initialized successfully');
    return serverAdapter;
  } catch (error) {
    logger.error('Failed to initialize Bull Board:', error);
    throw error;
  }
}

/**
 * Get the Bull Board server adapter
 */
export function getBullBoardAdapter() {
  return serverAdapter;
}

/**
 * Add a new queue to Bull Board
 */
export function addQueueToBullBoard(queueName: string, queue: any) {
  if (!bullBoard) {
    logger.warn('Bull Board not initialized, cannot add queue');
    return;
  }

  try {
    bullBoard.addQueue(new BullMQAdapter(queue));
    logger.info(`Queue "${queueName}" added to Bull Board`);
  } catch (error) {
    logger.error(`Failed to add queue "${queueName}" to Bull Board:`, error);
  }
}

/**
 * Remove a queue from Bull Board
 */
export function removeQueueFromBullBoard(queueName: string) {
  if (!bullBoard) {
    logger.warn('Bull Board not initialized, cannot remove queue');
    return;
  }

  try {
    bullBoard.removeQueue(queueName);
    logger.info(`Queue "${queueName}" removed from Bull Board`);
  } catch (error) {
    logger.error(`Failed to remove queue "${queueName}" from Bull Board:`, error);
  }
}
