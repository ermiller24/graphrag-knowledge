# Knowledge Graph Schema with Templates and Caching

This document defines the schema for a knowledge graph that combines structured data with templates, document caching, and vector indexing. The design enables efficient document generation, automatic updates when related nodes change, and semantic search capabilities.

## Core Concepts

The knowledge graph is built around these key concepts:

1. **Standard Nodes**: The primary entities in the knowledge graph
2. **Templates**: Define how to generate documents from nodes
3. **Cached Documents**: Pre-generated documents for efficient retrieval
4. **Vector Indices**: Enable semantic search across the graph
5. **Relationships**: Connect nodes in meaningful ways

## Node Types

### Standard Node

All standard nodes in the graph share these common properties:

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

### Template Node

Templates define how to generate documents from nodes:

```cypher
CREATE (t:Template {
  id: "template-identifier",
  name: "Template Name",
  description: "Template description",
  structure: "# {{name}}\n\n{{summary}}\n\n## Properties\n\n{{properties}}\n\n## Relationships\n\n{{relationships}}",
  created_date: timestamp(),
  last_modified_date: timestamp()
})
```

The `structure` property contains a template string with placeholders that will be replaced with actual node data when generating a document.

### Cached Document Node

Stores pre-generated documents for efficient retrieval:

```cypher
CREATE (c:CachedDocument {
  id: "cache-identifier",
  content: "Generated document content...",
  generated_at: timestamp(),
  dependency_signature: "hash-of-dependencies",
  is_valid: true
})
```

### Vector Index Node

Stores vector embeddings for semantic search:

```cypher
CREATE (v:VectorIndex {
  id: "vector-index-identifier",
  embedding: [0.1, 0.2, ...],        // Vector embedding
  model: "embedding-model-name",     // Model used to generate the embedding
  dimension: 384,                    // Dimension of the embedding
  indexed_at: timestamp()
})
```

### Relationship Type Node

Documents the types of relationships available in the graph:

```cypher
CREATE (r:RelationshipType {
  name: "RELATIONSHIP_NAME",
  description: "Description of what this relationship means",
  source_types: ["Node", "SpecificNodeLabel"],  // Valid source node types
  target_types: ["Node", "SpecificNodeLabel"],  // Valid target node types
  template: "{{source.name}} {{relationship.name}} {{target.name}}",
  relevance_strength: "medium",                 // Options: "weak", "medium", "strong"
  directionality: "balanced"                    // Options: "strongly_forward", "weakly_forward", "balanced", "weakly_backward", "strongly_backward"
})
```

The `relevance_strength` indicates how meaningful this relationship type is for understanding connections, while `directionality` indicates whether the relationship is more important for understanding the source node, target node, or equally important for both.

## Relationship Types

### Domain-Specific Relationships

Instead of using a generic relationship type with a "type" property, use specific relationship types directly based on the domain semantics:

```cypher
// Person to Person relationships
CREATE (p1:Node:Person)-[:RELATED_TO {
  relationship_degree: "sibling",
  description: "Family relationship",
  created_date: timestamp()
}]->(p2:Node:Person)

// Person to Event relationships
CREATE (p:Node:Person)-[:PARTICIPATED_IN {
  role: "organizer",
  description: "Organized the conference",
  created_date: timestamp()
}]->(e:Node:Event)

// Person to Organization relationships
CREATE (p:Node:Person)-[:WORKS_FOR {
  position: "Senior Engineer",
  start_date: "2020-01-15",
  created_date: timestamp()
}]->(o:Node:Organization)
```

This approach offers several advantages:
1. **Query Performance**: Neo4j can use relationship types for indexing and query optimization
2. **Query Clarity**: Queries become more readable and intuitive
3. **Schema Flexibility**: New relationship types can be added as needed without schema changes

For example, finding people who work for a specific organization:

```cypher
// Using specific relationship types
MATCH (p:Person)-[:WORKS_FOR]->(o:Organization {name: "Acme Inc"})
RETURN p

// vs. using a generic relationship with a type property
MATCH (p:Person)-[r:RELATES_TO]->(o:Organization {name: "Acme Inc"})
WHERE r.type = "works_for"
RETURN p
```

The first query is both more efficient and more readable.

### Special Relationships

#### USES_TEMPLATE

Connects a node to its template:

