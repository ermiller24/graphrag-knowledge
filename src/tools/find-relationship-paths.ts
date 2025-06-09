import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const findRelationshipPathsSchema: Tool = {
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
};