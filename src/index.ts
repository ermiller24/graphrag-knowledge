#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DatabaseManager } from './core/database.js';
import { 
  NodeData, 
  RelationshipData, 
  DocumentGenerationOptions,
} from './types.js';

// Initialize the server
const server = new Server(
  {
    name: "graphrag-knowledge",
    version: "0.0.1",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Global database manager instance
let dbManager: DatabaseManager;

// Initialize database connection
async function initializeDatabase() {
  try {
    dbManager = await DatabaseManager.initialize();
    console.error('Database connection initialized');
  } catch (error) {
    console.error('Failed to initialize database connection:', error);
    throw error;
  }
}

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
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
      },
      {
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
      },
      {
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
      },
      {
        name: "explore_neighborhoods",
        description: "Explore neighborhoods around search terms with intelligent deduplication and filtering. Use schema_mode to explore NodeType and RelationshipType definitions instead of knowledge content.\n\nSCHEMA MODE USAGE: When schema_mode=true, search for specific schema definition names. For example:\n- Search for 'Character' to find the Character NodeType definition and related RelationshipTypes\n- Search for 'MEMBER_OF' to find that RelationshipType definition and its constraints\n- DO NOT search for 'NodeType' or 'RelationshipType' - search for the actual schema names like 'Character', 'Location', 'FRIEND', etc.",
        inputSchema: {
          type: "object",
          properties: {
            search_terms: {
              type: "array",
              items: { type: "string" },
              description: "Terms to search for"
            },
            search_strategy: {
              type: "string",
              enum: ["vector", "text", "combined"],
              description: "Search strategy to use"
            },
            max_results_per_term: { type: "number", description: "Maximum results per search term" },
            neighborhood_depth: { type: "number", description: "Depth of neighborhood exploration" },
            min_similarity_threshold: { type: "number", description: "Minimum similarity score for vector search results (0.0-1.0)" },
            include_relationship_types: { type: "boolean", description: "Include relationship type analysis" },
            include_templates: { type: "boolean", description: "Include template usage analysis" },
            deduplicate_nodes: { type: "boolean", description: "Remove duplicate nodes with same name" },
            schema_mode: { type: "boolean", description: "Explore schema (NodeType/RelationshipType) instead of knowledge content" }
          },
          required: ["search_terms"]
        }
      },
      {
        name: "find_relationship_paths",
        description: "Find paths between nodes with strength calculations",
        inputSchema: {
          type: "object",
          properties: {
            node_pairs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  source: { type: "string", description: "Source node ID or name" },
                  target: { type: "string", description: "Target node ID or name" }
                }
              },
              description: "Pairs of nodes to find paths between"
            },
            max_path_length: { type: "number", description: "Maximum path length to consider" },
            min_strength_threshold: { type: "number", description: "Minimum path strength threshold" },
            max_paths_per_pair: { type: "number", description: "Maximum paths to return per pair" },
            include_path_narratives: { type: "boolean", description: "Include narrative descriptions" }
          },
          required: ["node_pairs"]
        }
      },
      {
        name: "manage_templates",
        description: "Create, update, delete, or list document templates for generating rich, navigable knowledge documents.\n\n" +
          "TEMPLATE BEST PRACTICES:\n\n" +
          "1. **Use Hyperlinks for Navigation**: Create clickable links between related nodes using the pattern:\n" +
          "   `[{{target.name}}](node://{{target.id}}) - {{target.summary}}`\n\n" +
          "2. **Access Full Node Objects**: Template variables should return complete node objects, not just properties:\n" +
          "   - Good: `MATCH (n)-[r:FRIEND]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target`\n" +
          "   - Bad: `MATCH (n)-[r:FRIEND]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target.name as target_name`\n\n" +
          "3. **Use Mustache Sections for Dynamic Content**:\n" +
          "   - Loops: `{{#relationships}}...{{/relationships}}`\n" +
          "   - Conditionals: `{{^relationships}}*No relationships found*{{/relationships}}`\n" +
          "   - Properties: `{{#properties}}- **{{key}}**: {{value}}{{/properties}}`\n\n" +
          "4. **Structure Template Variables by Relationship Type**: Create separate variables for different relationship types:\n" +
          "   - `friend_relationships`: `MATCH (n)-[r:FRIEND]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target`\n" +
          "   - `location_relationships`: `MATCH (n)-[r:LOCATED_IN]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target`\n\n" +
          "5. **Include Fallback Content**: Always provide inverted sections for empty relationships to create informative documents even when data is sparse.\n\n" +
          "6. **Use Node Type Filtering**: Filter relationships by target node types for better organization:\n" +
          "   `MATCH (n)-[r:CARRIES|OWNS]->(target:Node) WHERE id(n) = $nodeId AND target.node_type = 'Artifact' RETURN type(r) as relationship_type, target`\n\n" +
          "EXAMPLE TEMPLATE STRUCTURE:\n" +
          "```\n" +
          "# {{name}}\n\n" +
          "## Summary\n{{summary}}\n\n" +
          "## Friends\n" +
          "{{#friend_relationships}}\n" +
          "- **{{relationship_type}}**: [{{target.name}}](node://{{target.id}}) - {{target.summary}}\n" +
          "{{/friend_relationships}}\n" +
          "{{^friend_relationships}}\n" +
          "*No friends recorded*\n" +
          "{{/friend_relationships}}\n" +
          "```",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["create", "update", "delete", "list"],
              description: "The operation to perform"
            },
            templates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Template ID" },
                  name: { type: "string", description: "Template name" },
                  description: { type: "string", description: "Template description" },
                  structure: {
                    type: "string",
                    description: "Mustache template structure using {{variable}} syntax. Use {{#array}}...{{/array}} for loops, {{^array}}...{{/array}} for empty conditions, and [{{target.name}}](node://{{target.id}}) for hyperlinks."
                  },
                  variables: {
                    type: "object",
                    description: "Cypher queries for template variables. Each key becomes a template variable. Queries should return 'target' objects (not just properties) to enable hyperlink generation. Use $nodeId parameter to reference the current node."
                  }
                }
              }
            }
          },
          required: ["operation"]
        }
      },
      {
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
      }
    ]
  };
});

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "manage_nodes": {
        const { operation, nodes } = args as { operation: "create" | "update" | "delete", nodes: NodeData[] };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await dbManager.manageNodes(operation, nodes), null, 2)
            }
          ]
        };
      }

      case "manage_relationships": {
        const { operation, relationships } = args as { operation: "create" | "update" | "delete", relationships: RelationshipData[] };
        return {
          content: [
            {
              type: "text", 
              text: JSON.stringify(await dbManager.manageRelationships(operation, relationships), null, 2)
            }
          ]
        };
      }

      case "generate_documents": {
        const { node_identifiers, force_regenerate, include_dependencies, template_override } = args as {
          node_identifiers: string[];
          force_regenerate?: boolean;
          include_dependencies?: boolean;
          template_override?: string;
        };
        
        const options: DocumentGenerationOptions = {
          force_regenerate,
          include_dependencies,
          template_override
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await dbManager.generateDocuments(node_identifiers, options), null, 2)
            }
          ]
        };
      }

      case "explore_neighborhoods": {
        const {
          search_terms,
          search_strategy = "combined",
          max_results_per_term = 3,
          neighborhood_depth = 2,
          min_similarity_threshold = 0.1,
          include_relationship_types = true,
          include_templates = true,
          deduplicate_nodes = true,
          schema_mode = false
        } = args as {
          search_terms: string[];
          search_strategy?: "vector" | "text" | "combined";
          max_results_per_term?: number;
          neighborhood_depth?: number;
          min_similarity_threshold?: number;
          include_relationship_types?: boolean;
          include_templates?: boolean;
          deduplicate_nodes?: boolean;
          schema_mode?: boolean;
        };
        
        try {
          const result = await dbManager.exploreNeighborhoods(
            search_terms,
            search_strategy,
            Number(max_results_per_term), // Ensure it's a regular number
            Number(neighborhood_depth),   // Ensure it's a regular number
            Number(min_similarity_threshold),
            include_relationship_types,
            include_templates,
            deduplicate_nodes,
            schema_mode
          );
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, (key, value) => {
                  // Handle BigInt values in JSON serialization
                  if (typeof value === 'bigint') {
                    return Number(value);
                  }
                  return value;
                }, 2)
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${(error as Error).message}`
              }
            ]
          };
        }
      }

      case "find_relationship_paths": {
        const {
          node_pairs,
          max_path_length = 4,
          min_strength_threshold = 0.1,
          max_paths_per_pair = 3,
          include_path_narratives = true
        } = args as {
          node_pairs: Array<{source: string; target: string}>;
          max_path_length?: number;
          min_strength_threshold?: number;
          max_paths_per_pair?: number;
          include_path_narratives?: boolean;
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await dbManager.findRelationshipPaths(
                node_pairs,
                max_path_length,
                min_strength_threshold,
                max_paths_per_pair,
                include_path_narratives
              ), null, 2)
            }
          ]
        };
      }

      case "manage_templates": {
        const { operation, templates } = args as {
          operation: "create" | "update" | "delete" | "list";
          templates?: Array<{
            id: string;
            name: string;
            description: string;
            structure: string;
            variables: {[key: string]: string};
          }>;
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await dbManager.manageTemplates(operation, templates || []), null, 2)
            }
          ]
        };
      }

      case "unsafe_query": {
        const { query, parameters = {} } = args as {
          query: string;
          parameters?: any;
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await dbManager.unsafeQuery(query, parameters), null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${(error as Error).message}`
        }
      ],
      isError: true
    };
  }
});

// Main server startup
async function main() {
  try {
    await initializeDatabase();
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('GraphRAG Knowledge MCP server running on stdio');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('Shutting down server...');
  if (dbManager) {
    await dbManager.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Shutting down server...');
  if (dbManager) {
    await dbManager.close();
  }
  process.exit(0);
});

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