```cypher
CREATE (n:Node)-[:USES_TEMPLATE]->(t:Template)
```

#### CACHED_AT

Connects a node to its cached document:

```cypher
CREATE (n:Node)-[:CACHED_AT]->(c:CachedDocument)
```

#### VECTOR_INDEXED_AT

Connects a node to its vector index:

```cypher
CREATE (n:Node)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
```

#### DEPENDS_ON

Tracks dependencies for cached documents:

```cypher
CREATE (c:CachedDocument)-[:DEPENDS_ON]->(n:Node)
```

## Schema Implementation

### Node Labels and Inheritance

Nodes can have multiple labels to indicate their type and role:

```cypher
CREATE (p:Node:Person {
  id: "person-123",
  name: "John Doe",
  summary: "Software engineer",
  created_date: timestamp(),
  last_modified_date: timestamp(),
  birth_date: "1985-01-15"
})
```

### Indexes for Performance

Create indexes on frequently queried properties:

```cypher
CREATE INDEX node_id FOR (n:Node) ON (n.id);
CREATE INDEX node_last_modified FOR (n:Node) ON (n.last_modified_date);
CREATE INDEX template_id FOR (t:Template) ON (t.id);
CREATE INDEX cached_document_id FOR (c:CachedDocument) ON (c.id);
CREATE INDEX relationship_type_name FOR (r:RelationshipType) ON (r.name);
```

## Document Generation and Caching

### Template-Based Document Generation

When a document is requested for a node:

1. Find the node's template through the USES_TEMPLATE relationship
2. Collect the node's properties and relationships
3. Fill in the template placeholders with the collected data
4. Return the generated document

```cypher
// Find a node and its template
MATCH (n:Node {id: "node-123"})-[:USES_TEMPLATE]->(t:Template)

// Collect node properties
WITH n, t, properties(n) AS props

// Collect relationships
MATCH (n)-[r]->(related)
WITH n, t, props, collect({type: type(r), target: related.name}) AS rels

// Generate document (simplified - actual implementation would use a template engine)
RETURN 
  REPLACE(
    REPLACE(
      t.structure, 
      "{{name}}", 
      n.name
    ),
    "{{summary}}",
    n.summary
  ) AS document
```

### Document Caching

To efficiently retrieve documents:

1. Check if a valid cached document exists
2. If valid, return the cached document
3. If invalid or missing, generate a new document and cache it

```cypher
// Try to find a valid cached document
MATCH (n:Node {id: "node-123"})-[:CACHED_AT]->(c:CachedDocument)
WHERE c.is_valid = true
RETURN c.content AS document

// If no valid cache exists, generate and cache a new document
```

### Cache Invalidation

Using timestamp-based invalidation:

```cypher
// Find cached documents that depend on modified nodes
MATCH (c:CachedDocument)-[:DEPENDS_ON]->(n:Node)
WHERE n.last_modified_date > c.generated_at
SET c.is_valid = false
```

## Vector Search Implementation

### Creating Vector Embeddings

When a node is created or updated:

1. Generate a text representation of the node
2. Create a vector embedding using an embedding model
3. Store the embedding in a VectorIndex node
4. Connect the node to its vector index

```cypher
// Assuming the vector embedding has been generated
MATCH (n:Node {id: "node-123"})
CREATE (v:VectorIndex {
  id: n.id + "-vector",
  embedding: [0.1, 0.2, ...],
  model: "sentence-transformers/all-MiniLM-L6-v2",
  dimension: 384,
  indexed_at: timestamp()
})
CREATE (n)-[:VECTOR_INDEXED_AT]->(v)
```

### Semantic Search

To find nodes semantically similar to a query:

```cypher
// Assuming the query embedding has been generated
WITH [0.3, 0.4, ...] AS queryEmbedding
MATCH (n:Node)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
WITH n, v, gds.similarity.cosine(queryEmbedding, v.embedding) AS similarity
WHERE similarity > 0.7
RETURN n.id, n.name, similarity
ORDER BY similarity DESC
LIMIT 10
```

## Common Queries

### Creating a New Node with Template

```cypher
// Create a new node
CREATE (p:Node:Person {
  id: "person-456",
  name: "Jane Smith",
  summary: "Data scientist",
  created_date: timestamp(),
  last_modified_date: timestamp(),
  birth_date: "1990-05-20"
})

// Connect to an existing template
MATCH (t:Template {id: "person-template"})
CREATE (p)-[:USES_TEMPLATE]->(t)
```

