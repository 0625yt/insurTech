import { Router } from 'express';
import * as statsController from '../controllers/stats.controller';

const router = Router();

/**
 * GET /api/stats/models
 * AI 모델별 정확도 통계
 */
router.get('/models', statsController.getModelStats);

/**
 * GET /api/stats/claims
 * 청구 처리 통계
 */
router.get('/claims', statsController.getClaimStats);

/**
 * GET /api/stats/dashboard
 * 대시보드 전체 통계
 */
router.get('/dashboard', statsController.getDashboardStats);

export default router;
