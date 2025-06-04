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
    relevance_strength?: "weak" | "medium" | "strong";
    properties?: {[key: string]: any};
  }>;
}

interface RelationshipData {
  id?: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
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

interface NodeResolution {
  user_specified: string;
  resolved_id: string;
  resolved_name: string;
  resolution_method: 'exact_match' | 'vector_match' | 'create_placeholder' | 'ambiguous';
  similarity_score?: number;
  alternatives?: Array<{name: string; similarity: number}>;
}

interface BulkRelationship {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  relevanceStrength: "weak" | "medium" | "strong";
  properties: {[key: string]: any};
  resolution: NodeResolution;
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
    // Validate input
    if (!nodes || nodes.length === 0) {
      throw new Error("At least one node must be provided");
    }
    
    // Validate operation-specific requirements
    if (operation === "update" || operation === "delete") {
      for (const [index, node] of nodes.entries()) {
        if (!node.id) {
          throw new Error(`Node at index ${index} is missing required 'id' field for ${operation} operation`);
        }
      }
    }
    
    if (operation === "create") {
      // Validate create-specific requirements
      for (const [index, node] of nodes.entries()) {
        if (!node.name) {
          throw new Error(`Node at index ${index} is missing required 'name' field for create operation`);
        }
        if (!node.summary) {
          throw new Error(`Node at index ${index} is missing required 'summary' field for create operation`);
        }
      }
      return await this.createNodesWithRelationships(nodes);
    }
    
    // For update and delete, use the original individual processing
    const results = [];
    
