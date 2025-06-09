import { logger } from './logger.js';

// Standard response format for MCP tools
export interface MCPResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

// Utility function to create successful responses
export function createSuccessResponse(data: any): MCPResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, (key, value) => {
          // Handle BigInt values in JSON serialization
          if (typeof value === 'bigint') {
            return Number(value);
          }
          return value;
        }, 2)
      }
    ]
  };
}

// Utility function to create error responses
export function createErrorResponse(error: Error | string): MCPResponse {
  const errorMessage = error instanceof Error ? error.message : error;
  logger.error('Tool execution error:', errorMessage);
  
  return {
    content: [
      {
        type: "text",
        text: `Error: ${errorMessage}`
      }
    ]
  };
}

// Higher-order function to wrap tool handlers with consistent error handling
export function withErrorHandling<T extends any[], R>(
  handler: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<MCPResponse> => {
    try {
      const result = await handler(...args);
      return createSuccessResponse(result);
    } catch (error) {
      return createErrorResponse(error as Error);
    }
  };
}

// Utility function to safely cast arguments to expected type
export function safeArgs<T>(args: Record<string, unknown> | undefined): T {
  return (args || {}) as T;
}

// Utility function to safely convert parameters to numbers
export function safeNumber(value: any, defaultValue: number): number {
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

// Utility function to validate and normalize string parameters
export function safeString(value: any, defaultValue: string = ''): string {
  return typeof value === 'string' ? value : defaultValue;
}

// Utility function to validate and normalize boolean parameters
export function safeBoolean(value: any, defaultValue: boolean = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return defaultValue;
}