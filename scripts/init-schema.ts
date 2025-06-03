#!/usr/bin/env node

import * as neo4j from 'neo4j-driver';

/**
 * Database schema initialization script for GraphRAG Knowledge MCP Server
 * This script should be run once after Neo4j startup to create indexes, constraints, and initial data
 * Run with: docker exec graphrag-knowledge-mcp node scripts/init-schema.js
 */

class SchemaInitializer {
  private driver: neo4j.Driver;
  private session: neo4j.Session;

  constructor() {
    this.driver = neo4j.default.driver(
      'bolt://neo4j:7687',
      neo4j.default.auth.basic('neo4j', 'password')
    );
    this.session = this.driver.session();
  }

  async initialize(): Promise<void> {
    try {
      console.log('Starting schema initialization...');
      
      await this.createConstraints();
      await this.createIndexes();
      await this.createVectorIndexes();
      await this.createInitialRelationshipTypes();
      
      console.log('Schema initialization completed successfully');
    } catch (error) {
      console.error('Failed to initialize schema:', error);
      throw error;
    }
  }

  private async createConstraints(): Promise<void> {
    console.log('Creating constraints...');
    
    const constraints = [
      // Node constraints
      'CREATE CONSTRAINT node_id IF NOT EXISTS FOR (n:Node) REQUIRE n.id IS UNIQUE',
      
      // Template constraints
      'CREATE CONSTRAINT template_id IF NOT EXISTS FOR (t:Template) REQUIRE t.id IS UNIQUE',
      
      // Cached document constraints
      'CREATE CONSTRAINT cached_document_id IF NOT EXISTS FOR (c:CachedDocument) REQUIRE c.id IS UNIQUE',
      
      // Vector index constraints
      'CREATE CONSTRAINT vector_index_id IF NOT EXISTS FOR (v:VectorIndex) REQUIRE v.id IS UNIQUE',
      
      // Relationship type constraints
      'CREATE CONSTRAINT relationship_type_name IF NOT EXISTS FOR (r:RelationshipType) REQUIRE r.name IS UNIQUE'
    ];

    for (const constraint of constraints) {
      try {
        await this.session.run(constraint);
        console.log(`✓ Created constraint: ${constraint.split(' ')[2]}`);
      } catch (error) {
        console.log(`⚠ Constraint may already exist: ${constraint.split(' ')[2]}`);
      }
    }
  }

  private async createIndexes(): Promise<void> {
    console.log('Creating indexes...');
    
    const indexes = [
      // Node indexes
      'CREATE INDEX node_id_idx IF NOT EXISTS FOR (n:Node) ON (n.id)',
      'CREATE INDEX node_name_idx IF NOT EXISTS FOR (n:Node) ON (n.name)',
      'CREATE INDEX node_last_modified_idx IF NOT EXISTS FOR (n:Node) ON (n.last_modified_date)',
      
      // Template indexes
      'CREATE INDEX template_id_idx IF NOT EXISTS FOR (t:Template) ON (t.id)',
      'CREATE INDEX template_name_idx IF NOT EXISTS FOR (t:Template) ON (t.name)',
      
      // Cached document indexes
      'CREATE INDEX cached_document_id_idx IF NOT EXISTS FOR (c:CachedDocument) ON (c.id)',
      'CREATE INDEX cached_document_generated_at_idx IF NOT EXISTS FOR (c:CachedDocument) ON (c.generated_at)',
      'CREATE INDEX cached_document_is_valid_idx IF NOT EXISTS FOR (c:CachedDocument) ON (c.is_valid)',
      
      // Vector index indexes
      'CREATE INDEX vector_index_id_idx IF NOT EXISTS FOR (v:VectorIndex) ON (v.id)',
      'CREATE INDEX vector_index_model_idx IF NOT EXISTS FOR (v:VectorIndex) ON (v.model)',
      
      // Relationship type indexes
      'CREATE INDEX relationship_type_name_idx IF NOT EXISTS FOR (r:RelationshipType) ON (r.name)'
    ];

    for (const index of indexes) {
      try {
        await this.session.run(index);
        console.log(`✓ Created index: ${index.split(' ')[2]}`);
      } catch (error) {
        console.log(`⚠ Index may already exist: ${index.split(' ')[2]}`);
      }
    }
  }

