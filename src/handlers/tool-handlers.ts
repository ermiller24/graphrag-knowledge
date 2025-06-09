import { DatabaseManager } from '../database/index.js';
import { 
  NodeData, 
  RelationshipData, 
  DocumentGenerationOptions 
} from '../types.js';
import { 
  TOOL_DEFAULTS,
  SearchStrategy,
  createSuccessResponse,
  createErrorResponse,
  safeNumber,
  safeString,
  safeBoolean,
  logger
} from '../utils/index.js';

// Tool handler functions with standardized parameter handling and error management

export async function handleManageNodes(
  dbManager: DatabaseManager,
  args: { operation: "create" | "update" | "delete", nodes: NodeData[] }
) {
  const { operation, nodes } = args;
  logger.debug(`Managing nodes: operation=${operation}, count=${nodes.length}`);
  
  const result = await dbManager.manageNodes(operation, nodes);
  logger.info(`Successfully managed ${nodes.length} nodes with operation: ${operation}`);
  
  return result;
}

export async function handleManageRelationships(
  dbManager: DatabaseManager,
  args: { operation: "create" | "update" | "delete", relationships: RelationshipData[] }
) {
  const { operation, relationships } = args;
  logger.debug(`Managing relationships: operation=${operation}, count=${relationships.length}`);
  
  const result = await dbManager.manageRelationships(operation, relationships);
  logger.info(`Successfully managed ${relationships.length} relationships with operation: ${operation}`);
  
  return result;
}

export async function handleGenerateDocuments(
  dbManager: DatabaseManager,
  args: {
    node_identifiers: string[];
    force_regenerate?: boolean;
    include_dependencies?: boolean;
    template_override?: string;
  }
) {
  const { node_identifiers, force_regenerate, include_dependencies, template_override } = args;
  logger.debug(`Generating documents for ${node_identifiers.length} nodes`);
  
  const options: DocumentGenerationOptions = {
    force_regenerate,
    include_dependencies,
    template_override
  };
  
  const result = await dbManager.generateDocuments(node_identifiers, options);
  logger.info(`Successfully generated documents for ${node_identifiers.length} nodes`);
  
  return result;
}

export async function handleExploreNeighborhoods(
  dbManager: DatabaseManager,
  args: {
    search_terms: string[];
    search_strategy?: SearchStrategy;
    max_results_per_term?: number;
    neighborhood_depth?: number;
    min_similarity_threshold?: number;
    include_relationship_types?: boolean;
    include_templates?: boolean;
    deduplicate_nodes?: boolean;
    schema_mode?: boolean;
  }
) {
  const defaults = TOOL_DEFAULTS.EXPLORE_NEIGHBORHOODS;
  
  // Normalize and validate parameters using utility functions
  const search_terms = args.search_terms;
  const search_strategy = safeString(args.search_strategy, defaults.SEARCH_STRATEGY) as SearchStrategy;
  const max_results_per_term = safeNumber(args.max_results_per_term, defaults.MAX_RESULTS_PER_TERM);
  const neighborhood_depth = safeNumber(args.neighborhood_depth, defaults.NEIGHBORHOOD_DEPTH);
  const min_similarity_threshold = safeNumber(args.min_similarity_threshold, defaults.MIN_SIMILARITY_THRESHOLD);
  const include_relationship_types = safeBoolean(args.include_relationship_types, defaults.INCLUDE_RELATIONSHIP_TYPES);
  const include_templates = safeBoolean(args.include_templates, defaults.INCLUDE_TEMPLATES);
  const deduplicate_nodes = safeBoolean(args.deduplicate_nodes, defaults.DEDUPLICATE_NODES);
  const schema_mode = safeBoolean(args.schema_mode, defaults.SCHEMA_MODE);
  
  logger.debug(`Exploring neighborhoods: terms=${search_terms.length}, strategy=${search_strategy}, schema_mode=${schema_mode}`);
  
  const result = await dbManager.exploreNeighborhoods(
    search_terms,
    search_strategy,
    max_results_per_term,
    neighborhood_depth,
    min_similarity_threshold,
    include_relationship_types,
    include_templates,
    deduplicate_nodes,
    schema_mode
  );
  
  logger.info(`Successfully explored neighborhoods for ${search_terms.length} search terms`);
  return result;
}

export async function handleFindRelationshipPaths(
  dbManager: DatabaseManager,
  args: {
    node_pairs: Array<{source: string; target: string}>;
    max_path_length?: number;
    min_strength_threshold?: number;
    max_paths_per_pair?: number;
    include_path_narratives?: boolean;
  }
) {
  const defaults = TOOL_DEFAULTS.FIND_RELATIONSHIP_PATHS;
  
  const { node_pairs } = args;
  const max_path_length = safeNumber(args.max_path_length, defaults.MAX_PATH_LENGTH);
  const min_strength_threshold = safeNumber(args.min_strength_threshold, defaults.MIN_STRENGTH_THRESHOLD);
  const max_paths_per_pair = safeNumber(args.max_paths_per_pair, defaults.MAX_PATHS_PER_PAIR);
  const include_path_narratives = safeBoolean(args.include_path_narratives, defaults.INCLUDE_PATH_NARRATIVES);
  
  logger.debug(`Finding relationship paths for ${node_pairs.length} node pairs`);
  
  const result = await dbManager.findRelationshipPaths(
    node_pairs,
    max_path_length,
    min_strength_threshold,
    max_paths_per_pair,
    include_path_narratives
  );
  
  logger.info(`Successfully found relationship paths for ${node_pairs.length} node pairs`);
  return result;
}

export async function handleManageTemplates(
  dbManager: DatabaseManager,
  args: {
    operation: "create" | "update" | "delete" | "list";
    templates?: Array<{
      id: string;
      name: string;
      description: string;
      structure: string;
      variables: {[key: string]: string};
    }>;
  }
) {
  const { operation, templates = [] } = args;
  logger.debug(`Managing templates: operation=${operation}, count=${templates.length}`);
  
  const result = await dbManager.manageTemplates(operation, templates);
  logger.info(`Successfully managed templates with operation: ${operation}`);
  
  return result;
}

export async function handleUnsafeQuery(
  dbManager: DatabaseManager,
  args: {
    query: string;
    parameters?: any;
  }
) {
  const { query, parameters = {} } = args;
  logger.warn(`Executing unsafe query: ${query.substring(0, 100)}...`);
  
  const result = await dbManager.unsafeQuery(query, parameters);
  logger.info('Unsafe query executed successfully');
  
  return result;
}