# GraphRAG Knowledge REST API Architecture

## Overview

This document outlines the architecture for adding a REST API interface to the existing GraphRAG Knowledge MCP server. The design maintains the current MCP functionality while adding a human-accessible REST API through a clean separation of concerns.

## Current State Analysis

### Existing Architecture
```
index.ts (3204 lines)
├── Neo4jManager class (all business logic)
├── MCP protocol handlers
├── Tool definitions and schemas
└── Server initialization
```

### Issues with Current Architecture
- Business logic tightly coupled with MCP protocol
- Single large file mixing concerns
- Difficult to add alternative interfaces
- No human-accessible interface

## Proposed Architecture

### High-Level Design
```
┌─────────────────┐    ┌─────────────────┐
│   MCP Client    │    │  REST Client    │
│   (AI Agents)   │    │   (Humans)      │
└─────────────────┘    └─────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐    ┌─────────────────┐
│   mcp.ts        │    │   server.ts     │
│ (MCP Protocol)  │    │ (Koa REST API)  │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │      index.ts       │
         │  (Business Logic)   │
         │   Neo4jManager      │
         │   Core Functions    │
         └─────────────────────┘
                     │
                     ▼
         ┌─────────────────────┐
         │       Neo4j         │
         │     Database        │
         └─────────────────────┘
```

### File Structure Refactoring

#### 1. `index.ts` (Core Business Logic)
**Purpose**: Export all business logic functions and classes
**Size**: ~2000 lines (extracted from current implementation)

```typescript
// Core exports
export class Neo4jManager { /* existing implementation */ }

// Main business functions
export async function manageNodes(operation: string, nodes: NodeData[]): Promise<any>
export async function manageRelationships(operation: string, relationships: RelationshipData[]): Promise<any>
export async function generateDocuments(nodeIdentifiers: string[], options: DocumentGenerationOptions): Promise<any>
export async function exploreNeighborhoods(searchTerms: string[], options: ExploreOptions): Promise<any>
export async function findRelationshipPaths(nodePairs: NodePair[], options: PathOptions): Promise<any>
export async function manageTemplates(operation: string, templates: any[]): Promise<any>
export async function unsafeQuery(query: string, parameters: any): Promise<any>

// Utility functions
export async function initializeDatabase(): Promise<Neo4jManager>
export function validateInput(toolName: string, input: any): ValidationResult

// Type exports
export type { NodeData, RelationshipData, DocumentGenerationOptions, /* all other types */ }
```

#### 2. `mcp.ts` (MCP Protocol Handler)
**Purpose**: Handle MCP protocol specifics
**Size**: ~400 lines

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as core from './index.js';

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

