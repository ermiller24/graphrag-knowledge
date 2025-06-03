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
// import * as Mustache from 'mustache';

// Type definitions
interface NodeData {
  id: string;
  name: string;
  summary: string;
  node_type?: string;
  template_id?: string;
  properties?: {[key: string]: any};
  relationships?: Array<{
    target_id: string;
    relationship_type: string;
    direction?: "forward" | "reverse";
    relevance_strength?: "weak" | "medium" | "strong";
    properties?: {[key: string]: any};
  }>;
}

interface RelationshipData {
  id?: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
  direction?: "forward" | "reverse";
  relevance_strength?: "weak" | "medium" | "strong";
  properties?: {[key: string]: any};
}

interface DocumentGenerationOptions {
  force_regenerate?: boolean;
  include_dependencies?: boolean;
  template_override?: string;
}

interface SearchResult {
  id: string;
  name: string;
  type: string;
  summary: string;
  similarity_score: number;
}

interface PathResult {
  path_id: number;
  length: number;
  strength: number;
  nodes: Array<{id: string; name: string}>;
  relationships: Array<{
    type: string;
    direction: "forward" | "backward";
    edge_strength: number;
    source: string;
    target: string;
    properties?: {[key: string]: any};
  }>;
  narrative: string;
  strength_breakdown: {
    raw_strength: number;
    length_penalty: number;
    final_strength: number;
  };
}

// Neo4j database manager class
class Neo4jManager {
  private driver: neo4j.Driver;
  private session: neo4j.Session;
  private embeddingModel: string;
  private embeddingDimension: number;
  private embeddingPipeline: any;

