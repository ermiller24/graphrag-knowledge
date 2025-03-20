#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as neo4j from 'neo4j-driver';
import type { Record, Node, Relationship, Integer } from 'neo4j-driver';
import { pipeline } from '@huggingface/transformers';

// Neo4j database manager class
class Neo4jManager {
  private driver: neo4j.Driver;
  private session: neo4j.Session;
  private embeddingModel: string;
  private embeddingDimension: number;
  private embeddingPipeline: any;

  static async initialize(): Promise<Neo4jManager> {
    const manager = new Neo4jManager();
    await manager.initializeSchema();
    return manager;
  }

  private constructor() {
    this.driver = neo4j.default.driver(
      'bolt://neo4j:7687',
      neo4j.default.auth.basic('neo4j', 'password')
    );
    this.session = this.driver.session();
    this.embeddingModel = 'sentence-transformers/all-MiniLM-L6-v2';
    this.embeddingDimension = 384;
    this.embeddingPipeline = null;
  }

  /**
   * Initialize the embedding pipeline
   * @returns {Promise<void>}
   */
  private async initializeEmbeddingPipeline(): Promise<void> {
    if (!this.embeddingPipeline) {
      try {
        console.log(`Initializing embedding pipeline with model: ${this.embeddingModel}`);
        
        // Create the pipeline with detailed options for @huggingface/transformers
        this.embeddingPipeline = await pipeline('feature-extraction', this.embeddingModel);
        
        // Test the pipeline with a simple example
        console.log('Testing embedding pipeline with a simple example...');
        const testText = 'This is a test sentence for embedding generation.';
        const testOutput = await this.embeddingPipeline(testText);
        
        console.log('Embedding pipeline initialized successfully');
      } catch (error) {
        console.error('Failed to initialize embedding pipeline:', error);
        console.error('Error details:', (error as Error).stack);
        throw error;
      }
    }
  }

  /**
   * Generate embeddings for a text string
   * @param {string} text - The text to generate embeddings for
   * @returns {Promise<number[]>} - The embedding vector
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    await this.initializeEmbeddingPipeline();
    
    try {
      console.log(`Generating embedding for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      // Generate embedding using the pipeline
      const output = await this.embeddingPipeline(text);
      
      // Extract the embedding vector from the output
      let embedding: number[] | null = null;
      
      // Handle Tensor object from @huggingface/transformers
      if (output && typeof output === 'object' && 'ort_tensor' in output && output.ort_tensor && 'cpuData' in output.ort_tensor) {
        console.log('Found Tensor object with cpuData');
        
        // Extract the Float32Array from the tensor
        const tensorData = output.ort_tensor.cpuData;
        
        // The tensor has dimensions [1, numTokens, embeddingDim]
        const dims = output.ort_tensor.dims;
        const numTokens = dims[1];
        const embeddingDim = dims[2];
        
        // Create an array to hold the averaged embedding
        const averagedEmbedding = new Array(embeddingDim).fill(0);
        
        // Sum up the embeddings for all tokens
        for (let tokenIdx = 0; tokenIdx < numTokens; tokenIdx++) {
          for (let dimIdx = 0; dimIdx < embeddingDim; dimIdx++) {
            // Calculate the index in the flattened array
            const flatIndex = tokenIdx * embeddingDim + dimIdx;
            averagedEmbedding[dimIdx] += tensorData[flatIndex];
          }
        }
        
        // Divide by the number of tokens to get the average
        for (let dimIdx = 0; dimIdx < embeddingDim; dimIdx++) {
          averagedEmbedding[dimIdx] /= numTokens;
        }
        
        embedding = averagedEmbedding;
      } else if (Array.isArray(output)) {
        // Handle array output
        if (output.length > 0) {
          if (Array.isArray(output[0])) {
            embedding = output[0];
          } else {
            embedding = output;
          }
        }
      } else if (output && typeof output === 'object') {
        // For other object structures, try to find arrays in the object
        if ('data' in output) {
          embedding = output.data as number[];
        } else if ('embeddings' in output) {
          embedding = (output.embeddings as number[][])[0];
        }
      }
      
      // If we still don't have an embedding, throw an error
      if (!embedding) {
        console.error('Failed to extract embedding vector from output');
        throw new Error('Failed to extract embedding vector');
      }
      
      // Convert all values to numbers and check for NaN
      embedding = embedding.map(value => {
        const num = Number(value);
        return isNaN(num) ? 0 : num;
      });
      
      // Verify the embedding dimension
      if (embedding.length !== this.embeddingDimension) {
        // If the embedding is too large, truncate it
        if (embedding.length > this.embeddingDimension) {
          embedding = embedding.slice(0, this.embeddingDimension);
        }
        // If the embedding is too small, pad it with zeros
        else if (embedding.length < this.embeddingDimension) {
          const padding = new Array(this.embeddingDimension - embedding.length).fill(0);
          embedding = [...embedding, ...padding];
        }
      }
      
      return embedding;
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  /**
   * Set the embedding vector for a node
   * @param {number} nodeId - The ID of the node
   * @param {number[]} embedding - The embedding vector
   * @returns {Promise<void>}
   */
  private async setNodeEmbedding(nodeId: number, embedding: number[]): Promise<void> {
    try {
      // Ensure the embedding is a flat array of numbers
      if (Array.isArray(embedding)) {
        // If embedding is a nested array, flatten it
        if (embedding.some(item => Array.isArray(item))) {
          embedding = embedding.flat();
        }
        
        // Convert all values to numbers
        embedding = embedding.map(value => Number(value));
        
        // Verify the embedding dimension
        if (embedding.length !== this.embeddingDimension) {
          // If the embedding is too large, truncate it
          if (embedding.length > this.embeddingDimension) {
            embedding = embedding.slice(0, this.embeddingDimension);
          }
          // If the embedding is too small, pad it with zeros
          else if (embedding.length < this.embeddingDimension) {
            const padding = new Array(this.embeddingDimension - embedding.length).fill(0);
            embedding = [...embedding, ...padding];
          }
        }
      } else {
        throw new Error('Invalid embedding format');
      }
      
      // Use a simple SET operation to set the embedding property
      const query = `
        MATCH (n)
        WHERE id(n) = $nodeId
        SET n.embedding = $embedding
      `;
      
      await this.session.run(query, { nodeId, embedding });
      console.log(`Embedding set for node with ID ${nodeId}`);
    } catch (error) {
      console.error(`Failed to set embedding for node with ID ${nodeId}:`, error);
      throw error;
    }
  }

