// Default values for tool parameters
export const TOOL_DEFAULTS = {
  EXPLORE_NEIGHBORHOODS: {
    SEARCH_STRATEGY: "combined" as const,
    MAX_RESULTS_PER_TERM: 3,
    NEIGHBORHOOD_DEPTH: 2,
    MIN_SIMILARITY_THRESHOLD: 0.1,
    INCLUDE_RELATIONSHIP_TYPES: true,
    INCLUDE_TEMPLATES: true,
    DEDUPLICATE_NODES: true,
    SCHEMA_MODE: false
  },
  FIND_RELATIONSHIP_PATHS: {
    MAX_PATH_LENGTH: 4,
    MIN_STRENGTH_THRESHOLD: 0.1,
    MAX_PATHS_PER_PAIR: 3,
    INCLUDE_PATH_NARRATIVES: true
  }
} as const;

// Type definitions for search strategies
export type SearchStrategy = "vector" | "text" | "combined";
export type RelevanceStrength = "weak" | "medium" | "strong";
export type ToolOperation = "create" | "update" | "delete" | "list";