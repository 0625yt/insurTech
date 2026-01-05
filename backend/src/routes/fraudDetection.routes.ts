import { Router } from 'express';
import { FraudDetectionController } from '../controllers/fraudDetection.controller';
import { authMiddleware, requirePermission, requireRoleLevel } from '../middlewares/auth.middleware';

const router = Router();

// 모든 사기 탐지 관련 라우트는 인증 필요
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════
// 사기 분석
// ═══════════════════════════════════════════════════════════════

// 청구 사기 분석
router.post('/analyze/:claimId', requirePermission('claim:read'), FraudDetectionController.analyzeClaim);

// 고객 패턴 분석
router.get('/customer-pattern/:customerId', requireRoleLevel(2), FraudDetectionController.getCustomerPattern);

// 병원 네트워크 분석
router.get('/hospital-network/:hospitalId', requireRoleLevel(2), FraudDetectionController.getHospitalNetwork);

// ═══════════════════════════════════════════════════════════════
// 고위험 청구 조회
// ═══════════════════════════════════════════════════════════════

// 고위험 청구 목록
router.get('/high-risk-claims', requirePermission('claim:read'), FraudDetectionController.getHighRiskClaims);

// ═══════════════════════════════════════════════════════════════
// 사기 지표 관리
// ═══════════════════════════════════════════════════════════════

// 사기 지표 업데이트
router.put('/indicators/:claimId', requirePermission('claim:update'), FraudDetectionController.updateFraudIndicators);

// SIU 조사 의뢰
router.post('/siu-referral/:claimId', requireRoleLevel(2), FraudDetectionController.referToSIU);

// ═══════════════════════════════════════════════════════════════
// 통계 및 트렌드
// ═══════════════════════════════════════════════════════════════

// 사기 탐지 통계
router.get('/stats', requireRoleLevel(2), FraudDetectionController.getFraudStats);

// 사기 패턴 트렌드
router.get('/trends', requireRoleLevel(2), FraudDetectionController.getFraudTrends);

export default router;