  private async initializeSchema(): Promise<void> {
    try {
      // Create constraints
      await this.session.run('CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT knowledge_id IF NOT EXISTS FOR (k:Knowledge) REQUIRE k.id IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT source IF NOT EXISTS FOR (s:Source) REQUIRE f.path IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT tag_category_name IF NOT EXISTS FOR (tc:TagCategory) REQUIRE tc.name IS UNIQUE');
      await this.session.run('CREATE CONSTRAINT tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE');
      
      // Create indexes
      await this.session.run('CREATE INDEX topic_name_idx IF NOT EXISTS FOR (t:Topic) ON (t.name)');
      await this.session.run('CREATE INDEX knowledge_id_idx IF NOT EXISTS FOR (k:Knowledge) ON (k.id)');
      await this.session.run('CREATE INDEX source_idx IF NOT EXISTS FOR (s:Source) ON (f.path)');
      await this.session.run('CREATE INDEX tag_category_name_idx IF NOT EXISTS FOR (tc:TagCategory) ON (tc.name)');
      await this.session.run('CREATE INDEX tag_name_idx IF NOT EXISTS FOR (t:Tag) ON (t.name)');
      
      // Create vector indexes for each node type
      try {
        // First check if vector indexes already exist
        const checkQuery = `
          SHOW INDEXES
          WHERE type = 'VECTOR'
        `;
        
        const result = await this.session.run(checkQuery);
        const existingIndexes = new Set(result.records.map(record => record.get('name')));
        
        // Create vector indexes if they don't exist
        const indexesToCreate = [
          { label: 'Topic', property: 'embedding' },
          { label: 'Knowledge', property: 'embedding' },
          { label: 'Tag', property: 'embedding' },
          { label: 'TagCategory', property: 'embedding' }
        ];
        
        for (const { label, property } of indexesToCreate) {
          const indexName = `${label.toLowerCase()}_${property}_idx`;
          if (!existingIndexes.has(indexName)) {
            await this.createVectorIndex(label, property);
          } else {
            console.log(`Vector index ${indexName} already exists`);
          }
        }
      } catch (vectorIndexError) {
        console.error('Failed to create vector indexes:', vectorIndexError);
        // Continue with schema initialization even if vector index creation fails
      }
    } catch (error) {
      console.error('Failed to initialize Neo4j schema:', error);
      throw error;
    }
  }

