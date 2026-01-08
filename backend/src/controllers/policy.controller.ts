import { Request, Response, NextFunction } from 'express';
import { db } from '../database/connection';
import { redis } from '../database/redis';

/**
 * 보험증권 목록 조회
 */
export const getPolicyList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const query = `
      SELECT
        p.id, p.policy_number, p.product_code, p.product_name,
        p.coverage_start_date, p.coverage_end_date,
        c.name as customer_name, p.premium_status, p.status, p.created_at
      FROM policies p
      LEFT JOIN customers c ON p.customer_id = c.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = `SELECT COUNT(*) FROM policies`;

    const [dataResult, countResult] = await Promise.all([
      db.query(query, [limit, offset]),
      db.query(countQuery),
    ]);

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 보험증권 ID로 조회
 */
export const getPolicyById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { policyId } = req.params;

    // 캐시 확인
    const cached = await redis.getJSON(`policy:${policyId}`);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        source: 'cache',
      });
    }

    // DB 조회
    const result = await db.query(
      `SELECT p.*, c.name as customer_name, c.customer_code
       FROM policies p
       LEFT JOIN customers c ON p.customer_id = c.id
       WHERE p.id = $1`,
      [policyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Policy not found' },
      });
    }

    const policy = result.rows[0];

    // 캐시 저장 (1시간)
    await redis.setJSON(`policy:${policyId}`, policy, 3600);

    res.json({
      success: true,
      data: policy,
      source: 'database',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 보험증권의 담보 목록 조회
 */
export const getPolicyCoverages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { policyId } = req.params;

    // 먼저 보험증권 존재 여부 확인
    const policyResult = await db.query(
      `SELECT id, product_code, policy_number FROM policies WHERE id = $1`,
      [policyId]
    );

    if (policyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: 'Policy not found' },
      });
    }

    const policy = policyResult.rows[0];

    // 해당 증권의 담보 조회
    const coverageResult = await db.query(
      `SELECT
         id, coverage_code, coverage_name, insured_amount,
         deductible_type, deductible_amount, deductible_rate,
         payout_rate, max_days, max_times, per_occurrence_limit,
         annual_limit, lifetime_limit, is_active
       FROM policy_coverages
       WHERE policy_id = $1 AND is_active = true
       ORDER BY coverage_code`,
      [policyId]
    );

    res.json({
      success: true,
      policy_id: policyId,
      policy_number: policy.policy_number,
      product_code: policy.product_code,
      data: coverageResult.rows,
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
    const { productCode } = req.params;
    const { category } = req.query;

    let query = `
      SELECT
        id, term_code, article_number, clause_number, sub_clause,
        title, content, summary, term_category, applies_to,
        calculation_type, calculation_value, calculation_formula,
        effective_date, expiry_date, version
      FROM policy_terms
      WHERE product_code = $1
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
    `;
    const params: any[] = [productCode];

    if (category) {
      query += ` AND term_category = $2`;
      params.push(category);
    }

    query += ` ORDER BY article_number, clause_number, sub_clause`;

    const result = await db.query(query, params);

    // 카테고리별 그룹핑
    const byCategory: Record<string, any[]> = {};
    result.rows.forEach(term => {
      const cat = term.term_category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(term);
    });

    res.json({
      success: true,
      data: result.rows,
      byCategory,
      count: result.rows.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 모든 약관 조회 (product_code 필터 옵션)
 */
export const getAllPolicyTerms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, search } = req.query;
    const conditions: string[] = ['(expiry_date IS NULL OR expiry_date > CURRENT_DATE)'];
    const params: any[] = [];
    let paramIndex = 1;

    if (category) {
      conditions.push(`term_category = $${paramIndex++}`);
      params.push(category);
    }

    if (search) {
      conditions.push(`(title ILIKE $${paramIndex} OR content ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT
        id, product_code, term_code, article_number, clause_number,
        title, summary, term_category, applies_to,
        calculation_formula, effective_date
      FROM policy_terms
      ${whereClause}
      ORDER BY product_code, article_number, clause_number
    `, params);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    next(error);
  }
};
