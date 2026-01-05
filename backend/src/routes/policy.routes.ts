import { Router } from 'express';
import * as policyController from '../controllers/policy.controller';

const router = Router();

/**
 * GET /api/policies
 * 보험증권 목록 조회
 */
router.get('/', policyController.getPolicyList);

/**
 * GET /api/policies/:policyId
 * 특정 보험증권 조회
 */
router.get('/:policyId', policyController.getPolicyById);

/**
 * GET /api/policies/:policyId/coverages
 * 보험증권의 담보 목록 조회
 */
router.get('/:policyId/coverages', policyController.getPolicyCoverages);

/**
 * GET /api/policies/terms/all
 * 전체 약관 조회
 */
router.get('/terms/all', policyController.getAllPolicyTerms);

/**
 * GET /api/policies/terms/:productCode
 * 상품별 약관 조회
 */
router.get('/terms/:productCode', policyController.getPolicyTerms);

export default router;
