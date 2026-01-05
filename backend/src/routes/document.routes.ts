import { Router } from 'express';
import { DocumentController } from '../controllers/document.controller';
import { authMiddleware, requirePermission, requireRoleLevel } from '../middlewares/auth.middleware';

const router = Router();

// 모든 서류 관련 라우트는 인증 필요
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════
// 서류 체크리스트
// ═══════════════════════════════════════════════════════════════

// 체크리스트 생성
router.post('/checklist', requirePermission('claim:read'), DocumentController.createChecklist);

// 체크리스트 조회
router.get('/checklist/:claimId', requirePermission('claim:read'), DocumentController.getChecklist);

// 서류 완료 상태 확인
router.get('/complete-status/:claimId', requirePermission('claim:read'), DocumentController.checkDocumentComplete);

// ═══════════════════════════════════════════════════════════════
// 서류 제출/검증
// ═══════════════════════════════════════════════════════════════

// 서류 제출
router.post('/submit', requirePermission('claim:update'), DocumentController.submitDocument);

// 서류 검증
router.put('/verify/:verificationId', requirePermission('claim:update'), DocumentController.verifyDocument);

// 추가 서류 요청
router.post('/request-additional', requirePermission('claim:update'), DocumentController.requestAdditionalDocument);

// 서류 면제
router.put('/waive/:checklistId', requireRoleLevel(2), DocumentController.waiveDocument);

// ═══════════════════════════════════════════════════════════════
// 조회
// ═══════════════════════════════════════════════════════════════

// 필수 서류 요구사항 목록
router.get('/requirements', DocumentController.getDocumentRequirements);

// 서류 검증 이력
router.get('/verification-history/:claimId', requirePermission('claim:read'), DocumentController.getVerificationHistory);

export default router;
