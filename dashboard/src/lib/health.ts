// ==================== Health Check Utilities ====================

let _isShuttingDown = false;

/**
 * Returns current system health information for monitoring.
 */
export function getSystemHealth(): {
  uptime: number;
  memory: { heapUsed: number; heapTotal: number; rss: number; external: number };
  cpu: NodeJS.CpuUsage;
  env: string;
  nodeVersion: string;
  platform: string;
} {
  const memUsage = process.memoryUsage();
  return {
    uptime: process.uptime(),
    memory: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
    },
    cpu: process.cpuUsage(),
    env: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    platform: process.platform,
  };
}

/**
 * Check if the server is currently shutting down.
 * Route handlers should call this to reject new requests during shutdown.
 */
export function isShuttingDown(): boolean {
  return _isShuttingDown;
}

/**
 * Set up graceful shutdown handlers for SIGTERM and SIGINT.
 * - Logs shutdown initiation
 * - Sets isShuttingDown flag so routes can reject new requests
 * - Waits up to 10 seconds for in-flight requests to complete
 * - Logs completion and exits with code 0
 * - Prevents multiple concurrent shutdown attempts
 */
export function setupGracefulShutdown(): void {
  const SHUTDOWN_TIMEOUT_MS = 10_000;

  function handleShutdown(signal: string): void {
    if (_isShuttingDown) {
      console.warn(`Received ${signal} but shutdown is already in progress. Ignoring.`);
      return;
    }

    _isShuttingDown = true;
    console.log('Shutdown signal received. Starting graceful shutdown...');

    // Force exit after timeout regardless of in-flight requests
    const forceExitTimer = setTimeout(() => {
      console.warn('Graceful shutdown timed out. Forcing exit.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Allow in-flight requests to complete, then exit
    // In a real production setup, you would track active connections here
    setTimeout(() => {
      clearTimeout(forceExitTimer);
      console.log('Graceful shutdown complete');
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);

    // Remove listeners after first signal to prevent double-handling
    process.removeListener(signal, handleShutdown);
  }

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}
