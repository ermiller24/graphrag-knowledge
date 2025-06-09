// Type definitions for GraphRAG Knowledge system

// Type definitions
export interface NodeData {
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

// Validation system export interfaces
export interface NodeTypeDefinition {
  name: string;
  description: string;
  aliases: string[];
  valid_properties: string[];
  common_relationships: string[];
}

export interface RelationshipTypeDefinition {
  name: string;
  directionality: "source_to_target" | "bidirectional" | "target_to_source";
  valid_source_types: string[];
  valid_target_types: string[];
  description: string;
  aliases: string[];
}

export interface ValidationResult {
  is_valid: boolean;
  name?: string;
  suggestions?: string[];
  warnings?: string[];
  errors?: string[];
  should_reverse?: boolean;
}

export interface RelationshipData {
  id?: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
  relevance_strength?: "weak" | "medium" | "strong";
  properties?: {[key: string]: any};
}

export interface DocumentGenerationOptions {
  force_regenerate?: boolean;
  include_dependencies?: boolean;
  template_override?: string;
}

export interface SearchResult {
  id: string;
  name: string;
  type: string;
  summary: string;
  similarity_score: number;
}

export interface PathResult {
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

export interface NodeResolution {
  user_specified: string;
  resolved_id: string;
  resolved_name: string;
  resolution_method: 'exact_match' | 'vector_match' | 'create_placeholder' | 'ambiguous' | 'intra_batch';
  similarity_score?: number;
  alternatives?: Array<{name: string; similarity: number}>;
}

export interface BulkRelationship {
  sourceId: string;
  targetId: string;
  relationshipType: string;
  relevanceStrength: "weak" | "medium" | "strong";
  properties: {[key: string]: any};
  resolution: NodeResolution;
  was_reversed?: boolean;
}