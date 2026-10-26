export type PostgresSsl = false | { rejectUnauthorized: boolean; ca?: string };
export interface PostgresConnectionConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl: PostgresSsl;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
  application_name: string;
  options: string;
}
export function sslConfig(env?: NodeJS.ProcessEnv): PostgresSsl;
export function postgresConfig(env?: NodeJS.ProcessEnv): PostgresConnectionConfig;
