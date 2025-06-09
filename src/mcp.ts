#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { DatabaseManager } from './database/index.js';
import { allToolSchemas } from './tools/index.js';
import {
  logger,
  setupShutdownHandlers
} from './utils/index.js';

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
let dbManager: DatabaseManager | null = null;

// Initialize database connection
async function initializeDatabase(): Promise<DatabaseManager> {
  try {
    const manager = await DatabaseManager.initialize();
    logger.info('Database connection initialized successfully');
    return manager;
  } catch (error) {
    logger.error('Failed to initialize database connection:', error);
    throw error;
  }
}

// Tool list handler - uses extracted schemas
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.debug('Listing available tools');
  return {
    tools: allToolSchemas
  };
});

// Tool execution handler with improved error handling and logging
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  logger.debug(`Executing tool: ${name}`);
  
  if (!dbManager) {
    logger.error('Database manager not initialized');
    return {
      content: [
        {
          type: "text",
          text: "Error: Database manager not initialized"
        }
      ]
    };
  }

  try {
    switch (name) {
      case "manage_nodes": {
        const { operation, nodes } = args as { operation: "create" | "update" | "delete", nodes: any[] };
        const result = await dbManager.manageNodes(operation, nodes);
        logger.info(`Successfully managed ${nodes.length} nodes with operation: ${operation}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                  return Number(value);
                }
                return value;
              }, 2)
            }
          ]
        };
      }

      case "manage_relationships": {
        const { operation, relationships } = args as { operation: "create" | "update" | "delete", relationships: any[] };
        const result = await dbManager.manageRelationships(operation, relationships);
        logger.info(`Successfully managed ${relationships.length} relationships with operation: ${operation}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, (key, value) => {
                if (typeof value === 'bigint') {
                  return Number(value);
                }
                return value;
              }, 2)
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
        
        const options = {
          force_regenerate,
          include_dependencies,
          template_override
        };
        
        const result = await dbManager.generateDocuments(node_identifiers, options);
        logger.info(`Successfully generated documents for ${node_identifiers.length} nodes`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
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
        } = args as any;
        
        const result = await dbManager.exploreNeighborhoods(
          search_terms,
          search_strategy,
          max_results_per_term,
          neighborhood_depth,
          min_similarity_threshold,
          include_relationship_types,
          include_templates,
          deduplicate_nodes,
          schema_mode
        );
        
        logger.info(`Successfully explored neighborhoods for ${search_terms.length} search terms`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "find_relationship_paths": {
        const {
          node_pairs,
          max_path_length = 4,
          min_strength_threshold = 0.1,
          max_paths_per_pair = 3,
          include_path_narratives = true
        } = args as any;
        
        const result = await dbManager.findRelationshipPaths(
          node_pairs,
          max_path_length,
          min_strength_threshold,
          max_paths_per_pair,
          include_path_narratives
        );
        
        logger.info(`Successfully found relationship paths for ${node_pairs.length} node pairs`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "manage_templates": {
        const { operation, templates = [] } = args as {
          operation: "create" | "update" | "delete" | "list";
          templates?: any[];
        };
        
        const result = await dbManager.manageTemplates(operation, templates);
        logger.info(`Successfully managed templates with operation: ${operation}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "unsafe_query": {
        const { query, parameters = {} } = args as {
          query: string;
          parameters?: any;
        };
        
        logger.warn(`Executing unsafe query: ${query.substring(0, 100)}...`);
        const result = await dbManager.unsafeQuery(query, parameters);
        logger.info('Unsafe query executed successfully');
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      default:
        const errorMsg = `Unknown tool: ${name}`;
        logger.warn(errorMsg);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${errorMsg}`
            }
          ]
        };
    }
  } catch (error) {
    logger.error(`Error in tool handler for ${name}:`, error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
});

// Main server startup
async function main(): Promise<void> {
  try {
    // Initialize database
    dbManager = await initializeDatabase();
    
    // Setup graceful shutdown handlers
    setupShutdownHandlers(dbManager);
    
    // Start the server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    logger.info('GraphRAG Knowledge MCP server running on stdio');
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  logger.error('Unhandled error in main:', error);
  process.exit(1);
});