// Tool definitions (moved from index.ts)
const TOOLS = [
  {
    name: "manage_nodes",
    description: "Create, update, or delete nodes in the knowledge graph...",
    inputSchema: { /* existing schema */ }
  },
  // ... all other tool definitions
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case "manage_nodes":
        return await core.manageNodes(args.operation, args.nodes);
      case "manage_relationships":
        return await core.manageRelationships(args.operation, args.relationships);
      // ... all other cases
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

async function main() {
  await core.initializeDatabase();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

#### 3. `server.ts` (Koa REST API)
**Purpose**: Provide REST API interface
**Size**: ~800 lines

```typescript
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import { koaSwagger } from 'koa2-swagger-ui';
import * as core from './index.js';

const app = new Koa();
const router = new Router({ prefix: '/api/v1' });

// Middleware
app.use(cors());
app.use(bodyParser());
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status = err.status || 500;
    ctx.body = { error: err.message };
  }
});

// Routes
router.post('/nodes', async (ctx) => {
  const result = await core.manageNodes('create', [ctx.request.body]);
  ctx.body = result;
});

router.put('/nodes/:id', async (ctx) => {
  const nodeData = { id: ctx.params.id, ...ctx.request.body };
  const result = await core.manageNodes('update', [nodeData]);
  ctx.body = result;
});

router.delete('/nodes/:id', async (ctx) => {
  const result = await core.manageNodes('delete', [{ id: ctx.params.id }]);
  ctx.body = result;
});

router.get('/nodes/:id', async (ctx) => {
  const result = await core.exploreNeighborhoods([ctx.params.id], {
    search_strategy: 'text',
    max_results_per_term: 1,
    neighborhood_depth: 0
  });
  ctx.body = result.neighborhoods[0] || null;
});

// ... all other routes

app.use(router.routes());
app.use(router.allowedMethods());

// Swagger documentation
app.use(koaSwagger({
  routePrefix: '/docs',
  swaggerOptions: {
    url: '/api/swagger.json'
  }
}));

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  await core.initializeDatabase();
  console.log(`REST API server running on port ${PORT}`);
});
```

## REST API Design

### Base URL
`http://localhost:3001/api/v1`

### Authentication
- **Development**: No authentication required
- **Production**: JWT-based authentication with configurable providers
- **Admin endpoints**: Require special admin role

### Endpoints

#### Node Management
```http
POST   /nodes                    # Create single node
POST   /nodes/batch              # Create multiple nodes
GET    /nodes/:id                # Get node details
PUT    /nodes/:id                # Update node
DELETE /nodes/:id                # Delete node
GET    /nodes                    # List nodes with pagination
```

#### Relationship Management
```http
POST   /relationships            # Create relationships
PUT    /relationships/:id        # Update relationship
DELETE /relationships/:id        # Delete relationship
GET    /relationships            # List relationships
```

#### Search & Exploration
```http
GET    /search                   # Basic search with query params
POST   /search/advanced          # Advanced search with JSON body
GET    /search/paths             # Find paths between nodes
GET    /nodes/:id/neighborhood   # Get node neighborhood
```

#### Document Generation
```http
GET    /nodes/:id/document       # Generate document for node
POST   /documents/generate       # Batch document generation
GET    /documents/:id            # Get cached document
```

#### Templates
```http
GET    /templates                # List all templates
POST   /templates                # Create template
GET    /templates/:id            # Get template
PUT    /templates/:id            # Update template
DELETE /templates/:id            # Delete template
```

#### Schema & Metadata
```http
GET    /schema/node-types         # Get available node types
GET    /schema/relationship-types # Get available relationship types
GET    /schema                    # Full schema information
GET    /stats                     # Database statistics
```

#### Admin & Debug
```http
POST   /admin/query              # Execute raw Cypher (admin only)
GET    /admin/health             # Health check
POST   /admin/reindex            # Rebuild vector indexes
```

### Request/Response Examples

#### Create Node
```http
POST /api/v1/nodes
Content-Type: application/json

{
  "name": "Frodo Baggins",
  "summary": "A hobbit from the Shire who becomes the Ring-bearer",
  "node_type": "Character",
  "properties": {
    "age": 50,
    "height": "3'6\"",
    "occupation": "Ring-bearer"
  },
  "relationships": [
    {
      "target_id": "Shire",
      "relationship_type": "LIVES_IN",
      "relevance_strength": "strong"
    }
  ]
}
```

#### Search Nodes
```http
GET /api/v1/search?q=Frodo&type=Character&limit=10&similarity=0.7

Response:
{
  "results": [
    {
      "id": "node-123",
      "name": "Frodo Baggins",
      "summary": "A hobbit from the Shire...",
      "node_type": "Character",
      "similarity_score": 0.95
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

#### Generate Document
```http
GET /api/v1/nodes/node-123/document?template=character_profile

Response:
{
  "content": "# Frodo Baggins\n\n## Summary\nA hobbit from the Shire...",
  "format": "markdown",
  "generated_at": "2025-01-01T12:00:00Z",
  "template_id": "character_profile"
}
```

## Docker Configuration

### Current Docker Setup
```yaml
# docker-compose.yml (current)
services:
  neo4j:
    image: neo4j:5.15
    # ... existing config
  
  graphrag-knowledge-mcp:
    build: .
    # ... existing config
```

### New Docker Setup
```yaml
# docker-compose.yml (new)
services:
  neo4j:
    image: neo4j:5.15
    # ... existing config
  
  graphrag-knowledge-mcp:
    build:
      context: .
      dockerfile: Dockerfile.mcp
    depends_on:
      - neo4j
    # ... existing config
  
  graphrag-knowledge-api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3001:3001"
    depends_on:
      - neo4j
    environment:
      - NODE_ENV=production
      - PORT=3001
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=password
```

### Dockerfile.mcp
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/index.js ./
COPY dist/mcp.js ./

CMD ["node", "mcp.js"]
```

### Dockerfile.api
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/index.js ./
COPY dist/server.js ./
COPY public/ ./public/

EXPOSE 3001
CMD ["node", "server.js"]
```

## Package.json Updates

### New Dependencies
```json
{
  "dependencies": {
    "@huggingface/transformers": "^3.4.0",
    "@modelcontextprotocol/sdk": "1.0.1",
    "mustache": "^4.2.0",
    "neo4j-driver": "^5.28.1",
    "typescript": "^5.6.2",
    
    // New REST API dependencies
    "koa": "^2.14.2",
    "@koa/router": "^12.0.1",
    "koa-bodyparser": "^4.4.1",
    "@koa/cors": "^4.0.0",
    "koa2-swagger-ui": "^5.10.0",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/mustache": "^4.2.5",
    "@types/node": "^22",
    "shx": "^0.3.4",
    "typescript": "^5.6.2",
    
    // New dev dependencies
    "@types/koa": "^2.13.12",
    "@types/koa__router": "^12.0.4",
    "@types/koa-bodyparser": "^4.3.12",
    "@types/koa__cors": "^4.0.0",
    "@types/jsonwebtoken": "^9.0.5"
  }
}
```

### Updated Scripts
```json
{
  "scripts": {
    "build": "tsc && shx chmod +x dist/*.js",
    "build:mcp": "tsc --build tsconfig.mcp.json",
    "build:api": "tsc --build tsconfig.api.json",
    "dev:mcp": "npm run build:mcp && node dist/mcp.js",
    "dev:api": "npm run build:api && node dist/server.js",
    "prepare": "npm run build",
    "watch": "tsc --watch",
    "test": "jest",
    "test:api": "jest --testPathPattern=api",
    "test:mcp": "jest --testPathPattern=mcp"
  }
}
```

## TypeScript Configuration

### tsconfig.json (base)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### tsconfig.mcp.json
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/index.ts", "src/mcp.ts", "src/types.d.ts"]
}
```

### tsconfig.api.json
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist"
  },
  "include": ["src/index.ts", "src/server.ts", "src/types.d.ts"]
}
```

## Error Handling Strategy

### MCP Error Handling
```typescript
// mcp.ts
try {
  const result = await core.manageNodes(args.operation, args.nodes);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }]
  };
} catch (error) {
  return {
    content: [{ type: "text", text: `Error: ${error.message}` }],
    isError: true
  };
}
```

### REST API Error Handling
```typescript
// server.ts
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    // Map business logic errors to HTTP status codes
    if (err.message.includes('not found')) {
      ctx.status = 404;
    } else if (err.message.includes('validation')) {
      ctx.status = 400;
    } else if (err.message.includes('unauthorized')) {
      ctx.status = 401;
    } else {
      ctx.status = 500;
    }
    
    ctx.body = {
      error: err.message,
      code: err.code || 'UNKNOWN_ERROR',
      timestamp: new Date().toISOString()
    };
  }
});
```

## Testing Strategy

### Unit Tests
```typescript
// tests/core.test.ts
import * as core from '../src/index';

