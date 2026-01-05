import { Pool, PoolClient, QueryResult } from 'pg';
import { logger } from '../utils/logger';
import { databaseConfig } from '../config/database.config';

// PostgreSQL 연결 풀 설정
const pool = new Pool(databaseConfig);

// 연결 풀 이벤트 핸들러
pool.on('connect', (client) => {
  // 클라이언트 인코딩을 UTF8로 명시적 설정 (한글 깨짐 방지)
  client.query('SET client_encoding = \'UTF8\'');
  logger.debug('New PostgreSQL client connected to the pool');
});

pool.on('error', (err: Error) => {
  logger.error('Unexpected PostgreSQL pool error:', err);
});

// 데이터베이스 인터페이스
export const db = {
  /**
   * 쿼리 실행
   */
  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await pool.query<T>(text, params);
      const duration = Date.now() - start;
      logger.debug(`Executed query`, { text, duration, rows: result.rowCount });
      return result;
    } catch (error) {
      logger.error('Database query error:', { text, error });
      throw error;
    }
  },

  /**
   * 트랜잭션 실행
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * 클라이언트 가져오기 (수동 관리용)
   */
  async getClient(): Promise<PoolClient> {
    return await pool.connect();
  },

  /**
   * 연결 종료
   */
  async end(): Promise<void> {
    await pool.end();
    logger.info('PostgreSQL pool closed');
  }
};
