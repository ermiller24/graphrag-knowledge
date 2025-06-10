#!/usr/bin/env node

import Koa, { Context, Next } from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { DatabaseManager } from './database/index.js';
import { allToolSchemas } from './tools/index.js';
import { NodeData, RelationshipData } from './types.js';
import {
  logger,
  setupShutdownHandlers
} from './utils/index.js';

// Request body interfaces
interface CreateNodeRequest {
  name: string;
  summary: string;
  node_type?: string;
  template_id?: string;
  properties?: Record<string, any>;
  relationships?: Array<{
    target_id: string;
    relationship_type: string;
    relevance_strength?: 'weak' | 'medium' | 'strong';
    properties?: Record<string, any>;
  }>;
}

interface UpdateNodeRequest {
  name?: string;
  summary?: string;
  node_type?: string;
  template_id?: string;
  properties?: Record<string, any>;
}

interface CreateRelationshipRequest {
  source_id: string;
  target_id: string;
  relationship_type: string;
  relevance_strength?: 'weak' | 'medium' | 'strong';
  properties?: Record<string, any>;
}

interface UpdateRelationshipRequest {
  relevance_strength?: 'weak' | 'medium' | 'strong';
  properties?: Record<string, any>;
}

interface ExploreNeighborhoodsRequest {
  search_terms: string[];
  search_strategy?: 'vector' | 'text' | 'combined';
  max_results_per_term?: number;
  neighborhood_depth?: number;
  min_similarity_threshold?: number;
  include_relationship_types?: boolean;
  include_templates?: boolean;
  deduplicate_nodes?: boolean;
  schema_mode?: boolean;
}

interface FindPathsRequest {
  node_pairs: Array<{
    source: string;
    target: string;
  }>;
  max_path_length?: number;
  min_strength_threshold?: number;
  max_paths_per_pair?: number;
  include_path_narratives?: boolean;
}

interface GenerateDocumentsRequest {
  node_identifiers: string[];
  force_regenerate?: boolean;
  include_dependencies?: boolean;
  template_override?: string;
}

interface CreateTemplateRequest {
  id?: string;
  name: string;
  description: string;
  structure: string;
  variables: Record<string, string>;
}

interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  structure?: string;
  variables?: Record<string, string>;
}

interface UnsafeQueryRequest {
  query: string;
  parameters?: Record<string, any>;
}

const app = new Koa();
const router = new Router({ prefix: '/api/v1' });

// Global database manager instance
let dbManager: DatabaseManager | null = null;

// Initialize database connection
async function initializeDatabase(): Promise<DatabaseManager> {
  try {
    const manager = await DatabaseManager.initialize();
    logger.info('Database connection initialized successfully for REST API');
    return manager;
  } catch (error) {
    logger.error('Failed to initialize database connection for REST API:', error);
    throw error;
  }
}

// Middleware
app.use(cors({
  origin: (ctx: Context) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'];
    const origin = ctx.get('Origin');
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser({
  jsonLimit: '10mb',
  textLimit: '10mb'
}));

// Global error handler
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err: any) {
    logger.error(`API Error: ${err.message}`, err);
    
    // Map business logic errors to HTTP status codes
    if (err.message.includes('not found') || err.message.includes('Node not found')) {
      ctx.status = 404;
    } else if (err.message.includes('validation') || err.message.includes('Invalid')) {
      ctx.status = 400;
    } else if (err.message.includes('unauthorized') || err.message.includes('permission')) {
      ctx.status = 401;
    } else if (err.message.includes('Database manager not initialized')) {
      ctx.status = 503;
    } else {
      ctx.status = 500;
    }
    
    ctx.body = {
      error: err.message,
      code: err.code || 'UNKNOWN_ERROR',
      timestamp: new Date().toISOString(),
      path: ctx.path,
      method: ctx.method
    };
  }
});

// Request logging middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info(`${ctx.method} ${ctx.url} - ${ctx.status} - ${ms}ms`);
});