describe('Core Business Logic', () => {
  test('manageNodes creates node successfully', async () => {
    const result = await core.manageNodes('create', [mockNodeData]);
    expect(result.results[0].status).toBe('success');
  });
});
```

### Integration Tests
```typescript
// tests/api.test.ts
import request from 'supertest';
import { app } from '../src/server';

describe('REST API', () => {
  test('POST /nodes creates node', async () => {
    const response = await request(app)
      .post('/api/v1/nodes')
      .send(mockNodeData)
      .expect(200);
    
    expect(response.body.results[0].status).toBe('success');
  });
});
```

### MCP Tests
```typescript
// tests/mcp.test.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('MCP Interface', () => {
  test('manage_nodes tool works correctly', async () => {
    const result = await client.request({
      method: 'tools/call',
      params: {
        name: 'manage_nodes',
        arguments: { operation: 'create', nodes: [mockNodeData] }
      }
    });
    
    expect(result.content[0].text).toContain('success');
  });
});
```

## Security Considerations

### Authentication
- JWT tokens for API access
- Role-based access control (user, admin)
- Rate limiting per user/IP
- API key support for service-to-service communication

### Input Validation
- Joi or Zod schemas for request validation
- Sanitize all user inputs
- Validate Cypher queries in unsafe_query endpoint
- File upload restrictions for import functionality

### CORS Configuration
```typescript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));
```

## Monitoring & Observability

### Logging
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

### Metrics
- Request/response times
- Error rates by endpoint
- Database query performance
- Vector search performance
- Memory usage and garbage collection

### Health Checks
```typescript
router.get('/health', async (ctx) => {
  const dbHealth = await core.checkDatabaseHealth();
  const vectorHealth = await core.checkVectorIndexHealth();
  
  ctx.body = {
    status: dbHealth && vectorHealth ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealth ? 'up' : 'down',
      vectorIndex: vectorHealth ? 'up' : 'down'
    }
  };
});
```

## Migration Plan

### Phase 1: Refactor Core Logic
1. Extract business logic from current `index.ts` to new structure
2. Create shared type definitions
3. Implement core function exports
4. Update existing MCP implementation to use new structure

### Phase 2: Implement REST API
1. Create Koa server with basic endpoints
2. Implement authentication middleware
3. Add comprehensive error handling
4. Create OpenAPI documentation

### Phase 3: Docker & Deployment
1. Create separate Dockerfiles
2. Update docker-compose.yml
3. Add environment configuration
4. Implement health checks

### Phase 4: Testing & Documentation
1. Write comprehensive test suites
2. Add API documentation
3. Create usage examples
4. Performance testing and optimization

## Performance Considerations

### Caching Strategy
- Redis for frequently accessed data
- In-memory caching for schema information
- Document generation caching (already implemented)

### Database Optimization
- Connection pooling (already implemented)
- Query optimization for REST endpoints
- Pagination for large result sets
- Async processing for bulk operations

### API Performance
- Response compression
- Request/response caching headers
- Streaming for large responses
- Background job processing for heavy operations

## Future Enhancements

### Web Dashboard
- React-based admin interface
- Graph visualization using D3.js or vis.js
- Real-time updates via WebSockets
- Bulk import/export functionality

### Advanced Features
- GraphQL endpoint for flexible queries
- Webhook support for external integrations
- Backup and restore functionality
- Multi-tenant support

### Scalability
- Horizontal scaling with load balancers
- Database clustering
- Microservice decomposition
- Event-driven architecture

This architecture provides a solid foundation for adding REST API capabilities while maintaining the existing MCP functionality and setting up for future enhancements.