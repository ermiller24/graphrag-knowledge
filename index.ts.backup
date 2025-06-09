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
import Mustache from 'mustache';

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

// Validation system interfaces
interface NodeTypeDefinition {
  name: string;
  description: string;
  aliases: string[];
  valid_properties: string[];
  common_relationships: string[];
}

interface RelationshipTypeDefinition {
  name: string;
  directionality: "source_to_target" | "bidirectional" | "target_to_source";
  valid_source_types: string[];
  valid_target_types: string[];
  description: string;
  aliases: string[];
}

interface ValidationResult {
  is_valid: boolean;
  name?: string;
  suggestions?: string[];
  warnings?: string[];
  errors?: string[];
  should_reverse?: boolean;
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
  resolution_method: 'exact_match' | 'vector_match' | 'create_placeholder' | 'ambiguous' | 'intra_batch';
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
  was_reversed?: boolean;
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
      // Phase 1: Collect all referenced nodes and validate node types
      const allReferencedNodes = new Set<string>();
      const nodeTypeReferences = new Set<string>();
      const validationResults: any[] = [];
      
      // Create a map of nodes being created in this batch (by name, case-insensitive)
      const batchNodesByName = new Map<string, string>();
      for (const node of nodes) {
        if (node.name) {
          batchNodesByName.set(node.name.toLowerCase(), node.name);
        }
      }
      
      // Collect all target_ids from relationships and node_types, and validate node types
      for (const node of nodes) {
        if (node.node_type) {
          nodeTypeReferences.add(node.node_type);
          // Validate node type
          const validation = await this.validateNodeType(node.node_type, tx);
          validationResults.push({
            node_name: node.name,
            node_type: node.node_type,
            validation
          });
        }
        if (node.relationships) {
          for (const rel of node.relationships) {
            allReferencedNodes.add(rel.target_id);
          }
        }
      }
      
      // Separate intra-batch references from external references
      const externalReferences: string[] = [];
      const intraBatchResolutions: NodeResolution[] = [];
      
      for (const ref of allReferencedNodes) {
        const lowerRef = ref.toLowerCase();
        if (batchNodesByName.has(lowerRef)) {
          // This is a reference to a node being created in this batch
          intraBatchResolutions.push({
            user_specified: ref,
            resolved_id: 'BATCH_PLACEHOLDER', // Will be resolved after node creation
            resolved_name: batchNodesByName.get(lowerRef)!,
            resolution_method: 'intra_batch',
            similarity_score: 1.0
          });
        } else {
          externalReferences.push(ref);
        }
      }
      