// Database check middleware
app.use(async (ctx, next) => {
  if (!dbManager) {
    ctx.status = 503;
    ctx.body = {
      error: 'Database manager not initialized',
      code: 'SERVICE_UNAVAILABLE',
      timestamp: new Date().toISOString()
    };
    return;
  }
  await next();
});

// Helper function to serialize BigInt values
function serializeBigInt(obj: any): any {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return value;
  }));
}

// Health check endpoint
router.get('/health', async (ctx) => {
  try {
    // Simple database connectivity check
    await dbManager!.unsafeQuery('RETURN 1 as test', {});
    
    ctx.body = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'up',
        api: 'up'
      },
      version: '0.0.1'
    };
  } catch (error) {
    ctx.status = 503;
    ctx.body = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'down',
        api: 'up'
      },
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Get available tools (schema information)
router.get('/tools', async (ctx) => {
  ctx.body = {
    tools: allToolSchemas,
    count: allToolSchemas.length
  };
});

// Node Management Endpoints

// Create single node
router.post('/nodes', async (ctx) => {
  const nodeData = ctx.request.body as CreateNodeRequest;
  const result = await dbManager!.manageNodes('create', [nodeData as any]);
  ctx.body = serializeBigInt(result);
});

// Create multiple nodes (batch)
router.post('/nodes/batch', async (ctx) => {
  const { nodes } = ctx.request.body as { nodes: any[] };
  if (!Array.isArray(nodes)) {
    ctx.status = 400;
    ctx.body = { error: 'nodes must be an array' };
    return;
  }
  const result = await dbManager!.manageNodes('create', nodes);
  ctx.body = serializeBigInt(result);
});

// Get node by ID
router.get('/nodes/:id', async (ctx) => {
  const result = await dbManager!.exploreNeighborhoods(
    [ctx.params.id],
    'text',
    1,
    0,
    0.1,
    true,
    true,
    true,
    false
  );
  
  if (result.neighborhoods && result.neighborhoods.length > 0) {
    ctx.body = result.neighborhoods[0];
  } else {
    ctx.status = 404;
    ctx.body = { error: 'Node not found' };
  }
});

// Update node
router.put('/nodes/:id', async (ctx) => {
  const updateData = ctx.request.body as UpdateNodeRequest;
  const nodeData = { id: ctx.params.id, ...updateData };
  const result = await dbManager!.manageNodes('update', [nodeData as any]);
  ctx.body = serializeBigInt(result);
});

// Delete node
router.delete('/nodes/:id', async (ctx) => {
  const result = await dbManager!.manageNodes('delete', [{ id: ctx.params.id } as any]);
  ctx.body = serializeBigInt(result);
});

// List nodes with pagination and filtering
router.get('/nodes', async (ctx) => {
  const {
    search = '',
    node_type = '',
    limit = 20,
    page = 1,
    similarity = 0.1
  } = ctx.query;

  const searchTerms = search ? [search as string] : [''];
  const maxResults = Math.min(parseInt(limit as string) || 20, 100);
  
  const result = await dbManager!.exploreNeighborhoods(
    searchTerms,
    'combined',
    maxResults,
    0,
    parseFloat(similarity as string),
    false,
    false,
    true,
    false
  );

  // Filter by node_type if specified
  let nodes = result.neighborhoods || [];
  if (node_type) {
    nodes = nodes.filter((node: any) => node.node_type === node_type);
  }

  // Simple pagination
  const pageNum = parseInt(page as string) || 1;
  const startIndex = (pageNum - 1) * maxResults;
  const paginatedNodes = nodes.slice(startIndex, startIndex + maxResults);

  ctx.body = {
    nodes: paginatedNodes,
    pagination: {
      page: pageNum,
      limit: maxResults,
      total: nodes.length,
      pages: Math.ceil(nodes.length / maxResults)
    }
  };
});

// Relationship Management Endpoints

