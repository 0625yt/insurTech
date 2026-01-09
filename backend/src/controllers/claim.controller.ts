/**
 * 보험금 청구 컨트롤러
 * 실제 보험 심사 로직 연동
 */

import { Request, Response, NextFunction } from 'express';
import { db } from '../database/connection';
import { logger } from '../utils/logger';
import { claimService } from '../services/claim.service';

/**
 * 새로운 청구 제출 및 자동 심사
 */
export const submitClaim = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claimData = req.body;

    logger.info('Claim submission received:', { policy: claimData.policy_number || claimData.policy_id });

    // 서비스 호출
    const result = await claimService.processClaimReview({
      policy_number: claimData.policy_number || claimData.policy_id,
      customer_name: claimData.customer_name,
      claim_type: claimData.claim_type || 'HOSPITALIZATION',
      treatment_start_date: claimData.treatment_start_date || new Date().toISOString().split('T')[0],
      treatment_end_date: claimData.treatment_end_date || new Date().toISOString().split('T')[0],
      hospital_name: claimData.hospital_name || '서울대학교병원',
      diagnosis_code: claimData.diagnosis_code || 'K35.0',
      diagnosis_name: claimData.diagnosis_name || '급성충수염',
      surgery_code: claimData.surgery_code,
      surgery_name: claimData.surgery_name,
      hospitalization_days: claimData.hospitalization_days || 4,
      total_medical_expense: claimData.total_medical_expense || claimData.claim_amount || 1520000,
      insured_expense: claimData.insured_expense || Math.round((claimData.claim_amount || 1520000) * 0.8),
      uninsured_expense: claimData.uninsured_expense || Math.round((claimData.claim_amount || 1520000) * 0.2)
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error('Claim submission error:', error);
    next(error);
  }
};

/**
 * 청구 목록 조회 (대시보드용)
 */
