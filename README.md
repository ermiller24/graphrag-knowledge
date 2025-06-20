# GraphRAG Knowledge MCP Server

A sophisticated Model Context Protocol (MCP) server that implements an intelligent knowledge graph using Neo4j with vector search capabilities, intelligent relationship resolution, and document generation.

## Overview

GraphRAG Knowledge is an advanced MCP server that provides tools for building, managing, and querying a flexible knowledge graph. It combines the power of graph databases (Neo4j) with vector embeddings to enable both semantic and structural search capabilities, intelligent node resolution, relationship validation, and **sophisticated document generation through customizable templates**.

The system's **templating engine** is a standout feature that transforms raw graph data into rich, navigable documents with automatic hyperlink generation between related nodes. This makes knowledge retrieval and exploration significantly more intuitive and user-friendly than traditional graph queries.

Unlike traditional hierarchical knowledge graphs, this system uses a flexible node-type system with intelligent validation and relationship constraints, making it suitable for complex domains like literature analysis, historical research, world-building, and any scenario requiring rich, interconnected knowledge representation.

## Knowledge Graph Architecture

### Core Node Structure

The knowledge graph uses a flexible schema where all content nodes are labeled as `:Node` with a `node_type` property that references predefined `NodeType` definitions. This approach provides both flexibility and validation.

#### Base Node Properties
- `id`: Unique identifier
- `name`: Human-readable name
- `summary`: Descriptive summary
- `node_type`: Reference to a NodeType definition
- `template_id`: Optional reference to a document template
- `created_date`: Creation timestamp
- `last_modified_date`: Last modification timestamp
- `is_placeholder`: Boolean indicating if node was auto-created
- Custom properties as defined by the node type

### Relationship System

The system includes intelligent relationship validation with predefined relationship types that specify:
- **Directionality**: source_to_target, bidirectional, or target_to_source
- **Valid source types**: Which node types can be the source of this relationship
- **Valid target types**: Which node types can be the target of this relationship
- **Aliases**: Alternative names for the same relationship type

### Vector Search Integration

Each node automatically receives vector embeddings generated from its name and summary using the `sentence-transformers/all-MiniLM-L6-v2` model (384 dimensions). This enables:

1. **Semantic Search**: Find nodes semantically similar to text queries
2. **Intelligent Node Resolution**: Automatically resolve node references by name or similarity
3. **Hybrid Search**: Combine vector similarity with graph structure traversal

### Document Generation System

The system includes a sophisticated document generation system using Mustache templates:

- **Templates**: Define how to generate rich, navigable documents from nodes
- **Hyperlinks**: Automatic generation of clickable links between related nodes using `[{{target.name}}](node://{{target.id}})` syntax
- **Dynamic Content**: Templates can include loops, conditionals, and custom Cypher queries
- **Caching**: Generated documents are cached with dependency tracking for efficient regeneration

## Setup and Installation

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for development)

### Quick Start

1. Clone the repository
2. Start the services:

```bash
make up
```