      // Resolve external referenced nodes using vector search
      const externalNodeResolutions = await this.resolveNodeReferences(externalReferences, tx);
      const nodeResolutions = [...intraBatchResolutions, ...externalNodeResolutions];
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
          const textForIndexing = `${nodeData.name || ''} ${nodeData.summary || ''}`.trim();
          await this.createVectorIndexInTransaction(createdNodeId, textForIndexing, tx);
        } catch (embeddingError) {
          console.error(`Failed to create vector index for node ${createdNodeId}:`, embeddingError);
        }
      }
      
      // Phase 3.5: Update intra-batch resolutions with actual node IDs
      const createdNodesByName = new Map<string, string>();
      for (const createdNode of createdNodes) {
        if (createdNode.nodeData.name) {
          createdNodesByName.set(createdNode.nodeData.name.toLowerCase(), createdNode.nodeId);
        }
      }
      
      // Update intra-batch resolutions with actual node IDs
      for (const resolution of nodeResolutions) {
        if (resolution.resolution_method === 'intra_batch') {
          const actualNodeId = createdNodesByName.get(resolution.resolved_name.toLowerCase());
          if (actualNodeId) {
            resolution.resolved_id = actualNodeId;
          }
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
      
      // Phase 5: Create all relationships with validation
      const allRelationships: BulkRelationship[] = [];
      const relationshipResults: any[] = [];
      const relationshipValidations: any[] = [];
      
      for (const createdNode of createdNodes) {
        if (createdNode.nodeData.relationships) {
          for (const rel of createdNode.nodeData.relationships) {
            const resolution = nodeResolutions.find(r => r.user_specified === rel.target_id);
            if (resolution) {
              // Get source and target node types for validation
              const sourceNodeType = createdNode.nodeData.node_type || null;
              const targetNodeType = await this.getNodeType(resolution.resolved_id, tx);
              
              // Validate relationship type
              const relValidation = await this.validateRelationshipType(
                rel.relationship_type,
                sourceNodeType,
                targetNodeType,
                tx
              );
              
              // Handle automatic relationship reversal if needed
              let finalSourceId = createdNode.nodeId;
              let finalTargetId = resolution.resolved_id;
              let finalSourceName = createdNode.nodeData.name;
              let finalTargetName = resolution.resolved_name;
              
              if (relValidation.should_reverse) {
                // Swap source and target
                finalSourceId = resolution.resolved_id;
                finalTargetId = createdNode.nodeId;
                finalSourceName = resolution.resolved_name;
                finalTargetName = createdNode.nodeData.name;
              }
              
              relationshipValidations.push({
                source_node: finalSourceName,
                target_node: finalTargetName,
                relationship_type: rel.relationship_type,
                validation: relValidation
              });
              
              allRelationships.push({
                sourceId: finalSourceId,
                targetId: finalTargetId,
                relationshipType: relValidation.name || rel.relationship_type,
                relevanceStrength: rel.relevance_strength || "medium",
                properties: rel.properties || {},
                resolution,
                was_reversed: relValidation.should_reverse || false
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
        } : null,
        node_type_validation: validationResults.find(v => v.node_name === createdNode.nodeData.name)?.validation
      }));
      
      const ambiguities = [
        ...nodeResolutions.filter(r => (r.resolution_method === 'vector_match' || r.resolution_method === 'ambiguous') && r.alternatives && r.alternatives.length > 0),
        ...nodeTypeResolutions.filter(r => (r.resolution_method === 'vector_match' || r.resolution_method === 'ambiguous') && r.alternatives && r.alternatives.length > 0)
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
        })),
        validation_results: {
          node_types: validationResults,
          relationships: relationshipValidations
        }
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
      template_id: nodeData.template_id,
      node_type: nodeData.node_type,
      last_modified_date: Date.now(),
      is_placeholder: false,  // Convert placeholder to real node when manually updated
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
  private async resolveNodeReferences(references: string[], tx: any, createPlaceholders: boolean = true): Promise<NodeResolution[]> {
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
      const nameQuery = `
        MATCH (n:Node)
        WHERE toLower(n.name) = toLower($ref)
        RETURN n.id as id, n.name as name
      `;
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
          WHERE similarity > 0.5
          RETURN n.id as id, n.name as name, similarity
          ORDER BY similarity DESC
          LIMIT 5
        `;
        
        const vectorResult = await tx.run(vectorQuery, { embedding });
        
        if (vectorResult.records.length > 0) {
          const topMatch = vectorResult.records[0];
          const similarity = topMatch.get('similarity');
          
          if (similarity > 0.8) {
            // High confidence match - still include top 3 alternatives for transparency
            const alternatives = vectorResult.records.slice(0, 3).map((record: any) => ({
              name: record.get('name'),
              id: record.get('id'),
              similarity: record.get('similarity')
            }));
            
            resolutions.push({
              user_specified: ref,
              resolved_id: topMatch.get('id'),
              resolved_name: topMatch.get('name'),
              resolution_method: 'vector_match',
              similarity_score: similarity,
              alternatives
            });
          } else if (similarity > 0.5) {
            // Ambiguous match - include top 3 alternatives
            const alternatives = vectorResult.records.slice(0, 3).map((record: any) => ({
              name: record.get('name'),
              id: record.get('id'),
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
          } else if (createPlaceholders) {
            // Low confidence - create placeholder only if allowed
            resolutions.push({
              user_specified: ref,
              resolved_id: `placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
              resolved_name: ref,
              resolution_method: 'create_placeholder'
            });
          }
          // If createPlaceholders is false, we skip adding anything for low confidence matches
        } else if (createPlaceholders) {
          // No matches found - create placeholder only if allowed
          resolutions.push({
            user_specified: ref,
            resolved_id: `placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            resolved_name: ref,
            resolution_method: 'create_placeholder'
          });
        }
        // If createPlaceholders is false, we skip adding anything for no matches
      } catch (embeddingError) {
        console.error(`Failed to generate embedding for ${ref}:`, embeddingError);
        if (createPlaceholders) {
          // Fallback to placeholder only if allowed
          resolutions.push({
            user_specified: ref,
            resolved_id: `placeholder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            resolved_name: ref,
            resolution_method: 'create_placeholder'
          });
        }
        // If createPlaceholders is false, we skip adding anything for embedding errors
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
    
    // Create vector indices for placeholder nodes so they can be found in future searches
    for (const placeholder of placeholders) {
      try {
        const textForIndexing = `${placeholder.resolved_name} placeholder`;
        await this.createVectorIndexInTransaction(placeholder.resolved_id, textForIndexing, tx);
      } catch (embeddingError) {
        console.error(`Failed to create vector index for placeholder ${placeholder.resolved_id}:`, embeddingError);
      }
    }
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
   * Validate node type against existing NodeType definitions
   */
  private async validateNodeType(nodeType: string, tx: any): Promise<ValidationResult> {
    if (!nodeType) {
      return { is_valid: true }; // Allow nodes without types
    }

    // First check for exact match with canonical names
    const exactQuery = `
      MATCH (nt:NodeType)
      WHERE nt.name = $nodeType
      RETURN nt.name as name, nt.description as description
    `;
    
    const exactResult = await tx.run(exactQuery, { nodeType });
    
    if (exactResult.records.length > 0) {
      return {
        is_valid: true,
        name: exactResult.records[0].get('name')
      };
    }

    // Check for alias matches
    const aliasQuery = `
      MATCH (alias:NodeType {name: $nodeType})-[:ALIAS_OF]->(canonical:NodeType)
      RETURN canonical.name as name, canonical.description as description
    `;
    
    const aliasResult = await tx.run(aliasQuery, { nodeType });
    
    if (aliasResult.records.length > 0) {
      const canonical = aliasResult.records[0].get('name');
      return {
        is_valid: true,
        name: canonical,
        warnings: [`Node type '${nodeType}' is an alias. Consider using canonical name '${canonical}' for consistency.`]
      };
    }

    // Use vector similarity to find similar NodeType definitions
    try {
      const embedding = await this.generateEmbedding(nodeType);
      const similarityQuery = `
        MATCH (nt:NodeType)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
        WITH nt, v,
             reduce(dot = 0.0, i IN range(0, size(v.embedding)-1) |
               dot + v.embedding[i] * $embedding[i]
             ) / (
               sqrt(reduce(norm1 = 0.0, x IN v.embedding | norm1 + x * x)) *
               sqrt(reduce(norm2 = 0.0, x IN $embedding | norm2 + x * x))
             ) AS similarity
        WHERE similarity > 0.5
        RETURN nt.name as name, similarity
        ORDER BY similarity DESC
        LIMIT 5
      `;
      
      const similarityResult = await tx.run(similarityQuery, { embedding });
      
      if (similarityResult.records.length > 0) {
        const suggestions = similarityResult.records.map((record: any) =>
          record.get('name')
        );
        
        return {
          is_valid: true,
          suggestions,
          warnings: [`Node type '${nodeType}' not found. Did you mean one of: ${suggestions.join(', ')}? Or use the manage_nodes tool to create a new NodeType definition with node_type: 'NodeType'.`]
        };
      }
    } catch (embeddingError) {
      console.error('Failed to generate embedding for node type validation:', embeddingError);
    }

    // No similar types found - suggest creating new NodeType
    return {
      is_valid: true,
      warnings: [`Node type '${nodeType}' not found. Use the manage_nodes tool to create a NodeType definition: set node_type: 'NodeType' and name: '${nodeType}' with appropriate properties.`]
    };
  }

  /**
   * Validate relationship type against existing RelationshipType definitions
   */
  private async validateRelationshipType(
    relationshipType: string,
    sourceNodeType: string | null,
    targetNodeType: string | null,
    tx: any
  ): Promise<ValidationResult> {
    // First check for exact match with canonical names
    const exactQuery = `
      MATCH (rt:RelationshipType)
      WHERE rt.name = $relationshipType
      OPTIONAL MATCH (rt)-[:VALID_SOURCE]->(sourceType:NodeType)
      OPTIONAL MATCH (rt)-[:VALID_TARGET]->(targetType:NodeType)
      RETURN rt.name as name,
             rt.directionality as directionality,
             collect(DISTINCT sourceType.name) as valid_source_types,
             collect(DISTINCT targetType.name) as valid_target_types
    `;
    
    const exactResult = await tx.run(exactQuery, { relationshipType });
    
    if (exactResult.records.length > 0) {
      const record = exactResult.records[0];
      const validSourceTypes = record.get('valid_source_types') || [];
      const validTargetTypes = record.get('valid_target_types') || [];
      const directionality = record.get('directionality');
      
      const warnings: string[] = [];
      let shouldReverse = false;
      
      // Check for demonstrably wrong direction: source is only valid as target AND target is only valid as source
      const sourceInvalidAsSource = sourceNodeType && validSourceTypes.length > 0 && !validSourceTypes.includes(sourceNodeType);
      const targetInvalidAsTarget = targetNodeType && validTargetTypes.length > 0 && !validTargetTypes.includes(targetNodeType);
      const sourceValidAsTarget = sourceNodeType && validTargetTypes.length > 0 && validTargetTypes.includes(sourceNodeType);
      const targetValidAsSource = targetNodeType && validSourceTypes.length > 0 && validSourceTypes.includes(targetNodeType);
      
      if (sourceInvalidAsSource && targetInvalidAsTarget && sourceValidAsTarget && targetValidAsSource) {
        // This is a demonstrably backwards relationship - auto-reverse it
        shouldReverse = true;
        warnings.push(`Relationship direction was automatically reversed because '${sourceNodeType}' should be the target and '${targetNodeType}' should be the source for '${relationshipType}'. Please update the schema if you need relationships in the original direction.`);
      } else {
        // Normal validation warnings
        if (sourceInvalidAsSource) {
          warnings.push(`Source node type '${sourceNodeType}' is not in valid source types: ${validSourceTypes.join(', ')}`);
        }
        
        if (targetInvalidAsTarget) {
          warnings.push(`Target node type '${targetNodeType}' is not in valid target types: ${validTargetTypes.join(', ')}`);
        }
      }
      
      // Check directionality
      if (directionality === 'target_to_source') {
        warnings.push(`Relationship '${relationshipType}' typically flows from target to source. Consider reversing the direction.`);
      }
      
      return {
        is_valid: true,
        name: record.get('name'),
        warnings: warnings.length > 0 ? warnings : undefined,
        should_reverse: shouldReverse
      };
    }

    // Check for alias matches
    const aliasQuery = `
      MATCH (alias:RelationshipType {name: $relationshipType})-[:ALIAS_OF]->(canonical:RelationshipType)
      RETURN canonical.name as name
    `;
    
    const aliasResult = await tx.run(aliasQuery, { relationshipType });
    
    if (aliasResult.records.length > 0) {
      const canonical = aliasResult.records[0].get('name');
      return {
        is_valid: true,
        name: canonical,
        warnings: [`Relationship type '${relationshipType}' is an alias. Consider using canonical name '${canonical}' for consistency.`]
      };
    }

    // Use vector similarity to find similar RelationshipType definitions
    try {
      const embedding = await this.generateEmbedding(relationshipType);
      const similarityQuery = `
        MATCH (rt:RelationshipType)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
        WITH rt, v,
             reduce(dot = 0.0, i IN range(0, size(v.embedding)-1) |
               dot + v.embedding[i] * $embedding[i]
             ) / (
               sqrt(reduce(norm1 = 0.0, x IN v.embedding | norm1 + x * x)) *
               sqrt(reduce(norm2 = 0.0, x IN $embedding | norm2 + x * x))
             ) AS similarity
        WHERE similarity > 0.5
        RETURN rt.name as name, similarity
        ORDER BY similarity DESC
        LIMIT 5
      `;
      
      const similarityResult = await tx.run(similarityQuery, { embedding });
      
      if (similarityResult.records.length > 0) {
        const suggestions = similarityResult.records.map((record: any) =>
          record.get('name')
        );
        
        return {
          is_valid: true,
          suggestions,
          warnings: [`Relationship type '${relationshipType}' not found. Did you mean one of: ${suggestions.join(', ')}? Or use the manage_nodes tool to create a new RelationshipType definition with node_type: 'RelationshipType'.`]
        };
      }
    } catch (embeddingError) {
      console.error('Failed to generate embedding for relationship type validation:', embeddingError);
    }

    // No similar types found - suggest creating new RelationshipType
    return {
      is_valid: true,
      warnings: [`Relationship type '${relationshipType}' not found. Use the manage_nodes tool to create a RelationshipType definition: set node_type: 'RelationshipType' and name: '${relationshipType}' with directionality and valid source/target types.`]
    };
  }

  /**
   * Get node type for a given node ID
   */
  private async getNodeType(nodeId: string, tx: any): Promise<string | null> {
    const query = `
      MATCH (n:Node {id: $nodeId})
      RETURN n.node_type as node_type
    `;
    
    const result = await tx.run(query, { nodeId });
    
    if (result.records.length > 0) {
      return result.records[0].get('node_type');
    }
    
    return null;
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
          relationship_validation: result?.relationship_validation,
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
      
      // Get node types for validation
      const sourceNodeType = await this.getNodeType(sourceResolution.resolved_id, tx);
      const targetNodeType = await this.getNodeType(targetResolution.resolved_id, tx);
      
      // Validate relationship type
      const relationshipValidation = await this.validateRelationshipType(
        relData.relationship_type,
        sourceNodeType,
        targetNodeType,
        tx
      );
      
      // Use canonical name if available
      const finalRelationshipType = relationshipValidation.name || relData.relationship_type;
      
      // Handle automatic relationship reversal if needed
      let finalSourceResolution = sourceResolution;
      let finalTargetResolution = targetResolution;
      let reversalMessage = '';
      
      if (relationshipValidation.should_reverse) {
        // Swap source and target
        finalSourceResolution = targetResolution;
        finalTargetResolution = sourceResolution;
        reversalMessage = ' (direction automatically reversed)';
      }
      
      // Check for ambiguous resolutions and warn user
      const ambiguousResolutions = nodeResolutions.filter(r => r.resolution_method === 'ambiguous');
      
      // Collect all vector-based resolutions (both high confidence and ambiguous) that have alternatives
      const vectorResolutionsWithAlternatives = nodeResolutions.filter(r =>
        (r.resolution_method === 'vector_match' || r.resolution_method === 'ambiguous') &&
        r.alternatives && r.alternatives.length > 0
      );
      
      // Create placeholder nodes if needed (same as node creation)
      const placeholdersToCreate = nodeResolutions.filter(r => r.resolution_method === 'create_placeholder');
      if (placeholdersToCreate.length > 0) {
        await this.createPlaceholderNodes(placeholdersToCreate, tx);
      }
      
      // Create the relationship and capture its ID
      const createQuery = `
        MATCH (source:Node {id: $sourceId})
        MATCH (target:Node {id: $targetId})
        CREATE (source)-[r:\`${finalRelationshipType}\`]->(target)
        SET r += $properties,
            r.relevance_strength = $relevanceStrength,
            r.created_date = timestamp()
        RETURN id(r) as relationshipId
      `;
      
      const createResult = await tx.run(createQuery, {
        sourceId: finalSourceResolution.resolved_id,
        targetId: finalTargetResolution.resolved_id,
        relevanceStrength: relData.relevance_strength || "medium",
        properties: relData.properties || {}
      });
      
      const relationshipId = createResult.records[0]?.get('relationshipId');
      
      await tx.commit();
      
      return {
        relationship_id: relationshipId ? relationshipId.toString() : null,
        message: `Relationship '${finalRelationshipType}' created successfully between '${finalSourceResolution.resolved_name}' and '${finalTargetResolution.resolved_name}'${reversalMessage}`,
        source_resolution: {
          user_specified: sourceResolution.user_specified,
          resolved_to: {
            id: finalSourceResolution.resolved_id,
            name: finalSourceResolution.resolved_name,
            resolution_method: finalSourceResolution.resolution_method,
            similarity_score: finalSourceResolution.similarity_score
          }
        },
        target_resolution: {
          user_specified: targetResolution.user_specified,
          resolved_to: {
            id: finalTargetResolution.resolved_id,
            name: finalTargetResolution.resolved_name,
            resolution_method: finalTargetResolution.resolution_method,
            similarity_score: finalTargetResolution.similarity_score
          }
        },
        relationship_validation: relationshipValidation,
        created_placeholders: placeholdersToCreate.map(p => ({
          id: p.resolved_id,
          name: p.resolved_name,
          user_specified: p.user_specified
        })),
        ambiguous_resolutions: vectorResolutionsWithAlternatives.map(r => ({
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
        // Use existing node resolution logic that includes vector search, but don't create placeholders
        const resolutions = await this.session.executeRead(async (tx) => {
          return await this.resolveNodeReferences([identifier], tx, false);
        });
        
        if (resolutions.length === 0) {
          throw new Error(`Node not found for identifier: ${identifier}. No exact match, name match, or similar nodes found via vector search.`);
        }
        
        const resolution = resolutions[0];
        
        // Get the full node object using the resolved ID
        const nodeResult = await this.session.run(`MATCH (n:Node {id: $nodeId}) RETURN n`, {
          nodeId: resolution.resolved_id
        });
        
        if (nodeResult.records.length === 0) {
          throw new Error(`Resolved node not found: ${resolution.resolved_id}`);
        }
        
        const node = nodeResult.records[0].get('n');
        const nodeProps = node.properties;
        
        // Determine which template to use
        let templateId = options.template_override || nodeProps.template_id;
        let templateUsed = 'default-template';
        let content: string;
        
        if (templateId) {
          // Try to use the specified template
          try {
            const templateResult = await this.generateDocumentWithTemplate(node, templateId);
            content = templateResult.content;
            templateUsed = templateId;
          } catch (templateError) {
            console.warn(`Failed to use template '${templateId}' for node ${nodeProps.id}: ${(templateError as Error).message}`);
            // Fall back to default
            content = `# ${nodeProps.name}\n\n## Summary\n${nodeProps.summary || 'No summary available'}\n\n*Note: Template '${templateId}' failed to render*`;
            templateUsed = 'default-template-fallback';
          }
        } else {
          // Use simple default format
          content = `# ${nodeProps.name}\n\n## Summary\n${nodeProps.summary || 'No summary available'}`;
          templateUsed = 'default-template';
        }
        
        documents.push({
          node_id: nodeProps.id,
          node_name: nodeProps.name,
          content,
          generated_at: Date.now(),
          from_cache: false,
          dependencies: [],
          template_used: templateUsed
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
   * Generate document content using a template
   */
  private async generateDocumentWithTemplate(node: any, templateId: string): Promise<{content: string}> {
    // Get the template
    const templateQuery = `MATCH (t:Template {id: $templateId}) RETURN t`;
    const templateResult = await this.session.run(templateQuery, { templateId });
    
    if (templateResult.records.length === 0) {
      throw new Error(`Template '${templateId}' not found`);
    }
    
    const template = templateResult.records[0].get('t');
    const templateStructure = template.properties.structure;
    const templateVariables = template.properties.variables ? JSON.parse(template.properties.variables) : {};
    
    // Get node properties
    const nodeProps = node.properties;
    const nodeId = node.identity; // Use the actual Neo4j ID, not string
    
    // Build template data starting with basic node properties
    const templateData: any = {
      name: nodeProps.name,
      summary: nodeProps.summary,
      properties: Object.entries(nodeProps)
        .filter(([key, value]) => key !== 'name' && key !== 'summary' && key !== 'id')
        .map(([key, value]) => ({ key, value }))
    };
    
    // Execute Cypher queries for template variables
    for (const [varName, cypherQuery] of Object.entries(templateVariables)) {
      try {
        const varResult = await this.session.run(cypherQuery as string, { nodeId });
        templateData[varName] = varResult.records.map(record => {
          const obj: any = {};
          for (const key of record.keys) {
            const value = record.get(key);
            
            // Handle Neo4j node objects (convert to accessible JavaScript objects)
            if (value && typeof value === 'object' && value.identity !== undefined && value.properties) {
              obj[key] = {
                id: value.identity.toString(),
                name: value.properties.name,
                summary: value.properties.summary,
                node_type: value.properties.node_type,
                properties: this.convertNeo4jIntegers(value.properties)
              };
            }
            // Handle Neo4j relationship objects
            else if (value && typeof value === 'object' && value.type) {
              obj[key] = value.type;
            }
            // Handle regular values
            else {
              obj[key] = this.convertNeo4jIntegers(value);
            }
          }
          return obj;
        });
      } catch (error) {
        console.warn(`Failed to execute template variable query '${varName}':`, error);
        templateData[varName] = [];
      }
    }
    
    // Use Mustache for proper template rendering
    let content: string;
    try {
      content = Mustache.render(templateStructure, templateData);
      // If Mustache failed silently, it would return the original template
      if (content === templateStructure) {
        throw new Error('Mustache render returned unchanged template');
      }
    } catch (error) {
      console.error('Mustache rendering failed:', error);
      // Fall back to simple variable replacement
      content = templateStructure;
      content = content.replace(/\{\{name\}\}/g, templateData.name || '');
      content = content.replace(/\{\{summary\}\}/g, templateData.summary || '');
      
      // Simple relationship replacement
      for (const [varName, data] of Object.entries(templateData)) {
        if (Array.isArray(data) && varName.endsWith('_relationships')) {
          let sectionContent = '';
          for (const item of data) {
            const relType = item.relationship_type || 'Related';
            const targetName = item.target?.name || 'Unknown';
            sectionContent += `- **${relType}**: ${targetName}\n`;
          }
          // Replace both normal and inverted sections with the content
          const normalRegex = new RegExp(`\\{\\{#${varName}\\}\\}[\\s\\S]*?\\{\\{\\/${varName}\\}\\}`, 'g');
          const invertedRegex = new RegExp(`\\{\\{\\^${varName}\\}\\}[\\s\\S]*?\\{\\{\\/${varName}\\}\\}`, 'g');
          
          if (data.length > 0) {
            content = content.replace(normalRegex, sectionContent);
            content = content.replace(invertedRegex, '');
          } else {
            content = content.replace(normalRegex, '');
            content = content.replace(invertedRegex, '*No items found*');
          }
        }
      }
    }
    
    return { content };
  }

  /**
   * Convert Neo4j Integer objects to regular JavaScript numbers
   */
  private convertNeo4jIntegers(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    // Handle Neo4j Integer objects
    if (obj && typeof obj === 'object' && 'low' in obj && 'high' in obj) {
      return obj.low + (obj.high * 0x100000000);
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => this.convertNeo4jIntegers(item));
    }
    
    // Handle objects
    if (typeof obj === 'object') {
      const converted: any = {};
      for (const [key, value] of Object.entries(obj)) {
        converted[key] = this.convertNeo4jIntegers(value);
      }
      return converted;
    }
    
    return obj;
  }
/**
   * Explore schema neighborhoods (NodeType and RelationshipType nodes)
   */
  private async exploreSchemaNeighborhoods(
    searchTerms: string[],
    searchStrategy: "vector" | "text" | "combined",
    maxResultsPerTerm: number,
    neighborhoodDepth: number,
    minSimilarityThreshold: number,
    deduplicateNodes: boolean
  ): Promise<any> {
    const neighborhoods: {[term: string]: any} = {};
    
    for (const term of searchTerms) {
      // Search for NodeType and RelationshipType nodes
      const schemaQuery = `
        CALL {
          // Search NodeTypes
          MATCH (nt:NodeType)
          WHERE nt.name CONTAINS $term OR nt.description CONTAINS $term
          RETURN nt as node, 'NodeType' as node_type, 1.0 as similarity, 'text' as match_type
          LIMIT toInteger($maxResults)
          UNION
          // Search RelationshipTypes
          MATCH (rt:RelationshipType)
          WHERE rt.name CONTAINS $term OR rt.description CONTAINS $term
          RETURN rt as node, 'RelationshipType' as node_type, 1.0 as similarity, 'text' as match_type
          LIMIT toInteger($maxResults)
        }
        RETURN node, node_type, similarity, match_type
        ORDER BY similarity DESC
      `;
      
      const searchResult = await this.session.run(schemaQuery, {
        term: term.toLowerCase(),
        maxResults: maxResultsPerTerm
      });
      
      const primaryNodes = [];
      const nodeIds = new Set<string>();
      
      for (const record of searchResult.records) {
        const node = record.get('node');
        const nodeType = record.get('node_type');
        const similarity = record.get('similarity');
        
        const nodeData = {
          id: node.identity.toString(),
          name: node.properties.name || 'Unknown',
          node_type: nodeType,
          properties: node.properties,
          similarity: similarity,
          match_type: record.get('match_type')
        };
        
        primaryNodes.push(nodeData);
        nodeIds.add(nodeData.id);
      }
      
      // Explore neighborhoods for schema nodes
      const relationships = [];
      if (neighborhoodDepth > 0 && nodeIds.size > 0) {
        const neighborQuery = `
          MATCH (n)
          WHERE id(n) IN $nodeIds
          MATCH (n)-[r]-(neighbor)
          WHERE neighbor:NodeType OR neighbor:RelationshipType
          RETURN 
            id(n) as source_id,
            type(r) as relationship_type,
            id(neighbor) as target_id,
            neighbor.name as target_name,
            labels(neighbor) as target_labels,
            neighbor as target_node
          LIMIT 100
        `;
        
        const neighborResult = await this.session.run(neighborQuery, { 
          nodeIds: Array.from(nodeIds).map(id => parseInt(id)) 
        });
        
        for (const record of neighborResult.records) {
          relationships.push({
            source_id: record.get('source_id').toString(),
            target_id: record.get('target_id').toString(),
            relationship_type: record.get('relationship_type'),
            target_name: record.get('target_name'),
            target_labels: record.get('target_labels'),
            target_properties: record.get('target_node').properties
          });
        }
      }
      
      neighborhoods[term] = {
        search_term: term,
        primary_nodes: primaryNodes,
        relationships: relationships,
        schema_mode: true
      };
    }
    
    return {
      neighborhoods,
      summary: {
        total_terms: searchTerms.length,
        total_primary_nodes: Object.values(neighborhoods).reduce((sum: number, n: any) => sum + n.primary_nodes.length, 0),
        total_relationships: Object.values(neighborhoods).reduce((sum: number, n: any) => sum + n.relationships.length, 0),
        schema_mode: true
      }
    };
  }

  /**
   * Explore neighborhoods around search terms with comprehensive analysis
   */
  async exploreNeighborhoods(
    searchTerms: string[],
    searchStrategy: "vector" | "text" | "combined" = "combined",
    maxResultsPerTerm: number = 3,
    neighborhoodDepth: number = 2,
    minSimilarityThreshold: number = 0.1,
    includeRelationshipTypes: boolean = true,
    includeTemplates: boolean = true,
    deduplicateNodes: boolean = true,
    schemaMode: boolean = false
  ): Promise<any> {
    // Parameter validation
    const validStrategies = ["vector", "text", "combined"];
    if (!validStrategies.includes(searchStrategy)) {
      throw new Error(`Invalid search_strategy: "${searchStrategy}". Must be one of: ${validStrategies.join(", ")}`);
    }
    
    if (minSimilarityThreshold < 0 || minSimilarityThreshold > 1) {
      throw new Error(`min_similarity_threshold must be between 0.0 and 1.0, got: ${minSimilarityThreshold}`);
    }
    
    if (maxResultsPerTerm < 0) {
      throw new Error(`max_results_per_term must be non-negative, got: ${maxResultsPerTerm}`);
    }
    
    if (neighborhoodDepth < 0) {
      throw new Error(`neighborhood_depth must be non-negative, got: ${neighborhoodDepth}`);
    }
    
    // Handle schema mode - explore NodeType and RelationshipType nodes instead of regular content
    if (schemaMode) {
      return await this.exploreSchemaNeighborhoods(
        searchTerms,
        searchStrategy,
        maxResultsPerTerm,
        neighborhoodDepth,
        minSimilarityThreshold,
        deduplicateNodes
      );
    }
    
    const neighborhoods: {[term: string]: any} = {};
    const allPrimaryNodeIds = new Set<string>();
    
    // Step 1: Batch search for all terms in a single query
    const batchSearchQuery = await this.buildBatchSearchQuery(searchTerms, searchStrategy, maxResultsPerTerm, minSimilarityThreshold);
    const searchResult = await this.session.run(batchSearchQuery.query, batchSearchQuery.params);
    
    // Process search results by term
    const searchResultsByTerm: {[term: string]: any[]} = {};
    for (const term of searchTerms) {
      searchResultsByTerm[term] = [];
    }
    
    for (const record of searchResult.records) {
      const term = record.get('search_term');
      const nodeData = {
        id: record.get('id'),
        name: record.get('name'),
        type: record.get('type'),
        summary: record.get('summary') || '',
        similarity_score: record.get('similarity_score')
      };
      searchResultsByTerm[term].push(nodeData);
      allPrimaryNodeIds.add(nodeData.id);
    }
    
    // Apply deduplication if requested
    if (deduplicateNodes) {
      for (const term of searchTerms) {
        searchResultsByTerm[term] = this.deduplicateNodesByName(searchResultsByTerm[term]);
      }
    }
    
    // Step 2: Single comprehensive neighborhood analysis query
    if (allPrimaryNodeIds.size > 0) {
      const neighborhoodDepthNum = Number(neighborhoodDepth); // Ensure it's a regular number
      const neighborhoodQuery = `
        // Get multi-hop neighborhood relationships with direction info
        MATCH (primary:Node) WHERE primary.id IN $primaryNodeIds
        MATCH path = (primary)-[*1..${neighborhoodDepthNum}]-(neighbor:Node)
        WHERE NOT neighbor.id IN $primaryNodeIds
        AND ALL(rel in relationships(path) WHERE NOT type(rel) IN ['NODE_TYPE', 'ALIAS_OF', 'VALID_SOURCE', 'VALID_TARGET'])
        WITH primary, neighbor, path, length(path) as distance,
             [rel in relationships(path) | {
               type: type(rel),
               strength: coalesce(rel.relevance_strength, 'medium'),
               direction: CASE
                 WHEN startNode(rel) = primary THEN 'outgoing'
                 WHEN endNode(rel) = primary THEN 'incoming'
                 ELSE 'bidirectional'
               END
             }] as rel_path
        
        // Collect neighborhood data
        WITH primary.id as primary_id,
             collect(DISTINCT {
               id: neighbor.id,
               name: neighbor.name,
               distance: distance,
               relationship_path: rel_path
             }) as nearby_nodes,
             
             // Get direct relationships with enhanced info including direction
             collect(DISTINCT {
               type: rel_path[0].type,
               strength: rel_path[0].strength,
               direction: rel_path[0].direction,
               connected_node: {id: neighbor.id, name: neighbor.name},
               distance: distance
             }) as all_relationships
        
        RETURN primary_id, nearby_nodes, all_relationships, [] as templates_used
      `;
      
      const neighborhoodResult = await this.session.run(neighborhoodQuery, {
        primaryNodeIds: Array.from(allPrimaryNodeIds)
      });
      
      // Build neighborhood data map
      const neighborhoodData: {[nodeId: string]: any} = {};
      for (const record of neighborhoodResult.records) {
        const primaryId = record.get('primary_id');
        neighborhoodData[primaryId] = {
          nearby_nodes: this.convertNeo4jIntegers(record.get('nearby_nodes') || []),
          relationships: this.convertNeo4jIntegers(record.get('all_relationships') || []),
          templates_used: record.get('templates_used') || []
        };
      }
      
      // Step 3: Collect all nearby node IDs for filtering recommendations
      const allNearbyNodeIds = new Set<string>();
      for (const nodeId of allPrimaryNodeIds) {
        const nodeNeighborhood = neighborhoodData[nodeId];
        if (nodeNeighborhood) {
          nodeNeighborhood.nearby_nodes.forEach((node: any) => allNearbyNodeIds.add(node.id));
        }
      }
      
      // Step 4: Generate intelligent recommendations in batch
      const recommendations = await this.generateBatchRecommendations(
        Array.from(allPrimaryNodeIds),
        searchTerms,
        searchStrategy,
        minSimilarityThreshold,
        maxResultsPerTerm,
        Array.from(allNearbyNodeIds)
      );
      
      // Step 5: Assemble final results
      for (const term of searchTerms) {
        const primaryNodes = searchResultsByTerm[term];
        const allRelationships: any[] = [];
        const allNearbyNodes: any[] = [];
        const allTemplates = new Set<string>();
        
        // Aggregate data from all primary nodes for this term
        for (const node of primaryNodes) {
          const nodeNeighborhood = neighborhoodData[node.id];
          if (nodeNeighborhood) {
            allRelationships.push(...nodeNeighborhood.relationships);
            allNearbyNodes.push(...nodeNeighborhood.nearby_nodes);
            nodeNeighborhood.templates_used.forEach((t: string) => allTemplates.add(t));
          }
        }
        
        // Remove duplicates and sort by relevance
        const uniqueRelationships = this.deduplicateRelationships(allRelationships);
        const uniqueNearbyNodes = this.deduplicateNearbyNodes(allNearbyNodes);
        
        neighborhoods[term] = {
          primary_nodes: primaryNodes,
          relationships: uniqueRelationships.slice(0, 20),
          nearby_nodes: uniqueNearbyNodes.slice(0, 15),
          common_relationship_types: includeRelationshipTypes ?
            [...new Set(uniqueRelationships.map(r => r.type))] : [],
          templates_in_use: includeTemplates ? Array.from(allTemplates) : []
        };
      }
      
      return {
        neighborhoods,
        recommendations: recommendations.slice(0, 5)
      };
    }
    
    // Fallback for no results
    for (const term of searchTerms) {
      neighborhoods[term] = {
        primary_nodes: [],
        relationships: [],
        nearby_nodes: [],
        common_relationship_types: [],
        templates_in_use: []
      };
    }
    
    return {
      neighborhoods,
      recommendations: []
    };
  }
  
  /**
   * Build optimized batch search query supporting multiple strategies
   */
  private async buildBatchSearchQuery(searchTerms: string[], strategy: string, maxResults: number, minSimilarityThreshold: number = 0.1) {
    const maxResultsNum = Number(maxResults); // Ensure it's a regular number
    
    if (strategy === "text") {
      // Text-only search
      const query = `
        UNWIND $searchTerms as searchTerm
        MATCH (n:Node)
        WHERE (toLower(n.name) CONTAINS toLower(searchTerm) OR
               toLower(n.summary) CONTAINS toLower(searchTerm))
        
        WITH searchTerm, n,
             CASE
               WHEN toLower(n.name) = toLower(searchTerm) THEN 1.0
               WHEN toLower(n.name) CONTAINS toLower(searchTerm) THEN 0.8
               WHEN toLower(n.summary) CONTAINS toLower(searchTerm) THEN 0.6
               ELSE 0.4
             END as similarity_score
        
        WITH searchTerm, n, similarity_score
        ORDER BY similarity_score DESC
        
        WITH searchTerm, collect({node: n, score: similarity_score})[0..${maxResultsNum}] as topNodesWithScores
        UNWIND topNodesWithScores as nodeWithScore
        
        RETURN searchTerm as search_term,
               nodeWithScore.node.id as id,
               nodeWithScore.node.name as name,
               coalesce(labels(nodeWithScore.node)[1], 'Node') as type,
               nodeWithScore.node.summary as summary,
               nodeWithScore.score as similarity_score
      `;
      
      return {
        query,
        params: {
          searchTerms: searchTerms
        }
      };
    } else if (strategy === "vector") {
      // Vector-only search
      const embeddings: {[term: string]: number[]} = {};
      
      // Generate embeddings for all search terms
      for (const term of searchTerms) {
        try {
          embeddings[term] = await this.generateEmbedding(term);
        } catch (error) {
          console.error(`Failed to generate embedding for term "${term}":`, error);
          // Fallback to empty embedding
          embeddings[term] = new Array(this.embeddingDimension).fill(0);
        }
      }
      
      const query = `
        UNWIND $searchTermsWithEmbeddings as termData
        MATCH (n:Node)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
        WITH termData, n, v,
             reduce(dot = 0.0, i IN range(0, size(v.embedding)-1) |
               dot + v.embedding[i] * termData.embedding[i]
             ) / (
               sqrt(reduce(norm1 = 0.0, x IN v.embedding | norm1 + x * x)) *
               sqrt(reduce(norm2 = 0.0, x IN termData.embedding | norm2 + x * x))
             ) AS similarity_score
       
       WITH termData.term as searchTerm, n, similarity_score
       WHERE similarity_score >= $minSimilarityThreshold
       ORDER BY similarity_score DESC
       
       WITH searchTerm, collect({node: n, score: similarity_score})[0..${maxResultsNum}] as topNodesWithScores
        UNWIND topNodesWithScores as nodeWithScore
        
        RETURN searchTerm as search_term,
               nodeWithScore.node.id as id,
               nodeWithScore.node.name as name,
               coalesce(labels(nodeWithScore.node)[1], 'Node') as type,
               nodeWithScore.node.summary as summary,
               nodeWithScore.score as similarity_score
      `;
      
      return {
        query,
        params: {
          searchTermsWithEmbeddings: searchTerms.map(term => ({
            term: term,
            embedding: embeddings[term]
          })),
          minSimilarityThreshold: minSimilarityThreshold
        }
      };
    } else {
      // Combined search (both text and vector)
      const embeddings: {[term: string]: number[]} = {};
      
      // Generate embeddings for all search terms
      for (const term of searchTerms) {
        try {
          embeddings[term] = await this.generateEmbedding(term);
        } catch (error) {
          console.error(`Failed to generate embedding for term "${term}":`, error);
          embeddings[term] = new Array(this.embeddingDimension).fill(0);
        }
      }
      
      const query = `
        UNWIND $searchTermsWithEmbeddings as termData
        
        // Text search results
        OPTIONAL MATCH (textNode:Node)
        WHERE (toLower(textNode.name) CONTAINS toLower(termData.term) OR
               toLower(textNode.summary) CONTAINS toLower(termData.term))
        WITH termData, textNode,
             CASE
               WHEN textNode IS NULL THEN 0.0
               WHEN toLower(textNode.name) = toLower(termData.term) THEN 1.0
               WHEN toLower(textNode.name) CONTAINS toLower(termData.term) THEN 0.8
               WHEN toLower(textNode.summary) CONTAINS toLower(termData.term) THEN 0.6
               ELSE 0.4
             END as text_score
        
        // Vector search results
        OPTIONAL MATCH (vectorNode:Node)-[:VECTOR_INDEXED_AT]->(v:VectorIndex)
        WITH termData, textNode, text_score, vectorNode, v,
             CASE
               WHEN vectorNode IS NULL OR v IS NULL THEN 0.0
               ELSE reduce(dot = 0.0, i IN range(0, size(v.embedding)-1) |
                 dot + v.embedding[i] * termData.embedding[i]
               ) / (
                 sqrt(reduce(norm1 = 0.0, x IN v.embedding | norm1 + x * x)) *
                 sqrt(reduce(norm2 = 0.0, x IN termData.embedding | norm2 + x * x))
               )
             END AS vector_score
        
        // Combine results
        WITH termData.term as searchTerm,
             CASE
               WHEN textNode IS NOT NULL AND vectorNode IS NOT NULL AND textNode.id = vectorNode.id
               THEN textNode
               WHEN textNode IS NOT NULL AND (vectorNode IS NULL OR text_score >= vector_score)
               THEN textNode
               WHEN vectorNode IS NOT NULL
               THEN vectorNode
               ELSE null
             END as n,
             CASE
               WHEN textNode IS NOT NULL AND vectorNode IS NOT NULL AND textNode.id = vectorNode.id
               THEN (text_score + vector_score) / 2.0
               WHEN textNode IS NOT NULL AND (vectorNode IS NULL OR text_score >= vector_score)
               THEN text_score
               WHEN vectorNode IS NOT NULL
               THEN vector_score
               ELSE 0.0
             END as similarity_score
        
        WHERE n IS NOT NULL AND similarity_score >= $minSimilarityThreshold
        
        WITH searchTerm, n, similarity_score
        ORDER BY similarity_score DESC
        
        WITH searchTerm, n, max(similarity_score) as best_score
        ORDER BY best_score DESC
        
        WITH searchTerm, collect({node: n, score: best_score})[0..${maxResultsNum}] as topNodesWithScores
        UNWIND topNodesWithScores as nodeWithScore
        
        RETURN searchTerm as search_term,
               nodeWithScore.node.id as id,
               nodeWithScore.node.name as name,
               coalesce(labels(nodeWithScore.node)[1], 'Node') as type,
               nodeWithScore.node.summary as summary,
               nodeWithScore.score as similarity_score
      `;
      
      return {
        query,
        params: {
          searchTermsWithEmbeddings: searchTerms.map(term => ({
            term: term,
            embedding: embeddings[term]
          })),
          minSimilarityThreshold: minSimilarityThreshold
        }
      };
    }
  }
  
  /**
   * Generate intelligent recommendations based on graph patterns
   */
  private async generateBatchRecommendations(
    primaryNodeIds: string[],
    searchTerms: string[] = [],
    searchStrategy: string = "combined",
    minSimilarityThreshold: number = 0.1,
    maxResultsPerTerm: number = 3,
    nearbyNodeIds: string[] = []
  ): Promise<any[]> {
    try {
      // First try collaborative filtering approach
      const collaborativeQuery = `
        // Find nodes with shared neighbors (collaborative filtering approach)
        MATCH (primary:Node) WHERE primary.id IN $primaryNodeIds
        MATCH (primary)--(shared:Node)--(candidate:Node)
        WHERE NOT candidate.id IN $primaryNodeIds
        AND NOT candidate.id IN $nearbyNodeIds
        AND NOT (primary)--(candidate)
        
        WITH candidate, count(DISTINCT shared) as sharedNeighbors,
             collect(DISTINCT primary.name) as connectedToPrimary
        WHERE sharedNeighbors >= 2
        
        RETURN candidate.id as id,
               candidate.name as name,
               candidate.summary as summary,
               sharedNeighbors,
               connectedToPrimary,
               sharedNeighbors * 0.8 as recommendation_score,
               'collaborative_filtering' as reason_type
        ORDER BY recommendation_score DESC, sharedNeighbors DESC
        LIMIT 5
      `;
      
      const collaborativeResult = await this.session.run(collaborativeQuery, { primaryNodeIds, nearbyNodeIds });
      const collaborativeRecommendations = collaborativeResult.records.map(record => {
        const sharedNeighbors = this.convertNeo4jIntegers(record.get('sharedNeighbors'));
        const score = this.convertNeo4jIntegers(record.get('recommendation_score'));
        
        return {
          id: record.get('id'),
          name: record.get('name'),
          summary: record.get('summary'),
          reason: `Shares ${sharedNeighbors} common connections with your search results`,
          score: score,
          type: 'collaborative'
        };
      });
      
      // If we have enough collaborative recommendations, return them
      if (collaborativeRecommendations.length >= 3) {
        return collaborativeRecommendations;
      }
      
      // If vector search was used, add semantic similarity recommendations
      if ((searchStrategy === "vector" || searchStrategy === "combined") && searchTerms.length > 0) {
        const semanticQuery = await this.buildBatchSearchQuery(
          searchTerms,
          "vector", // Force vector search for semantic similarity
          maxResultsPerTerm * 3, // Get more results for recommendations
          Math.max(0.05, minSimilarityThreshold - 0.1) // Lower threshold for recommendations
        );
        
        const semanticResult = await this.session.run(semanticQuery.query, semanticQuery.params);
        const semanticRecommendations = semanticResult.records
          .filter(record => !primaryNodeIds.includes(record.get('id')) && !nearbyNodeIds.includes(record.get('id'))) // Exclude primary search results and nearby nodes
          .map(record => ({
            id: record.get('id'),
            name: record.get('name'),
            summary: record.get('summary') || '',
            reason: `Semantically similar to your search (${(this.convertNeo4jIntegers(record.get('similarity_score')) * 100).toFixed(0)}% match)`,
            score: this.convertNeo4jIntegers(record.get('similarity_score')) * 0.6, // Lower weight than collaborative
            type: 'semantic'
          }))
          .slice(0, 5); // Limit semantic recommendations
        
        // Combine collaborative and semantic recommendations and deduplicate
        const allRecommendations = [...collaborativeRecommendations, ...semanticRecommendations];
        const deduplicatedRecommendations = new Map();
        
        // Deduplicate by node ID, keeping the highest scoring entry
        for (const rec of allRecommendations) {
          const existing = deduplicatedRecommendations.get(rec.id);
          if (!existing || rec.score > existing.score) {
            deduplicatedRecommendations.set(rec.id, rec);
          }
        }
        
        return Array.from(deduplicatedRecommendations.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
      }
      
      // Fallback to node type similarity if no vector search
      const nodeTypeQuery = `
        MATCH (primary:Node) WHERE primary.id IN $primaryNodeIds
        MATCH (candidate:Node)
        WHERE NOT candidate.id IN $primaryNodeIds
        AND NOT candidate.id IN $nearbyNodeIds
        AND candidate.node_type = primary.node_type
        AND NOT (primary)--(candidate)
        
        RETURN candidate.id as id,
               candidate.name as name,
               candidate.summary as summary,
               0 as sharedNeighbors,
               ['similar_type'] as connectedToPrimary,
               0.3 as recommendation_score,
               'node_type' as reason_type
        LIMIT 3
      `;
      
      const nodeTypeResult = await this.session.run(nodeTypeQuery, { primaryNodeIds, nearbyNodeIds });
      const nodeTypeRecommendations = nodeTypeResult.records.map(record => ({
        id: record.get('id'),
        name: record.get('name'),
        summary: record.get('summary'),
        reason: 'Similar node type to your search results',
        score: this.convertNeo4jIntegers(record.get('recommendation_score')),
        type: 'node_type'
      }));
      
      // Combine all recommendations and deduplicate
      const allRecommendations = [...collaborativeRecommendations, ...nodeTypeRecommendations];
      const deduplicatedRecommendations = new Map();
      
      // Deduplicate by node ID, keeping the highest scoring entry
      for (const rec of allRecommendations) {
        const existing = deduplicatedRecommendations.get(rec.id);
        if (!existing || rec.score > existing.score) {
          deduplicatedRecommendations.set(rec.id, rec);
        }
      }
      
      return Array.from(deduplicatedRecommendations.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    } catch (error) {
      console.error('Failed to generate recommendations:', error);
      return [];
    }
  }
  
  /**
   * Remove duplicate relationships and sort by relevance
   */
  private deduplicateRelationships(relationships: any[]): any[] {
    const seen = new Set<string>();
    const unique: any[] = [];
    
    // Sort by strength and distance first
    const sorted = relationships.sort((a, b) => {
      const strengthOrder = { strong: 3, medium: 2, weak: 1 };
      const aStrength = strengthOrder[a.strength as keyof typeof strengthOrder] || 1;
      const bStrength = strengthOrder[b.strength as keyof typeof strengthOrder] || 1;
      
      if (aStrength !== bStrength) return bStrength - aStrength;
      return (a.distance || 1) - (b.distance || 1);
    });
    
    for (const rel of sorted) {
      const key = `${rel.type}-${rel.connected_node.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rel);
      }
    }
    
    return unique;
  }
  
  /**
   * Remove duplicate nearby nodes and sort by distance/relevance
   */
  private deduplicateNearbyNodes(nearbyNodes: any[]): any[] {
    const seen = new Set<string>();
    const unique: any[] = [];
    
    // Sort by distance first, then by name
    const sorted = nearbyNodes.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.name.localeCompare(b.name);
    });
    
    for (const node of sorted) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        unique.push(node);
      }
    }
    
    return unique;
  }

  /**
   * Remove duplicate nodes with the same name, keeping the one with highest similarity score
   */
  private deduplicateNodesByName(nodes: any[]): any[] {
    const nodesByName = new Map<string, any>();
    
    for (const node of nodes) {
      const existingNode = nodesByName.get(node.name.toLowerCase());
      if (!existingNode || node.similarity_score > existingNode.similarity_score) {
        nodesByName.set(node.name.toLowerCase(), node);
      }
    }
    
    return Array.from(nodesByName.values()).sort((a, b) => b.similarity_score - a.similarity_score);
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
          LIMIT ${Math.floor(maxPathsPerPair)}
        `;
        
        const result = await this.session.run(pathQuery, {
          sourceId: pair.source,
          targetId: pair.target,
          maxLength: maxPathLength
        });
        
        const paths: PathResult[] = result.records.map((record, index) => {
          const path = record.get('path');
          const pathLength = this.convertNeo4jIntegers(record.get('pathLength'));
          
          // Extract all unique nodes from the path
          const nodeSet = new Set();
          const nodes: Array<{id: string; name: string}> = [];
          
          // Add start node of first segment
          if (path.segments.length > 0) {
            const startNode = path.segments[0].start;
            const startId = startNode.properties.id;
            if (!nodeSet.has(startId)) {
              nodeSet.add(startId);
              nodes.push({
                id: startId,
                name: startNode.properties.name
              });
            }
          }
          
          // Add end node of each segment
          for (const segment of path.segments) {
            const endNode = segment.end;
            const endId = endNode.properties.id;
            if (!nodeSet.has(endId)) {
              nodeSet.add(endId);
              nodes.push({
                id: endId,
                name: endNode.properties.name
              });
            }
          }
          
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
            let variables = {};
            try {
              variables = template.properties.variables ? JSON.parse(template.properties.variables) : {};
            } catch (error) {
              console.warn('Failed to parse template variables:', error);
              variables = {};
            }
            return {
              id: template.properties.id,
              name: template.properties.name,
              description: template.properties.description,
              structure: template.properties.structure,
              variables
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
            
            const templateParams = {
              ...template,
              variables: typeof template.variables === 'object' ? JSON.stringify(template.variables) : template.variables
            };
            
            await this.session.run(createQuery, templateParams);
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
            
            const templateParams = {
              ...template,
              variables: typeof template.variables === 'object' ? JSON.stringify(template.variables) : template.variables
            };
            
            const result = await this.session.run(updateQuery, templateParams);
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
        description: "Create, update, or delete nodes in the knowledge graph with intelligent relationship resolution and validation.\n\n⚠️ RECOMMENDED WORKFLOW: First use explore_neighborhoods with schema_mode=true to understand available NodeTypes and RelationshipTypes, then create missing schema definitions before adding knowledge content.\n\nCREATE: Creates nodes with optional relationships. Target nodes are resolved by exact name match, then vector similarity, finally creating placeholders if needed. Node types are validated against existing NodeType nodes (warnings shown for missing types).\n\nVALIDATION FEATURES:\n- Node types are checked against existing NodeType nodes\n- Suggests similar existing types to prevent duplicates like 'Character' vs 'Person'\n- Validates relationship types against RelationshipType nodes\n- Provides canonical names and validation warnings\n\nDATA MODELING GUIDANCE:\n- Use RELATIONSHIPS for dimensional attributes (categories that could be shared): race, location, allegiance, family ties, etc.\n- Use PROPERTIES for measures (specific attributes unique to that entity): age, height, dates, quotes, descriptions, etc.\n- Example: Instead of property 'race: Dwarf', use relationship 'RACE -> Dwarf' (auto-creates Dwarf node)\n\nUPDATE: Modifies existing node properties (requires node ID). Relationships are preserved.\n\nDELETE: Removes nodes and all associated data including vector indices (requires node ID).",
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
                  properties: { type: "object", description: "Measures/attributes unique to this entity (age, height, dates, quotes, descriptions). Avoid categorical data that should be relationships." },
                  relationships: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        target_id: { type: "string", description: "Name or ID of target node (resolved automatically)" },
                        relationship_type: { type: "string", description: "Type of relationship (e.g., 'RACE', 'LIVES_IN', 'WORKS_FOR', 'MEMBER_OF'). Use for dimensional attributes." },
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
        description: "Create, update, or delete relationships between nodes with intelligent node resolution and validation.\n\n⚠️ RECOMMENDED WORKFLOW: First use explore_neighborhoods with schema_mode=true to understand available RelationshipTypes, then create missing schema definitions before adding knowledge relationships.\n\nCREATE: Creates directed relationships from source to target. Node references are resolved automatically:\n- Exact ID match (highest priority)\n- Exact name match (case-insensitive)\n- Vector similarity search (fuzzy matching)\n- Creates placeholder nodes if no match found\n\nVALIDATION FEATURES:\n- Relationship types are validated against existing RelationshipType nodes\n- Checks directionality and valid source/target node types\n- Suggests canonical relationship names to prevent duplicates\n- Provides validation warnings and recommendations\n\nUPDATE: Modifies relationship properties using relationship ID. Use the ID returned from create operations.\n\nDELETE: Removes relationships completely using relationship ID.\n\nReturns detailed resolution info including similarity scores for ambiguous matches and lists any placeholder nodes created.",
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
              description: "Node identifiers to generate documents for. Supports exact ID match, case-insensitive name match, and vector similarity search as fallbacks."
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
        description: "Explore neighborhoods around search terms with intelligent deduplication and filtering. Use schema_mode to explore NodeType and RelationshipType definitions instead of knowledge content.\n\nSCHEMA MODE USAGE: When schema_mode=true, search for specific schema definition names. For example:\n- Search for 'Character' to find the Character NodeType definition and related RelationshipTypes\n- Search for 'MEMBER_OF' to find that RelationshipType definition and its constraints\n- DO NOT search for 'NodeType' or 'RelationshipType' - search for the actual schema names like 'Character', 'Location', 'FRIEND', etc.",
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
            min_similarity_threshold: { type: "number", description: "Minimum similarity score for vector search results (0.0-1.0)" },
            include_relationship_types: { type: "boolean", description: "Include relationship type analysis" },
            include_templates: { type: "boolean", description: "Include template usage analysis" },
            deduplicate_nodes: { type: "boolean", description: "Remove duplicate nodes with same name" },
            schema_mode: { type: "boolean", description: "Explore schema (NodeType/RelationshipType) instead of knowledge content" }
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
        description: "Create, update, delete, or list document templates for generating rich, navigable knowledge documents.\n\n" +
          "TEMPLATE BEST PRACTICES:\n\n" +
          "1. **Use Hyperlinks for Navigation**: Create clickable links between related nodes using the pattern:\n" +
          "   `[{{target.name}}](node://{{target.id}}) - {{target.summary}}`\n\n" +
          "2. **Access Full Node Objects**: Template variables should return complete node objects, not just properties:\n" +
          "   - Good: `MATCH (n)-[r:FRIEND]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target`\n" +
          "   - Bad: `MATCH (n)-[r:FRIEND]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target.name as target_name`\n\n" +
          "3. **Use Mustache Sections for Dynamic Content**:\n" +
          "   - Loops: `{{#relationships}}...{{/relationships}}`\n" +
          "   - Conditionals: `{{^relationships}}*No relationships found*{{/relationships}}`\n" +
          "   - Properties: `{{#properties}}- **{{key}}**: {{value}}{{/properties}}`\n\n" +
          "4. **Structure Template Variables by Relationship Type**: Create separate variables for different relationship types:\n" +
          "   - `friend_relationships`: `MATCH (n)-[r:FRIEND]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target`\n" +
          "   - `location_relationships`: `MATCH (n)-[r:LOCATED_IN]->(target) WHERE id(n) = $nodeId RETURN type(r) as relationship_type, target`\n\n" +
          "5. **Include Fallback Content**: Always provide inverted sections for empty relationships to create informative documents even when data is sparse.\n\n" +
          "6. **Use Node Type Filtering**: Filter relationships by target node types for better organization:\n" +
          "   `MATCH (n)-[r:CARRIES|OWNS]->(target:Node) WHERE id(n) = $nodeId AND target.node_type = 'Artifact' RETURN type(r) as relationship_type, target`\n\n" +
          "EXAMPLE TEMPLATE STRUCTURE:\n" +
          "```\n" +
          "# {{name}}\n\n" +
          "## Summary\n{{summary}}\n\n" +
          "## Friends\n" +
          "{{#friend_relationships}}\n" +
          "- **{{relationship_type}}**: [{{target.name}}](node://{{target.id}}) - {{target.summary}}\n" +
          "{{/friend_relationships}}\n" +
          "{{^friend_relationships}}\n" +
          "*No friends recorded*\n" +
          "{{/friend_relationships}}\n" +
          "```",
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
                  structure: {
                    type: "string",
                    description: "Mustache template structure using {{variable}} syntax. Use {{#array}}...{{/array}} for loops, {{^array}}...{{/array}} for empty conditions, and [{{target.name}}](node://{{target.id}}) for hyperlinks."
                  },
                  variables: {
                    type: "object",
                    description: "Cypher queries for template variables. Each key becomes a template variable. Queries should return 'target' objects (not just properties) to enable hyperlink generation. Use $nodeId parameter to reference the current node."
                  }
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
          min_similarity_threshold = 0.1,
          include_relationship_types = true,
          include_templates = true,
          deduplicate_nodes = true,
          schema_mode = false
        } = args as {
          search_terms: string[];
          search_strategy?: "vector" | "text" | "combined";
          max_results_per_term?: number;
          neighborhood_depth?: number;
          min_similarity_threshold?: number;
          include_relationship_types?: boolean;
          include_templates?: boolean;
          deduplicate_nodes?: boolean;
          schema_mode?: boolean;
        };
        
        try {
          const result = await dbManager.exploreNeighborhoods(
            search_terms,
            search_strategy,
            Number(max_results_per_term), // Ensure it's a regular number
            Number(neighborhood_depth),   // Ensure it's a regular number
            Number(min_similarity_threshold),
            include_relationship_types,
            include_templates,
            deduplicate_nodes,
            schema_mode
          );
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, (key, value) => {
                  // Handle BigInt values in JSON serialization
                  if (typeof value === 'bigint') {
                    return Number(value);
                  }
                  return value;
                }, 2)
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${(error as Error).message}`
              }
            ]
          };
        }
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
