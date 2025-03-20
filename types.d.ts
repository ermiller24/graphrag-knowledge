declare module 'kuzu' {
  export class Database {
    constructor(path: string);
  }

  export class Connection {
    constructor(db: Database);
    query(query: string, params?: any[]): Promise<QueryResult>;
  }

  export interface QueryResult {
    getAll(): Promise<any[]>;
  }
}