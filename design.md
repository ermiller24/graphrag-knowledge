# GraphRAG Knowledge MCP Server Design Document

## Overview

This document specifies the complete design for a Model Context Protocol (MCP) server that implements a knowledge graph with templates, document caching, and vector indexing. The system combines Neo4j graph database capabilities with intelligent document generation and semantic search.

## Architecture

### Core Components

1. **Neo4j Graph Database**: Stores nodes, relationships, templates, cached documents, and vector indices
2. **MCP Server**: Provides tools for LLM interaction via Model Context Protocol
3. **Vector Embedding Pipeline**: Generates semantic embeddings using Hugging Face transformers
4. **Template Engine**: Mustache-based document generation from graph data
5. **Caching System**: Timestamp-based cache invalidation for efficient document retrieval

### Technology Stack

- **Runtime**: Node.js with TypeScript
- **Database**: Neo4j 2025.02.0
- **MCP SDK**: @modelcontextprotocol/sdk v1.0.1
- **Vector Embeddings**: @huggingface/transformers v3.4.0 (sentence-transformers/all-MiniLM-L6-v2)
- **Template Engine**: Mustache (to be added)
- **Containerization**: Docker with docker-compose

## Graph Schema

### Node Types

#### Standard Node
All standard nodes share these required properties:
```cypher
CREATE (n:Node {
  id: "unique-identifier",           // Required: Unique identifier
  name: "Node Name",                 // Required: Human-readable name
  summary: "Brief description",      // Required: Short summary
  created_date: timestamp(),         // Required: Creation timestamp
  last_modified_date: timestamp(),   // Required: Last modification timestamp
  // Additional arbitrary properties as needed
})
```

#### Template Node
```cypher
CREATE (t:Template {
  id: "template-identifier",
  name: "Template Name",
  description: "Template description",
  structure: "# {{name}}\n\n{{summary}}\n\n## Properties\n\n{{properties}}\n\n## Relationships\n\n{{relationships}}",
  variables: {
    residences: "MATCH (n)-[r:RESIDED_AT]->(loc:Location) RETURN loc.name as location, r.start_date as start_date ORDER BY r.start_date",
    collaborators: "MATCH (n)-[r:COLLABORATED_WITH]->(p:Person) RETURN p.name as name, r.projects as projects, r.when as when ORDER BY r.when",
    influences: "MATCH (n)-[r:INFLUENCED_BY]->(p:Person) RETURN p.name as name, r.strength as strength, p.summary as work_type"
  },
  created_date: timestamp(),
  last_modified_date: timestamp()
})
```

The `variables` property contains a dictionary where each key is a variable name used in the template, and each value is a Cypher query that will be executed to populate that variable. The query results are provided to the template engine as JSON.

#### Cached Document Node
```cypher
CREATE (c:CachedDocument {
  id: "cache-identifier",
  content: "Generated document content...",
  generated_at: timestamp(),
  dependency_signature: "hash-of-dependencies",
  is_valid: true
})
```

#### Vector Index Node
```cypher
CREATE (v:VectorIndex {
  id: "vector-index-identifier",
  embedding: [0.1, 0.2, ...],        // Vector embedding (384 dimensions)
  model: "sentence-transformers/all-MiniLM-L6-v2",
  dimension: 384,
  indexed_at: timestamp()
})
```

#### Relationship Type Node
```cypher
CREATE (r:RelationshipType {
  name: "RELATIONSHIP_NAME",
  description: "Description of what this relationship means",
  source_types: ["Node", "SpecificNodeLabel"],
  target_types: ["Node", "SpecificNodeLabel"],
  directionality: "balanced"                    // Options: "balanced", "weak", "strong"
})
```

**Note**: `directionality` is a property of the relationship type, while `relevance_strength` is a property of individual relationship instances. All relationships are defined to flow from the entity where the relationship is more important to the entity where it's less important. For example, `CHILD_OF` would be a valid relationship, as the parent-child relationship is more important to understanding the child entity than the parent; `PARENT_OF` would not be a valid relationship.

### Relationship Types

#### Special Relationships
- `USES_TEMPLATE`: Connects nodes to their templates
- `CACHED_AT`: Connects nodes to their cached documents
- `VECTOR_INDEXED_AT`: Connects nodes to their vector indices
- `DEPENDS_ON`: Tracks dependencies for cached documents

