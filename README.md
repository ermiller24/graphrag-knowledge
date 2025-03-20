# GraphRAG Knowledge

A Model Context Protocol (MCP) server that implements a hierarchical knowledge graph using Neo4j with vector search capabilities.

## Overview

GraphRAG Knowledge is an MCP server that provides tools for building, managing, and querying a structured knowledge graph. It combines the power of graph databases (Neo4j) with vector embeddings to enable both semantic and structural search capabilities.

The knowledge graph follows a hierarchical structure:

```
TagCategory <- Tag <- Topic <- Knowledge <- Source
```

Each node in this hierarchy can be connected through "BELONGS_TO" relationships (moving up the hierarchy) as well as arbitrary "horizontal" relationships between nodes at the same or different levels.

## Knowledge Graph Structure

### Node Types

1. **Tag Categories**: Broad categories for organizing tags (e.g., "subject", "memories")
2. **Tags**: Labels that belong to categories (e.g., "physics", "cooking" in the "subject" category)
3. **Topics**: Discrete blocks of knowledge (e.g., "general relativity", "roasts")
4. **Knowledge**: Basic chunks of information (e.g., "the schwarzchild metric", "roast chicken with vegetables")
5. **Sources**: Paths to URLs or files containing source information (e.g., Wikipedia pages, recipe URLs)

### Relationships

- **Vertical Relationships**: The primary hierarchical structure uses "BELONGS_TO" relationships
  - Knowledge nodes belong to Topic nodes
  - Topic nodes belong to Tag nodes
  - Tag nodes belong to TagCategory nodes
  - Source nodes belong to Knowledge nodes

- **Horizontal Relationships**: Custom relationships can be created between any nodes
  - Example: A "DERIVED_FROM" relationship connecting "the schwarzchild metric" to "The Einstein Field Equations"

### Vector Search

Each node in the knowledge graph is equipped with vector embeddings generated from its name and description. This enables:

1. **Semantic Search**: Find nodes that are semantically similar to a text query
2. **Hybrid Search**: Combine vector similarity with graph structure to find related information

## Setup and Usage

### Prerequisites

- Docker and Docker Compose
- Node.js (for development)

### Running the Server

1. Clone the repository
2. Build and start the services:

```bash
docker compose up -d
```

This will start:
- A Neo4j database server (accessible at http://localhost:7474 with neo4j/password)
- The GraphRAG Knowledge MCP server

### Development

To build the project locally:

```bash
npm install
npm run build
```

## MCP Tools

The server exposes the following tools through the Model Context Protocol:

### 1. knowledge_create_node

Create a node in the knowledge graph.

```javascript
{
  "nodeType": "topic", // tag_category, tag, topic, knowledge, source
  "name": "General Relativity",
  "description": "Einstein's theory of gravity",
  "belongsTo": [
    {
      "type": "tag",
      "name": "physics"
    }
  ],
  "path": "path/to/source", // Only for source nodes
  "additionalFields": {
    "summary": "A brief summary", // Required for knowledge nodes
    "customField": "value"
  }
}
```

### 2. knowledge_create_edge

Create a relationship between nodes.

```javascript
{
  "sourceType": "knowledge",
  "sourceName": "Schwarzschild Metric",
  "targetType": "knowledge",
  "targetName": "Einstein Field Equations",
  "relationship": "DERIVED_FROM",
  "description": "The Schwarzschild metric is a solution to the Einstein Field Equations"
}
```

### 3. knowledge_alter

Update or delete a node.

```javascript
{
  "nodeType": "knowledge",
  "nodeId": 123,
  "deleteNode": false,
  "fields": {
    "name": "Updated Name",
    "description": "Updated description"
  }
}
```

### 4. knowledge_search

Search the knowledge graph using Cypher query components.

```javascript
{
  "matchClause": "(k:Knowledge)-[:BELONGS_TO]->(t:Topic)",
  "whereClause": "t.name = 'General Relativity'",
  "returnClause": "k.name AS name, k.description AS description"
}
```

### 5. knowledge_vector_search

Search for nodes similar to a text query using vector similarity.

```javascript
{
  "nodeType": "knowledge",
  "text": "gravity and spacetime curvature",
  "limit": 5,
  "minSimilarity": 0.7
}
```

### 6. knowledge_hybrid_search

Perform a hybrid search combining vector similarity with graph structure.

```javascript
{
  "nodeType": "knowledge",
  "text": "gravity and spacetime curvature",
  "relationshipType": "RELATES",
  "targetType": "topic",
  "limit": 5,
  "minSimilarity": 0.7
}
```

### 7. knowledge_unsafe_query

Execute an arbitrary Cypher query against the Neo4j knowledge graph.

```javascript
{
  "query": "MATCH (n:Knowledge) RETURN n LIMIT 10"
}
```

## Technical Implementation

The server uses:
- Neo4j as the graph database
- Hugging Face Transformers for generating vector embeddings
- Model Context Protocol SDK for exposing tools to AI assistants

Vector embeddings are generated using the "sentence-transformers/all-MiniLM-L6-v2" model with a dimension of 384.

## License

GNU License

## Author

Eir Miller