  private async createVectorIndexes(): Promise<void> {
    console.log('Creating vector indexes...');
    
    try {
      // Check if vector indexes already exist
      const checkQuery = `
        SHOW INDEXES
        WHERE type = 'VECTOR'
      `;
      
      const result = await this.session.run(checkQuery);
      const existingIndexes = new Set(result.records.map(record => record.get('name')));
      
      // Create vector index for VectorIndex nodes
      const vectorIndexName = 'vector_index_embedding_idx';
      if (!existingIndexes.has(vectorIndexName)) {
        const createVectorIndexQuery = `
          CREATE VECTOR INDEX ${vectorIndexName} IF NOT EXISTS
          FOR (v:VectorIndex) ON (v.embedding)
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: 384,
              \`vector.similarity_function\`: 'cosine'
            }
          }
        `;
        
        await this.session.run(createVectorIndexQuery);
        console.log(`✓ Created vector index: ${vectorIndexName}`);
      } else {
        console.log(`⚠ Vector index already exists: ${vectorIndexName}`);
      }
    } catch (error) {
      console.error('Failed to create vector indexes:', error);
      // Continue with initialization even if vector index creation fails
    }
  }

  private async createInitialRelationshipTypes(): Promise<void> {
    console.log('Creating initial relationship types...');
    
    const relationshipTypes = [
      // Special system relationships
      {
        name: 'USES_TEMPLATE',
        description: 'Connects nodes to their templates',
        source_types: ['Node'],
        target_types: ['Template'],
        directionality: 'strong'
      },
      {
        name: 'CACHED_AT',
        description: 'Connects nodes to their cached documents',
        source_types: ['Node'],
        target_types: ['CachedDocument'],
        directionality: 'strong'
      },
      {
        name: 'VECTOR_INDEXED_AT',
        description: 'Connects nodes to their vector indices',
        source_types: ['Node'],
        target_types: ['VectorIndex'],
        directionality: 'strong'
      },
      {
        name: 'DEPENDS_ON',
        description: 'Tracks dependencies for cached documents',
        source_types: ['CachedDocument'],
        target_types: ['Node'],
        directionality: 'strong'
      },
      
      // Common domain relationships
      {
        name: 'CHILD_OF',
        description: 'Parent-child relationship (being someone\'s child is more defining than being someone\'s parent)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'strong'
      },
      {
        name: 'INFLUENCED_BY',
        description: 'Influence relationship (being influenced is more defining than being an influencer)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'weak'
      },
      {
        name: 'EMPLOYED_BY',
        description: 'Employment relationship (employment is more defining for the person)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'strong'
      },
      {
        name: 'LOCATED_IN',
        description: 'Location relationship (location is more defining for the located entity)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'strong'
      },
      {
        name: 'COLLABORATED_WITH',
        description: 'Collaboration relationship (equally important to both parties)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'balanced'
      },
      {
        name: 'STUDIED_AT',
        description: 'Education relationship (studying is more defining for the student)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'strong'
      },
      {
        name: 'PERFORMED_AT',
        description: 'Performance relationship (performing is more defining for the performer)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'strong'
      },
      {
        name: 'MEMBER_OF',
        description: 'Membership relationship (membership is more defining for the member)',
        source_types: ['Node'],
        target_types: ['Node'],
        directionality: 'strong'
      }
    ];

    for (const relType of relationshipTypes) {
      try {
        const query = `
          MERGE (rt:RelationshipType {name: $name})
          SET rt.description = $description,
              rt.source_types = $source_types,
              rt.target_types = $target_types,
              rt.directionality = $directionality
          RETURN rt.name as name
        `;
        
        await this.session.run(query, relType);
        console.log(`✓ Created relationship type: ${relType.name}`);
      } catch (error) {
        console.error(`Failed to create relationship type ${relType.name}:`, error);
      }
    }
  }

  async close(): Promise<void> {
    await this.session.close();
    await this.driver.close();
  }
}

async function main() {
  const initializer = new SchemaInitializer();
  
  try {
    await initializer.initialize();
    console.log('\n🎉 Schema initialization completed successfully!');
    console.log('The GraphRAG Knowledge MCP server is ready to use.');
  } catch (error) {
    console.error('\n❌ Schema initialization failed:', error);
    process.exit(1);
  } finally {
    await initializer.close();
  }
}

// Run the initialization if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}