  /**
   * Create a vector index for a node label and property
   * @param {string} label - The node label
   * @param {string} property - The property name that will store the vector
   * @returns {Promise<void>}
   */
  private async createVectorIndex(label: string, property: string): Promise<void> {
    try {
      const indexName = `${label.toLowerCase()}_${property}_idx`;
      
      // Create the vector index with simplified syntax for Neo4j
      const createQuery = `
        CREATE VECTOR INDEX ${indexName} IF NOT EXISTS
        FOR (n:${label}) ON (n.${property})
        OPTIONS {
          indexConfig: {
            \`vector.dimensions\`: ${this.embeddingDimension},
            \`vector.similarity_function\`: 'cosine'
          }
        }
      `;
      
      await this.session.run(createQuery);
      console.log(`Vector index ${indexName} created successfully`);
    } catch (error) {
      console.error(`Failed to create vector index for ${label}.${property}:`, error);
      throw error;
    }
  }

  // New unified methods for knowledge graph operations
  
  /**
   * Create a node in the knowledge graph
   * @param nodeType The type of node to create (tag_category, tag, topic, knowledge, source)
   * @param name The name of the node (must be unique within its type)
   * @param description A description of the node
   * @param belongsTo Optional array of nodes this node belongs to
   * @param path Optional path for source nodes
   * @param additionalFields Optional additional fields for the node
   * @returns The created node's ID
   */
  async createNode(
    nodeType: 'tag_category' | 'tag' | 'topic' | 'knowledge' | 'source',
    name: string,
    description: string,
    belongsTo?: Array<{type: string, name: string}>,
    path?: string,
    additionalFields?: {[key: string]: any}
  ): Promise<number> {
    try {
      // Convert nodeType to Neo4j label format (e.g., tag_category -> TagCategory)
      const label = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Prepare properties based on node type
      const properties: {[key: string]: any} = {
        name,
        description,
        ...(additionalFields || {})
      };
      
      // Add path for source nodes
      if (nodeType === 'source' && path) {
        properties.path = path;
      }
      
      // For knowledge nodes, ensure they have a summary
      if (nodeType === 'knowledge' && !properties.summary) {
        properties.summary = name;
      }
      
      // Create the node
      const createQuery = `
        CREATE (n:${label})
        SET n = $properties
        RETURN id(n) as nodeId
      `;
      
      const createResult = await this.session.run(createQuery, { properties });
      const nodeId = createResult.records[0].get('nodeId').toNumber();
      
      // Generate and set embedding for the node name
      try {
        const embedding = await this.generateEmbedding(name);
        await this.setNodeEmbedding(nodeId, embedding);
      } catch (embeddingError) {
        console.error(`Failed to generate or set embedding for node ${name}:`, embeddingError);
        // Continue with node creation even if embedding fails
      }
      
      // Create belongs_to relationships if specified
      if (belongsTo && belongsTo.length > 0) {
        for (const parent of belongsTo) {
          const parentLabel = parent.type.split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
          
          const relationshipQuery = `
            MATCH (parent:${parentLabel} {name: $parentName})
            MATCH (child) WHERE id(child) = $childId
            CREATE (child)-[:BELONGS_TO]->(parent)
          `;
          
          await this.session.run(relationshipQuery, {
            parentName: parent.name,
            childId: nodeId
          });
        }
      }
      
      return nodeId;
    } catch (error) {
      console.error(`Failed to create ${nodeType} node:`, error);
      throw error;
    }
  }
  
  /**
   * Create an edge between nodes in the knowledge graph
   * @param sourceType The type of the source node
   * @param sourceName The name of the source node
   * @param targetType The type of the target node
   * @param targetName The name of the target node
   * @param relationship The type of relationship
   * @param description A description of the relationship
   * @returns The created edge's ID
   */
  async createEdge(
    sourceType: string,
    sourceName: string | string[],
    targetType: string,
    targetName: string | string[],
    relationship: string,
    description: string
  ): Promise<number> {
    try {
      // Convert types to Neo4j label format
      const sourceLabel = sourceType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      const targetLabel = targetType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Handle arrays of source and target names
      const sourceNames = Array.isArray(sourceName) ? sourceName : [sourceName];
      const targetNames = Array.isArray(targetName) ? targetName : [targetName];
      
      let edgeId = -1;
      
      // Create edges between all sources and targets
      for (const sName of sourceNames) {
        for (const tName of targetNames) {
          const query = `
            MATCH (source:${sourceLabel} {name: $sourceName})
            MATCH (target:${targetLabel} {name: $targetName})
            CREATE (source)-[r:RELATES {relationship: $relationship, description: $description}]->(target)
            RETURN id(r) as edgeId
          `;
          
          const result = await this.session.run(query, {
            sourceName: sName,
            targetName: tName,
            relationship,
            description
          });
          
          // Store the ID of the last created edge
          edgeId = result.records[0].get('edgeId').toNumber();
        }
      }
      
      return edgeId;
    } catch (error) {
      console.error('Failed to create edge:', error);
      throw error;
    }
  }
  