  static async initialize(): Promise<Neo4jManager> {
    const manager = new Neo4jManager();
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
   */
  private async initializeEmbeddingPipeline(): Promise<void> {
    if (!this.embeddingPipeline) {
      try {
        console.error(`Initializing embedding pipeline with model: ${this.embeddingModel}`);
        this.embeddingPipeline = await pipeline('feature-extraction', this.embeddingModel);
        console.error('Embedding pipeline initialized successfully');
      } catch (error) {
        console.error('Failed to initialize embedding pipeline:', error);
        throw error;
      }
    }
  }

  /**
   * Generate embeddings for a text string
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    await this.initializeEmbeddingPipeline();
    
    try {
      console.error(`Generating embedding for text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      const output = await this.embeddingPipeline(text);
      let embedding: number[] | null = null;
      
      // Handle Tensor object from @huggingface/transformers
      if (output && typeof output === 'object' && 'ort_tensor' in output && output.ort_tensor && 'cpuData' in output.ort_tensor) {
        const tensorData = output.ort_tensor.cpuData;
        const dims = output.ort_tensor.dims;
        const numTokens = dims[1];
        const embeddingDim = dims[2];
        
        const averagedEmbedding = new Array(embeddingDim).fill(0);
        
        for (let tokenIdx = 0; tokenIdx < numTokens; tokenIdx++) {
          for (let dimIdx = 0; dimIdx < embeddingDim; dimIdx++) {
            const flatIndex = tokenIdx * embeddingDim + dimIdx;
            averagedEmbedding[dimIdx] += tensorData[flatIndex];
          }
        }
        
        for (let dimIdx = 0; dimIdx < embeddingDim; dimIdx++) {
          averagedEmbedding[dimIdx] /= numTokens;
        }
        
        embedding = averagedEmbedding;
      } else if (Array.isArray(output)) {
        if (output.length > 0) {
          if (Array.isArray(output[0])) {
            embedding = output[0];
          } else {
            embedding = output;
          }
        }
      }
      
      if (!embedding) {
        throw new Error('Failed to extract embedding vector');
      }
      
      // Convert all values to numbers and check for NaN
      embedding = embedding.map(value => {
        const num = Number(value);
        return isNaN(num) ? 0 : num;
      });
      
      // Ensure correct dimension
      if (embedding.length !== this.embeddingDimension) {
        if (embedding.length > this.embeddingDimension) {
          embedding = embedding.slice(0, this.embeddingDimension);
        } else if (embedding.length < this.embeddingDimension) {
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
   * Create or update a vector index for a node
   */
  private async createVectorIndex(nodeId: string, text: string): Promise<string> {
    try {
      const embedding = await this.generateEmbedding(text);
      const vectorIndexId = `vector-${nodeId}-${Date.now()}`;
      
      const query = `
        MATCH (n:Node {id: $nodeId})
        
        // Remove existing vector index
        OPTIONAL MATCH (n)-[r:VECTOR_INDEXED_AT]->(oldV:VectorIndex)
        DELETE r, oldV
        
        // Create new vector index
        CREATE (v:VectorIndex {
          id: $vectorIndexId,
          embedding: $embedding,
          model: $model,
          dimension: $dimension,
          indexed_at: timestamp()
        })
        CREATE (n)-[:VECTOR_INDEXED_AT]->(v)
        RETURN v.id as vectorIndexId
      `;
      
      const result = await this.session.run(query, {
        nodeId,
        vectorIndexId,
        embedding,
        model: this.embeddingModel,
        dimension: this.embeddingDimension
      });
      
      return result.records[0].get('vectorIndexId');
    } catch (error) {
      console.error(`Failed to create vector index for node ${nodeId}:`, error);
      throw error;
    }
  }

  /**
   * Manage nodes (create, update, delete)
   */
  async manageNodes(operation: "create" | "update" | "delete", nodes: NodeData[]): Promise<any> {
    const results = [];
    
    for (const nodeData of nodes) {
      try {
        let result;
        
        switch (operation) {
          case "create":
            result = await this.createNode(nodeData);
            break;
          case "update":
            result = await this.updateNode(nodeData);
            break;
          case "delete":
            result = await this.deleteNode(nodeData.id!);
            break;
        }
        
        results.push({
          node_id: nodeData.id || result?.node_id,
          operation,
          status: "success",
          message: result?.message,
          created_relationships: result?.created_relationships || 0
        });
      } catch (error) {
        results.push({
          node_id: nodeData.id,
          operation,
          status: "error",
          message: (error as Error).message
        });
      }
    }
    
    return { results };
  }

  private async createNode(nodeData: NodeData): Promise<any> {
    const nodeId = nodeData.id || `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const properties = {
      id: nodeId,
      name: nodeData.name,
      summary: nodeData.summary,
      created_date: Date.now(),
      last_modified_date: Date.now(),
      ...(nodeData.properties || {})
    };
    
    // Add node type as label if specified
    const labels = nodeData.node_type ? `:Node:${nodeData.node_type}` : ':Node';
    
    const query = `
      CREATE (n${labels})
      SET n = $properties
      RETURN n.id as nodeId
    `;
    
    const result = await this.session.run(query, { properties });
    const createdNodeId = result.records[0].get('nodeId');
    
    // Create vector index
    try {
      await this.createVectorIndex(createdNodeId, `${nodeData.name} ${nodeData.summary}`);
    } catch (embeddingError) {
      console.error(`Failed to create vector index for node ${createdNodeId}:`, embeddingError);
    }
    
    return {
      node_id: createdNodeId,
      message: `Node created successfully`
    };
  }

  private async updateNode(nodeData: NodeData): Promise<any> {
    if (!nodeData.id) {
      throw new Error('Node ID is required for update operation');
    }
    
    const updateProperties = {
      name: nodeData.name,
      summary: nodeData.summary,
      last_modified_date: Date.now(),
      ...(nodeData.properties || {})
    };
    
    const query = `
      MATCH (n:Node {id: $nodeId})
      SET n += $properties
      RETURN n.id as nodeId
    `;
    
    const result = await this.session.run(query, { 
      nodeId: nodeData.id, 
      properties: updateProperties 
    });
    
    if (result.records.length === 0) {
      throw new Error(`Node with ID ${nodeData.id} not found`);
    }
    
    return {
      node_id: nodeData.id,
      message: `Node updated successfully`
    };
  }

  private async deleteNode(nodeId: string): Promise<any> {
    const query = `
      MATCH (n:Node {id: $nodeId})
      OPTIONAL MATCH (n)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
      OPTIONAL MATCH (n)-[:CACHED_AT]->(c:CachedDocument)
      DETACH DELETE n, v, c
    `;
    
    await this.session.run(query, { nodeId });
    
    return {
      node_id: nodeId,
      message: `Node deleted successfully`
    };
  }

  /**
   * Manage relationships (create, update, delete)
   */
  async manageRelationships(operation: "create" | "update" | "delete", relationships: RelationshipData[]): Promise<any> {
    const results = [];
    
    for (const relData of relationships) {
      try {
        let result;
        
        switch (operation) {
          case "create":
            result = await this.createRelationshipInternal(
              relData.source_id,
              relData.target_id,
              relData.relationship_type,
              relData.direction || "forward",
              relData.relevance_strength || "medium",
              relData.properties || {}
            );
            break;
          case "update":
            result = await this.updateRelationship(relData);
            break;
          case "delete":
            result = await this.deleteRelationship(relData.id!);
            break;
        }
        
        results.push({
          relationship_id: relData.id || result?.relationship_id,
          operation,
          status: "success",
          message: result?.message
        });
      } catch (error) {
        results.push({
          relationship_id: relData.id,
          operation,
          status: "error",
          message: (error as Error).message
        });
      }
    }
    
    return { results };
  }

  private async createRelationshipInternal(
    sourceId: string,
    targetId: string,
    relationshipType: string,
    direction: "forward" | "reverse",
    relevanceStrength: "weak" | "medium" | "strong",
    properties: {[key: string]: any}
  ): Promise<any> {
    const actualSourceId = direction === "forward" ? sourceId : targetId;
    const actualTargetId = direction === "forward" ? targetId : sourceId;
    
    const relProperties = {
      relevance_strength: relevanceStrength,
      created_date: Date.now(),
      ...properties
    };
    
    const query = `
      MATCH (source:Node {id: $sourceId})
      MATCH (target:Node {id: $targetId})
      CREATE (source)-[r:${relationshipType}]->(target)
      SET r = $properties
      RETURN id(r) as relationshipId
    `;
    
    const result = await this.session.run(query, {
      sourceId: actualSourceId,
      targetId: actualTargetId,
      properties: relProperties
    });
    
    return {
      relationship_id: result.records[0].get('relationshipId').toString(),
      message: `Relationship created successfully`
    };
  }

  private async updateRelationship(relData: RelationshipData): Promise<any> {
    if (!relData.id) {
      throw new Error('Relationship ID is required for update operation');
    }
    
    const updateProperties = {
      relevance_strength: relData.relevance_strength || "medium",
      last_modified_date: Date.now(),
      ...(relData.properties || {})
    };
    
    const query = `
      MATCH ()-[r]->()
      WHERE id(r) = $relationshipId
      SET r += $properties
      RETURN id(r) as relationshipId
    `;
    
    const result = await this.session.run(query, {
      relationshipId: parseInt(relData.id),
      properties: updateProperties
    });
    
    if (result.records.length === 0) {
      throw new Error(`Relationship with ID ${relData.id} not found`);
    }
    
    return {
      relationship_id: relData.id,
      message: `Relationship updated successfully`
    };
  }

  private async deleteRelationship(relationshipId: string): Promise<any> {
    const query = `
      MATCH ()-[r]->()
      WHERE id(r) = $relationshipId
      DELETE r
    `;
    
    await this.session.run(query, { relationshipId: parseInt(relationshipId) });
    
    return {
      relationship_id: relationshipId,
      message: `Relationship deleted successfully`
    };
  }

  /**
   * Generate documents for nodes using templates
   */
  async generateDocuments(nodeIdentifiers: string[], options: DocumentGenerationOptions = {}): Promise<any> {
    const documents = [];
    
    for (const identifier of nodeIdentifiers) {
      try {
        // Simple document generation for now
        const nodeQuery = `MATCH (n:Node {id: $identifier}) RETURN n
                          UNION
                          MATCH (n:Node) WHERE toLower(n.name) = toLower($identifier) RETURN n LIMIT 1`;
        
        const result = await this.session.run(nodeQuery, { identifier });
        
        if (result.records.length === 0) {
          throw new Error(`Node not found for identifier: ${identifier}`);
        }
        
        const node = result.records[0].get('n');
        const content = `# ${node.properties.name}\n\n${node.properties.summary || 'No summary available'}`;
        
        documents.push({
          node_id: node.properties.id,
          node_name: node.properties.name,
          content,
          generated_at: Date.now(),
          from_cache: false,
          dependencies: [],
          template_used: 'default-template'
        });
      } catch (error) {
        console.error(`Failed to generate document for identifier ${identifier}:`, error);
        documents.push({
          node_id: identifier,
          node_name: identifier,
          content: `Error generating document: ${(error as Error).message}`,
          generated_at: Date.now(),
          from_cache: false,
          dependencies: [],
          template_used: 'error'
        });
      }
    }
    
