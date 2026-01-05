import { Router } from 'express';
import { DuplicateInsuranceController } from '../controllers/duplicateInsurance.controller';
import { authMiddleware, requirePermission, requireRoleLevel } from '../middlewares/auth.middleware';

const router = Router();

// 모든 중복보험 관련 라우트는 인증 필요
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════
// 중복보험 정보 관리
// ═══════════════════════════════════════════════════════════════

// 중복보험 정보 추가
router.post('/', requirePermission('claim:update'), DuplicateInsuranceController.addOtherInsurance);

// 청구의 중복보험 정보 조회
router.get('/claim/:claimId', requirePermission('claim:read'), DuplicateInsuranceController.getClaimInsurances);

// 중복보험 정보 수정
router.put('/:insuranceId', requirePermission('claim:update'), DuplicateInsuranceController.updateOtherInsurance);

// 중복보험 정보 삭제
router.delete('/:insuranceId', requireRoleLevel(2), DuplicateInsuranceController.deleteOtherInsurance);

// ═══════════════════════════════════════════════════════════════
// 실손보험 조회
// ═══════════════════════════════════════════════════════════════

// 실손보험 조회 요청
router.post('/inquiry', requirePermission('claim:update'), DuplicateInsuranceController.requestRealLossInquiry);

// 실손보험 조회 결과 조회
router.get('/inquiry-results/:claimId', requirePermission('claim:read'), DuplicateInsuranceController.getInquiryResults);

// ═══════════════════════════════════════════════════════════════
// 비례분담 계산
// ═══════════════════════════════════════════════════════════════

// 비례분담 계산
router.post('/calculate', requirePermission('claim:update'), DuplicateInsuranceController.calculateProRataShare);

// 비례분담 계산 결과 조회
router.get('/calculation/:claimId', requirePermission('claim:read'), DuplicateInsuranceController.getCalculation);

// ═══════════════════════════════════════════════════════════════
// 요약 조회
// ═══════════════════════════════════════════════════════════════

// 중복보험 요약 정보
router.get('/summary/:claimId', requirePermission('claim:read'), DuplicateInsuranceController.getDuplicateSummary);

export default router;