### Generating and Caching a Document

```cypher
// Find a node and its template
MATCH (n:Node {id: "node-123"})-[:USES_TEMPLATE]->(t:Template)

// Generate document (simplified)
WITH n, t, "Generated document content..." AS documentContent

// Create cache node
CREATE (c:CachedDocument {
  id: n.id + "-cache",
  content: documentContent,
  generated_at: timestamp(),
  dependency_signature: "hash-of-dependencies",
  is_valid: true
})

// Connect node to cache
CREATE (n)-[:CACHED_AT]->(c)

// Track dependencies
MATCH (n)-[r]->(related)
CREATE (c)-[:DEPENDS_ON]->(related)
```

### Finding Nodes by Template

```cypher
// Find all nodes using a specific template
MATCH (n:Node)-[:USES_TEMPLATE]->(t:Template {id: "person-template"})
RETURN n.id, n.name
```

### Updating a Node and Invalidating Caches

```cypher
// Update a node
MATCH (n:Node {id: "node-123"})
SET n.summary = "Updated summary",
    n.last_modified_date = timestamp()

// Invalidate dependent caches
MATCH (c:CachedDocument)-[:DEPENDS_ON]->(n)
SET c.is_valid = false
```

## Best Practices

1. **Always update last_modified_date**: When modifying a node, always update its last_modified_date property
2. **Use templates for consistency**: Create templates for common node types to ensure consistent document generation
3. **Cache validation**: Implement efficient cache validation using indexed timestamp comparisons
4. **Dependency tracking**: Carefully track dependencies to ensure cache invalidation works correctly
5. **Vector index updates**: Update vector indices when node content changes to maintain search accuracy
6. **Use specific relationship types**: Create domain-specific relationship types rather than generic relationships with type properties
7. **Document relationship types**: Always create RelationshipType nodes to document the semantics of each relationship type
8. **Balance specificity and reusability**: Create relationship types that are specific enough to be meaningful but general enough to be reused

## Implementation Notes

1. **Template Engine**: Use a template engine for document generation (e.g., Handlebars, Mustache)
2. **Embedding Model**: Use a consistent embedding model for all vector indices
3. **Transaction Hooks**: Implement Neo4j transaction hooks to automatically:
   - Update last_modified_date when nodes change
   - Invalidate affected caches
   - Update vector indices

## Example: Historical Person Implementation