This will:
- Start a Neo4j database server (accessible at http://localhost:7474 with neo4j/password)
- Initialize the database schema with predefined node and relationship types
- Start the GraphRAG Knowledge MCP server

### Development Setup

```bash
npm install
npm run build
```

### Database Initialization

The database schema is automatically initialized with:
- Constraints and indexes for optimal performance
- Vector indexes for semantic search
- Predefined node types and relationship types
- Validation relationships between types

## MCP Tools Reference

The server exposes six powerful tools through the Model Context Protocol:

### 1. manage_nodes

Create, update, or delete nodes with intelligent relationship resolution.

**Create Operation:**
```json
{
  "operation": "create",
  "nodes": [
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
        },
        {
          "target_id": "Samwise Gamgee",
          "relationship_type": "FRIEND",
          "relevance_strength": "strong"
        }
      ]
    }
  ]
}
```

**Key Features:**
- **Intelligent Node Resolution**: Target nodes are resolved by exact name match, then vector similarity, creating placeholders if needed
- **Node Type Validation**: Validates node types against existing NodeType definitions
- **Relationship Validation**: Validates relationship types and directionality
- **Batch Processing**: Create multiple related nodes in a single operation
- **Intra-batch References**: Reference nodes being created in the same batch

**Update Operation:**
```json
{
  "operation": "update",
  "nodes": [
    {
      "id": "node-123",
      "properties": {
        "age": 51,
        "description": "Updated description"
      }
    }
  ]
}
```

**Delete Operation:**
```json
{
  "operation": "delete",
  "nodes": [
    {
      "id": "node-123"
    }
  ]
}
```

### 2. manage_relationships

Create, update, or delete relationships with intelligent node resolution and validation.

**Create Operation:**
```json
{
  "operation": "create",
  "relationships": [
    {
      "source_id": "Frodo Baggins",
      "target_id": "One Ring",
      "relationship_type": "CARRIES",
      "relevance_strength": "strong",
      "properties": {
        "duration": "17 years",
        "burden_level": "extreme"
      }
    }
  ]
}
```

**Key Features:**
- **Automatic Node Resolution**: Resolves node references by ID, exact name, or vector similarity
- **Relationship Type Validation**: Validates against predefined RelationshipType definitions
- **Directionality Checking**: Automatically reverses relationships if needed based on type definition
- **Placeholder Creation**: Creates placeholder nodes for unresolved references

### 3. generate_documents

Generate rich, templated documents for nodes with hyperlink navigation.

```json
{
  "node_identifiers": ["Frodo Baggins", "Gandalf"],
  "force_regenerate": false,
  "include_dependencies": true,
  "template_override": "character_detailed"
}
```

**Features:**
- **Template-based Generation**: Uses Mustache templates with custom Cypher queries
- **Hyperlink Navigation**: Generates clickable links between related nodes
- **Dependency Tracking**: Tracks which nodes a document depends on for cache invalidation
- **Fallback Content**: Provides informative content even when relationships are sparse

### 4. explore_neighborhoods

Explore neighborhoods around search terms with intelligent deduplication and filtering.

**Knowledge Content Exploration:**
```json
{
  "search_terms": ["Frodo", "Ring"],
  "search_strategy": "combined",
  "max_results_per_term": 10,
  "neighborhood_depth": 2,
  "min_similarity_threshold": 0.7,
  "include_relationship_types": true,
  "deduplicate_nodes": true
}
```

**Schema Exploration:**
```json
{
  "search_terms": ["Character", "FRIEND"],
  "schema_mode": true,
  "include_relationship_types": true
}
```

**Key Features:**
- **Multiple Search Strategies**: Vector, text, or combined search
- **Neighborhood Traversal**: Explore connected nodes at specified depths
- **Schema Mode**: Explore NodeType and RelationshipType definitions
- **Intelligent Deduplication**: Remove duplicate nodes and relationships
- **Relationship Analysis**: Include relationship type statistics and patterns

### 5. find_relationship_paths

Find paths between nodes with strength calculations and narrative generation.

```json
{
  "node_pairs": [
    {
      "source": "Frodo Baggins",
      "target": "Mount Doom"
    }
  ],
  "max_path_length": 5,
  "min_strength_threshold": 0.3,
  "max_paths_per_pair": 3,
  "include_path_narratives": true
}
```

**Features:**
- **Path Strength Calculation**: Calculates path strength based on relationship strengths and length
- **Narrative Generation**: Generates human-readable descriptions of paths
- **Multiple Path Discovery**: Finds multiple paths between node pairs
- **Strength Filtering**: Filter paths by minimum strength threshold

### 6. manage_templates

Create, update, delete, or list document templates for rich knowledge documents.

**Create Template:**
```json
{
  "operation": "create",
  "templates": [
    {
      "id": "character_profile",
      "name": "Character Profile",
      "description": "Detailed character profile with relationships",
      "structure": "# {{name}}\n\n## Summary\n{{summary}}\n\n## Friends\n{{#friend_relationships}}\n- **{{relationship_type}}**: [{{target.name}}](node://{{target.id}}) - {{target.summary}}\n{{/friend_relationships}}\n{{^friend_relationships}}\n*No friends recorded*\n{{/friend_relationships}}",
      "variables": {
        "friend_relationships": "MATCH (n)-[r:FRIEND]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target"
      }
    }
  ]
}
```

**Template Best Practices:**
- Use `[{{target.name}}](node://{{target.id}})` for hyperlinks
- Return complete node objects in Cypher queries, not just properties
- Use Mustache sections for loops and conditionals
- Structure variables by relationship type for better organization
- Include fallback content for empty relationships

### 7. unsafe_query

Execute raw Cypher queries for debugging and advanced operations.

```json
{
  "query": "MATCH (n:Node)-[r]->(m:Node) WHERE n.node_type = 'Character' RETURN n.name, type(r), m.name LIMIT 10",
  "parameters": {}
}
```

**⚠️ Warning**: This tool can modify or delete data. Use carefully and only for debugging purposes.

## REST API Reference

In addition to the MCP interface, GraphRAG Knowledge provides a comprehensive REST API that exposes all MCP tools through HTTP endpoints. This allows integration with web applications, mobile apps, and any system that can make HTTP requests.

### Quick Start

Start the REST API server alongside the MCP server:

```bash
# Start both MCP and REST API services
make start-all

# Or start just the REST API
make start-api
```

The REST API will be available at `http://localhost:3001` with the following endpoints:

### API Endpoints Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check endpoint |
| `/api/v1/docs` | GET | API documentation |
| `/api/v1/tools` | GET | List all available tools |
| `/api/v1/nodes` | POST | Create nodes |
| `/api/v1/nodes/{id}` | PUT | Update node |
| `/api/v1/nodes/{id}` | DELETE | Delete node |
| `/api/v1/relationships` | POST | Create relationships |
| `/api/v1/relationships/{id}` | PUT | Update relationship |
| `/api/v1/relationships/{id}` | DELETE | Delete relationship |
| `/api/v1/documents/generate` | POST | Generate documents |
| `/api/v1/explore` | POST | Explore neighborhoods |
| `/api/v1/paths` | POST | Find relationship paths |
| `/api/v1/templates` | GET/POST/PUT/DELETE | Manage templates |
| `/api/v1/query` | POST | Execute raw Cypher queries |

### Authentication and CORS

The REST API currently operates without authentication for development purposes. CORS is enabled for all origins to facilitate frontend development.

**⚠️ Production Note**: Implement proper authentication and restrict CORS origins before deploying to production.

### Node Management Endpoints

#### Create Nodes
```http
POST /api/v1/nodes
Content-Type: application/json

{
  "nodes": [
    {
      "name": "Aragorn",
      "summary": "Ranger of the North, heir to the throne of Gondor",
      "node_type": "Character",
      "properties": {
        "age": 87,
        "height": "6'6\"",
        "occupation": "King of Gondor"
      },
      "relationships": [
        {
          "target_id": "Gondor",
          "relationship_type": "RULES",
          "relevance_strength": "strong"
        }
      ]
    }
  ]
}
```

#### Update Node
```http
PUT /api/v1/nodes/{nodeId}
Content-Type: application/json

{
  "properties": {
    "age": 88,
    "description": "Updated description"
  }
}
```

#### Delete Node
```http
DELETE /api/v1/nodes/{nodeId}
```

### Relationship Management Endpoints

#### Create Relationships
```http
POST /api/v1/relationships
Content-Type: application/json

{
  "relationships": [
    {
      "source_id": "Aragorn",
      "target_id": "Arwen",
      "relationship_type": "MARRIED_TO",
      "relevance_strength": "strong",
      "properties": {
        "marriage_date": "Fourth Age 1"
      }
    }
  ]
}
```

#### Update Relationship
```http
PUT /api/v1/relationships/{relationshipId}
Content-Type: application/json

{
  "properties": {
    "status": "active",
    "notes": "Updated relationship notes"
  }
}
```

#### Delete Relationship
```http
DELETE /api/v1/relationships/{relationshipId}
```

### Document Generation Endpoint

#### Generate Documents
```http
POST /api/v1/documents/generate
Content-Type: application/json

{
  "node_identifiers": ["Aragorn", "Frodo Baggins"],
  "force_regenerate": false,
  "include_dependencies": true,
  "template_override": "character_detailed"
}
```

**Response:**
```json
{
  "success": true,
  "documents": [
    {
      "node_id": "node-123",
      "node_name": "Aragorn",
      "content": "# Aragorn\n\n## Summary\nRanger of the North...",
      "template_used": "character_profile",
      "generated_at": "2024-01-15T10:30:00Z",
      "dependencies": ["node-456", "node-789"]
    }
  ]
}
```

### Exploration Endpoint

#### Explore Neighborhoods
```http
POST /api/v1/explore
Content-Type: application/json

{
  "search_terms": ["Aragorn", "Gondor"],
  "search_strategy": "combined",
  "max_results_per_term": 10,
  "neighborhood_depth": 2,
  "min_similarity_threshold": 0.7,
  "include_relationship_types": true,
  "deduplicate_nodes": true,
  "schema_mode": false
}
```

### Path Finding Endpoint

#### Find Relationship Paths
```http
POST /api/v1/paths
Content-Type: application/json

{
  "node_pairs": [
    {
      "source": "Frodo Baggins",
      "target": "Mount Doom"
    }
  ],
  "max_path_length": 5,
  "min_strength_threshold": 0.3,
  "max_paths_per_pair": 3,
  "include_path_narratives": true
}
```

### Template Management Endpoints

#### List Templates
```http
GET /api/v1/templates
```

#### Create Template
```http
POST /api/v1/templates
Content-Type: application/json

{
  "templates": [
    {
      "id": "location_profile",
      "name": "Location Profile",
      "description": "Detailed location profile with inhabitants and features",
      "structure": "# {{name}}\n\n## Summary\n{{summary}}\n\n## Inhabitants\n{{#inhabitants}}\n- [{{target.name}}](node://{{target.id}})\n{{/inhabitants}}",
      "variables": {
        "inhabitants": "MATCH (n)<-[r:LIVES_IN]-(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target"
      }
    }
  ]
}
```

#### Update Template
```http
PUT /api/v1/templates/{templateId}
Content-Type: application/json

{
  "name": "Updated Template Name",
  "description": "Updated description",
  "structure": "Updated template structure..."
}
```

#### Delete Template
```http
DELETE /api/v1/templates/{templateId}
```

### Raw Query Endpoint

#### Execute Cypher Query
```http
POST /api/v1/query
Content-Type: application/json

{
  "query": "MATCH (n:Node)-[r]->(m:Node) WHERE n.node_type = 'Character' RETURN n.name, type(r), m.name LIMIT 10",
  "parameters": {
    "limit": 10
  }
}
```

**⚠️ Warning**: The query endpoint can modify or delete data. Use carefully and only for debugging purposes.

### Error Handling

The REST API uses standard HTTP status codes and returns consistent error responses:

```json
{
  "success": false,
  "error": "Error message description",
  "details": {
    "code": "VALIDATION_ERROR",
    "field": "node_type",
    "message": "Node type 'InvalidType' not found"
  }
}
```

**Common HTTP Status Codes:**
- `200 OK`: Successful operation
- `201 Created`: Resource created successfully
- `400 Bad Request`: Invalid request data
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

### API Testing

Test the API health endpoint:
```bash
make test-api
# or
curl http://localhost:3001/health
```

### Development Commands

```bash
# Start REST API only
make start-api

# Stop REST API
make stop-api

# View REST API logs
make logs-api

# Restart REST API (after code changes)
make api-restart

# Start both MCP and REST API
make start-all
```

### Integration Examples

#### JavaScript/Node.js
```javascript
const axios = require('axios');

// Create a character
const response = await axios.post('http://localhost:3001/api/v1/nodes', {
  nodes: [{
    name: 'Legolas',
    summary: 'Elven archer from Mirkwood',
    node_type: 'Character',
    properties: {
      age: 2931,
      race: 'Elf'
    }
  }]
});

console.log('Created node:', response.data.nodes[0]);
```

#### Python
```python
import requests

# Explore neighborhoods
response = requests.post('http://localhost:3001/api/v1/explore', json={
    'search_terms': ['Frodo'],
    'search_strategy': 'combined',
    'neighborhood_depth': 2
})

data = response.json()
print(f"Found {len(data['neighborhoods'])} neighborhoods")
```

#### cURL
```bash
# Generate documents
curl -X POST http://localhost:3001/api/v1/documents/generate \
  -H "Content-Type: application/json" \
  -d '{"node_identifiers": ["Frodo Baggins"]}'
```

The REST API provides the same powerful functionality as the MCP interface but through familiar HTTP endpoints, making it easy to integrate GraphRAG Knowledge into any application or workflow.

## Data Modeling Guidelines

### Properties vs. Relationships

**Use PROPERTIES for:**
- Measures and specific attributes unique to an entity
- Scalar values: age, height, dates, descriptions, quotes
- Data that doesn't need to be shared or referenced by other nodes

**Use RELATIONSHIPS for:**
- Dimensional attributes that could be shared across entities
- Categories that other nodes might also belong to
- Connections that represent meaningful associations

**Example:**
```json
// Good: Use relationship for race (dimensional attribute)
{
  "name": "Gimli",
  "node_type": "Character",
  "properties": {
    "age": 139,
    "height": "4'5\"",
    "description": "Dwarf warrior of Erebor"
  },
  "relationships": [
    {
      "target_id": "Dwarf",
      "relationship_type": "RACE"
    }
  ]
}

// Avoid: Don't use property for race
{
  "properties": {
    "race": "Dwarf"  // This should be a relationship
  }
}
```

### Workflow Recommendations

1. **Start with Schema Exploration**: Use `explore_neighborhoods` with `schema_mode=true` to understand available NodeTypes and RelationshipTypes

2. **Create Missing Schema Definitions**: If you need new node or relationship types, create them first

3. **Build Knowledge Incrementally**: Start with core entities, then add relationships and details

4. **Use Batch Operations**: Create related nodes together using intra-batch references

5. **Leverage Templates**: Create templates for consistent document generation

## Technical Implementation

### Architecture

- **Database**: Neo4j 5.x with vector search capabilities
- **Embeddings**: Hugging Face Transformers (`sentence-transformers/all-MiniLM-L6-v2`, 384 dimensions)
- **Protocol**: Model Context Protocol (MCP) 1.0.1
- **Language**: TypeScript with Node.js
- **Templating**: Mustache for document generation

### Performance Features

- **Vector Indexes**: Optimized cosine similarity search
- **Database Constraints**: Unique constraints on IDs and names
- **Batch Processing**: Efficient bulk operations with transaction management
- **Caching**: Document caching with dependency tracking
- **Connection Pooling**: Efficient Neo4j driver connection management

### Development Commands

```bash
# Build the project
make build

# Start services
make up

# Stop services
make down

# Restart MCP server (after code changes)
make redeploy

# View logs
make logs

# Access Neo4j browser
open http://localhost:7474
```

## Use Cases

### Literature and Storytelling
- Character relationship mapping
- World-building and lore management
- Plot and narrative structure analysis
- Cross-reference tracking

### Research and Knowledge Management
- Academic research organization
- Historical event and figure tracking
- Concept relationship mapping
- Source and citation management

### Business and Organizational Knowledge
- Stakeholder relationship mapping
- Process and workflow documentation
- Institutional knowledge capture
- Decision tree and dependency tracking

## License

GNU General Public License

## Author

Eir Miller

---

*This MCP server is designed to work seamlessly with AI assistants that support the Model Context Protocol, providing them with powerful knowledge graph capabilities for complex reasoning and information management tasks.*