#### Domain-Specific Relationships
Use specific relationship types directly (e.g., `CHILD_OF`, `INFLUENCED_BY`, `PERFORMED_AT`) rather than generic relationships with type properties.

### Relationship Direction and Strength System

**Relationship Direction Standard**: All relationships flow from the entity where the relationship is more semantically important to the entity where it's less important. This eliminates redundancy by having only one relationship type instead of pairs like CHILD_OF/PARENT_OF.

**Examples of Proper Direction**:
- `CHILD_OF`: Person → Person (being someone's child is more defining than being someone's parent)
- `INFLUENCED_BY`: Artist → Artist (being influenced is more defining than being an influencer)
- `EMPLOYED_BY`: Person → Company (employment is more defining for the person)
- `LOCATED_IN`: Building → City (location is more defining for the building)
- `COLLABORATED_WITH`: Balanced relationship (equally important to both parties)

**Relevance Strength** (property of individual relationships - how meaningful this specific relationship instance is):
- `weak` = 0.2 (e.g., a minor collaboration, distant influence)
- `medium` = 0.6 (e.g., a standard professional relationship)
- `strong` = 1.0 (e.g., a career-defining collaboration, major influence)

**Directionality** (property of relationship types - how much the relationship matters in each direction):
- `strong` = [1.0, 0.2] (relationship is much more important for source than target)
- `weak` = [0.8, 0.6] (relationship is somewhat more important for source)
- `balanced` = [0.7, 0.7] (relationship is equally important in both directions)