```cypher
// Create a Historical Person template
CREATE (t:Template {
  id: "historical-person-template",
  name: "Historical Person Template",
  description: "Template for historical persons",
  structure: "# {{name}} ({{birth_year}}-{{death_year}})\n\n{{summary}}\n\n## Biography\n\n{{biography}}\n\n## Notable Relationships\n\n{{relationships}}",
  created_date: timestamp(),
  last_modified_date: timestamp()
})

// Create Charlie Parker node
CREATE (p:Node:Person:HistoricalPerson {
  id: "charlie-parker",
  name: "Charlie Parker",
  summary: "American jazz saxophonist and composer",
  birth_year: 1920,
  death_year: 1955,
  biography: "Charles Parker Jr. was an American jazz saxophonist, composer, and bandleader...",
  created_date: timestamp(),
  last_modified_date: timestamp()
})

// Create Miles Davis node
CREATE (m:Node:Person:HistoricalPerson {
  id: "miles-davis",
  name: "Miles Davis",
  summary: "American jazz trumpeter and composer",
  birth_year: 1926,
  death_year: 1991,
  biography: "Miles Dewey Davis III was an American jazz trumpeter, bandleader, and composer...",
  created_date: timestamp(),
  last_modified_date: timestamp()
})

// Connect to template
MATCH (p:Node {id: "charlie-parker"}), (m:Node {id: "miles-davis"}), (t:Template {id: "historical-person-template"})
CREATE (p)-[:USES_TEMPLATE]->(t)
CREATE (m)-[:USES_TEMPLATE]->(t)

// Create relationship using a specific relationship type
MATCH (p:Node {id: "charlie-parker"}), (m:Node {id: "miles-davis"})
CREATE (m)-[:COLLABORATED_WITH {
  when: "when Miles was young",
  description: "Miles Davis collaborated with Charlie Parker in his early career",
  projects: ["Recordings with Charlie Parker's quintet", "Live performances in NYC"]
}]->(p)

// Create another relationship type
CREATE (m)-[:INFLUENCED_BY {
  strength: "strong",
  description: "Miles Davis was heavily influenced by Charlie Parker's bebop style"
}]->(p)

// Document the relationship types with relevance and directionality
CREATE (r1:RelationshipType {
  name: "COLLABORATED_WITH",
  description: "Indicates that one person collaborated with another on creative projects",
  source_types: ["Person"],
  target_types: ["Person"],
  template: "{{source.name}} collaborated with {{target.name}} {{relationship.when}} on {{relationship.projects}}",
  relevance_strength: "strong",
  directionality: "balanced"
})

CREATE (r2:RelationshipType {
  name: "INFLUENCED_BY",
  description: "Indicates that one person was influenced by another's work or style",
  source_types: ["Person"],
  target_types: ["Person"],
  template: "{{source.name}} was {{relationship.strength}}ly influenced by {{target.name}}'s {{target.summary}}",
  relevance_strength: "strong",
  directionality: "strongly_forward"
})

// Add more domain-specific relationship types
CREATE (r3:RelationshipType {
  name: "PERFORMED_AT",
  description: "Indicates that a person performed at a venue or event",
  source_types: ["Person"],
  target_types: ["Venue", "Event"],
  template: "{{source.name}} performed at {{target.name}} on {{relationship.date}}",
  relevance_strength: "medium",
  directionality: "weakly_forward"
})

CREATE (r4:RelationshipType {
  name: "RECORDED_AT",
  description: "Indicates that a musical work was recorded at a specific studio",
  source_types: ["MusicalWork"],
  target_types: ["Studio"],
  template: "{{source.name}} was recorded at {{target.name}} in {{relationship.year}}",
  relevance_strength: "medium",
  directionality: "strongly_forward"
})

CREATE (r5:RelationshipType {
  name: "INSTANCE_OF",
  description: "Indicates that a node is a specific instance of a more general category",
  source_types: ["Node"],
  target_types: ["Node"],
  template: "{{source.name}} is an instance of {{target.name}}",
  relevance_strength: "weak",
  directionality: "strongly_forward"
})

CREATE (r6:RelationshipType {
  name: "PART_OF",
  description: "Indicates that a node is a component or part of a larger whole",
  source_types: ["Node"],
  target_types: ["Node"],
  template: "{{source.name}} is part of {{target.name}}",
  relevance_strength: "medium",
  directionality: "strongly_forward"
})

## Knowledge Graph Discovery Tools

### Graph Neighborhood Explorer

When adding new information to the knowledge graph, it's crucial to understand the existing structure to make appropriate connections. The Graph Neighborhood Explorer tool helps LLMs discover what already exists in the graph that might relate to the information being added.

#### Purpose

This tool addresses several key challenges:
- Prevents creation of duplicate nodes with slightly different names
- Helps identify the most appropriate existing nodes to connect to
- Reveals the relationship patterns used in specific areas of the graph
- Ensures consistent naming and structure

#### Tool Interface

```javascript
{
  "tool": "explore_graph_neighborhood",
  "parameters": {
    "search_terms": ["Shor's Algorithm", "Quantum Computing", "Quantum Algorithms"],
    "search_strategy": "combined", // Options: "vector", "text", "combined"
    "max_results_per_term": 3,
    "neighborhood_depth": 2,
    "include_relationship_types": true,
    "include_templates": true
  }
}
```

#### Implementation Strategy

The tool combines multiple search strategies:

1. **Vector Similarity Search**: Find semantically similar nodes even when exact keywords don't match
2. **Text Search**: Perform exact or fuzzy matching on node names and summaries
3. **Graph Proximity**: Explore the immediate neighborhood of found nodes

```cypher
// Example implementation for finding related nodes
WITH $searchTerms AS terms
UNWIND terms AS term

// Vector similarity search
CALL db.index.vector.queryNodes('node-embeddings', 3, $termEmbedding)
YIELD node, score
WHERE score > 0.7

// Combine with text search
UNION
MATCH (n:Node)
WHERE n.name CONTAINS term OR n.summary CONTAINS term

