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
      await this.createInitialNodeTypes();
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
      
      // Node type constraints
      'CREATE CONSTRAINT node_type_name IF NOT EXISTS FOR (nt:NodeType) REQUIRE nt.name IS UNIQUE',
      
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
      
      // Node type indexes
      'CREATE INDEX node_type_name_idx IF NOT EXISTS FOR (nt:NodeType) ON (nt.name)',
      'CREATE INDEX node_type_aliases_idx IF NOT EXISTS FOR (nt:NodeType) ON (nt.aliases)',
      
      // Relationship type indexes
      'CREATE INDEX relationship_type_name_idx IF NOT EXISTS FOR (r:RelationshipType) ON (r.name)',
      'CREATE INDEX relationship_type_aliases_idx IF NOT EXISTS FOR (r:RelationshipType) ON (r.aliases)'
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

  private async createInitialNodeTypes(): Promise<void> {
    console.log('Creating initial node types...');
    
    const nodeTypes = [
      {
        name: 'Character',
        description: 'Individual persons, beings, or entities in stories, history, or fiction',
        aliases: ['Person', 'Individual', 'Being', 'Figure', 'Protagonist', 'Hero', 'Villain'],
        valid_properties: ['age', 'height', 'description', 'birth_date', 'death_date', 'occupation'],
        common_relationships: ['CHILD_OF', 'LIVES_IN', 'MEMBER_OF', 'EMPLOYED_BY', 'INFLUENCED_BY']
      },
      {
        name: 'Location',
        description: 'Places, regions, cities, buildings, or geographical areas',
        aliases: ['Place', 'Region', 'City', 'Building', 'Area', 'Realm', 'Kingdom'],
        valid_properties: ['population', 'area', 'description', 'founded_date', 'coordinates'],
        common_relationships: ['LOCATED_IN', 'RULED_BY', 'CONTAINS']
      },
      {
        name: 'Organization',
        description: 'Groups, companies, institutions, or formal associations',
        aliases: ['Group', 'Company', 'Institution', 'Association', 'Guild', 'Fellowship'],
        valid_properties: ['founded_date', 'size', 'description', 'purpose', 'headquarters'],
        common_relationships: ['LOCATED_IN', 'FOUNDED_BY', 'LED_BY', 'MEMBER_OF']
      },
      {
        name: 'Event',
        description: 'Significant occurrences, battles, ceremonies, or historical moments',
        aliases: ['Battle', 'War', 'Ceremony', 'Meeting', 'Occurrence', 'Incident'],
        valid_properties: ['date', 'duration', 'description', 'outcome', 'casualties'],
        common_relationships: ['OCCURRED_AT', 'PARTICIPATED_IN', 'CAUSED_BY', 'LED_TO']
      },
      {
        name: 'Artifact',
        description: 'Objects, items, weapons, tools, or magical items of significance',
        aliases: ['Object', 'Item', 'Weapon', 'Tool', 'Ring', 'Sword', 'Treasure'],
        valid_properties: ['material', 'weight', 'description', 'created_date', 'value'],
        common_relationships: ['OWNED_BY', 'CREATED_BY', 'LOCATED_IN', 'USED_BY']
      },
      {
        name: 'Concept',
        description: 'Abstract ideas, philosophies, magic systems, or theoretical constructs',
        aliases: ['Idea', 'Philosophy', 'Theory', 'Magic', 'Power', 'Ability'],
        valid_properties: ['description', 'origin', 'principles', 'applications'],
        common_relationships: ['PRACTICED_BY', 'ORIGINATED_FROM', 'RELATED_TO']
      },
      {
        name: 'NodeType',
        description: 'Meta-nodes that define valid node types and their properties for validation',
        aliases: ['Type', 'Category', 'Classification'],
        valid_properties: ['name', 'description', 'aliases', 'valid_properties', 'common_relationships'],
        common_relationships: ['VALIDATES', 'CATEGORIZES']
      },
      {
        name: 'RelationshipType',
        description: 'Meta-nodes that define valid relationship types and their constraints for validation',
        aliases: ['RelationType', 'ConnectionType', 'LinkType'],
        valid_properties: ['name', 'directionality', 'valid_source_types', 'valid_target_types', 'description', 'aliases'],
        common_relationships: ['VALIDATES', 'CONSTRAINS']
      }
    ];

    for (const nodeType of nodeTypes) {
      try {
        const query = `
          MERGE (nt:NodeType {name: $name})
          SET nt.description = $description,
              nt.valid_properties = $valid_properties,
              nt.common_relationships = $common_relationships
          RETURN nt.name as name
        `;
        
        await this.session.run(query, nodeType);
        console.log(`✓ Created node type: ${nodeType.name}`);
        
        // Create alias relationships if any exist
        if (nodeType.aliases && nodeType.aliases.length > 0) {
          for (const alias of nodeType.aliases) {
            const aliasQuery = `
              MERGE (alias:NodeType {name: $alias})
              MERGE (canonical:NodeType {name: $canonical})
              MERGE (alias)-[:ALIAS_OF]->(canonical)
            `;
            await this.session.run(aliasQuery, { alias, canonical: nodeType.name });
            console.log(`  ✓ Created alias: ${alias} -> ${nodeType.name}`);
          }
        }
      } catch (error) {
        console.error(`Failed to create node type ${nodeType.name}:`, error);
      }
    }
  }

  private async createInitialRelationshipTypes(): Promise<void> {
    console.log('Creating initial relationship types...');
    
    const relationshipTypes = [
      // Special system relationships
      {
        name: 'USES_TEMPLATE',
        description: 'Connects nodes to their templates',
        directionality: 'source_to_target',
        valid_source_types: ['Node'],
        valid_target_types: ['Template'],
        aliases: []
      },
      {
        name: 'NODE_TYPE',
        description: 'Connects nodes to their type definitions',
        directionality: 'source_to_target',
        valid_source_types: ['Node'],
        valid_target_types: ['NodeType'],
        aliases: []
      },
      {
        name: 'CACHED_AT',
        description: 'Connects nodes to their cached documents',
        directionality: 'source_to_target',
        valid_source_types: ['Node'],
        valid_target_types: ['CachedDocument'],
        aliases: []
      },
      {
        name: 'VECTOR_INDEXED_AT',
        description: 'Connects nodes to their vector indices',
        directionality: 'source_to_target',
        valid_source_types: ['Node'],
        valid_target_types: ['VectorIndex'],
        aliases: []
      },
      {
        name: 'DEPENDS_ON',
        description: 'Tracks dependencies for cached documents',
        directionality: 'source_to_target',
        valid_source_types: ['CachedDocument'],
        valid_target_types: ['Node'],
        aliases: []
      },
      
      // Common domain relationships
      {
        name: 'CHILD_OF',
        description: 'Parent-child relationship (being someone\'s child is more defining than being someone\'s parent)',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Character'],
        aliases: ['SON_OF', 'DAUGHTER_OF', 'OFFSPRING_OF']
      },
      {
        name: 'INFLUENCED_BY',
        description: 'Influence relationship (being influenced is more defining than being an influencer)',
        directionality: 'source_to_target',
        valid_source_types: ['Character', 'Organization', 'Event'],
        valid_target_types: ['Character', 'Organization', 'Event', 'Concept'],
        aliases: ['INSPIRED_BY', 'AFFECTED_BY']
      },
      {
        name: 'EMPLOYED_BY',
        description: 'Employment relationship (employment is more defining for the person)',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Organization'],
        aliases: ['WORKS_FOR', 'SERVES']
      },
      {
        name: 'LOCATED_IN',
        description: 'Location relationship (location is more defining for the located entity)',
        directionality: 'source_to_target',
        valid_source_types: ['Character', 'Organization', 'Event', 'Artifact', 'Location'],
        valid_target_types: ['Location'],
        aliases: ['SITUATED_IN', 'FOUND_IN', 'RESIDES_IN']
      },
      {
        name: 'COLLABORATED_WITH',
        description: 'Collaboration relationship (equally important to both parties)',
        directionality: 'bidirectional',
        valid_source_types: ['Character', 'Organization'],
        valid_target_types: ['Character', 'Organization'],
        aliases: ['WORKED_WITH', 'PARTNERED_WITH']
      },
      {
        name: 'STUDIED_AT',
        description: 'Education relationship (studying is more defining for the student)',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Organization', 'Location'],
        aliases: ['EDUCATED_AT', 'LEARNED_AT']
      },
      {
        name: 'PERFORMED_AT',
        description: 'Performance relationship (performing is more defining for the performer)',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Location', 'Event'],
        aliases: ['PLAYED_AT', 'ACTED_AT']
      },
      {
        name: 'MEMBER_OF',
        description: 'Membership relationship (membership is more defining for the member)',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Organization'],
        aliases: ['BELONGS_TO', 'PART_OF']
      },
      {
        name: 'OWNS',
        description: 'Ownership relationship',
        directionality: 'source_to_target',
        valid_source_types: ['Character', 'Organization'],
        valid_target_types: ['Artifact', 'Location'],
        aliases: ['POSSESSES', 'HAS']
      },
      {
        name: 'CREATED_BY',
        description: 'Creation relationship (artifact to creator)',
        directionality: 'target_to_source',
        valid_source_types: ['Artifact', 'Organization', 'Concept'],
        valid_target_types: ['Character'],
        aliases: ['MADE_BY', 'FORGED_BY', 'FOUNDED_BY']
      },
      
      // Common LOTR/Fantasy relationships that users often need
      {
        name: 'FRIEND',
        description: 'Friendship relationship between characters',
        directionality: 'bidirectional',
        valid_source_types: ['Character'],
        valid_target_types: ['Character'],
        aliases: ['BEFRIENDS', 'COMPANION']
      },
      {
        name: 'ALLY',
        description: 'Alliance relationship between characters or organizations',
        directionality: 'bidirectional',
        valid_source_types: ['Character', 'Organization'],
        valid_target_types: ['Character', 'Organization'],
        aliases: ['ALLIED_WITH', 'SUPPORTS']
      },
      {
        name: 'PROTECTS',
        description: 'Protection relationship where source protects target',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Character', 'Location', 'Artifact'],
        aliases: ['GUARDS', 'DEFENDS']
      },
      {
        name: 'GUIDES',
        description: 'Guidance relationship where source guides target',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Character'],
        aliases: ['LEADS', 'MENTORS']
      },
      {
        name: 'HOME_OF',
        description: 'Location relationship where source is home to target',
        directionality: 'source_to_target',
        valid_source_types: ['Location'],
        valid_target_types: ['Character'],
        aliases: ['HOUSES', 'SHELTERS']
      },
      {
        name: 'CARRIES',
        description: 'Possession relationship where source carries target',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Artifact'],
        aliases: ['BEARS', 'HOLDS']
      },
      {
        name: 'RULES',
        description: 'Leadership relationship where source rules target',
        directionality: 'source_to_target',
        valid_source_types: ['Character'],
        valid_target_types: ['Location', 'Organization'],
        aliases: ['GOVERNS', 'REIGNS_OVER']
      }
    ];

    for (const relType of relationshipTypes) {
      try {
        const query = `
          MERGE (rt:RelationshipType {name: $name})
          SET rt.description = $description,
              rt.directionality = $directionality
          RETURN rt.name as name
        `;
        
        await this.session.run(query, relType);
        console.log(`✓ Created relationship type: ${relType.name}`);
        
        // Create VALID_SOURCE relationships
        if (relType.valid_source_types && relType.valid_source_types.length > 0) {
          for (const sourceType of relType.valid_source_types) {
            const sourceQuery = `
              MERGE (rt:RelationshipType {name: $relName})
              MERGE (nt:NodeType {name: $nodeType})
              MERGE (rt)-[:VALID_SOURCE]->(nt)
            `;
            await this.session.run(sourceQuery, { relName: relType.name, nodeType: sourceType });
            console.log(`  ✓ Added valid source: ${relType.name} -> ${sourceType}`);
          }
        }
        
        // Create VALID_TARGET relationships
        if (relType.valid_target_types && relType.valid_target_types.length > 0) {
          for (const targetType of relType.valid_target_types) {
            const targetQuery = `
              MERGE (rt:RelationshipType {name: $relName})
              MERGE (nt:NodeType {name: $nodeType})
              MERGE (rt)-[:VALID_TARGET]->(nt)
            `;
            await this.session.run(targetQuery, { relName: relType.name, nodeType: targetType });
            console.log(`  ✓ Added valid target: ${relType.name} -> ${targetType}`);
          }
        }
        
        // Create alias relationships
        if (relType.aliases && relType.aliases.length > 0) {
          for (const alias of relType.aliases) {
            const aliasQuery = `
              MERGE (alias:RelationshipType {name: $alias})
              MERGE (canonical:RelationshipType {name: $canonical})
              MERGE (alias)-[:ALIAS_OF]->(canonical)
            `;
            await this.session.run(aliasQuery, { alias, canonical: relType.name });
            console.log(`  ✓ Created alias: ${alias} -> ${relType.name}`);
          }
        }
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