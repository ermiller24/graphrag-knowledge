// Export all tool schemas
export { manageNodesSchema } from './manage-nodes.js';
export { manageRelationshipsSchema } from './manage-relationships.js';
export { generateDocumentsSchema } from './generate-documents.js';
export { exploreNeighborhoodsSchema } from './explore-neighborhoods.js';
export { findRelationshipPathsSchema } from './find-relationship-paths.js';
export { manageTemplatesSchema } from './manage-templates.js';
export { unsafeQuerySchema } from './unsafe-query.js';

// Import for array creation
import { manageNodesSchema } from './manage-nodes.js';
import { manageRelationshipsSchema } from './manage-relationships.js';
import { generateDocumentsSchema } from './generate-documents.js';
import { exploreNeighborhoodsSchema } from './explore-neighborhoods.js';
import { findRelationshipPathsSchema } from './find-relationship-paths.js';
import { manageTemplatesSchema } from './manage-templates.js';
import { unsafeQuerySchema } from './unsafe-query.js';

// Collect all schemas in an array for easy iteration
export const allToolSchemas = [
  manageNodesSchema,
  manageRelationshipsSchema,
  generateDocumentsSchema,
  exploreNeighborhoodsSchema,
  findRelationshipPathsSchema,
  manageTemplatesSchema,
  unsafeQuerySchema
];