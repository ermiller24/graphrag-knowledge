// Simple structured logging utility
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  private log(level: LogLevel, message: string, ...args: any[]) {
    if (level >= this.level) {
      const timestamp = new Date().toISOString();
      const levelName = LogLevel[level];
      const prefix = `[${timestamp}] [${levelName}]`;
      
      // Use console.error for all logs to ensure they appear in stderr
      // This is important for MCP servers as stdout is used for protocol communication
      console.error(prefix, message, ...args);
    }
  }

  debug(message: string, ...args: any[]) {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: any[]) {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.log(LogLevel.ERROR, message, ...args);
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }
}

// Export a default logger instance
export const logger = new Logger(
  process.env.LOG_LEVEL ? 
    LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] || LogLevel.INFO : 
    LogLevel.INFO
);

// Export the Logger class for custom instances
export { Logger };