// Create relationships
router.post('/relationships', async (ctx) => {
  const { relationships } = ctx.request.body as { relationships: any[] };
  if (!Array.isArray(relationships)) {
    ctx.status = 400;
    ctx.body = { error: 'relationships must be an array' };
    return;
  }
  const result = await dbManager!.manageRelationships('create', relationships);
  ctx.body = serializeBigInt(result);
});

// Update relationship
router.put('/relationships/:id', async (ctx) => {
  const updateData = ctx.request.body as UpdateRelationshipRequest;
  const relationshipData = { id: ctx.params.id, ...updateData };
  const result = await dbManager!.manageRelationships('update', [relationshipData as any]);
  ctx.body = serializeBigInt(result);
});

// Delete relationship
router.delete('/relationships/:id', async (ctx) => {
  const result = await dbManager!.manageRelationships('delete', [{ id: ctx.params.id } as any]);
  ctx.body = serializeBigInt(result);
});

// Search & Exploration Endpoints

// Basic search
router.get('/search', async (ctx) => {
  const {
    q = '',
    strategy = 'combined',
    limit = 10,
    depth = 2,
    similarity = 0.1,
    include_relationships = 'true',
    deduplicate = 'true'
  } = ctx.query;

  if (!q) {
    ctx.status = 400;
    ctx.body = { error: 'Query parameter "q" is required' };
    return;
  }

  const result = await dbManager!.exploreNeighborhoods(
    [q as string],
    strategy as 'vector' | 'text' | 'combined',
    parseInt(limit as string) || 10,
    parseInt(depth as string) || 2,
    parseFloat(similarity as string) || 0.1,
    include_relationships === 'true',
    true,
    deduplicate === 'true',
    false
  );

  ctx.body = result;
});