    return { documents };
  }

  /**
   * Explore neighborhoods around search terms
   */
  async exploreNeighborhoods(
    searchTerms: string[],
    searchStrategy: "vector" | "text" | "combined" = "combined",
    maxResultsPerTerm: number = 3,
    neighborhoodDepth: number = 2,
    includeRelationshipTypes: boolean = true,
    includeTemplates: boolean = true
  ): Promise<any> {
    const neighborhoods: {[term: string]: any} = {};
    
    for (const term of searchTerms) {
      try {
        // Simple text search for now
        const searchQuery = `
          MATCH (n:Node)
          WHERE toLower(n.name) CONTAINS toLower($term) 
             OR toLower(n.summary) CONTAINS toLower($term)
          RETURN n.id as id, n.name as name, 
                 coalesce(labels(n)[1], 'Node') as type,
                 n.summary as summary, 1.0 as similarity_score
          LIMIT $limit
        `;
        
        const result = await this.session.run(searchQuery, { term, limit: maxResultsPerTerm });
        const primaryNodes = result.records.map(record => ({
          id: record.get('id'),
          name: record.get('name'),
          type: record.get('type'),
          summary: record.get('summary') || '',
          similarity_score: record.get('similarity_score')
        }));
        
        // Get relationships for primary nodes
        const relationships = [];
        for (const node of primaryNodes) {
          const relQuery = `
            MATCH (n:Node {id: $nodeId})-[r]-(connected:Node)
            RETURN type(r) as type, connected.id as connected_id, connected.name as connected_name
            LIMIT 5
          `;
          
          const relResult = await this.session.run(relQuery, { nodeId: node.id });
          relationships.push(...relResult.records.map(record => ({
            type: record.get('type'),
            connected_node: {
              id: record.get('connected_id'),
              name: record.get('connected_name')
            }
          })));
        }
        
        neighborhoods[term] = {
          primary_nodes: primaryNodes,
          relationships: relationships.slice(0, 20),
          nearby_nodes: [],
          common_relationship_types: includeRelationshipTypes ? [...new Set(relationships.map(r => r.type))] : [],
          templates_in_use: includeTemplates ? [] : []
        };
      } catch (error) {
        console.error(`Failed to explore neighborhood for term "${term}":`, error);
        neighborhoods[term] = {
          primary_nodes: [],
          relationships: [],
          nearby_nodes: [],
          common_relationship_types: [],
          templates_in_use: []
        };
      }
    }
    
    return {
      neighborhoods,
      recommendations: []
    };
  }

  /**
   * Find relationship paths between node pairs
   */
  async findRelationshipPaths(
    nodePairs: Array<{source: string; target: string}>,
    maxPathLength: number = 4,
    minStrengthThreshold: number = 0.1,
    maxPathsPerPair: number = 3,
    includePathNarratives: boolean = true
  ): Promise<any> {
    const pathResults: {[key: string]: PathResult[]} = {};
    
    for (const pair of nodePairs) {
      const pairKey = `${pair.source} -> ${pair.target}`;
      
      try {
        // Simple path finding query
        const pathQuery = `
          MATCH (source:Node), (target:Node)
          WHERE source.id = $sourceId OR toLower(source.name) = toLower($sourceId)
          AND target.id = $targetId OR toLower(target.name) = toLower($targetId)
          
          MATCH path = shortestPath((source)-[*1..${maxPathLength}]-(target))
          WHERE length(path) <= $maxLength
          
          RETURN path, length(path) as pathLength
          LIMIT $maxPaths
        `;
        
        const result = await this.session.run(pathQuery, {
          sourceId: pair.source,
          targetId: pair.target,
          maxLength: maxPathLength,
          maxPaths: maxPathsPerPair
        });
        
        const paths: PathResult[] = result.records.map((record, index) => {
          const path = record.get('path');
          const pathLength = record.get('pathLength');
          
          const nodes = path.segments.map((segment: any, segIndex: number) => ({
            id: segIndex === 0 ? segment.start.properties.id : segment.end.properties.id,
            name: segIndex === 0 ? segment.start.properties.name : segment.end.properties.name
          }));
          
          const relationships = path.segments.map((segment: any) => ({
            type: segment.relationship.type,
            direction: "forward" as const,
            edge_strength: 0.7,
            source: segment.start.properties.id,
            target: segment.end.properties.id,
            properties: segment.relationship.properties
          }));
          
          const strength = 0.8 / pathLength; // Simple strength calculation
          
          return {
            path_id: index,
            length: pathLength,
            strength,
            nodes,
            relationships,
            narrative: includePathNarratives ? `Path from ${pair.source} to ${pair.target} via ${pathLength} steps` : '',
            strength_breakdown: {
              raw_strength: 0.8,
              length_penalty: 1.0 / pathLength,
              final_strength: strength
            }
          };
        });
        
        pathResults[pairKey] = paths;
      } catch (error) {
        console.error(`Failed to find paths for pair ${pairKey}:`, error);
        pathResults[pairKey] = [];
      }
    }
    
    return { path_results: pathResults };
  }

  /**
   * Manage templates (create, update, delete, list)
   */
  async manageTemplates(operation: "create" | "update" | "delete" | "list", templates: any[] = []): Promise<any> {
    const results = [];
    
    switch (operation) {
      case "list":
        const listQuery = `MATCH (t:Template) RETURN t ORDER BY t.name`;
        const listResult = await this.session.run(listQuery);
        return {
          templates: listResult.records.map(record => {
            const template = record.get('t');
            return {
              id: template.properties.id,
              name: template.properties.name,
              description: template.properties.description,
              structure: template.properties.structure,
              variables: template.properties.variables || {}
            };
          })
        };
        
      case "create":
        for (const template of templates) {
          try {
            const createQuery = `
              CREATE (t:Template {
                id: $id,
                name: $name,
                description: $description,
                structure: $structure,
                variables: $variables,
                created_date: timestamp(),
                last_modified_date: timestamp()
              })
              RETURN t.id as templateId
            `;
            
            await this.session.run(createQuery, template);
            results.push({
              template_id: template.id,
              operation: "create",
              status: "success",
              message: "Template created successfully"
            });
          } catch (error) {
            results.push({
              template_id: template.id,
              operation: "create",
              status: "error",
              message: (error as Error).message
            });
          }
        }
        break;
        
      case "update":
        for (const template of templates) {
          try {
            const updateQuery = `
              MATCH (t:Template {id: $id})
              SET t.name = $name,
                  t.description = $description,
                  t.structure = $structure,
                  t.variables = $variables,
                  t.last_modified_date = timestamp()
              RETURN t.id as templateId
            `;
            
            const result = await this.session.run(updateQuery, template);
            if (result.records.length === 0) {
              throw new Error(`Template with ID ${template.id} not found`);
            }
            
            results.push({
              template_id: template.id,
              operation: "update",
              status: "success",
              message: "Template updated successfully"
            });
          } catch (error) {
            results.push({
              template_id: template.id,
              operation: "update",
              status: "error",
              message: (error as Error).message
            });
          }
        }
        break;
        
      case "delete":
        for (const template of templates) {
          try {
            const deleteQuery = `
              MATCH (t:Template {id: $id})
              DETACH DELETE t
            `;
            
            await this.session.run(deleteQuery, { id: template.id });
            results.push({
              template_id: template.id,
              operation: "delete",
              status: "success",
              message: "Template deleted successfully"
            });
          } catch (error) {
            results.push({
              template_id: template.id,
              operation: "delete",
              status: "error",
              message: (error as Error).message
            });
          }
        }
        break;
    }
    
    return { results };
  }

  async close(): Promise<void> {
    await this.session.close();
    await this.driver.close();
  }
}

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
let dbManager: Neo4jManager;