export const getClaimList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const sortBy = (req.query.sortBy as string) || 'created_at';
    const sortDir = (req.query.sortDir as string) || 'desc';

    const sortMap: Record<string, string> = {
      created_at: 'c.created_at',
      claim_date: 'c.claim_date',
      total_claimed_amount: 'c.total_claimed_amount',
      status: 'c.status',
      ai_confidence_score: 'c.ai_confidence_score',
      fraud_score: 'c.fraud_score'
    };
    const sortColumn = sortMap[sortBy] || sortMap.created_at;
    const sortDirection = sortDir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let query = `
      SELECT
        c.id, c.claim_number, c.claim_date, c.claim_type,
        c.diagnosis_code, c.diagnosis_name, c.surgery_name,
        c.hospitalization_days,
        c.total_claimed_amount, c.total_approved_amount, c.total_rejected_amount,
        c.status, c.ai_confidence_score, c.fraud_score,
        c.ai_recommendation, c.auto_processable,
        c.created_at, c.updated_at,
        cu.name as customer_name, cu.customer_code, cu.risk_grade,
        p.policy_number, p.product_name
      FROM claims c
      JOIN customers cu ON c.customer_id = cu.id
      JOIN policies p ON c.policy_id = p.id
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.claim_number ILIKE $${params.length} OR cu.name ILIKE $${params.length} OR p.policy_number ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY ${sortColumn} ${sortDirection} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    // 데이터 및 총 개수 조회
    let countQuery = `SELECT COUNT(*) FROM claims c JOIN customers cu ON c.customer_id = cu.id`;
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }

    const [dataResult, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, params.slice(0, -2))
    ]);

    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 청구 상세 조회 - 담보 정보, 검증 결과, 산출 근거 포함
 */
export const getClaimById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // id가 숫자인지 확인하여 적절한 쿼리 선택
    const isNumeric = /^\d+$/.test(id);

    const result = await db.query(`
      SELECT
        c.*,
        cu.name as customer_name, cu.customer_code, cu.birth_date, cu.phone, cu.risk_grade, cu.risk_score,
        p.policy_number, p.product_name, p.status as policy_status,
        p.coverage_start_date, p.coverage_end_date, p.premium_status,
        p.exemption_end_date, p.reduction_end_date, p.reduction_rate
      FROM claims c
      JOIN customers cu ON c.customer_id = cu.id
      JOIN policies p ON c.policy_id = p.id
      WHERE ${isNumeric ? 'c.id = $1' : 'c.claim_number = $1'}
    `, [isNumeric ? parseInt(id) : id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const claim = result.rows[0];

    // 청구 항목 조회
    const itemsResult = await db.query(`
      SELECT * FROM claim_items WHERE claim_id = $1 ORDER BY sequence_no
    `, [claim.id]);

    // 심사 이력 조회
    const reviewsResult = await db.query(`
      SELECT * FROM claim_reviews WHERE claim_id = $1 ORDER BY created_at DESC
    `, [claim.id]);

    // ========== 담보(보장) 정보 조회 ==========
    const coveragesResult = await db.query(`
      SELECT
        pc.id,
        pc.coverage_code,
        pc.coverage_name,
        pc.insured_amount,
        pc.deductible_amount,
        pc.deductible_rate,
        pc.payout_rate,
        pc.max_days,
        pc.surgery_classification,
        pc.annual_limit,
        pc.used_annual_amount,
        pc.per_occurrence_limit,
        ct.code as type_code,
        ct.name as type_name,
        ct.category as coverage_category,
        ct.calculation_type,
        ct.description as coverage_description
      FROM policy_coverages pc
      JOIN coverage_types ct ON pc.coverage_type_id = ct.id
      WHERE pc.policy_id = $1 AND pc.is_active = TRUE
      ORDER BY pc.id
    `, [claim.policy_id]);

    // ========== 검증 결과 생성 ==========
    const treatmentDate = new Date(claim.treatment_start_date);
    const exemptionEnd = new Date(claim.exemption_end_date);
    const reductionEnd = new Date(claim.reduction_end_date);
    const coverageStart = new Date(claim.coverage_start_date);
    const coverageEnd = new Date(claim.coverage_end_date);

    const isInExemptionPeriod = treatmentDate <= exemptionEnd;
    const isInReductionPeriod = treatmentDate <= reductionEnd && !isInExemptionPeriod;
    const reductionRate = isInReductionPeriod ? Number(claim.reduction_rate) || 50 : 0;

    const validationResult = {
      policy_valid: claim.policy_status === 'ACTIVE',
      premium_paid: claim.premium_status === 'PAID',
      within_coverage_period: treatmentDate >= coverageStart && treatmentDate <= coverageEnd,
      exemption_period: {
        is_in_period: isInExemptionPeriod,
        end_date: claim.exemption_end_date,
        message: isInExemptionPeriod ? '면책기간 내 발생으로 보장 불가' : '면책기간 경과'
      },
      reduction_period: {
        is_in_period: isInReductionPeriod,
        end_date: claim.reduction_end_date,
        rate: reductionRate,
        message: isInReductionPeriod ? `감액기간 내 (${reductionRate}% 감액 적용)` : '감액기간 경과'
      }
    };

    // ========== AI 분석 결과에서 산출 근거 추출 ==========
    let payoutBreakdown = [];
    let coverageAnalysis = null;

    if (claim.ai_analysis_result) {
      try {
        const aiResult = typeof claim.ai_analysis_result === 'string'
          ? JSON.parse(claim.ai_analysis_result)
          : claim.ai_analysis_result;

        if (aiResult.coverage_analysis) {
          coverageAnalysis = aiResult.coverage_analysis;
          payoutBreakdown = aiResult.coverage_analysis.breakdown || [];
        }
      } catch (e) {
        logger.warn('AI analysis parse error:', e);
      }
    }

    // ========== 담보별 적용 여부 및 산출 내역 매칭 ==========
    const coveragesWithStatus = coveragesResult.rows.map((cov: any) => {
      // 해당 담보가 적용되었는지 확인
      const appliedItem = payoutBreakdown.find((item: any) =>
        item.item.includes(cov.coverage_name) ||
        item.item.includes(cov.coverage_code) ||
        (cov.surgery_classification && item.item.includes(`${cov.surgery_classification}종`))
      );

      return {
        ...cov,
        insured_amount: Number(cov.insured_amount) || 0,
        deductible_amount: Number(cov.deductible_amount) || 0,
        deductible_rate: Number(cov.deductible_rate) || 0,
        payout_rate: Number(cov.payout_rate) || 100,
        annual_limit: cov.annual_limit ? Number(cov.annual_limit) : null,
        used_annual_amount: Number(cov.used_annual_amount) || 0,
        is_applied: !!appliedItem,
        applied_detail: appliedItem || null
      };
    });

    res.json({
      success: true,
      data: {
        ...claim,
        items: itemsResult.rows,
        reviews: reviewsResult.rows,
        // 추가된 상세 정보
        coverages: coveragesWithStatus,
        validation: validationResult,
        payout_breakdown: payoutBreakdown,
        coverage_analysis: coverageAnalysis
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 청구 승인
 */
export const approveClaim = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reviewer_name, notes, approved_amount } = req.body;
    const isNumeric = /^\d+$/.test(id);
    const whereClause = isNumeric ? 'id = $1' : 'claim_number = $1';
    const idValue = isNumeric ? parseInt(id) : id;

    // 상태 업데이트
    await db.query(`
      UPDATE claims SET
        status = 'APPROVED',
        decision = 'APPROVED',
        approved_by = $2,
        approved_at = NOW(),
        decision_reason = $3,
        total_approved_amount = COALESCE($4, total_approved_amount),
        updated_at = NOW()
      WHERE ${whereClause}
    `, [idValue, reviewer_name, notes, approved_amount]);

    // 심사 이력 추가
    const claimResult = await db.query(`SELECT id FROM claims WHERE ${whereClause}`, [idValue]);
    if (claimResult.rows.length > 0) {
      await db.query(`
        INSERT INTO claim_reviews (claim_id, reviewer_type, reviewer_name, action, previous_status, new_status, decision, decision_reason)
        VALUES ($1, 'HUMAN', $2, 'APPROVED', 'PENDING_REVIEW', 'APPROVED', 'APPROVE', $3)
      `, [claimResult.rows[0].id, reviewer_name, notes]);
    }

    res.json({ success: true, message: '청구가 승인되었습니다.' });
  } catch (error) {
    next(error);
  }
};

/**
 * 청구 거절
 */
export const rejectClaim = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { reviewer_name, reason } = req.body;
    const isNumeric = /^\d+$/.test(id);
    const whereClause = isNumeric ? 'id = $1' : 'claim_number = $1';
    const idValue = isNumeric ? parseInt(id) : id;

    await db.query(`
      UPDATE claims SET
        status = 'REJECTED',
        decision = 'REJECTED',
        approved_by = $2,
        approved_at = NOW(),
        decision_reason = $3,
        total_approved_amount = 0,
        updated_at = NOW()
      WHERE ${whereClause}
    `, [idValue, reviewer_name, reason]);

    // 심사 이력 추가
    const claimResult = await db.query(`SELECT id FROM claims WHERE ${whereClause}`, [idValue]);
    if (claimResult.rows.length > 0) {
      await db.query(`
        INSERT INTO claim_reviews (claim_id, reviewer_type, reviewer_name, action, previous_status, new_status, decision, decision_reason)
        VALUES ($1, 'HUMAN', $2, 'REJECTED', 'PENDING_REVIEW', 'REJECTED', 'REJECT', $3)
      `, [claimResult.rows[0].id, reviewer_name, reason]);
    }

    res.json({ success: true, message: '청구가 거절되었습니다.' });
  } catch (error) {
    next(error);
  }
};

/**
 * 대시보드 통계
 */
export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 오늘 통계
    const todayStatsResult = await db.query(`
      SELECT
        COUNT(*) as total_claims,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected_count,
        COUNT(CASE WHEN status IN ('RECEIVED', 'AI_PROCESSING', 'PENDING_REVIEW') THEN 1 END) as pending_count,
        COALESCE(SUM(total_approved_amount), 0) as total_approved_amount,
        COALESCE(SUM(CASE WHEN auto_processable = true THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100, 0) as auto_process_rate
      FROM claims
      WHERE DATE(created_at) = $1
    `, [today]);

    // 전체 통계
    const totalStatsResult = await db.query(`
      SELECT
        COUNT(*) as total_claims,
        COALESCE(SUM(total_claimed_amount), 0) as total_claimed,
        COALESCE(SUM(total_approved_amount), 0) as total_approved,
        COALESCE(AVG(ai_confidence_score), 0) as avg_confidence,
        COALESCE(AVG(fraud_score), 0) as avg_fraud_score
      FROM claims
    `);

    // 상태별 분포
    const statusDistResult = await db.query(`
      SELECT status, COUNT(*) as count
      FROM claims
      GROUP BY status
    `);

    // 최근 7일 추이
    const trendResult = await db.query(`
      SELECT
        DATE(created_at) as claim_date,
        COUNT(*) as count,
        SUM(total_approved_amount) as approved_amount
      FROM claims
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY claim_date
    `);

    res.json({
      success: true,
      data: {
        today: todayStatsResult.rows[0],
        total: totalStatsResult.rows[0],
        statusDistribution: statusDistResult.rows,
        trend: trendResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 고객 정보 조회
 */
export const getCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const customerResult = await db.query(`
      SELECT * FROM customers WHERE id = $1 OR customer_code = $1
    `, [id]);

    if (customerResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const customer = customerResult.rows[0];

    // 증권 목록
    const policiesResult = await db.query(`
      SELECT * FROM policies WHERE customer_id = $1 ORDER BY created_at DESC
    `, [customer.id]);

    // 청구 이력
    const claimsResult = await db.query(`
      SELECT claim_number, claim_date, claim_type, diagnosis_name,
             total_claimed_amount, total_approved_amount, status
      FROM claims
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [customer.id]);

    res.json({
      success: true,
      data: {
        ...customer,
        policies: policiesResult.rows,
        recent_claims: claimsResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 증권 정보 조회
 */
export const getPolicy = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const policyResult = await db.query(`
      SELECT p.*, c.name as customer_name, c.customer_code, c.birth_date, c.phone
      FROM policies p
      JOIN customers c ON p.customer_id = c.id
      WHERE p.id = $1::integer OR p.policy_number = $2
    `, [parseInt(id) || 0, id]);

    if (policyResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Policy not found' });
    }

    const policy = policyResult.rows[0];

    // 보장내역
    const coveragesResult = await db.query(`
      SELECT pc.*, ct.name as type_name, ct.category, ct.calculation_type
      FROM policy_coverages pc
      JOIN coverage_types ct ON pc.coverage_type_id = ct.id
      WHERE pc.policy_id = $1
      ORDER BY pc.id
    `, [policy.id]);

    res.json({
      success: true,
      data: {
        ...policy,
        coverages: coveragesResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 진단코드 검색
 */
export const searchDiagnosis = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      return res.json({ success: true, data: [] });
    }

    const result = await db.query(`
      SELECT code, name, category, is_critical_illness, is_cancer, fraud_risk_base
      FROM diagnosis_codes
      WHERE code ILIKE $1 OR name ILIKE $1
      ORDER BY code
      LIMIT 20
    `, [`%${q}%`]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

/**
 * 수술코드 검색
 */
export const searchSurgery = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;

    if (!q || (q as string).length < 2) {
      return res.json({ success: true, data: [] });
    }

    const result = await db.query(`
      SELECT code, name, classification, category, average_cost
      FROM surgery_classification
      WHERE code ILIKE $1 OR name ILIKE $1
      ORDER BY classification, code
      LIMIT 20
    `, [`%${q}%`]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

/**
 * 청구의 AI 모델 결과 목록 조회
 */
export const getAIModelResults = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(id);

    // 청구 ID 조회
    const claimResult = await db.query(`
      SELECT id FROM claims WHERE ${isNumeric ? 'id = $1' : 'claim_number = $1'}
    `, [isNumeric ? parseInt(id) : id]);

    if (claimResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const claimId = claimResult.rows[0].id;

    // AI 모델 결과 조회
    const result = await db.query(`
      SELECT
        car.id,
        car.model_id,
        am.model_code,
        am.model_name,
        am.provider,
        am.avg_user_rating,
        am.avg_accuracy,
        car.recommendation,
        car.confidence_score,
        car.total_approved_amount,
        car.total_rejected_amount,
        car.payout_breakdown,
        car.coverage_analysis,
        car.validation_result,
        car.fraud_analysis,
        car.risk_factors,
        car.reasoning,
        car.response_time_ms,
        car.is_selected,
        car.selected_at,
        car.selected_by,
        car.created_at
      FROM claim_ai_results car
      JOIN ai_models am ON car.model_id = am.id
      WHERE car.claim_id = $1
      ORDER BY am.is_default DESC, car.confidence_score DESC
    `, [claimId]);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        ...row,
        payout_breakdown: typeof row.payout_breakdown === 'string'
          ? JSON.parse(row.payout_breakdown)
          : row.payout_breakdown,
        coverage_analysis: typeof row.coverage_analysis === 'string'
          ? JSON.parse(row.coverage_analysis)
          : row.coverage_analysis,
        validation_result: typeof row.validation_result === 'string'
          ? JSON.parse(row.validation_result)
          : row.validation_result,
        fraud_analysis: typeof row.fraud_analysis === 'string'
          ? JSON.parse(row.fraud_analysis)
          : row.fraud_analysis,
        risk_factors: typeof row.risk_factors === 'string'
          ? JSON.parse(row.risk_factors)
          : row.risk_factors,
        total_approved_amount: Number(row.total_approved_amount),
        total_rejected_amount: Number(row.total_rejected_amount),
        confidence_score: Number(row.confidence_score),
        avg_user_rating: Number(row.avg_user_rating),
        avg_accuracy: Number(row.avg_accuracy)
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * AI 모델 결과 선택
 */
export const selectAIModelResult = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, resultId } = req.params;
    const { selected_by } = req.body;
    const isNumeric = /^\d+$/.test(id);

    // 청구 ID 조회
    const claimResult = await db.query(`
      SELECT id FROM claims WHERE ${isNumeric ? 'id = $1' : 'claim_number = $1'}
    `, [isNumeric ? parseInt(id) : id]);

    if (claimResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Claim not found' });
    }

    const claimId = claimResult.rows[0].id;

    // 기존 선택 해제
    await db.query(`
      UPDATE claim_ai_results SET is_selected = FALSE WHERE claim_id = $1
    `, [claimId]);

    // 새 결과 선택
    const updateResult = await db.query(`
      UPDATE claim_ai_results
      SET is_selected = TRUE, selected_at = NOW(), selected_by = $2
      WHERE id = $1 AND claim_id = $3
      RETURNING total_approved_amount, total_rejected_amount
    `, [resultId, selected_by || '심사자', claimId]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'AI result not found' });
    }

    // 청구 금액 업데이트
    await db.query(`
      UPDATE claims SET
        total_approved_amount = $1,
        total_rejected_amount = $2,
        updated_at = NOW()
      WHERE id = $3
    `, [
      updateResult.rows[0].total_approved_amount,
      updateResult.rows[0].total_rejected_amount,
      claimId
    ]);

    res.json({ success: true, message: 'AI 모델 결과가 선택되었습니다.' });
  } catch (error) {
    next(error);
  }
};

/**
 * AI 모델 평가 제출
 */
export const submitModelEvaluation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { resultId } = req.params;
    const {
      evaluator_name,
      evaluator_role,
      rating,
      accuracy_rating,
      reasoning_rating,
      is_correct,
      feedback_type,
      feedback_text,
      correction_needed,
      corrected_recommendation,
      corrected_amount,
      correction_reason
    } = req.body;

    // AI 결과 정보 조회
    const resultInfo = await db.query(`
      SELECT claim_id, model_id FROM claim_ai_results WHERE id = $1
    `, [resultId]);

    if (resultInfo.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'AI result not found' });
    }

    const { claim_id, model_id } = resultInfo.rows[0];

    // 평가 저장
    await db.query(`
      INSERT INTO ai_model_evaluations (
        claim_ai_result_id, claim_id, model_id,
        evaluator_name, evaluator_role,
        rating, accuracy_rating, reasoning_rating,
        is_correct, feedback_type, feedback_text,
        correction_needed, corrected_recommendation, corrected_amount, correction_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      resultId, claim_id, model_id,
      evaluator_name, evaluator_role,
      rating, accuracy_rating, reasoning_rating,
      is_correct, feedback_type, feedback_text,
      correction_needed, corrected_recommendation, corrected_amount, correction_reason
    ]);

    res.json({ success: true, message: '평가가 저장되었습니다.' });
  } catch (error) {
    next(error);
  }
};

/**
 * AI 모델 목록 조회
 */
export const getAIModels = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await db.query(`
      SELECT
        id, model_code, model_name, provider, version,
        specialization, description,
        total_evaluations, avg_accuracy, avg_response_time_ms, avg_user_rating,
        cost_per_1k_tokens, is_active, is_default
      FROM ai_models
      WHERE is_active = TRUE
      ORDER BY is_default DESC, avg_user_rating DESC
    `);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        ...row,
        avg_accuracy: Number(row.avg_accuracy),
        avg_user_rating: Number(row.avg_user_rating),
        cost_per_1k_tokens: Number(row.cost_per_1k_tokens)
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 약관 조항 조회
 */
export const getPolicyTerms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productCode } = req.query;
    const code = productCode as string || 'PREMIUM_HEALTH';

    const result = await db.query(`
      SELECT id, term_code, article_number, clause_number, title, content,
             summary, term_category, calculation_formula, calculation_value
      FROM policy_terms
      WHERE product_code = $1
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
      ORDER BY article_number, clause_number
    `, [code]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
};

// Legacy exports for n8n webhook compatibility
export const verifyClaim = submitClaim;
export const getClaimStatus = getClaimById;
export const getVerificationQueue = getClaimList;
