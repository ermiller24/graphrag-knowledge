import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const exploreNeighborhoodsSchema: Tool = {
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
};