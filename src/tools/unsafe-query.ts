import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const unsafeQuerySchema: Tool = {
  name: "unsafe_query",
  description: "Execute raw Cypher queries directly on the database. WARNING: This tool can break things and should be used carefully for debugging purposes only.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The Cypher query to execute"
      },
      parameters: {
        type: "object",
        description: "Parameters to pass to the query (optional)"
      }
    },
    required: ["query"]
  }
};