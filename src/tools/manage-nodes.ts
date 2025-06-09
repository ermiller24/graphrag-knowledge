import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const manageNodesSchema: Tool = {
  name: "manage_nodes",
  description: "Create, update, or delete nodes in the knowledge graph with intelligent relationship resolution and validation.\n\n⚠️ RECOMMENDED WORKFLOW: First use explore_neighborhoods with schema_mode=true to understand available NodeTypes and RelationshipTypes, then create missing schema definitions before adding knowledge content.\n\nCREATE: Creates nodes with optional relationships. Target nodes are resolved by exact name match, then vector similarity, finally creating placeholders if needed. Node types are validated against existing NodeType nodes (warnings shown for missing types).\n\nVALIDATION FEATURES:\n- Node types are checked against existing NodeType nodes\n- Suggests similar existing types to prevent duplicates like 'Character' vs 'Person'\n- Validates relationship types against RelationshipType nodes\n- Provides canonical names and validation warnings\n\nDATA MODELING GUIDANCE:\n- Use RELATIONSHIPS for dimensional attributes (categories that could be shared): race, location, allegiance, family ties, etc.\n- Use PROPERTIES for measures (specific attributes unique to that entity): age, height, dates, quotes, descriptions, etc.\n- Example: Instead of property 'race: Dwarf', use relationship 'RACE -> Dwarf' (auto-creates Dwarf node)\n\nUPDATE: Modifies existing node properties (requires node ID). Relationships are preserved.\n\nDELETE: Removes nodes and all associated data including vector indices (requires node ID).",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "Operation: 'create' (new nodes + relationships), 'update' (modify properties), 'delete' (remove completely)"
      },
      nodes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique node identifier (required for update/delete operations)" },
            name: { type: "string", description: "Human-readable node name (used for relationship resolution)" },
            summary: { type: "string", description: "Descriptive summary of the node's purpose or content" },
            node_type: { type: "string", description: "Category/type (creates placeholder type node and relationship if not exists)" },
            template_id: { type: "string", description: "Document template ID for generating formatted output" },
            properties: { type: "object", description: "Measures/attributes unique to this entity (age, height, dates, quotes, descriptions). Avoid categorical data that should be relationships." },
            relationships: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target_id: { type: "string", description: "Name or ID of target node (resolved automatically)" },
                  relationship_type: { type: "string", description: "Type of relationship (e.g., 'RACE', 'LIVES_IN', 'WORKS_FOR', 'MEMBER_OF'). Use for dimensional attributes." },
                  relevance_strength: { type: "string", enum: ["weak", "medium", "strong"], description: "Strength of the relationship connection" },
                  properties: { type: "object", description: "Additional relationship metadata" }
                }
              }
            }
          }
        }
      }
    },
    required: ["operation", "nodes"]
  }
};