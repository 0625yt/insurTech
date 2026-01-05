import { Router } from 'express';
import claimRoutes from './claim.routes';
import policyRoutes from './policy.routes';
import statsRoutes from './stats.routes';
import authRoutes from './auth.routes';
import approvalRoutes from './approval.routes';
import documentRoutes from './document.routes';
import duplicateInsuranceRoutes from './duplicateInsurance.routes';
import fraudDetectionRoutes from './fraudDetection.routes';
import auditRoutes from './audit.routes';

const router = Router();

// API 버전 정보
router.get('/', (req, res) => {
  res.json({
    name: 'InsurTech API',
    version: '4.0.0',
    description: '보험금 청구 자동 심사 시스템 (Enterprise Edition)',
    features: [
      '인증/권한 관리',
      '결재 워크플로우',
      '서류 검증/체크리스트',
      '중복보험 처리',
      '고도화 사기 탐지',
      '감사 로그',
    ],
    endpoints: {
      claims: '/api/claims',
      policies: '/api/policies',
      stats: '/api/stats',
      auth: '/api/auth',
      approvals: '/api/approvals',
      documents: '/api/documents',
      duplicateInsurance: '/api/duplicate-insurance',
      fraud: '/api/fraud',
      audit: '/api/audit',
    },
  });
});

// ═══════════════════════════════════════════════════════════════
// 기존 라우트
// ═══════════════════════════════════════════════════════════════
router.use('/claims', claimRoutes);
router.use('/policies', policyRoutes);
router.use('/stats', statsRoutes);

// ═══════════════════════════════════════════════════════════════
// Enterprise 기능 라우트
// ═══════════════════════════════════════════════════════════════
router.use('/auth', authRoutes);
router.use('/approvals', approvalRoutes);
router.use('/documents', documentRoutes);
router.use('/duplicate-insurance', duplicateInsuranceRoutes);
router.use('/fraud', fraudDetectionRoutes);
router.use('/audit', auditRoutes);

export default router;
