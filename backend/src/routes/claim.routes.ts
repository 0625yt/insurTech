import { Router } from 'express';
import * as claimController from '../controllers/claim.controller';

const router = Router();

// =====================================================
// 정적 경로 (반드시 :id 파라미터 라우트보다 먼저 정의)
// =====================================================

/**
 * GET /api/claims/stats
 * 대시보드 통계
 */
router.get('/stats', claimController.getDashboardStats);

/**
 * GET /api/claims/customers/:id
 * 고객 정보 조회
 */
router.get('/customers/:id', claimController.getCustomer);

/**
 * GET /api/claims/policies/:id
 * 증권 정보 조회
 */
router.get('/policies/:id', claimController.getPolicy);

/**
 * GET /api/claims/search/diagnosis
 * 진단코드 검색
 */
router.get('/search/diagnosis', claimController.searchDiagnosis);

/**
 * GET /api/claims/search/surgery
 * 수술코드 검색
 */
router.get('/search/surgery', claimController.searchSurgery);

/**
 * GET /api/claims/verification-queue/list
 * Legacy: 검증 큐 조회
 */
router.get('/verification-queue/list', claimController.getVerificationQueue);

// =====================================================
// 청구 기본 API
// =====================================================

/**
 * POST /api/claims
 * 새로운 청구 제출 및 자동 심사
 */
router.post('/', claimController.submitClaim);

/**
 * GET /api/claims
 * 청구 목록 조회 (페이지네이션, 필터링)
 */
router.get('/', claimController.getClaimList);

// =====================================================
// 청구 상세/액션 API (:id 파라미터 라우트)
// =====================================================

/**
 * GET /api/claims/:id
 * 청구 상세 조회
 */
router.get('/:id', claimController.getClaimById);

/**
 * POST /api/claims/:id/approve
 * 청구 승인
 */
router.post('/:id/approve', claimController.approveClaim);

/**
 * POST /api/claims/:id/reject
 * 청구 거절
 */
router.post('/:id/reject', claimController.rejectClaim);

/**
 * POST /api/claims/:id/verify
 * Legacy: 청구 검증
 */
router.post('/:id/verify', claimController.verifyClaim);

/**
 * GET /api/claims/:id/status
 * Legacy: 청구 상태 조회
 */
router.get('/:id/status', claimController.getClaimStatus);

/**
 * GET /api/claims/:id/ai-results
 * 청구의 AI 모델별 결과 조회
 */
router.get('/:id/ai-results', claimController.getAIModelResults);

/**
 * POST /api/claims/:id/ai-results/:resultId/select
 * AI 모델 결과 선택
 */
router.post('/:id/ai-results/:resultId/select', claimController.selectAIModelResult);

/**
 * POST /api/claims/ai-results/:resultId/evaluate
 * AI 모델 평가 제출
 */
router.post('/ai-results/:resultId/evaluate', claimController.submitModelEvaluation);

export default router;