// Explore neighborhood
WITH DISTINCT n
MATCH path = (n)-[r*1..2]-(related)
WHERE NOT type(r[0]) IN ['USES_TEMPLATE', 'CACHED_AT', 'VECTOR_INDEXED_AT']
RETURN n, relationships(path) AS rels, nodes(path) AS neighbors
```

#### Response Structure

```javascript
{
  "neighborhoods": {
    "Quantum Computing": {
      "primary_nodes": [
        {
          "id": "quantum-computing-123",
          "name": "Quantum Computing",
          "type": "Topic",
          "summary": "The study of quantum mechanical phenomena...",
          "similarity_score": 0.95
        }
      ],
      "relationships": [
        {
          "type": "PARENT_OF",
          "source": "quantum-computing-123",
          "target": "quantum-algorithms-456",
          "target_name": "Quantum Algorithms"
        },
        {
          "type": "SUBFIELD_OF",
          "source": "quantum-computing-123",
          "target": "quantum-mechanics-789",
          "target_name": "Quantum Mechanics"
        }
      ],
      "nearby_nodes": [
        {
          "id": "grovers-algorithm-234",
          "name": "Grover's Algorithm",
          "distance": 2,
          "path": "Quantum Computing -> Quantum Algorithms -> Grover's Algorithm"
        }
      ],
      "common_relationship_types": ["EXAMPLE_OF", "SUBFIELD_OF", "INVENTED_BY"],
      "templates_in_use": ["algorithm-template", "topic-template"]
    }
  },
  "recommendations": {
    "suggested_parent": "quantum-algorithms-456",
    "suggested_relationship": "EXAMPLE_OF",
    "missing_intermediate_nodes": []
  }
}
```

### Path Finder Tool

The Path Finder tool discovers meaningful relationships between two nodes in the graph using a self-describing approach that leverages the relationship metadata stored in RelationshipType nodes.

#### Purpose

This tool is essential for:
- Understanding indirect relationships between nodes during read operations
- Discovering shared contexts (e.g., albums both musicians played on)
- Finding the most meaningful connection paths using graph-defined relationship weights
- Automatically filtering trivial paths based on relationship metadata

#### Tool Interface

```javascript
{
  "tool": "find_relationship_paths",
  "parameters": {
    "source_node_id": "miles-davis",
    "target_node_id": "charlie-parker",
    "max_path_length": 4,
    "max_paths": 10,
    "min_path_strength": 0.3,
    "path_ranking": "weighted"
  }
}
```

#### Relationship Strength and Directionality System

The path finder uses a self-describing system where each RelationshipType defines:

**Relevance Strength** (how meaningful the relationship is):
- `weak` = 0.2 (e.g., INSTANCE_OF, IS_A)
- `medium` = 0.6 (e.g., PERFORMED_AT, PART_OF)
- `strong` = 1.0 (e.g., COLLABORATED_WITH, INFLUENCED_BY)

**Directionality** (which direction provides more insight):
- `strongly_forward` = [1.0, 0.1] (source→target important, target→source not)
- `weakly_forward` = [0.8, 0.4] (source→target more important)
- `balanced` = [0.7, 0.7] (equally important in both directions)
- `weakly_backward` = [0.4, 0.8] (target→source more important)
- `strongly_backward` = [0.1, 1.0] (target→source important, source→target not)

#### Path Strength Calculation Algorithm

```cypher
// Step 1: Get all relationship type metadata
MATCH (rt:RelationshipType)
WITH collect({
  name: rt.name,
  strength: CASE rt.relevance_strength
    WHEN 'weak' THEN 0.2
    WHEN 'medium' THEN 0.6
    WHEN 'strong' THEN 1.0
    ELSE 0.4
  END,
  forward_weight: CASE rt.directionality
    WHEN 'strongly_forward' THEN 1.0
    WHEN 'weakly_forward' THEN 0.8
    WHEN 'balanced' THEN 0.7
    WHEN 'weakly_backward' THEN 0.4
    WHEN 'strongly_backward' THEN 0.1
    ELSE 0.5
  END,
  backward_weight: CASE rt.directionality
    WHEN 'strongly_forward' THEN 0.1
    WHEN 'weakly_forward' THEN 0.4
    WHEN 'balanced' THEN 0.7
    WHEN 'weakly_backward' THEN 0.8
    WHEN 'strongly_backward' THEN 1.0
    ELSE 0.5
  END
}) AS relationshipWeights

