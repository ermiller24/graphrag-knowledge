import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const manageRelationshipsSchema: Tool = {
  name: "manage_relationships",
  description: "Create, update, or delete relationships between nodes with intelligent node resolution and validation.\n\n⚠️ RECOMMENDED WORKFLOW: First use explore_neighborhoods with schema_mode=true to understand available RelationshipTypes, then create missing schema definitions before adding knowledge relationships.\n\nCREATE: Creates directed relationships from source to target. Node references are resolved automatically:\n- Exact ID match (highest priority)\n- Exact name match (case-insensitive)\n- Vector similarity search (fuzzy matching)\n- Creates placeholder nodes if no match found\n\nVALIDATION FEATURES:\n- Relationship types are validated against existing RelationshipType nodes\n- Checks directionality and valid source/target node types\n- Suggests canonical relationship names to prevent duplicates\n- Provides validation warnings and recommendations\n\nUPDATE: Modifies relationship properties using relationship ID. Use the ID returned from create operations.\n\nDELETE: Removes relationships completely using relationship ID.\n\nReturns detailed resolution info including similarity scores for ambiguous matches and lists any placeholder nodes created.",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "Operation: 'create' (new relationships), 'update' (modify existing), 'delete' (remove completely)"
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Relationship ID from create response (required for update/delete operations)" },
            source_id: { type: "string", description: "Source node: exact ID, exact name, or partial name for fuzzy matching" },
            target_id: { type: "string", description: "Target node: exact ID, exact name, or partial name for fuzzy matching" },
            relationship_type: { type: "string", description: "Relationship type (e.g., 'WORKS_FOR', 'LOCATED_IN'). Must start with uppercase letter." },
            relevance_strength: { type: "string", enum: ["weak", "medium", "strong"], description: "Strength of the relationship connection" },
            properties: { type: "object", description: "Custom key-value properties to store with the relationship" }
          }
        }
      }
    },
    required: ["operation", "relationships"]
  }
};