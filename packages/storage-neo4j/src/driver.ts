import neo4j, { Driver, Session } from 'neo4j-driver';
import type { Neo4jConfig } from '@autopology/core';

export interface Neo4jContext {
  driver: Driver;
  config: Neo4jConfig;
}

export function createNeo4jContext(config: Neo4jConfig): Neo4jContext {
  const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
    disableLosslessIntegers: true,
  });
  return { driver, config };
}

export async function verifyConnection(ctx: Neo4jContext): Promise<void> {
  await ctx.driver.verifyConnectivity();
}

export function openSession(ctx: Neo4jContext): Session {
  return ctx.driver.session({ database: ctx.config.database });
}

export async function closeNeo4j(ctx: Neo4jContext): Promise<void> {
  await ctx.driver.close();
}
