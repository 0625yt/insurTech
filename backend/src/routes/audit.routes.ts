import { Router } from 'express';
import { AuditController } from '../controllers/audit.controller';
import { authMiddleware, requireRoleLevel } from '../middlewares/auth.middleware';

const router = Router();

// 모든 감사 로그 관련 라우트는 인증 필요 + 팀장 이상만 접근
router.use(authMiddleware);
router.use(requireRoleLevel(2)); // 팀장 이상만 감사 로그 열람 가능

// ═══════════════════════════════════════════════════════════════
// 감사 로그 조회
// ═══════════════════════════════════════════════════════════════

// 감사 로그 목록
router.get('/logs', AuditController.getAuditLogs);

// 특정 엔티티 감사 이력
router.get('/entity/:entityType/:entityId', AuditController.getEntityAuditHistory);

// 청구별 변경 이력
router.get('/claim-history/:claimId', AuditController.getClaimHistory);

// ═══════════════════════════════════════════════════════════════
// 민감 데이터 접근 로그
// ═══════════════════════════════════════════════════════════════

// 민감 데이터 접근 로그 (부장 이상)
router.get('/sensitive-access', requireRoleLevel(3), AuditController.getSensitiveAccessLogs);

// ═══════════════════════════════════════════════════════════════
// 사용자 활동
// ═══════════════════════════════════════════════════════════════

// 사용자별 활동 요약
router.get('/user-activity/:userId', AuditController.getUserActivitySummary);

// 로그인 이력
router.get('/login-history', AuditController.getLoginHistory);

// ═══════════════════════════════════════════════════════════════
// 통계 및 분석
// ═══════════════════════════════════════════════════════════════

// 감사 통계
router.get('/stats', AuditController.getAuditStats);

// 이상 행동 탐지
router.get('/anomalies', requireRoleLevel(3), AuditController.getAnomalies);

// ═══════════════════════════════════════════════════════════════
// 내보내기 (금감원 보고용)
// ═══════════════════════════════════════════════════════════════

// 감사 로그 내보내기 (부장 이상)
router.get('/export', requireRoleLevel(3), AuditController.exportAuditLogs);

export default router;