  /**
   * Alter or delete a node in the knowledge graph
   * @param nodeType The type of node to alter
   * @param nodeId The ID of the node to alter
   * @param delete Whether to delete the node
   * @param fields The fields to update
   * @returns Success message
   */
  async alterNode(
    nodeType: string,
    nodeId: number,
    deleteNode: boolean,
    fields?: {[key: string]: any}
  ): Promise<string> {
    try {
      // Convert nodeType to Neo4j label format
      const label = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      if (deleteNode) {
        // Delete the node
        const query = `
          MATCH (n:${label})
          WHERE id(n) = $nodeId
          DETACH DELETE n
        `;
        
        await this.session.run(query, { nodeId });
        return `Node with ID ${nodeId} deleted successfully`;
      } else if (fields) {
        // Update the node
        const setStatements = Object.entries(fields)
          .map(([key, _]) => `n.${key} = $fields.${key}`)
          .join(', ');
        
        const query = `
          MATCH (n:${label})
          WHERE id(n) = $nodeId
          SET ${setStatements}
          RETURN n
        `;
        
        await this.session.run(query, { nodeId, fields });
        
        // If the name field was updated, regenerate the embedding
        if (fields.name) {
          try {
            const embedding = await this.generateEmbedding(fields.name);
            await this.setNodeEmbedding(nodeId, embedding);
          } catch (embeddingError) {
            console.error(`Failed to update embedding for node with ID ${nodeId}:`, embeddingError);
            // Continue with node update even if embedding update fails
          }
        }
        
        return `Node with ID ${nodeId} updated successfully`;
      } else {
        throw new Error('Either delete must be true or fields must be provided');
      }
    } catch (error) {
      console.error('Failed to alter node:', error);
      throw error;
    }
  }
  
  /**
   * Search the knowledge graph using flexible Cypher query components
   * @param matchClause The Cypher MATCH clause (e.g., '(n:Topic)', '(a:Knowledge)-[r]-(b:Knowledge)')
   * @param whereClause Optional Cypher WHERE clause for filtering
   * @param returnClause The Cypher RETURN clause specifying what to return (e.g., 'n', 'a, type(r), b')
   * @param params Optional parameters for the query
   * @returns The query results (limited to 20 records)
   */
  async searchGraph(
    matchClause: string,
    whereClause?: string,
    returnClause?: string,
    params?: {[key: string]: any}
  ): Promise<string> {
    try {
      let query = `MATCH ${matchClause}`;
      
      if (whereClause) {
        query += ` WHERE ${whereClause}`;
      }
      
      query += ` RETURN ${returnClause || matchClause.match(/\(([a-zA-Z0-9_]+)\)/)?.[1] || '*'} LIMIT 20`;
      
      const result = await this.session.run(query, params || {});
      
      // Process the records based on the returned data
      const records = result.records.map((record: Record) => {
        const recordObj: { [key: string]: any } = {};
        const keys = record.keys.map(key => String(key));
        
        for (const key of keys) {
          const value = record.get(key);
          if (neo4j.default.isNode(value)) {
            const node = value as Node;
            recordObj[key] = {
              id: node.identity.toNumber(),
              labels: node.labels,
              properties: this.formatNeo4jValue(node.properties)
            };
          } else if (neo4j.default.isRelationship(value)) {
            const rel = value as Relationship;
            recordObj[key] = {
              type: rel.type,
              properties: this.formatNeo4jValue(rel.properties),
              start: rel.start.toNumber(),
              end: rel.end.toNumber(),
              identity: rel.identity.toNumber()
            };
          } else {
            recordObj[key] = this.formatNeo4jValue(value);
          }
        }
        return recordObj;
      });
      
      return JSON.stringify(records, null, 2);
    } catch (error) {
      console.error('Failed to search nodes:', error);
      throw error;
    }
  }
  
