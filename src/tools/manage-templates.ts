import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const manageTemplatesSchema: Tool = {
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
};