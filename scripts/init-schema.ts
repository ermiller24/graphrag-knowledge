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
        description: 'Individual persons, employees, stakeholders, contacts, or clients',
        aliases: ['Person', 'Employee', 'Stakeholder', 'Contact', 'Client', 'Lead'],
        valid_properties: ['age', 'email', 'phone', 'role', 'department', 'description', 'birth_date', 'occupation'],
        common_relationships: ['REPORTS_TO', 'LOCATED_IN', 'MEMBER_OF', 'EMPLOYED_BY', 'MANAGES_TEAM']
      },
      {
        name: 'Location',
        description: 'Physical or virtual places, regions, cities, offices, or market areas',
        aliases: ['Place', 'Region', 'City', 'Office', 'Branch', 'Market_Area', 'Website'],
        valid_properties: ['address', 'country', 'region', 'description', 'founded_date', 'coordinates'],
        common_relationships: ['LOCATED_IN', 'BRANCH_OF', 'CONTAINS_OFFICE']
      },
      {
        name: 'Organization',
        description: 'Companies, departments, subsidiaries, partner companies, or competitors',
        aliases: ['Company', 'Department', 'Subsidiary', 'Partner_Company', 'Competitor', 'Vendor', 'Customer_Org'],
        valid_properties: ['founded_date', 'number_of_employees', 'industry', 'description', 'purpose', 'headquarters_location_id', 'website'],
        common_relationships: ['LOCATED_IN', 'FOUNDED_BY', 'LED_BY', 'MEMBER_OF', 'SUBSIDIARY_OF', 'PARTNERS_WITH', 'COMPETES_WITH', 'SUPPLIES_TO', 'CUSTOMER_OF']
      },
      {
        name: 'Event',
        description: 'Significant business occurrences, meetings, product launches, or market changes',
        aliases: ['Meeting', 'Conference', 'Product_Launch', 'Market_Shift', 'Acquisition', 'Investment_Round'],
        valid_properties: ['date', 'duration', 'description', 'outcome', 'participants', 'budget'],
        common_relationships: ['OCCURRED_AT', 'PARTICIPATED_IN', 'TRIGGERED_BY', 'LED_TO_OUTCOME']
      },
      {
        name: 'Product',
        description: 'Goods or services offered by a company or resulting from a project.',
        aliases: ['Service', 'Offering', 'SKU', 'Software', 'Hardware', 'Deliverable', 'Feature'],
        valid_properties: ['version', 'release_date', 'price', 'category', 'description', 'status'],
        common_relationships: ['DEVELOPED_BY_TEAM', 'SOLD_BY_ORG', 'COMPONENT_OF_PRODUCT', 'USED_BY_CUSTOMER', 'REQUIRES_LICENSE']
      },
      {
        name: 'Concept',
        description: 'Business strategies, models, processes, methodologies, KPIs, or market trends',
        aliases: ['Strategy', 'Business_Model', 'Process', 'Methodology', 'KPI', 'Market_Trend', 'Policy'],
        valid_properties: ['description', 'origin', 'principles', 'applications', 'status', 'owner'],
        common_relationships: ['APPLIES_TO_ORG', 'DERIVED_FROM_CONCEPT', 'MEASURES_PERFORMANCE_OF']
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
      
      // Common domain relationships (Business Focused)
      {
        name: 'REPORTS_TO',
        description: 'Hierarchical reporting structure within an organization.',
        directionality: 'source_to_target', // Employee REPORTS_TO Manager
        valid_source_types: ['Character'], // Employee
        valid_target_types: ['Character'], // Manager
        aliases: ['MANAGED_BY']
      },
      {
        name: 'INFLUENCED_BY',
        description: 'Influence relationship between entities (e.g., market trend influences strategy).',
        directionality: 'source_to_target',
        valid_source_types: ['Organization', 'Event', 'Concept', 'Product'],
        valid_target_types: ['Organization', 'Event', 'Concept', 'Character', 'Product'],
        aliases: ['AFFECTED_BY', 'DRIVEN_BY']
      },
      {
        name: 'EMPLOYED_BY',
        description: 'Employment relationship.',
        directionality: 'source_to_target', // Character EMPLOYED_BY Organization
        valid_source_types: ['Character'],
        valid_target_types: ['Organization'],
        aliases: ['WORKS_FOR', 'CONTRACTED_TO']
      },
      {
        name: 'LOCATED_IN',
        description: 'Physical or logical location of an entity.',
        directionality: 'source_to_target',
        valid_source_types: ['Character', 'Organization', 'Event', 'Product', 'Location'],
        valid_target_types: ['Location'],
        aliases: ['SITUATED_IN', 'BASED_IN', 'HOSTED_ON']
      },
      {
        name: 'PARTNERS_WITH',
        description: 'A formal or informal partnership between organizations or individuals.',
        directionality: 'bidirectional',
        valid_source_types: ['Organization', 'Character'],
        valid_target_types: ['Organization', 'Character'],
        aliases: ['COLLABORATES_WITH', 'ALLIED_WITH']
      },
      {
        name: 'ATTENDED_EVENT',
        description: 'Indicates an entity (Character, Organization) attended an Event.',
        directionality: 'source_to_target',
        valid_source_types: ['Character', 'Organization'],
        valid_target_types: ['Event'],
        aliases: ['PARTICIPATED_IN_EVENT']
      },
      {
        name: 'MEMBER_OF',
        description: 'Membership in an organization, team, or group.',
        directionality: 'source_to_target', // Character MEMBER_OF Organization
        valid_source_types: ['Character'],
        valid_target_types: ['Organization'], // Could also be 'Concept' for communities of practice
        aliases: ['BELONGS_TO_TEAM', 'PART_OF_DEPARTMENT']
      },
      {
        name: 'OWNS_PRODUCT', // Changed from OWNS
        description: 'Ownership or primary responsibility for a product or service.',
        directionality: 'source_to_target', // Organization OWNS_PRODUCT Product
        valid_source_types: ['Organization', 'Character'], // e.g. Product Manager
        valid_target_types: ['Product'],
        aliases: ['MANAGES_PRODUCT', 'RESPONSIBLE_FOR_PRODUCT']
      },
      {
        name: 'DEVELOPED_BY_TEAM', // Changed from CREATED_BY
        description: 'Indicates which team or organization developed a product.',
        directionality: 'source_to_target', // Product DEVELOPED_BY_TEAM Organization
        valid_source_types: ['Product'],
        valid_target_types: ['Organization', 'Character'], // Could be an individual developer
        aliases: ['CREATED_BY_ORG', 'ENGINEERED_BY']
      },
      // Business-specific relationships
      {
        name: 'COLLEAGUE_OF',
        description: 'Relationship between colleagues or peers.',
        directionality: 'bidirectional',
        valid_source_types: ['Character'],
        valid_target_types: ['Character'],
        aliases: ['PEER_OF']
      },
      {
        name: 'MANAGES_RISK_FOR',
        description: 'Indicates an entity is responsible for managing risks for another.',
        directionality: 'source_to_target',
        valid_source_types: ['Character', 'Organization', 'Concept'], // e.g. A 'Risk Management Process' Concept
        valid_target_types: ['Product', 'Organization', 'Event', 'Location'],
        aliases: ['OVERSEES_RISK_OF']
      },
      {
        name: 'MENTORS',
        description: 'Mentorship relationship.',
        directionality: 'source_to_target', // Mentor MENTORS Mentee
        valid_source_types: ['Character'],
        valid_target_types: ['Character'],
        aliases: ['ADVISES']
      },
      {
        name: 'HEADQUARTERED_IN',
        description: 'Specifies the primary location of an organization.',
        directionality: 'source_to_target', // Organization HEADQUARTERED_IN Location
        valid_source_types: ['Organization'],
        valid_target_types: ['Location'],
        aliases: ['MAIN_OFFICE_IN']
      },
      {
        name: 'USES_PRODUCT',
        description: 'Indicates a character or organization uses a specific product.',
        directionality: 'source_to_target',
        valid_source_types: ['Character', 'Organization'],
        valid_target_types: ['Product'],
        aliases: ['CONSUMES_SERVICE', 'LICENSES_SOFTWARE']
      },
      {
        name: 'MANAGES_TEAM',
        description: 'Leadership relationship where a character manages a team/department (Organization).',
        directionality: 'source_to_target', // Character MANAGES_TEAM Organization
        valid_source_types: ['Character'],
        valid_target_types: ['Organization'], // Representing a team or department
        aliases: ['LEADS_DEPARTMENT', 'SUPERVISES_GROUP']
      },
      {
        name: 'INVESTED_IN',
        description: 'Indicates an investment relationship.',
        directionality: 'source_to_target', // Investor INVESTED_IN Investee
        valid_source_types: ['Organization', 'Character'],
        valid_target_types: ['Organization', 'Event'], // e.g. Investment Round
        aliases: ['FUNDED', 'BACKED_BY']
      },
      {
        name: 'COMPETES_WITH',
        description: 'Indicates a competitive relationship between organizations.',
        directionality: 'bidirectional',
        valid_source_types: ['Organization'],
        valid_target_types: ['Organization'],
        aliases: ['RIVAL_OF']
      },
      {
        name: 'SUPPLIES_TO',
        description: 'Indicates a supplier-customer relationship.',
        directionality: 'source_to_target', // Supplier SUPPLIES_TO Customer
        valid_source_types: ['Organization'],
        valid_target_types: ['Organization'],
        aliases: ['VENDOR_FOR']
      },
      {
        name: 'CUSTOMER_OF',
        description: 'Indicates a customer relationship.',
        directionality: 'source_to_target', // Customer CUSTOMER_OF Supplier
        valid_source_types: ['Character', 'Organization'],
        valid_target_types: ['Organization'],
        aliases: ['BUYS_FROM', 'CLIENT_OF']
      },
      {
        name: 'COMPONENT_OF_PRODUCT',
        description: 'Indicates a product is a component of another product.',
        directionality: 'source_to_target', // Component COMPONENT_OF_PRODUCT MainProduct
        valid_source_types: ['Product'],
        valid_target_types: ['Product'],
        aliases: ['PART_OF_PRODUCT', 'SUBASSEMBLY_OF']
      },
      {
        name: 'REQUIRES_LICENSE',
        description: 'Indicates a product requires a license, or a character/org holds one.',
        directionality: 'source_to_target', // Product REQUIRES_LICENSE Concept (LicenseType) or Character/Org REQUIRES_LICENSE Product
        valid_source_types: ['Product', 'Character', 'Organization'],
        valid_target_types: ['Concept', 'Product'], // Concept could be 'LicenseType'
        aliases: ['NEEDS_LICENSE_FOR']
      },
      {
        name: 'APPLIES_TO_ORG',
        description: 'Indicates a concept (like a policy or strategy) applies to an organization.',
        directionality: 'source_to_target', // Concept APPLIES_TO_ORG Organization
        valid_source_types: ['Concept'],
        valid_target_types: ['Organization'],
        aliases: ['RELEVANT_FOR_ORG']
      },
      {
        name: 'DERIVED_FROM_CONCEPT',
        description: 'Indicates a concept is derived from or based on another concept.',
        directionality: 'source_to_target', // SpecificConcept DERIVED_FROM_CONCEPT GeneralConcept
        valid_source_types: ['Concept'],
        valid_target_types: ['Concept'],
        aliases: ['BASED_ON_CONCEPT']
      },
      {
        name: 'MEASURES_PERFORMANCE_OF',
        description: 'Indicates a KPI (Concept) measures the performance of an Organization, Product, or Character.',
        directionality: 'source_to_target', // KPI MEASURES_PERFORMANCE_OF Entity
        valid_source_types: ['Concept'], // Specifically KPIs
        valid_target_types: ['Organization', 'Product', 'Character', 'Event'],
        aliases: ['TRACKS_PERFORMANCE_OF']
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