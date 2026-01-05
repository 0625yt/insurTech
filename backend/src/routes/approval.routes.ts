import { Router } from 'express';
import { ApprovalController } from '../controllers/approval.controller';
import { authMiddleware, requirePermission, requireRoleLevel } from '../middlewares/auth.middleware';

const router = Router();

// 모든 결재 라우트는 인증 필요
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════
// 결재 워크플로우
// ═══════════════════════════════════════════════════════════════

// 결재 프로세스 시작 (담당자)
router.post('/start', requirePermission('claim:submit_approval'), ApprovalController.startApproval);

// 결재 처리 (승인/반려/보류)
router.post('/:approvalId/process', requirePermission('claim:approve'), ApprovalController.processApproval);

// ═══════════════════════════════════════════════════════════════
// 결재함 조회
// ═══════════════════════════════════════════════════════════════

// 내 결재함 (대기 건)
router.get('/inbox', ApprovalController.getMyInbox);

// 대기 중인 결재 건수
router.get('/pending-count', ApprovalController.getPendingCount);

// ═══════════════════════════════════════════════════════════════
// 결재 상태/이력 조회
// ═══════════════════════════════════════════════════════════════

// 특정 청구의 결재 상태
router.get('/claim/:claimId', ApprovalController.getClaimApprovalStatus);

// 결재 이력
router.get('/:approvalId/history', ApprovalController.getApprovalHistory);

// ═══════════════════════════════════════════════════════════════
// 관리 기능
// ═══════════════════════════════════════════════════════════════

// 결재 라인 템플릿 목록
router.get('/templates', requireRoleLevel(2), ApprovalController.getApprovalTemplates);

// 결재 통계
router.get('/stats', ApprovalController.getApprovalStats);

export default router;
