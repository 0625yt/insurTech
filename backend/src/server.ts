import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { db } from './database/connection';
import { redis } from './database/redis';
import routes from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { notFoundHandler } from './middlewares/notFoundHandler';

// 환경변수 로드
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
// 미들웨어 설정
// ═══════════════════════════════════════════════════════════════

// 보안 헤더
app.use(helmet());

// CORS 설정
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Body Parser
app.use(express.json({ limit: '50mb' }));  // Base64 이미지를 위한 큰 limit
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 압축
app.use(compression());

// 로깅
app.use(morgan('combined', {
  stream: { write: (message: string) => logger.info(message.trim()) }
}));

// ═══════════════════════════════════════════════════════════════
// 헬스체크
// ═══════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
  try {
    // PostgreSQL 연결 확인
    await db.query('SELECT 1');

    // Redis 연결 확인
    await redis.ping();

    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// API 라우트
// ═══════════════════════════════════════════════════════════════

app.use('/api', routes);

// ═══════════════════════════════════════════════════════════════
// 에러 핸들링
// ═══════════════════════════════════════════════════════════════

app.use(notFoundHandler);
app.use(errorHandler);

// ═══════════════════════════════════════════════════════════════
// 서버 시작
// ═══════════════════════════════════════════════════════════════

const startServer = async () => {
  try {
    // 데이터베이스 연결 확인
    await db.query('SELECT NOW()');
    logger.info('PostgreSQL connected successfully');

    // Redis 연결 확인
    // Redis 연결 확인 (선택적)
    try {
      await redis.ping();
      logger.info('Redis connected successfully');
    } catch (redisError) {
      logger.warn('Redis connection failed - continuing without Redis cache');
    }

    app.listen(PORT, () => {
      logger.info(`🚀 InsurTech API Server running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  await db.end();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');
  await db.end();
  await redis.quit();
  process.exit(0);
});

startServer();

export default app;
