import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const generateDocumentsSchema: Tool = {
  name: "generate_documents",
  description: "Generate templated documents for nodes",
  inputSchema: {
    type: "object",
    properties: {
      node_identifiers: {
        type: "array",
        items: { type: "string" },
        description: "Node identifiers to generate documents for. Supports exact ID match, case-insensitive name match, and vector similarity search as fallbacks."
      },
      force_regenerate: { type: "boolean", description: "Force regeneration even if cached" },
      include_dependencies: { type: "boolean", description: "Include dependency information" },
      template_override: { type: "string", description: "Override template ID to use" }
    },
    required: ["node_identifiers"]
  }
};