**Examples**:
- `CHILD_OF` has `directionality: "strong"` (being someone's child is very important for understanding the child, less so for the parent)
- `INFLUENCED_BY` has `directionality: "weak"` (being influenced matters more for the influenced, but influences also help define the influencer)
- `COLLABORATED_WITH` has `directionality: "balanced"` (collaborations are equally important for understanding both parties)

**Relationship Direction Standard Benefits**:
1. **Eliminates Redundancy**: Instead of having both CHILD_OF and PARENT_OF, we only need CHILD_OF
2. **Consistent Semantics**: All relationships flow from the entity where the relationship is more defining
3. **Simplified Queries**: No need to check multiple relationship types for the same semantic relationship
4. **Clearer Intent**: The direction immediately indicates which entity the relationship is more important for

**Migration from Bidirectional Systems**:
- `PARENT_OF` → Use `CHILD_OF` with `direction: "reverse"`
- `EMPLOYER_OF` → Use `EMPLOYED_BY` with `direction: "reverse"`
- `CONTAINS` → Use `LOCATED_IN` with `direction: "reverse"`

## MCP Tools Specification

### 1. Node Management Tool

**Tool Name**: `manage_nodes`

**Purpose**: Create, modify, or delete nodes in the knowledge graph

**Parameters**:
```typescript
{
  operation: "create" | "update" | "delete",
  nodes: Array<{
    id?: string,                    // Required for update/delete
    name: string,                   // Required for create/update
    summary: string,                // Required for create/update
    node_type?: string,             // Optional: specific node label
    template_id?: string,           // Optional: template to use
    properties?: {[key: string]: any}, // Additional properties
    relationships?: Array<{         // Optional: relationships to create
      target_id: string,
      relationship_type: string,
      direction?: "forward" | "reverse", // Optional: direction of relationship (default: "forward")
      relevance_strength?: "weak" | "medium" | "strong", // Strength of this specific relationship instance
      properties?: {[key: string]: any}
    }>
  }>
}
```

**Response**:
```typescript
{
  results: Array<{
    node_id: string,
    operation: string,
    status: "success" | "error",
    message?: string,
    created_relationships?: number
  }>
}
```

**Relationship Direction Explanation**:
- `direction: "forward"` (default): Creates relationship from the node being created to the target_id
- `direction: "reverse"`: Creates relationship from the target_id to the node being created

**Example**: When creating a "Miles Davis" node with a relationship to "Charlie Parker":
```typescript
{
  operation: "create",
  nodes: [{
    name: "Miles Davis",
    summary: "American jazz trumpeter",
    relationships: [
      {
        target_id: "charlie-parker-123",
        relationship_type: "INFLUENCED_BY",
        direction: "forward",  // Creates: Miles Davis -[INFLUENCED_BY]-> Charlie Parker
        relevance_strength: "strong"
      }
    ]
  }]
}
```

If you wanted to create the reverse relationship (Charlie Parker influenced by Miles Davis), you would use `direction: "reverse"`.

### 2. Relationship Management Tool

**Tool Name**: `manage_relationships`

**Purpose**: Create, modify, or delete relationships between nodes

**Parameters**:
```typescript
{
  operation: "create" | "update" | "delete",
  relationships: Array<{
    id?: string,                    // Required for update/delete
    source_id: string,              // Required for create
    target_id: string,              // Required for create
    relationship_type: string,      // Required for create/update
    direction?: "forward" | "reverse", // Optional: direction of relationship (default: "forward")
    relevance_strength?: "weak" | "medium" | "strong", // Strength of this specific relationship instance
    properties?: {[key: string]: any} // Relationship properties
  }>
}
```

**Response**:
```typescript
{
  results: Array<{
    relationship_id: string,
    operation: string,
    status: "success" | "error",
    message?: string
  }>
}
```

### 3. Document Generation Tool

**Tool Name**: `generate_documents`

**Purpose**: Generate templated documents for nodes

**Parameters**:
```typescript
{
  node_identifiers: string[],      // Node IDs or names to generate documents for
  force_regenerate?: boolean,      // Skip cache and regenerate
  include_dependencies?: boolean,  // Include dependency information
  template_override?: string       // Use specific template instead of node's default
}
```

**Response**:
```typescript
{
  documents: Array<{
    node_id: string,
    node_name: string,
    content: string,
    generated_at: number,
    from_cache: boolean,
    dependencies: string[],        // IDs of nodes this document depends on
    template_used: string
  }>
}
```

### 4. Neighborhood Explorer Tool

**Tool Name**: `explore_neighborhoods`

**Purpose**: Discover existing graph structure around search terms before adding new information

**Parameters**:
```typescript
{
  search_terms: string[],          // Keywords or phrases to search for
  search_strategy: "vector" | "text" | "combined",
  max_results_per_term: number,    // Default: 3
  neighborhood_depth: number,      // Default: 2
  include_relationship_types: boolean, // Default: true
  include_templates: boolean       // Default: true
}
```

**Response**:
```typescript
{
  neighborhoods: {
    [search_term: string]: {
      primary_nodes: Array<{
        id: string,
        name: string,
        type: string,
        summary: string,
        similarity_score: number
      }>,
      relationships: Array<{
        type: string,
        source: string,
        target: string,
        target_name: string,
        properties?: {[key: string]: any}
      }>,
      nearby_nodes: Array<{
        id: string,
        name: string,
        distance: number,
        path: string
      }>,
      common_relationship_types: string[],
      templates_in_use: string[]
    }
  },
  recommendations: {
    suggested_parents: Array<{
      node_id: string,
      node_name: string,
      confidence: number
    }>,
    suggested_relationship_types: string[],
    missing_intermediate_nodes: string[]
  }
}
```

### 5. Path Finder Tool

**Tool Name**: `find_relationship_paths`

**Purpose**: Discover meaningful relationships between existing nodes using self-describing graph metadata

**Parameters**:
```typescript
{
  node_pairs: Array<{
    source_node_id: string,
    target_node_id: string
  }>,
  max_path_length: number,         // Default: 4
  max_paths_per_pair: number,      // Default: 5
  min_path_strength: number        // Default: 0.3
}
```

**Response**:
```typescript
{
  path_results: Array<{
    source_node_id: string,
    target_node_id: string,
    paths: Array<{
      path_id: number,
      length: number,
      strength: number,
      nodes: Array<{
        id: string,
        name: string
      }>,
      relationships: Array<{
        type: string,
        direction: "forward" | "backward",
        edge_strength: number,
        source: string,
        target: string,
        properties?: {[key: string]: any}
      }>,
      narrative: string,
      strength_breakdown: {
        raw_strength: number,
        length_penalty: number,
        final_strength: number
      }
    }>,
    summary: {
      total_paths_found: number,
      paths_returned: number,
      strongest_path_strength: number,
      average_path_strength: number,
      relationship_types_used: string[]
    }
  }>
}
```

### 6. Template Management Tool (Optional)

**Tool Name**: `manage_templates`

**Purpose**: Create and manage document templates

**Parameters**:
```typescript
{
  operation: "create" | "update" | "delete" | "list",
  templates?: Array<{
    id?: string,                    // Required for update/delete
    name: string,                   // Required for create/update
    description: string,            // Required for create/update
    structure: string,              // Mustache template string
    node_types: string[]            // Node types this template applies to
  }>
}
```

## Implementation Details

### Project Structure
```
work/graphrag-knowledge/
├── src/
│   ├── index.ts                 // Main MCP server
│   ├── neo4j-manager.ts         // Database operations
│   ├── template-engine.ts       // Mustache template processing
│   ├── vector-search.ts         // Embedding and search logic
│   ├── path-finder.ts           // Path finding algorithm
│   └── types.ts                 // TypeScript type definitions
├── scripts/
│   └── init-schema.ts           // Schema initialization script
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── README.md
```

### Database Schema Initialization

**Important**: Schema initialization must be handled by a separate script, not during MCP server startup. The MCP uses `docker run` to execute commands, so any startup script would run on every LLM query.

**Schema Initialization Script** (`scripts/init-schema.ts`):
```typescript
// Separate script to run once after Neo4j startup
// Creates indexes, constraints, and initial relationship types
// Run with: docker exec graphrag-knowledge-mcp node scripts/init-schema.js
```

### Required Indexes
```cypher
// Node indexes
CREATE INDEX node_id FOR (n:Node) ON (n.id);
CREATE INDEX node_last_modified FOR (n:Node) ON (n.last_modified_date);
CREATE INDEX template_id FOR (t:Template) ON (t.id);
CREATE INDEX cached_document_id FOR (c:CachedDocument) ON (c.id);
CREATE INDEX relationship_type_name FOR (r:RelationshipType) ON (r.name);

// Vector indexes for semantic search
CREATE VECTOR INDEX node_embedding_idx FOR (n:Node) ON (n.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 384,
    `vector.similarity_function`: 'cosine'
  }
};
```

### Template Engine Implementation

Use Mustache for template processing with these features:
- Variable substitution: `{{name}}`, `{{summary}}`
- Conditional sections: `{{#has_relationships}}...{{/has_relationships}}`
- Loops: `{{#relationships}}...{{/relationships}}`
- Partials for reusable template components

**Template Variable System**:
Each template defines variables using Cypher queries. When rendering a template:

1. **Execute Variable Queries**: For each variable in the template's `variables` dictionary, execute the Cypher query with the target node as context
2. **Convert to JSON**: Query results are converted to JSON format
3. **Provide to Template Engine**: The JSON data is made available to Mustache under the variable name

**Example Template Variable Definitions**:
```typescript
// Template variables dictionary
{
  "residences": "MATCH (n)-[r:RESIDED_AT]->(loc:Location) RETURN loc.name as location, r.start_date as start_date ORDER BY r.start_date",
  "collaborators": "MATCH (n)-[r:COLLABORATED_WITH]->(p:Person) RETURN p.name as name, r.projects as projects, r.when as when ORDER BY r.when",
  "influences": "MATCH (n)-[r:INFLUENCED_BY]->(p:Person) RETURN p.name as name, r.strength as strength, p.summary as work_type"
}
```

**Template Data Structure**:
```typescript
interface TemplateData {
  // Basic node properties
  name: string;
  summary: string;
  [key: string]: any;
  
  // Dynamic variables populated from Cypher queries
  residences?: Array<{
    location: string;
    start_date: string;
  }>;
  collaborators?: Array<{
    name: string;
    projects: string[];
    when: string;
  }>;
  influences?: Array<{
    name: string;
    strength: string;
    work_type: string;
  }>;
  
  // Conditional flags (auto-generated based on data presence)
  has_residences: boolean;
  has_collaborators: boolean;
  has_influences: boolean;
}
```

**Template Processing Algorithm**:
```typescript
async function processTemplate(nodeId: string, template: Template): Promise<string> {
  const templateData: any = {};
  
  // 1. Get basic node properties
  const node = await getNode(nodeId);
  templateData.name = node.name;
  templateData.summary = node.summary;
  // ... other basic properties
  
  // 2. Execute variable queries
  for (const [varName, query] of Object.entries(template.variables)) {
    const result = await session.run(query, { n: node });
    templateData[varName] = result.records.map(record => record.toObject());
    
    // Auto-generate conditional flags
    templateData[`has_${varName}`] = templateData[varName].length > 0;
  }
  
  // 3. Render template with Mustache
  return Mustache.render(template.structure, templateData);
}
```

**Example Template with Cypher Variables**:
```cypher
// Create a template for historical persons
CREATE (t:Template {
  id: "historical-person-template",
  name: "Historical Person Template",
  description: "Template for historical persons with dynamic data",
  structure: "# {{name}} ({{birth_year}}-{{death_year}})\n\n{{summary}}\n\n{{#has_residences}}## Places Lived\n{{#residences}}* {{location}} (from {{start_date}})\n{{/residences}}{{/has_residences}}\n\n{{#has_collaborators}}## Collaborations\n{{#collaborators}}* Collaborated with {{name}} {{when}} on {{projects}}\n{{/collaborators}}{{/has_collaborators}}\n\n{{#has_influences}}## Influences\n{{#influences}}* {{#strength}}Strongly{{/strength}}{{^strength}}Moderately{{/strength}} influenced by {{name}}'s {{work_type}}\n{{/influences}}{{/has_influences}}",
  variables: {
    residences: "MATCH (n)-[r:RESIDED_AT]->(loc:Location) RETURN loc.name as location, r.start_date as start_date ORDER BY r.start_date",
    collaborators: "MATCH (n)-[r:COLLABORATED_WITH]->(p:Person) WHERE r.relevance_strength IN ['medium', 'strong'] RETURN p.name as name, r.projects as projects, r.when as when ORDER BY r.when",
    influences: "MATCH (n)-[r:INFLUENCED_BY]->(p:Person) RETURN p.name as name, CASE WHEN r.relevance_strength = 'strong' THEN true ELSE false END as strength, p.summary as work_type ORDER BY r.relevance_strength DESC"
  },
  created_date: timestamp(),
  last_modified_date: timestamp()
})
```

**Generated Document Example**:
When processing this template for "Charlie Parker", the system would:

1. Execute the `residences` query: Returns `[{location: "Kansas City", start_date: "1930"}, {location: "New York", start_date: "1939"}]`
2. Execute the `collaborators` query: Returns `[{name: "Miles Davis", projects: ["Recordings"], when: "1945-1948"}]`
3. Execute the `influences` query: Returns `[{name: "Lester Young", strength: true, work_type: "Jazz saxophonist"}]`
4. Set conditional flags: `has_residences: true`, `has_collaborators: true`, `has_influences: true`
5. Render the Mustache template with this data

**Resulting Document**:
```
# Charlie Parker (1920-1955)

American jazz saxophonist and composer

## Places Lived
* Kansas City (from 1930)
* New York (from 1939)

## Collaborations
* Collaborated with Miles Davis 1945-1948 on Recordings

## Influences
* Strongly influenced by Lester Young's Jazz saxophonist
```

### Cache Management

**Cache Validation Algorithm**:
```typescript
async function validateCache(nodeId: string): Promise<boolean> {
  // Check if cached document exists and is valid
  const cacheQuery = `
    MATCH (n:Node {id: $nodeId})-[:CACHED_AT]->(c:CachedDocument)
    WHERE c.is_valid = true
    AND NOT EXISTS {
      MATCH (c)-[:DEPENDS_ON]->(dep:Node)
      WHERE dep.last_modified_date > c.generated_at
      LIMIT 1
    }
    RETURN c.content
  `;
  
  const result = await session.run(cacheQuery, { nodeId });
  return result.records.length > 0;
}
```

### Path Strength Calculation

**Algorithm Implementation**:
```typescript
async function calculatePathStrength(path: Path): Promise<number> {
  // 1. Load relationship type metadata (directionality) and individual relationship strengths
  const relationshipTypeWeights = await getRelationshipTypeWeights();
  
  // 2. Calculate cumulative path strength
  let pathStrength = 1.0;
  
  for (let i = 0; i < path.relationships.length; i++) {
    const rel = path.relationships[i];
    const sourceNode = path.nodes[i];
    const targetNode = path.nodes[i + 1];
    
    // Get directionality from RelationshipType node
    const relTypeWeight = relationshipTypeWeights[rel.type];
    const isForward = rel.startNode === sourceNode;
    const directionalWeight = isForward ? relTypeWeight.forward_weight : relTypeWeight.backward_weight;
    
    // Get relevance strength from individual relationship instance
    const relevanceStrength = rel.properties.relevance_strength || "medium";
    const strengthValue = relevanceStrength === "strong" ? 1.0 :
                         relevanceStrength === "medium" ? 0.6 : 0.2;
    
    pathStrength *= (strengthValue * directionalWeight);
  }
  
  // 3. Apply length penalty
  const adjustedStrength = pathStrength * (1.0 / path.length);
  
  return adjustedStrength;
}

async function getRelationshipTypeWeights(): Promise<{[type: string]: any}> {
  const query = `
    MATCH (rt:RelationshipType)
    RETURN rt.name as name, rt.directionality as directionality
  `;
  
  const result = await session.run(query);
  const weights: {[type: string]: any} = {};
  
  result.records.forEach(record => {
    const name = record.get('name');
    const directionality = record.get('directionality');
    
    weights[name] = {
      forward_weight: getDirectionalWeight(directionality, true),
      backward_weight: getDirectionalWeight(directionality, false)
    };
  });
  
  return weights;
}

function getDirectionalWeight(directionality: string, isForward: boolean): number {
  const weights = {
    'strong': [1.0, 0.2],      // Relationship much more important for source than target
    'weak': [0.8, 0.6],        // Relationship somewhat more important for source
    'balanced': [0.7, 0.7]     // Relationship equally important in both directions
  };
  
  const [forward, backward] = weights[directionality] || [0.5, 0.5];
  return isForward ? forward : backward;
}
```

### Vector Search Implementation

**Embedding Generation**:
- Model: sentence-transformers/all-MiniLM-L6-v2
- Dimensions: 384
- Generated for: node name + summary
- Stored in VectorIndex nodes connected via VECTOR_INDEXED_AT

**Search Strategy**:
```typescript
async function hybridSearch(query: string, nodeTypes?: string[]): Promise<SearchResult[]> {
  // 1. Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // 2. Vector similarity search
  const vectorResults = await vectorSearch(queryEmbedding, nodeTypes);
  
  // 3. Text search
  const textResults = await textSearch(query, nodeTypes);
  
  // 4. Combine and rank results
  return combineResults(vectorResults, textResults);
}
```

### Document Generation Implementation

**Node Resolution Algorithm**:
The document generation tool must handle both node IDs and node names. Here's the implementation:

```typescript
async function resolveNodeIdentifiers(identifiers: string[]): Promise<Array<{id: string, name: string}>> {
  const resolvedNodes: Array<{id: string, name: string}> = [];
  
  for (const identifier of identifiers) {
    // Try to find by ID first
    let query = `
      MATCH (n:Node {id: $identifier})
      RETURN n.id as id, n.name as name
    `;
    
    let result = await session.run(query, { identifier });
    
    if (result.records.length === 0) {
      // If not found by ID, try by name (case-insensitive)
      query = `
        MATCH (n:Node)
        WHERE toLower(n.name) = toLower($identifier)
        RETURN n.id as id, n.name as name
      `;
      
      result = await session.run(query, { identifier });
    }
    
    if (result.records.length === 0) {
      // If still not found, try fuzzy matching on name
      query = `
        MATCH (n:Node)
        WHERE toLower(n.name) CONTAINS toLower($identifier)
        RETURN n.id as id, n.name as name,
               gds.similarity.jaccard(split(toLower(n.name), ' '), split(toLower($identifier), ' ')) as similarity
        ORDER BY similarity DESC
        LIMIT 1
      `;
      
      result = await session.run(query, { identifier });
    }
    
    if (result.records.length > 0) {
      const record = result.records[0];
      resolvedNodes.push({
        id: record.get('id'),
        name: record.get('name')
      });
    } else {
      throw new Error(`Node not found for identifier: ${identifier}`);
    }
  }
  
  return resolvedNodes;
}

async function generateDocuments(nodeIdentifiers: string[], options: GenerateDocumentsOptions): Promise<DocumentResult[]> {
  // 1. Resolve identifiers to actual nodes
  const resolvedNodes = await resolveNodeIdentifiers(nodeIdentifiers);
  
  const results: DocumentResult[] = [];
  
  for (const node of resolvedNodes) {
    // 2. Check cache if not forcing regeneration
    if (!options.force_regenerate) {
      const cachedContent = await getCachedDocument(node.id);
      if (cachedContent) {
        results.push({
          node_id: node.id,
          node_name: node.name,
          content: cachedContent.content,
          generated_at: cachedContent.generated_at,
          from_cache: true,
          dependencies: cachedContent.dependencies,
          template_used: cachedContent.template_used
        });
        continue;
      }
    }
    
    // 3. Generate new document
    const template = await getTemplateForNode(node.id, options.template_override);
    const document = await processTemplate(node.id, template);
    
    // 4. Cache the generated document
    await cacheDocument(node.id, document, template.id);
    
    results.push({
      node_id: node.id,
      node_name: node.name,
      content: document,
      generated_at: Date.now(),
      from_cache: false,
      dependencies: await getDependencies(node.id),
      template_used: template.id
    });
  }
  
  return results;
}
```

**Example Usage**:
- `generate_documents(["shor-algorithm-123"])` - Uses node ID
- `generate_documents(["Shor's Algorithm"])` - Uses node name (exact match)
- `generate_documents(["shors algorithm"])` - Uses fuzzy matching on node name

## Deployment

### Docker Configuration

**Dockerfile** (existing):
- Multi-stage build with Node.js 23
- TypeScript compilation
- Production dependencies only

**docker-compose.yml** (existing):
- MCP server container
- Neo4j 2025.02.0 container
- Shared network
- Health checks for Neo4j

### Startup Sequence

1. `docker-compose up -d` - Start Neo4j and MCP containers
2. Wait for Neo4j health check to pass
3. Run schema initialization script: `docker exec graphrag-knowledge-mcp node scripts/init-schema.js`
4. MCP server is ready for LLM connections

### Environment Variables

```bash
NEO4J_URI=bolt://neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

## Usage Patterns

### Adding New Information (Write Operations)
1. Use `explore_neighborhoods` to understand existing structure
2. Use `manage_nodes` to create new nodes with appropriate relationships
3. Use `manage_relationships` to create additional connections if needed

### Retrieving Information (Read Operations)
1. Use `generate_documents` to get templated information about nodes
2. Use `find_relationship_paths` to understand connections between nodes

### Batch Operations
All tools support batch operations to minimize LLM calls:
- `manage_nodes`: Create/update/delete multiple nodes in one call
- `manage_relationships`: Handle multiple relationships in one call
- `generate_documents`: Generate documents for multiple nodes
- `explore_neighborhoods`: Search for multiple terms simultaneously
- `find_relationship_paths`: Find paths between multiple node pairs

## Performance Considerations

### Caching Strategy
- Template compilation cached in memory with UUID keys
- Document caches validated using timestamp comparison
- Vector embeddings cached in VectorIndex nodes

### Query Optimization
- Use specific relationship types for better Neo4j performance
- Leverage indexes for all frequent query patterns
- Batch operations to reduce round trips

### Scalability
- Stateless MCP server design allows horizontal scaling
- Neo4j clustering support for high availability
- Vector search optimization through proper indexing

## Error Handling

### Graceful Degradation
- Continue operation if vector embedding generation fails
- Fallback to text search if vector search fails
- Cache invalidation continues even if regeneration fails

### Validation
- Input validation for all tool parameters
- Node existence checks before relationship creation
- Template syntax validation before storage

## Security Considerations

### Database Access
- Neo4j authentication required
- Network isolation via Docker networks
- No direct database exposure to external networks

### Input Sanitization
- Cypher injection prevention
- Template injection prevention
- File path validation for any file operations

This design document provides a complete specification for implementing the GraphRAG Knowledge MCP server. A skilled programmer should be able to build the entire system using this document as a guide.