    for (const nodeData of nodes) {
      try {
        let result;
        
        switch (operation) {
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
          message: result?.message
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

  /**
   * Enhanced node creation with intelligent relationship handling
   */
  private async createNodesWithRelationships(nodes: NodeData[]): Promise<any> {
    const session = this.driver.session();
    const tx = session.beginTransaction();
    
    try {
      // Phase 1: Collect all referenced nodes and resolve them
      const allReferencedNodes = new Set<string>();
      const nodeTypeReferences = new Set<string>();
      
      // Collect all target_ids from relationships and node_types
      for (const node of nodes) {
        if (node.node_type) {
          nodeTypeReferences.add(node.node_type);
        }
        if (node.relationships) {
          for (const rel of node.relationships) {
            allReferencedNodes.add(rel.target_id);
          }
        }
      }
      
      // Resolve all referenced nodes using vector search
      const nodeResolutions = await this.resolveNodeReferences(Array.from(allReferencedNodes), tx);
      const nodeTypeResolutions = await this.resolveNodeReferences(Array.from(nodeTypeReferences), tx);
      
      // Phase 2: Create missing placeholder nodes
      const placeholdersToCreate = [
        ...nodeResolutions.filter(r => r.resolution_method === 'create_placeholder'),
        ...nodeTypeResolutions.filter(r => r.resolution_method === 'create_placeholder')
      ];
      
      if (placeholdersToCreate.length > 0) {
        await this.createPlaceholderNodes(placeholdersToCreate, tx);
      }
      
      // Phase 3: Create all requested nodes
      const createdNodes = [];
      for (const nodeData of nodes) {
        const nodeId = nodeData.id || `node-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        
        const properties = {
          id: nodeId,
          name: nodeData.name,
          summary: nodeData.summary,
          created_date: Date.now(),
          last_modified_date: Date.now(),
          is_placeholder: false,
          node_type: nodeData.node_type || null,
          ...(nodeData.properties || {})
        };
        
        // Create node with base Node label only
        // Node type will be stored as a property and relationship
        const query = `
          CREATE (n:Node)
          SET n = $properties
          RETURN n.id as nodeId
        `;
        
        const result = await tx.run(query, { properties });
        const createdNodeId = result.records[0].get('nodeId');
        
        createdNodes.push({
          nodeId: createdNodeId,
          nodeData,
          nodeTypeResolution: nodeData.node_type ?
            nodeTypeResolutions.find(r => r.user_specified === nodeData.node_type) : null
        });
        
        // Create vector index
        try {
          await this.createVectorIndexInTransaction(createdNodeId, `${nodeData.name} ${nodeData.summary}`, tx);
        } catch (embeddingError) {
          console.error(`Failed to create vector index for node ${createdNodeId}:`, embeddingError);
        }
      }
      
      // Phase 4: Create NODE_TYPE relationships
      for (const createdNode of createdNodes) {
        if (createdNode.nodeTypeResolution) {
          await this.createNodeTypeRelationship(
            createdNode.nodeId,
            createdNode.nodeTypeResolution.resolved_id,
            tx
          );
        }
      }
      
      // Phase 5: Create all relationships
      const allRelationships: BulkRelationship[] = [];
      const relationshipResults: any[] = [];
      
      for (const createdNode of createdNodes) {
        if (createdNode.nodeData.relationships) {
          for (const rel of createdNode.nodeData.relationships) {
            const resolution = nodeResolutions.find(r => r.user_specified === rel.target_id);
            if (resolution) {
              allRelationships.push({
                sourceId: createdNode.nodeId,
                targetId: resolution.resolved_id,
                relationshipType: rel.relationship_type,
                relevanceStrength: rel.relevance_strength || "medium",
                properties: rel.properties || {},
                resolution
              });
            }
          }
        }
      }
      
      if (allRelationships.length > 0) {
        await this.createBulkRelationships(allRelationships, tx);
        
        // Build relationship results for response
        for (const rel of allRelationships) {
          relationshipResults.push({
            sourceId: rel.sourceId, // Add sourceId for proper filtering
            relationship_type: rel.relationshipType,
            target_node: {
              id: rel.targetId,
              name: rel.resolution.resolved_name,
              resolution_method: rel.resolution.resolution_method,
              similarity_score: rel.resolution.similarity_score,
              user_specified: rel.resolution.user_specified
            }
          });
        }
      }
      
      await tx.commit();
      
      // Build detailed response
      const results = createdNodes.map(createdNode => ({
        node_id: createdNode.nodeId,
        operation: "create",
        status: "success",
        message: "Node created successfully with relationships",
        created_relationships: relationshipResults.filter(r =>
          r.sourceId === createdNode.nodeId
        ),
        node_type_resolution: createdNode.nodeTypeResolution ? {
          specified: createdNode.nodeData.node_type,
          resolved_to: {
            id: createdNode.nodeTypeResolution.resolved_id,
            name: createdNode.nodeTypeResolution.resolved_name,
            similarity_score: createdNode.nodeTypeResolution.similarity_score
          }
        } : null
      }));
      
      const ambiguities = [
        ...nodeResolutions.filter(r => r.resolution_method === 'ambiguous'),
        ...nodeTypeResolutions.filter(r => r.resolution_method === 'ambiguous')
      ];
      
      return {
        results,
        created_placeholders: placeholdersToCreate.map(p => ({
          id: p.resolved_id,
          name: p.resolved_name,
          user_specified: p.user_specified
        })),
        potential_ambiguities: ambiguities.map(a => ({
          user_specified: a.user_specified,
          top_matches: a.alternatives || []
        }))
      };
      
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      await session.close();
    }
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
      throw new Error(`Node with ID '${nodeData.id}' not found. Cannot update non-existent node.`);
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
      RETURN count(n) as deletedCount
    `;
    
    const result = await this.session.run(query, { nodeId });
    const deletedCount = result.records[0].get('deletedCount').toNumber();
    
    if (deletedCount === 0) {
      throw new Error(`Node with ID '${nodeId}' not found. Cannot delete non-existent node.`);
    }
    
    return {
      node_id: nodeId,
      message: `Node deleted successfully`
    };
  }

  /**
   * Resolve node references using exact match and vector search
   */
  private async resolveNodeReferences(references: string[], tx: any): Promise<NodeResolution[]> {
    const resolutions: NodeResolution[] = [];
    
    for (const ref of references) {
      // First try exact ID match
      const exactQuery = `MATCH (n:Node {id: $ref}) RETURN n.id as id, n.name as name`;
      const exactResult = await tx.run(exactQuery, { ref });
      
      if (exactResult.records.length > 0) {
        const record = exactResult.records[0];
        resolutions.push({
          user_specified: ref,
          resolved_id: record.get('id'),
          resolved_name: record.get('name'),
          resolution_method: 'exact_match',
          similarity_score: 1.0
        });
        continue;
      }
      
      // Try exact name match
      const nameQuery = `MATCH (n:Node) WHERE toLower(n.name) = toLower($ref) RETURN n.id as id, n.name as name`;
      const nameResult = await tx.run(nameQuery, { ref });
      
      if (nameResult.records.length > 0) {
        const record = nameResult.records[0];
        resolutions.push({
          user_specified: ref,
          resolved_id: record.get('id'),
          resolved_name: record.get('name'),
          resolution_method: 'exact_match',
          similarity_score: 1.0
        });
        continue;
      }
      
      // Try vector similarity search
      try {
        const embedding = await this.generateEmbedding(ref);
        const vectorQuery = `
          MATCH (n:Node)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
          WITH n, v,
               reduce(dot = 0.0, i IN range(0, size(v.embedding)-1) |
                 dot + v.embedding[i] * $embedding[i]
               ) / (
                 sqrt(reduce(norm1 = 0.0, x IN v.embedding | norm1 + x * x)) *
                 sqrt(reduce(norm2 = 0.0, x IN $embedding | norm2 + x * x))
               ) AS similarity
          WHERE similarity > 0.6
          RETURN n.id as id, n.name as name, similarity
          ORDER BY similarity DESC
          LIMIT 5
        `;
        
        const vectorResult = await tx.run(vectorQuery, { embedding });
        
        if (vectorResult.records.length > 0) {
          const topMatch = vectorResult.records[0];
          const similarity = topMatch.get('similarity');
          
          if (similarity > 0.8) {
            // High confidence match
            resolutions.push({
              user_specified: ref,
              resolved_id: topMatch.get('id'),
              resolved_name: topMatch.get('name'),
              resolution_method: 'vector_match',
              similarity_score: similarity
            });
          } else if (similarity > 0.6) {
            // Ambiguous match - include alternatives
            const alternatives = vectorResult.records.map((record: any) => ({
              name: record.get('name'),
              similarity: record.get('similarity')
            }));
            
            resolutions.push({
              user_specified: ref,
              resolved_id: topMatch.get('id'),
              resolved_name: topMatch.get('name'),
              resolution_method: 'ambiguous',
              similarity_score: similarity,
              alternatives
            });
          } else {
            // Low confidence - create placeholder
            resolutions.push({
              user_specified: ref,
              resolved_id: `placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
              resolved_name: ref,
              resolution_method: 'create_placeholder'
            });
          }
        } else {
          // No matches found - create placeholder
          resolutions.push({
            user_specified: ref,
            resolved_id: `placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            resolved_name: ref,
            resolution_method: 'create_placeholder'
          });
        }
      } catch (embeddingError) {
        console.error(`Failed to generate embedding for ${ref}:`, embeddingError);
        // Fallback to placeholder
        resolutions.push({
          user_specified: ref,
          resolved_id: `placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          resolved_name: ref,
          resolution_method: 'create_placeholder'
        });
      }
    }
    
    return resolutions;
  }

  /**
   * Create placeholder nodes in bulk
   */
  private async createPlaceholderNodes(placeholders: NodeResolution[], tx: any): Promise<void> {
    if (placeholders.length === 0) return;
    
    const query = `
      UNWIND $placeholders as placeholder
      CREATE (n:Node {
        id: placeholder.resolved_id,
        name: placeholder.resolved_name,
        summary: "Placeholder node - needs to be filled in",
        is_placeholder: true,
        created_date: timestamp(),
        last_modified_date: timestamp()
      })
    `;
    
    const placeholderData = placeholders.map(p => ({
      resolved_id: p.resolved_id,
      resolved_name: p.resolved_name
    }));
    
    await tx.run(query, { placeholders: placeholderData });
  }

  /**
   * Create vector index within a transaction
   */
  private async createVectorIndexInTransaction(nodeId: string, text: string, tx: any): Promise<string> {
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
      
      const result = await tx.run(query, {
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
   * Create NODE_TYPE relationship
   */
  private async createNodeTypeRelationship(nodeId: string, nodeTypeId: string, tx: any): Promise<void> {
    const query = `
      MATCH (n:Node {id: $nodeId})
      MATCH (t:Node {id: $nodeTypeId})
      CREATE (n)-[:NODE_TYPE]->(t)
    `;
    
    await tx.run(query, { nodeId, nodeTypeId });
  }

  /**
   * Create relationships in bulk
   */
  private async createBulkRelationships(relationships: BulkRelationship[], tx: any): Promise<void> {
    if (relationships.length === 0) return;
    
    // Group relationships by type to create them efficiently
    const relationshipsByType = new Map<string, BulkRelationship[]>();
    
    for (const rel of relationships) {
      const key = rel.relationshipType;
      if (!relationshipsByType.has(key)) {
        relationshipsByType.set(key, []);
      }
      relationshipsByType.get(key)!.push(rel);
    }
    
    // Create relationships for each type
    for (const [relType, rels] of relationshipsByType) {
      // Use backticks to safely handle relationship type names
      const query = `
        UNWIND $relationships as rel
        MATCH (source:Node {id: rel.sourceId})
        MATCH (target:Node {id: rel.targetId})
        CREATE (source)-[r:\`${relType}\`]->(target)
        SET r += rel.properties,
            r.relevance_strength = rel.relevanceStrength,
            r.created_date = timestamp()
        RETURN count(r) as created
      `;
      
      const relationshipData = rels.map(rel => ({
        sourceId: rel.sourceId,
        targetId: rel.targetId,
        relevanceStrength: rel.relevanceStrength,
        properties: rel.properties || {}
      }));
      
      const result = await tx.run(query, { relationships: relationshipData });
      
      // Verify relationships were created
      const createdCount = result.records[0]?.get('created')?.toNumber() || 0;
      if (createdCount !== relationshipData.length) {
        console.warn(`Expected to create ${relationshipData.length} relationships of type ${relType}, but created ${createdCount}`);
      }
    }
  }

  /**
   * Manage relationships (create, update, delete)
   */
  async manageRelationships(operation: "create" | "update" | "delete", relationships: RelationshipData[]): Promise<any> {
    // Validate input
    if (!relationships || relationships.length === 0) {
      throw new Error("At least one relationship must be provided");
    }
    
    // Validate operation-specific requirements
    for (const [index, relData] of relationships.entries()) {
      if (operation === "create") {
        if (!relData.source_id) {
          throw new Error(`Relationship at index ${index} is missing required 'source_id' field for create operation`);
        }
        if (!relData.target_id) {
          throw new Error(`Relationship at index ${index} is missing required 'target_id' field for create operation`);
        }
        if (!relData.relationship_type) {
          throw new Error(`Relationship at index ${index} is missing required 'relationship_type' field for create operation`);
        }
        // Validate relevance_strength
        if (relData.relevance_strength && !["weak", "medium", "strong"].includes(relData.relevance_strength)) {
          throw new Error(`Relationship at index ${index} has invalid relevance_strength '${relData.relevance_strength}'. Must be 'weak', 'medium', or 'strong'`);
        }
      } else if (operation === "update" || operation === "delete") {
        if (!relData.id) {
          throw new Error(`Relationship at index ${index} is missing required 'id' field for ${operation} operation`);
        }
      }
    }
    
    const results = [];
    
    for (const [index, relData] of relationships.entries()) {
      try {
        let result;
        
        switch (operation) {
          case "create":
            result = await this.createRelationship(relData);
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
          message: result?.message,
          source_id: relData.source_id,
          target_id: relData.target_id,
          relationship_type: relData.relationship_type,
          source_resolution: result?.source_resolution,
          target_resolution: result?.target_resolution,
          created_placeholders: result?.created_placeholders,
          ambiguous_resolutions: result?.ambiguous_resolutions
        });
      } catch (error) {
        results.push({
          relationship_id: relData.id,
          operation,
          status: "error",
          message: (error as Error).message,
          source_id: relData.source_id,
          target_id: relData.target_id,
          relationship_type: relData.relationship_type
        });
      }
    }
    
    return { results };
  }

  private async createRelationship(relData: RelationshipData): Promise<any> {
    // Improved relationship type validation - allow more flexible naming
    if (!/^[A-Z][A-Z0-9_]*$/.test(relData.relationship_type)) {
      throw new Error(`Invalid relationship type '${relData.relationship_type}'. Must start with uppercase letter and contain only uppercase letters, numbers, and underscores.`);
    }

    const session = this.driver.session();
    const tx = session.beginTransaction();
    
    try {
      // Use the same node resolution logic as node creation
      const allReferencedNodes = [relData.source_id, relData.target_id];
      const nodeResolutions = await this.resolveNodeReferences(allReferencedNodes, tx);
      
      if (nodeResolutions.length !== 2) {
        throw new Error(`Failed to resolve nodes. Expected 2, got ${nodeResolutions.length}`);
      }
      
      const sourceResolution = nodeResolutions.find(r => r.user_specified === relData.source_id);
      const targetResolution = nodeResolutions.find(r => r.user_specified === relData.target_id);
      
      if (!sourceResolution || !targetResolution) {
        throw new Error('Failed to match node resolutions');
      }
      
      // Check for ambiguous resolutions and warn user
      const ambiguousResolutions = nodeResolutions.filter(r => r.resolution_method === 'ambiguous');
      
      // Create placeholder nodes if needed (same as node creation)
      const placeholdersToCreate = nodeResolutions.filter(r => r.resolution_method === 'create_placeholder');
      if (placeholdersToCreate.length > 0) {
        await this.createPlaceholderNodes(placeholdersToCreate, tx);
      }
      
      // Create the relationship and capture its ID
      const createQuery = `
        MATCH (source:Node {id: $sourceId})
        MATCH (target:Node {id: $targetId})
        CREATE (source)-[r:\`${relData.relationship_type}\`]->(target)
        SET r += $properties,
            r.relevance_strength = $relevanceStrength,
            r.created_date = timestamp()
        RETURN id(r) as relationshipId
      `;
      
      const createResult = await tx.run(createQuery, {
        sourceId: sourceResolution.resolved_id,
        targetId: targetResolution.resolved_id,
        relevanceStrength: relData.relevance_strength || "medium",
        properties: relData.properties || {}
      });
      
      const relationshipId = createResult.records[0]?.get('relationshipId');
      
      await tx.commit();
      
      return {
        relationship_id: relationshipId ? relationshipId.toString() : null,
        message: `Relationship '${relData.relationship_type}' created successfully between '${sourceResolution.resolved_name}' and '${targetResolution.resolved_name}'`,
        source_resolution: {
          user_specified: sourceResolution.user_specified,
          resolved_to: {
            id: sourceResolution.resolved_id,
            name: sourceResolution.resolved_name,
            resolution_method: sourceResolution.resolution_method,
            similarity_score: sourceResolution.similarity_score
          }
        },
        target_resolution: {
          user_specified: targetResolution.user_specified,
          resolved_to: {
            id: targetResolution.resolved_id,
            name: targetResolution.resolved_name,
            resolution_method: targetResolution.resolution_method,
            similarity_score: targetResolution.similarity_score
          }
        },
        created_placeholders: placeholdersToCreate.map(p => ({
          id: p.resolved_id,
          name: p.resolved_name,
          user_specified: p.user_specified
        })),
        ambiguous_resolutions: ambiguousResolutions.map(r => ({
          user_specified: r.user_specified,
          resolved_to: r.resolved_name,
          similarity_score: r.similarity_score,
          alternatives: r.alternatives || []
        }))
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      await session.close();
    }
  }

  private async updateRelationship(relData: RelationshipData): Promise<any> {
    if (!relData.id) {
      throw new Error('Relationship ID is required for update operation');
    }
    
    // Validate relevance_strength if provided
    if (relData.relevance_strength && !["weak", "medium", "strong"].includes(relData.relevance_strength)) {
      throw new Error(`Invalid relevance_strength '${relData.relevance_strength}'. Must be 'weak', 'medium', or 'strong'`);
    }
    
    // First check if the relationship exists
    const checkQuery = `
      MATCH ()-[r]->()
      WHERE id(r) = $relationshipId
      RETURN id(r) as relId, type(r) as relType
    `;
    
    const checkResult = await this.session.run(checkQuery, { relationshipId: parseInt(relData.id) });
    
    if (checkResult.records.length === 0) {
      throw new Error(`Relationship with ID '${relData.id}' does not exist`);
    }
    
    const relationshipType = checkResult.records[0].get('relType');
    
    const updateProperties: {[key: string]: any} = {
      last_modified_date: Date.now(),
      ...(relData.properties || {})
    };
    
    // Only add relevance_strength if it's provided
    if (relData.relevance_strength) {
      updateProperties.relevance_strength = relData.relevance_strength;
    }
    
    const updateQuery = `
      MATCH ()-[r]->()
      WHERE id(r) = $relationshipId
      SET r += $properties
      RETURN id(r) as relationshipId
    `;
    
    const result = await this.session.run(updateQuery, {
      relationshipId: parseInt(relData.id),
      properties: updateProperties
    });
    
    if (result.records.length === 0) {
      throw new Error(`Failed to update relationship with ID '${relData.id}'`);
    }
    
    return {
      relationship_id: relData.id,
      message: `Relationship '${relationshipType}' with ID '${relData.id}' updated successfully`
    };
  }

  private async deleteRelationship(relationshipId: string): Promise<any> {
    // First check if the relationship exists
    const checkQuery = `
      MATCH ()-[r]->()
      WHERE id(r) = $relationshipId
      RETURN id(r) as relId, type(r) as relType
    `;
    
    const checkResult = await this.session.run(checkQuery, { relationshipId: parseInt(relationshipId) });
    
    if (checkResult.records.length === 0) {
      throw new Error(`Relationship with ID '${relationshipId}' does not exist`);
    }
    
    const relationshipType = checkResult.records[0].get('relType');
    
    // Now delete the relationship
    const deleteQuery = `
      MATCH ()-[r]->()
      WHERE id(r) = $relationshipId
      DELETE r
      RETURN count(r) as deletedCount
    `;
    
    const deleteResult = await this.session.run(deleteQuery, { relationshipId: parseInt(relationshipId) });
    const deletedCount = deleteResult.records[0].get('deletedCount').toNumber();
    
    if (deletedCount === 0) {
      throw new Error(`Failed to delete relationship with ID '${relationshipId}'`);
    }
    
    return {
      relationship_id: relationshipId,
      message: `Relationship '${relationshipType}' with ID '${relationshipId}' deleted successfully`
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
          WHERE (source.id = $sourceId OR toLower(source.name) = toLower($sourceId))
          AND (target.id = $targetId OR toLower(target.name) = toLower($targetId))
          
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

  async unsafeQuery(query: string, parameters: any = {}): Promise<any> {
    try {
      const result = await this.session.run(query, parameters);
      
      // Convert Neo4j result to a more readable format
      const records = result.records.map(record => {
        const obj: any = {};
        record.keys.forEach((key, index) => {
          const value = record.get(key);
          // Handle Neo4j types
          if (value && typeof value === 'object' && value.constructor.name === 'Node') {
            obj[key] = {
              identity: value.identity.toString(),
              labels: value.labels,
              properties: value.properties
            };
          } else if (value && typeof value === 'object' && value.constructor.name === 'Relationship') {
            obj[key] = {
              identity: value.identity.toString(),
              type: value.type,
              start: value.start.toString(),
              end: value.end.toString(),
              properties: value.properties
            };
          } else {
            obj[key] = value;
          }
        });
        return obj;
      });

      return {
        records,
        summary: {
          query: result.summary.query.text,
          parameters: result.summary.query.parameters,
          queryType: result.summary.queryType,
          counters: result.summary.counters
        }
      };
    } catch (error) {
      return {
        error: (error as Error).message,
        query,
        parameters
      };
    }
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
        description: "Create, update, or delete nodes in the knowledge graph with intelligent relationship resolution.\n\nCREATE: Creates nodes with optional relationships. Target nodes are resolved by exact name match, then vector similarity, finally creating placeholders if needed. Node types automatically create categorical relationships.\n\nUPDATE: Modifies existing node properties (requires node ID). Relationships are preserved.\n\nDELETE: Removes nodes and all associated data including vector indices (requires node ID).",
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
                  properties: { type: "object", description: "Custom key-value properties to store with the node" },
                  relationships: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        target_id: { type: "string", description: "Name or ID of target node (resolved automatically)" },
                        relationship_type: { type: "string", description: "Type of relationship (e.g., 'WORKS_FOR', 'LOCATED_IN')" },
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
        description: "Create, update, or delete relationships between nodes with intelligent node resolution.\n\nCREATE: Creates directed relationships from source to target. Node references are resolved automatically:\n- Exact ID match (highest priority)\n- Exact name match (case-insensitive)\n- Vector similarity search (fuzzy matching)\n- Creates placeholder nodes if no match found\n\nUPDATE: Modifies relationship properties using relationship ID. Use the ID returned from create operations.\n\nDELETE: Removes relationships completely using relationship ID.\n\nReturns detailed resolution info including similarity scores for ambiguous matches and lists any placeholder nodes created.",
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
