import { logger } from './logger.js';
import { DatabaseManager } from '../database/index.js';

// Graceful shutdown handler
export async function gracefulShutdown(
  signal: string, 
  dbManager: DatabaseManager | null
): Promise<void> {
  logger.info(`Received ${signal}, shutting down server gracefully...`);
  
  try {
    if (dbManager) {
      logger.info('Closing database connection...');
      await dbManager.close();
      logger.info('Database connection closed successfully');
    }
  } catch (error) {
    logger.error('Error during shutdown:', error);
  } finally {
    logger.info('Server shutdown complete');
    process.exit(0);
  }
}

// Setup signal handlers for graceful shutdown
export function setupShutdownHandlers(dbManager: DatabaseManager | null): void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  
  signals.forEach(signal => {
    process.on(signal, () => gracefulShutdown(signal, dbManager));
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    gracefulShutdown('uncaughtException', dbManager);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection', dbManager);
  });
}