// Step 2: Find all paths between source and target
MATCH path = (source:Node {id: $sourceId})-[*1..4]-(target:Node {id: $targetId})
WHERE source <> target

// Step 3: Calculate path strength
WITH path, relationshipWeights,
     // Calculate cumulative path strength
     REDUCE(pathStrength = 1.0, i IN range(0, length(path)-1) |
       WITH relationships(path)[i] AS rel,
            nodes(path)[i] AS sourceNode,
            nodes(path)[i+1] AS targetNode
       
       // Find relationship type metadata
       WITH rel, sourceNode, targetNode,
            [rw IN relationshipWeights WHERE rw.name = type(rel)][0] AS relWeight
       
       // Determine if we're going forward or backward in this relationship
       WITH rel, relWeight,
            CASE
              WHEN startNode(rel) = sourceNode THEN relWeight.forward_weight
              ELSE relWeight.backward_weight
            END AS edgeWeight
       
       // Multiply path strength by edge strength and weight
       pathStrength * (relWeight.strength * edgeWeight)
     ) AS totalPathStrength

// Step 4: Apply path length penalty (shorter paths preferred)
WITH path, totalPathStrength,
     totalPathStrength * (1.0 / length(path)) AS adjustedStrength

// Step 5: Filter and rank paths
WHERE adjustedStrength >= $minPathStrength
  AND NOT (
    // Filter out circular paths
    size(nodes(path)) <> size(apoc.coll.toSet(nodes(path))) OR
    // Filter out paths that go through utility relationships only
    ALL(r IN relationships(path) WHERE
      [rw IN relationshipWeights WHERE rw.name = type(r)][0].strength <= 0.2
    )
  )

RETURN path, adjustedStrength
ORDER BY adjustedStrength DESC
LIMIT $maxPaths
```

#### Response Structure

```javascript
{
  "paths": [
    {
      "path_id": 1,
      "length": 2,
      "strength": 0.84,
      "nodes": [
        {"id": "miles-davis", "name": "Miles Davis"},
        {"id": "birth-of-cool", "name": "Birth of the Cool"},
        {"id": "charlie-parker", "name": "Charlie Parker"}
      ],
      "relationships": [
        {
          "type": "RECORDED",
          "direction": "forward",
          "edge_strength": 0.6,
          "source": "miles-davis",
          "target": "birth-of-cool"
        },
        {
          "type": "FEATURED_ON",
          "direction": "backward",
          "edge_strength": 0.4,
          "source": "charlie-parker",
          "target": "birth-of-cool"
        }
      ],
      "narrative": "Miles Davis recorded 'Birth of the Cool' and Charlie Parker was featured on it",
      "strength_breakdown": {
        "raw_strength": 0.42,
        "length_penalty": 0.5,
        "final_strength": 0.84
      }
    }
  ],
  "summary": {
    "total_paths_found": 12,
    "paths_returned": 5,
    "strongest_path_strength": 0.84,
    "average_path_strength": 0.52,
    "relationship_types_used": ["RECORDED", "FEATURED_ON", "COLLABORATED_WITH"]
  }
}
```

#### Self-Describing Advantages

This approach provides several key benefits:

1. **No Hardcoded Rules**: The algorithm adapts to whatever relationship types exist in the graph
2. **Domain Flexibility**: Works equally well for jazz musicians, quantum physics, or any other domain
3. **Transparent Scoring**: The strength calculation is based on explicit metadata that can be queried and understood
4. **Evolvable**: New relationship types automatically integrate into the path finding algorithm
5. **Bidirectional Intelligence**: Understands that "A influenced B" is more important for understanding A than B

### Usage Guidelines

1. **Graph Neighborhood Explorer**: Use before write operations (adding new nodes/relationships) to understand the existing local structure and avoid duplicates
2. **Path Finder Tool**: Use during read operations when you need to understand how two existing nodes are connected
3. **Separate Purposes**: These tools serve different phases of graph interaction - neighborhood exploration for writes, path finding for reads

These tools significantly reduce the number of queries an LLM needs to make when working with the knowledge graph, providing comprehensive context in single, efficient operations.