  /**
   * Search for nodes similar to a text query using vector similarity
   * @param {string} nodeType - The type of node to search for
   * @param {string} text - The text to search for
   * @param {number} limit - Maximum number of results to return
   * @param {number} minSimilarity - Minimum similarity score (0-1)
   * @returns {Promise<string>} - The search results
   */
  async vectorSearch(
    nodeType: string,
    text: string,
    limit: number = 10,
    minSimilarity: number = 0.7
  ): Promise<string> {
    try {
      // Generate embedding for the search text
      const embedding = await this.generateEmbedding(text);
      
      // Convert nodeType to Neo4j label format
      const label = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Get the vector index name
      const indexName = `${label.toLowerCase()}_embedding_idx`;
      
      // First try using the vector index directly with db.index.vector.queryNodes
      try {
        console.log(`Attempting vector search using index: ${indexName}`);
        const vectorIndexQuery = `
          CALL db.index.vector.queryNodes('${indexName}', $limit, $embedding)
          YIELD node, score
          WHERE score >= $minSimilarity
          RETURN node.name AS name, node.description AS description, id(node) AS id, score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(vectorIndexQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.default.int(limit)
        });
        
        // Check if we got results
        if (result.records.length > 0) {
          console.log(`Vector index search successful using db.index.vector.queryNodes, found ${result.records.length} results`);
          
          const records = result.records.map(record => ({
            id: record.get('id').toNumber(),
            name: record.get('name'),
            description: record.get('description'),
            score: record.get('score')
          }));
          
          return JSON.stringify(records, null, 2);
        } else {
          console.log('No results from vector index search, trying with vector.similarity.cosine');
        }
      } catch (vectorIndexError) {
        console.error('Failed to use db.index.vector.queryNodes, falling back to vector.similarity.cosine:', vectorIndexError);
      }
      
      // If vector index search fails or returns no results, try with vector.similarity.cosine
      try {
        console.log('Attempting vector search using vector.similarity.cosine');
        const similarityQuery = `
          MATCH (n:${label})
          WHERE n.embedding IS NOT NULL
          WITH n, vector.similarity.cosine(n.embedding, $embedding) AS score
          WHERE score >= $minSimilarity
          RETURN n.name AS name, n.description AS description, id(n) AS id, score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(similarityQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.default.int(limit)
        });
        
        console.log(`Vector similarity search successful using vector.similarity.cosine, found ${result.records.length} results`);
        
        const records = result.records.map(record => ({
          id: record.get('id').toNumber(),
          name: record.get('name'),
          description: record.get('description'),
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      } catch (error) {
        console.error('Failed to use vector.similarity.cosine, falling back to basic search:', error);
        
        // If all vector similarity methods fail, fall back to a basic search
        console.log('Falling back to basic search without vector similarity');
        const query = `
          MATCH (n:${label})
          WHERE n.embedding IS NOT NULL
          RETURN n.name AS name, n.description AS description, id(n) AS id, 1.0 AS score
          LIMIT $limit
        `;
        
        const result = await this.session.run(query, {
          limit: neo4j.default.int(limit)
        });
        
        const records = result.records.map(record => ({
          id: record.get('id').toNumber(),
          name: record.get('name'),
          description: record.get('description'),
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      }
    } catch (error) {
      console.error('Failed to perform vector search:', error);
      throw error;
    }
  }

  /**
   * Perform a hybrid search combining vector similarity with graph structure
   * @param {string} nodeType - The type of node to search for
   * @param {string} text - The text to search for
   * @param {string} relationshipType - The type of relationship to traverse
   * @param {string} targetType - The type of target node
   * @param {number} limit - Maximum number of results to return
   * @param {number} minSimilarity - Minimum similarity score (0-1)
   * @returns {Promise<string>} - The search results
   */
  async hybridSearch(
    nodeType: string,
    text: string,
    relationshipType: string,
    targetType: string,
    limit: number = 10,
    minSimilarity: number = 0.7
  ): Promise<string> {
    try {
      // Generate embedding for the search text
      const embedding = await this.generateEmbedding(text);
      
      // Convert types to Neo4j label format
      const sourceLabel = nodeType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      const targetLabel = targetType.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      
      // Get the vector index name
      const indexName = `${sourceLabel.toLowerCase()}_embedding_idx`;
      
      // First try using the vector index directly with db.index.vector.queryNodes
      try {
        console.log(`Attempting hybrid search using index: ${indexName}`);
        const vectorIndexQuery = `
          // First find similar nodes using the vector index
          CALL db.index.vector.queryNodes('${indexName}', $limit * 2, $embedding)
          YIELD node as source, score
          WHERE score >= $minSimilarity
          
          // Then match the related nodes through the specified relationship
          MATCH (source)-[r:${relationshipType}]-(target:${targetLabel})
          
          RETURN
            source.name AS sourceName,
            source.description AS sourceDescription,
            id(source) AS sourceId,
            type(r) AS relationshipType,
            target.name AS targetName,
            target.description AS targetDescription,
            id(target) AS targetId,
            score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(vectorIndexQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.default.int(limit)
        });
        
        // Check if we got results
        if (result.records.length > 0) {
          console.log(`Hybrid vector index search successful using db.index.vector.queryNodes, found ${result.records.length} results`);
          
          const records = result.records.map(record => ({
            source: {
              id: record.get('sourceId').toNumber(),
              name: record.get('sourceName'),
              description: record.get('sourceDescription')
            },
            relationship: {
              type: record.get('relationshipType')
            },
            target: {
              id: record.get('targetId').toNumber(),
              name: record.get('targetName'),
              description: record.get('targetDescription')
            },
            score: record.get('score')
          }));
          
          return JSON.stringify(records, null, 2);
        } else {
          console.log('No results from hybrid vector index search, trying with vector.similarity.cosine');
        }
      } catch (vectorIndexError) {
        console.error('Failed to use db.index.vector.queryNodes for hybrid search, falling back to vector.similarity.cosine:', vectorIndexError);
      }
      
      // If vector index search fails or returns no results, try with vector.similarity.cosine
      try {
        console.log('Attempting hybrid search using vector.similarity.cosine');
        const similarityQuery = `
          MATCH (source:${sourceLabel})-[r:${relationshipType}]-(target:${targetLabel})
          WHERE source.embedding IS NOT NULL
          WITH source, r, target, vector.similarity.cosine(source.embedding, $embedding) AS score
          WHERE score >= $minSimilarity
          RETURN
            source.name AS sourceName,
            source.description AS sourceDescription,
            id(source) AS sourceId,
            type(r) AS relationshipType,
            target.name AS targetName,
            target.description AS targetDescription,
            id(target) AS targetId,
            score
          ORDER BY score DESC
          LIMIT $limit
        `;
        
        const result = await this.session.run(similarityQuery, {
          embedding,
          minSimilarity,
          limit: neo4j.default.int(limit)
        });
        
        console.log(`Hybrid similarity search successful using vector.similarity.cosine, found ${result.records.length} results`);
        
        const records = result.records.map(record => ({
          source: {
            id: record.get('sourceId').toNumber(),
            name: record.get('sourceName'),
            description: record.get('sourceDescription')
          },
          relationship: {
            type: record.get('relationshipType')
          },
          target: {
            id: record.get('targetId').toNumber(),
            name: record.get('targetName'),
            description: record.get('targetDescription')
          },
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      } catch (error) {
        console.error('Failed to use vector.similarity.cosine for hybrid search, falling back to basic search:', error);
        
        // If all vector similarity methods fail, fall back to a basic search
        console.log('Falling back to basic search without vector similarity');
        const query = `
          MATCH (source:${sourceLabel})-[r:${relationshipType}]-(target:${targetLabel})
          RETURN
            source.name AS sourceName,
            source.description AS sourceDescription,
            id(source) AS sourceId,
            type(r) AS relationshipType,
            target.name AS targetName,
            target.description AS targetDescription,
            id(target) AS targetId,
            1.0 AS score
          LIMIT $limit
        `;
        
        const result = await this.session.run(query, {
          limit: neo4j.default.int(limit)
        });
        
        const records = result.records.map(record => ({
          source: {
            id: record.get('sourceId').toNumber(),
            name: record.get('sourceName'),
            description: record.get('sourceDescription')
          },
          relationship: {
            type: record.get('relationshipType')
          },
          target: {
            id: record.get('targetId').toNumber(),
            name: record.get('targetName'),
            description: record.get('targetDescription')
          },
          score: record.get('score')
        }));
        
        return JSON.stringify(records, null, 2);
      }
    } catch (error) {
      console.error('Failed to perform hybrid search:', error);
      throw error;
    }
  }

  async executeQuery(query: string): Promise<string> {
    try {
      const result = await this.session.run(query);
      const records = result.records.map((record: Record) => {
        const recordObj: { [key: string]: any } = {};
        const keys = record.keys.map(key => String(key));
        
        for (const key of keys) {
          const value = record.get(key);
          if (neo4j.default.isNode(value)) {
            const node = value as Node;
            recordObj[key] = {
              labels: node.labels,
              properties: this.formatNeo4jValue(node.properties),
              identity: node.identity.toNumber()
            };
          } else if (neo4j.default.isRelationship(value)) {
            const rel = value as Relationship;
            recordObj[key] = {
              type: rel.type,
              properties: this.formatNeo4jValue(rel.properties),
              start: rel.start.toNumber(),
              end: rel.end.toNumber(),
              identity: rel.identity.toNumber()
            };
          } else {
            recordObj[key] = this.formatNeo4jValue(value);
          }
        }
        return recordObj;
      });
      // Limit the number of records to 20
      const limitedRecords = records.slice(0, 20);
      return JSON.stringify(limitedRecords, null, 2);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to execute query: ${error.message}`);
      }
      throw error;
    }
  }

  private formatNeo4jValue(value: any): any {
    if (neo4j.default.isInt(value)) {
      return (value as Integer).toNumber();
    } else if (Array.isArray(value)) {
      return value.map(v => this.formatNeo4jValue(v));
    } else if (value && typeof value === 'object') {
      const formatted: { [key: string]: any } = {};
      for (const key in value) {
        formatted[key] = this.formatNeo4jValue(value[key]);
      }
      return formatted;
    }
    return value;
  }

  // Legacy methods removed

  async close(): Promise<void> {
    await this.session.close();
    await this.driver.close();
  }
}

let neo4jManager: Neo4jManager;

// Initialize neo4jManager before starting server
async function initializeNeo4jManager(): Promise<void> {
  neo4jManager = await Neo4jManager.initialize();
}

// The server instance and tools exposed to Claude
const server = new Server({
  name: "graphrag-knowledge",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {
      // Knowledge graph tools
      knowledge_create_node: {},
      knowledge_create_edge: {},
      knowledge_alter: {},
      knowledge_search: {},
      knowledge_unsafe_query: {},
      knowledge_vector_search: {},
      knowledge_hybrid_search: {}
    },
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Legacy knowledge tools removed - use knowledge_* tools instead
      {
        name: "knowledge_create_node",
        description: "Create a node in the knowledge graph. Node types include: tag_category, tag, topic, knowledge, source. Each node has a name and description, and can optionally belong to other nodes. Source nodes require a path to the document or URL acting as a data source. Knowledge node data is entered into additional fields.",
        inputSchema: {
          type: "object",
          properties: {
            nodeType: {
              type: "string",
              description: "The type of node to create (tag_category, tag, topic, knowledge, source)",
              enum: ["tag_category", "tag", "topic", "knowledge", "source"]
            },
            name: {
              type: "string",
              description: "The name of the node (must be unique within its type)"
            },
            description: {
              type: "string",
              description: "A description of the node"
            },
            belongsTo: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    description: "The type of parent node"
                  },
                  name: {
                    type: "string",
                    description: "The name of parent node"
                  }
                },
                required: ["type", "name"]
              },
              description: "Optional array of nodes this node belongs to"
            },
            path: {
              type: "string",
              description: "Optional path for source nodes"
            },
            additionalFields: {
              type: "object",
              description: "Optional additional fields for the node"
            }
          },
          required: ["nodeType", "name", "description"],
        },
      },
      {
        name: "knowledge_create_edge",
        description: "Create an edge (relationship) between nodes in the knowledge graph. The relationship can be between any node types.",
        inputSchema: {
          type: "object",
          properties: {
            sourceType: {
              type: "string",
              description: "The type of the source node"
            },
            sourceName: {
              type: "string",
              description: "The name of the source node (or array of names)"
            },
            targetType: {
              type: "string",
              description: "The type of the target node"
            },
            targetName: {
              type: "string",
              description: "The name of the target node (or array of names)"
            },
            relationship: {
              type: "string",
              description: "The type of relationship"
            },
            description: {
              type: "string",
              description: "A description of the relationship"
            }
          },
          required: ["sourceType", "sourceName", "targetType", "targetName", "relationship", "description"],
        },
      },
      {
        name: "knowledge_alter",
        description: "Alter or delete a node in the knowledge graph. Can update fields or delete the node entirely.",
        inputSchema: {
          type: "object",
          properties: {
            nodeType: {
              type: "string",
              description: "The type of node to alter"
            },
            nodeId: {
              type: "number",
              description: "The ID of the node to alter"
            },
            deleteNode: {
              type: "boolean",
              description: "Whether to delete the node"
            },
            fields: {
              type: "object",
              description: "The fields to update (required if deleteNode is false)"
            }
          },
          required: ["nodeType", "nodeId", "deleteNode"],
        },
      },
      {
        name: "knowledge_search",
        description: "Search the knowledge graph using flexible Cypher query components. Results are limited to a maximum of 20 records. This tool can search for nodes, relationships, or any combination of graph patterns.",
        inputSchema: {
          type: "object",
          properties: {
            matchClause: {
              type: "string",
              description: "The Cypher MATCH clause specifying what to match. Examples: '(n:Topic)', '(a:Knowledge)-[r]-(b:Knowledge)', '(t:Topic)-[r:contains]->(k:Knowledge)'"
            },
            whereClause: {
              type: "string",
              description: "Optional Cypher WHERE clause for filtering. Examples: 'n.name CONTAINS \"Quantum\"', 'a.id = 7 AND b.id = 15'"
            },
            returnClause: {
              type: "string",
              description: "Optional Cypher RETURN clause specifying what to return. If omitted, returns the first variable in the match clause. Examples: 'n', 'a, type(r), b', 'a.summary AS Source, type(r) AS Relationship, b.summary AS Target'"
            },
            params: {
              type: "object",
              description: "Optional parameters for the query"
            }
          },
          required: ["matchClause"],
        },
      },
      {
        name: "knowledge_unsafe_query",
        description: "Execute an arbitrary Cypher query against the Neo4j knowledge graph. Results are limited to a maximum of 20 records. This tool should be used as a last resort when the other tools are insufficient. Use with caution as it can potentially damage the knowledge graph if used incorrectly.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The Cypher query to execute against the Neo4j database."
            }
          },
          required: ["query"],
        },
      },
      {
        name: "knowledge_vector_search",
        description: "Search for nodes similar to a text query using vector similarity. This tool uses the vector embeddings to find semantically similar nodes.",
        inputSchema: {
          type: "object",
          properties: {
            nodeType: {
              type: "string",
              description: "The type of node to search for (tag_category, tag, topic, knowledge)",
              enum: ["tag_category", "tag", "topic", "knowledge"]
            },
            text: {
              type: "string",
              description: "The text to search for"
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
              default: 10
            },
            minSimilarity: {
              type: "number",
              description: "Minimum similarity score (0-1)",
              default: 0.7
            }
          },
          required: ["nodeType", "text"]
        },
      },
      {
        name: "knowledge_hybrid_search",
        description: "Perform a hybrid search combining vector similarity with graph structure. This tool finds nodes that are both semantically similar to the query text and connected to other nodes through specific relationships.",
        inputSchema: {
          type: "object",
          properties: {
            nodeType: {
              type: "string",
              description: "The type of node to search for (tag_category, tag, topic, knowledge)",
              enum: ["tag_category", "tag", "topic", "knowledge"]
            },
            text: {
              type: "string",
              description: "The text to search for"
            },
            relationshipType: {
              type: "string",
              description: "The type of relationship to traverse"
            },
            targetType: {
              type: "string",
              description: "The type of target node",
              enum: ["tag_category", "tag", "topic", "knowledge"]
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return",
              default: 10
            },
            minSimilarity: {
              type: "number",
              description: "Minimum similarity score (0-1)",
              default: 0.7
            }
          },
          required: ["nodeType", "text", "relationshipType", "targetType"]
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    // New unified knowledge graph tools
    case "knowledge_create_node":
      const nodeId = await neo4jManager.createNode(
        args.nodeType as 'tag_category' | 'tag' | 'topic' | 'knowledge' | 'source',
        args.name as string,
        args.description as string,
        args.belongsTo as Array<{type: string, name: string}> | undefined,
        args.path as string | undefined,
        args.additionalFields as {[key: string]: any} | undefined
      );
      return { content: [{ type: "text", text: `Node created successfully with ID: ${nodeId}` }] };
    
    case "knowledge_create_edge":
      const edgeId = await neo4jManager.createEdge(
        args.sourceType as string,
        args.sourceName as string | string[],
        args.targetType as string,
        args.targetName as string | string[],
        args.relationship as string,
        args.description as string
      );
      return { content: [{ type: "text", text: `Edge created successfully with ID: ${edgeId}` }] };
    
    case "knowledge_alter":
      const alterResult = await neo4jManager.alterNode(
        args.nodeType as string,
        args.nodeId as number,
        args.deleteNode as boolean,
        args.fields as {[key: string]: any} | undefined
      );
      return { content: [{ type: "text", text: alterResult }] };
    
    case "knowledge_search":
      return { content: [{ type: "text", text: await neo4jManager.searchGraph(
        args.matchClause as string,
        args.whereClause as string | undefined,
        args.returnClause as string | undefined,
        args.params as {[key: string]: any} | undefined
      ) }] };
    
    case "knowledge_unsafe_query":
      return { content: [{ type: "text", text: await neo4jManager.executeQuery(args.query as string) }] };
    
    case "knowledge_vector_search":
      return { content: [{ type: "text", text: await neo4jManager.vectorSearch(
        args.nodeType as string,
        args.text as string,
        args.limit as number | undefined,
        args.minSimilarity as number | undefined
      ) }] };
    
    case "knowledge_hybrid_search":
      return { content: [{ type: "text", text: await neo4jManager.hybridSearch(
        args.nodeType as string,
        args.text as string,
        args.relationshipType as string,
        args.targetType as string,
        args.limit as number | undefined,
        args.minSimilarity as number | undefined
      ) }] };
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  try {
    await initializeNeo4jManager();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Knowledge Graph MCP Server running on stdio");

    // Set up cleanup on process exit
    process.on('SIGINT', async () => {
      await neo4jManager.close();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await neo4jManager.close();
      process.exit(0);
    });
  } catch (error) {
    console.error("Initialization error:", error);
    throw error;
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});