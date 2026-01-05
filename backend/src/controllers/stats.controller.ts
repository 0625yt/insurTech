import { Request, Response, NextFunction } from 'express';
import { db } from '../database/connection';
import { redis } from '../database/redis';

/**
 * AI 모델별 정확도 통계
 */
export const getModelStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cacheKey = 'stats:models';

    // 캐시 확인 (5분)
    const cached = await redis.getJSON(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        source: 'cache',
      });
    }

    // DB에서 통계 조회
    const result = await db.query(`
      SELECT
        model_name,
        task_type,
        COUNT(*) AS total_evaluations,
        SUM(CASE WHEN is_correct = true THEN 1 ELSE 0 END) AS correct_count,
        SUM(CASE WHEN is_correct = false THEN 1 ELSE 0 END) AS incorrect_count,
        ROUND(AVG(CASE WHEN is_correct IS NOT NULL THEN
          CASE WHEN is_correct THEN 1.0 ELSE 0.0 END
        END) * 100, 2) AS accuracy_pct,
        ROUND(AVG(confidence_score), 3) AS avg_confidence,
        ROUND(AVG(response_time_ms), 0) AS avg_response_time_ms,
        COUNT(DISTINCT claim_case_id) AS unique_claims
      FROM ai_model_feedback
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY model_name, task_type
      ORDER BY accuracy_pct DESC NULLS LAST
    `);

    // 캐시 저장
    await redis.setJSON(cacheKey, result.rows, 300);

    res.json({
      success: true,
      data: result.rows,
      source: 'database',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 청구 처리 통계
 */
export const getClaimStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cacheKey = 'stats:claims';

    // 캐시 확인 (5분)
    const cached = await redis.getJSON(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        source: 'cache',
      });
    }

    // 상태별 통계
    const statusStats = await db.query(`
      SELECT
        review_status,
        COUNT(*) AS count,
        SUM(total_claimed_amount) AS total_claimed,
        SUM(approved_amount) AS total_approved,
        AVG(confidence_score) AS avg_confidence
      FROM claim_review_results
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY review_status
    `);

    // 일별 통계 (최근 30일)
    const dailyStats = await db.query(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS count,
        SUM(total_claimed_amount) AS total_claimed,
        SUM(approved_amount) AS total_approved
      FROM claim_review_results
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    const stats = {
      by_status: statusStats.rows,
      daily: dailyStats.rows,
    };

    // 캐시 저장
    await redis.setJSON(cacheKey, stats, 300);

    res.json({
      success: true,
      data: stats,
      source: 'database',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 대시보드 전체 통계
 */
export const getDashboardStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cacheKey = 'stats:dashboard';

    // 캐시 확인 (2분)
    const cached = await redis.getJSON(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        source: 'cache',
      });
    }

    // 전체 통계
    const [overallResult, pendingResult, statusResult, modelResult] = await Promise.all([
      // 전체 청구 통계 (claims 테이블 사용)
      db.query(`
        SELECT
          COUNT(*) AS total_claims,
          SUM(total_claimed_amount) AS total_claimed,
          SUM(total_approved_amount) AS total_approved,
          AVG(ai_confidence_score) AS avg_confidence
        FROM claims
        WHERE created_at > NOW() - INTERVAL '30 days'
      `),

      // 대기 중인 청구 (claims 테이블 사용)
      db.query(`
        SELECT COUNT(*) AS pending_count
        FROM claims
        WHERE status IN ('PENDING_REVIEW', 'PENDING_APPROVAL')
      `),

      // 상태별 청구 수
      db.query(`
        SELECT
          status,
          COUNT(*) AS count,
          SUM(total_claimed_amount) AS total_amount
        FROM claims
        GROUP BY status
      `),

      // 최고 성능 모델 (ai_models 테이블 사용)
      db.query(`
        SELECT
          am.model_name,
          COALESCE(ROUND(AVG(CASE WHEN amf.is_correct THEN 1.0 ELSE 0.0 END) * 100, 2), 0) AS accuracy
        FROM ai_models am
        LEFT JOIN ai_model_feedback amf ON am.model_code = amf.model_name
          AND amf.created_at > NOW() - INTERVAL '7 days'
        WHERE am.is_active = true
        GROUP BY am.model_name
        ORDER BY accuracy DESC
        LIMIT 1
      `),
    ]);

    const dashboard = {
      overview: overallResult.rows[0] || { total_claims: 0, total_claimed: 0, total_approved: 0, avg_confidence: 0 },
      pending_count: parseInt(pendingResult.rows[0]?.pending_count) || 0,
      by_status: statusResult.rows,
      best_model: modelResult.rows[0] || { model_name: 'N/A', accuracy: 0 },
      generated_at: new Date().toISOString(),
    };

    // 캐시 저장
    await redis.setJSON(cacheKey, dashboard, 120);

    res.json({
      success: true,
      data: dashboard,
      source: 'database',
    });
  } catch (error) {
    next(error);
  }
};