// Initialize database connection
async function initializeDatabase() {
  try {
    dbManager = await Neo4jManager.initialize();
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
        description: "Create, update, or delete nodes in the knowledge graph",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["create", "update", "delete"],
              description: "The operation to perform"
            },
            nodes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Node ID (required for update/delete)" },
                  name: { type: "string", description: "Node name" },
                  summary: { type: "string", description: "Node summary" },
                  node_type: { type: "string", description: "Optional node type for additional labeling" },
                  template_id: { type: "string", description: "Template ID to associate with this node" },
                  properties: { type: "object", description: "Additional properties" },
                  relationships: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        target_id: { type: "string" },
                        relationship_type: { type: "string" },
                        direction: { type: "string", enum: ["forward", "reverse"] },
                        relevance_strength: { type: "string", enum: ["weak", "medium", "strong"] },
                        properties: { type: "object" }
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
        description: "Create, update, or delete relationships between nodes",
        inputSchema: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: ["create", "update", "delete"],
              description: "The operation to perform"
            },
            relationships: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Relationship ID (required for update/delete)" },
                  source_id: { type: "string", description: "Source node ID" },
                  target_id: { type: "string", description: "Target node ID" },
                  relationship_type: { type: "string", description: "Type of relationship" },
                  direction: { type: "string", enum: ["forward", "reverse"], description: "Direction of relationship" },
                  relevance_strength: { type: "string", enum: ["weak", "medium", "strong"], description: "Strength of relationship" },
                  properties: { type: "object", description: "Additional properties" }
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
              description: "Node IDs or names to generate documents for"
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
        description: "Explore neighborhoods around search terms",
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
            include_relationship_types: { type: "boolean", description: "Include relationship type analysis" },
            include_templates: { type: "boolean", description: "Include template usage analysis" }
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
        description: "Create, update, delete, or list document templates",
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
                  structure: { type: "string", description: "Mustache template structure" },
                  variables: { type: "object", description: "Cypher queries for template variables" }
                }
              }
            }
          },
          required: ["operation"]
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
          include_relationship_types = true,
          include_templates = true
        } = args as {
          search_terms: string[];
          search_strategy?: "vector" | "text" | "combined";
          max_results_per_term?: number;
          neighborhood_depth?: number;
          include_relationship_types?: boolean;
          include_templates?: boolean;
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await dbManager.exploreNeighborhoods(
                search_terms,
                search_strategy,
                max_results_per_term,
                neighborhood_depth,
                include_relationship_types,
                include_templates
              ), null, 2)
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