// Advanced search with JSON body
router.post('/search/advanced', async (ctx) => {
  const requestBody = ctx.request.body as ExploreNeighborhoodsRequest;
  const {
    search_terms,
    search_strategy = 'combined',
    max_results_per_term = 10,
    neighborhood_depth = 2,
    min_similarity_threshold = 0.1,
    include_relationship_types = true,
    include_templates = true,
    deduplicate_nodes = true,
    schema_mode = false
  } = requestBody;

  if (!Array.isArray(search_terms) || search_terms.length === 0) {
    ctx.status = 400;
    ctx.body = { error: 'search_terms must be a non-empty array' };
    return;
  }

  const result = await dbManager!.exploreNeighborhoods(
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

  ctx.body = result;
});

// Find paths between nodes
router.post('/search/paths', async (ctx) => {
  const requestBody = ctx.request.body as FindPathsRequest;
  const {
    node_pairs,
    max_path_length = 4,
    min_strength_threshold = 0.1,
    max_paths_per_pair = 3,
    include_path_narratives = true
  } = requestBody;

  if (!Array.isArray(node_pairs) || node_pairs.length === 0) {
    ctx.status = 400;
    ctx.body = { error: 'node_pairs must be a non-empty array' };
    return;
  }

  const result = await dbManager!.findRelationshipPaths(
    node_pairs,
    max_path_length,
    min_strength_threshold,
    max_paths_per_pair,
    include_path_narratives
  );

  ctx.body = result;
});

// Get node neighborhood
router.get('/nodes/:id/neighborhood', async (ctx) => {
  const {
    depth = 2,
    include_relationships = 'true',
    deduplicate = 'true'
  } = ctx.query;

  const result = await dbManager!.exploreNeighborhoods(
    [ctx.params.id],
    'text',
    50,
    parseInt(depth as string) || 2,
    0.1,
    include_relationships === 'true',
    true,
    deduplicate === 'true',
    false
  );

  ctx.body = result;
});

// Document Generation Endpoints

// Generate document for single node
router.get('/nodes/:id/document', async (ctx) => {
  const {
    template = '',
    force_regenerate = 'false',
    include_dependencies = 'true'
  } = ctx.query;

  const options = {
    force_regenerate: force_regenerate === 'true',
    include_dependencies: include_dependencies === 'true',
    template_override: template ? template as string : undefined
  };

  const result = await dbManager!.generateDocuments([ctx.params.id], options);
  ctx.body = result;
});

// Batch document generation
router.post('/documents/generate', async (ctx) => {
  const requestBody = ctx.request.body as GenerateDocumentsRequest;
  const {
    node_identifiers,
    force_regenerate = false,
    include_dependencies = true,
    template_override
  } = requestBody;

  if (!Array.isArray(node_identifiers) || node_identifiers.length === 0) {
    ctx.status = 400;
    ctx.body = { error: 'node_identifiers must be a non-empty array' };
    return;
  }

  const options = {
    force_regenerate,
    include_dependencies,
    template_override
  };

  const result = await dbManager!.generateDocuments(node_identifiers, options);
  ctx.body = result;
});

// Template Management Endpoints

// List all templates
router.get('/templates', async (ctx) => {
  const result = await dbManager!.manageTemplates('list', []);
  ctx.body = result;
});

// Create template
router.post('/templates', async (ctx) => {
  const templateData = ctx.request.body;
  const result = await dbManager!.manageTemplates('create', [templateData]);
  ctx.body = result;
});

// Get template by ID
router.get('/templates/:id', async (ctx) => {
  // Use unsafe query to get specific template
  const query = `
    MATCH (t:Template {id: $templateId})
    RETURN t
  `;
  const result = await dbManager!.unsafeQuery(query, { templateId: ctx.params.id });
  
  if (result.records && result.records.length > 0) {
    ctx.body = result.records[0].get('t').properties;
  } else {
    ctx.status = 404;
    ctx.body = { error: 'Template not found' };
  }
});

// Update template
router.put('/templates/:id', async (ctx) => {
  const updateData = ctx.request.body as UpdateTemplateRequest;
  const templateData = { id: ctx.params.id, ...updateData };
  const result = await dbManager!.manageTemplates('update', [templateData as any]);
  ctx.body = result;
});

// Delete template
router.delete('/templates/:id', async (ctx) => {
  const result = await dbManager!.manageTemplates('delete', [{ id: ctx.params.id }]);
  ctx.body = result;
});

// Schema & Metadata Endpoints

// Get available node types
router.get('/schema/node-types', async (ctx) => {
  const result = await dbManager!.exploreNeighborhoods(
    ['NodeType'],
    'text',
    100,
    1,
    0.1,
    true,
    false,
    true,
    true
  );
  ctx.body = result;
});

// Get available relationship types
router.get('/schema/relationship-types', async (ctx) => {
  const result = await dbManager!.exploreNeighborhoods(
    ['RelationshipType'],
    'text',
    100,
    1,
    0.1,
    true,
    false,
    true,
    true
  );
  ctx.body = result;
});

// Full schema information
router.get('/schema', async (ctx) => {
  const nodeTypesResult = await dbManager!.exploreNeighborhoods(
    ['NodeType'],
    'text',
    100,
    1,
    0.1,
    true,
    false,
    true,
    true
  );
  
  const relationshipTypesResult = await dbManager!.exploreNeighborhoods(
    ['RelationshipType'],
    'text',
    100,
    1,
    0.1,
    true,
    false,
    true,
    true
  );

  ctx.body = {
    node_types: nodeTypesResult,
    relationship_types: relationshipTypesResult
  };
});

// Database statistics
router.get('/stats', async (ctx) => {
  const query = `
    CALL {
      MATCH (n:Node) RETURN count(n) as nodeCount
    }
    CALL {
      MATCH ()-[r]->() RETURN count(r) as relationshipCount
    }
    CALL {
      MATCH (nt:NodeType) RETURN count(nt) as nodeTypeCount
    }
    CALL {
      MATCH (rt:RelationshipType) RETURN count(rt) as relationshipTypeCount
    }
    CALL {
      MATCH (t:Template) RETURN count(t) as templateCount
    }
    RETURN nodeCount, relationshipCount, nodeTypeCount, relationshipTypeCount, templateCount
  `;
  
  const result = await dbManager!.unsafeQuery(query, {});
  
  if (result.records && result.records.length > 0) {
    const record = result.records[0];
    ctx.body = {
      nodes: Number(record.get('nodeCount')),
      relationships: Number(record.get('relationshipCount')),
      node_types: Number(record.get('nodeTypeCount')),
      relationship_types: Number(record.get('relationshipTypeCount')),
      templates: Number(record.get('templateCount')),
      timestamp: new Date().toISOString()
    };
  } else {
    ctx.body = {
      nodes: 0,
      relationships: 0,
      node_types: 0,
      relationship_types: 0,
      templates: 0,
      timestamp: new Date().toISOString()
    };
  }
});

// Admin & Debug Endpoints

// Execute raw Cypher query (admin only)
router.post('/admin/query', async (ctx) => {
  const requestBody = ctx.request.body as UnsafeQueryRequest;
  const { query, parameters = {} } = requestBody;
  
  if (!query) {
    ctx.status = 400;
    ctx.body = { error: 'query is required' };
    return;
  }

  logger.warn(`Admin executing unsafe query: ${query.substring(0, 100)}...`);
  const result = await dbManager!.unsafeQuery(query, parameters);
  ctx.body = serializeBigInt(result);
});

// API documentation endpoint
router.get('/docs', async (ctx) => {
  ctx.body = {
    title: 'GraphRAG Knowledge REST API',
    version: '0.0.1',
    description: 'REST API for the GraphRAG Knowledge MCP server',
    base_url: '/api/v1',
    endpoints: {
      health: 'GET /health - Health check',
      tools: 'GET /tools - Get available tools schema',
      nodes: {
        create: 'POST /nodes - Create single node',
        batch_create: 'POST /nodes/batch - Create multiple nodes',
        get: 'GET /nodes/:id - Get node by ID',
        update: 'PUT /nodes/:id - Update node',
        delete: 'DELETE /nodes/:id - Delete node',
        list: 'GET /nodes - List nodes with pagination',
        neighborhood: 'GET /nodes/:id/neighborhood - Get node neighborhood',
        document: 'GET /nodes/:id/document - Generate document for node'
      },
      relationships: {
        create: 'POST /relationships - Create relationships',
        update: 'PUT /relationships/:id - Update relationship',
        delete: 'DELETE /relationships/:id - Delete relationship'
      },
      search: {
        basic: 'GET /search - Basic search',
        advanced: 'POST /search/advanced - Advanced search',
        paths: 'POST /search/paths - Find paths between nodes'
      },
      documents: {
        generate: 'POST /documents/generate - Batch document generation'
      },
      templates: {
        list: 'GET /templates - List templates',
        create: 'POST /templates - Create template',
        get: 'GET /templates/:id - Get template',
        update: 'PUT /templates/:id - Update template',
        delete: 'DELETE /templates/:id - Delete template'
      },
      schema: {
        node_types: 'GET /schema/node-types - Get node types',
        relationship_types: 'GET /schema/relationship-types - Get relationship types',
        full: 'GET /schema - Full schema information'
      },
      stats: 'GET /stats - Database statistics',
      admin: {
        query: 'POST /admin/query - Execute raw Cypher query'
      }
    }
  };
});

// Apply routes
app.use(router.routes());
app.use(router.allowedMethods());

// Start server
const PORT = process.env.PORT || 3001;

async function main(): Promise<void> {
  try {
    // Initialize database
    dbManager = await initializeDatabase();
    
    // Setup graceful shutdown handlers
    setupShutdownHandlers(dbManager);
    
    // Start the server
    app.listen(PORT, () => {
      logger.info(`GraphRAG Knowledge REST API server running on port ${PORT}`);
      logger.info(`API documentation available at http://localhost:${PORT}/api/v1/docs`);
      logger.info(`Health check available at http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    logger.error('Failed to start REST API server:', error);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  logger.error('Unhandled error in REST API main:', error);
  process.exit(1);
});