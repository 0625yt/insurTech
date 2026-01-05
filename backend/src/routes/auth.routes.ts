import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware, requirePermission, requireRoleLevel } from '../middlewares/auth.middleware';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// 인증 라우트 (Public)
// ═══════════════════════════════════════════════════════════════

// 로그인
router.post('/login', AuthController.login);

// ═══════════════════════════════════════════════════════════════
// 인증 라우트 (Protected)
// ═══════════════════════════════════════════════════════════════

// 로그아웃
router.post('/logout', authMiddleware, AuthController.logout);

// 현재 사용자 정보
router.get('/me', authMiddleware, AuthController.getCurrentUser);

// 비밀번호 변경
router.put('/password', authMiddleware, AuthController.changePassword);

// 토큰 갱신
router.post('/refresh', authMiddleware, AuthController.refreshToken);

// ═══════════════════════════════════════════════════════════════
// 관리자 라우트
// ═══════════════════════════════════════════════════════════════

// 사용자 목록 조회 (팀장 이상)
router.get('/users', authMiddleware, requireRoleLevel(2), AuthController.getUsers);

// 결재자 목록 조회 (팀장 이상)
router.get('/approvers', authMiddleware, requireRoleLevel(2), AuthController.getApprovers);

export default router;
