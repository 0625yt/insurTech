import { db } from '../database/connection';
import { logger } from '../utils/logger';
import { AuthUser } from '../middlewares/auth.middleware';
import { AuditService } from '../middlewares/audit.middleware';

// 위험 레벨
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// 권장 조치
export enum RecommendedAction {
  APPROVE = 'APPROVE',
  REVIEW = 'REVIEW',
  INVESTIGATE = 'INVESTIGATE',
  REJECT = 'REJECT',
}

export class FraudDetectionService {
  // 청구 사기 탐지 실행
  static async detectFraud(claimId: number): Promise<{
    totalScore: number;
    riskLevel: RiskLevel;
    detectedPatterns: any[];
    recommendedAction: RecommendedAction;
  }> {
    // 청구 정보 조회
    const claimResult = await db.query(`
      SELECT c.*, cu.risk_grade as customer_risk_grade, cu.risk_score as customer_risk_score,
             p.contract_date, p.coverage_start_date
      FROM claims c
      JOIN customers cu ON c.customer_id = cu.id
      JOIN policies p ON c.policy_id = p.id
      WHERE c.id = $1
    `, [claimId]);

    if (claimResult.rows.length === 0) {
      throw new Error('청구를 찾을 수 없습니다.');
    }

    const claim = claimResult.rows[0];
    const detectedPatterns: any[] = [];
    let totalScore = 0;

    // 1. 단기다수청구 패턴
    const frequencyCheck = await this.checkClaimFrequency(claim.customer_id, claim.id);
    if (frequencyCheck.detected) {
      detectedPatterns.push(frequencyCheck);
      totalScore += frequencyCheck.score;
    }

    // 2. 진단코드 반복 청구
    const diagnosisCheck = await this.checkDiagnosisFrequency(
      claim.customer_id,
      claim.diagnosis_code,
      claim.id
    );
    if (diagnosisCheck.detected) {
      detectedPatterns.push(diagnosisCheck);
      totalScore += diagnosisCheck.score;
    }

    // 3. 주말 입원 패턴
    const weekendCheck = await this.checkWeekendAdmission(claim);
    if (weekendCheck.detected) {
      detectedPatterns.push(weekendCheck);
      totalScore += weekendCheck.score;
    }

    // 4. 고액 청구
    const highAmountCheck = this.checkHighAmount(claim);
    if (highAmountCheck.detected) {
      detectedPatterns.push(highAmountCheck);
      totalScore += highAmountCheck.score;
    }

    // 5. 조기 청구 (계약 후 6개월 이내)
    const earlyClaimCheck = this.checkEarlyClaim(claim);
    if (earlyClaimCheck.detected) {
      detectedPatterns.push(earlyClaimCheck);
      totalScore += earlyClaimCheck.score;
    }

    // 6. 병원 집중도
    const hospitalConcentrationCheck = await this.checkHospitalConcentration(
      claim.customer_id,
      claim.hospital_name
    );
    if (hospitalConcentrationCheck.detected) {
      detectedPatterns.push(hospitalConcentrationCheck);
      totalScore += hospitalConcentrationCheck.score;
    }

    // 7. 진단코드 기본 위험도
    const diagnosisRiskCheck = await this.checkDiagnosisRisk(claim.diagnosis_code);
    if (diagnosisRiskCheck.detected) {
      detectedPatterns.push(diagnosisRiskCheck);
      totalScore += diagnosisRiskCheck.score;
    }

    // 8. 고객 기존 위험도
    const customerRiskCheck = this.checkCustomerRisk(claim);
    if (customerRiskCheck.detected) {
      detectedPatterns.push(customerRiskCheck);
      totalScore += customerRiskCheck.score;
    }

    // 9. 입원일수 적정성
    const hospitalDaysCheck = await this.checkHospitalDays(claim);
    if (hospitalDaysCheck.detected) {
      detectedPatterns.push(hospitalDaysCheck);
      totalScore += hospitalDaysCheck.score;
    }

    // 점수 정규화 (100점 만점)
    totalScore = Math.min(100, totalScore);

    // 위험 레벨 결정
    let riskLevel: RiskLevel;
    if (totalScore >= 70) {
      riskLevel = RiskLevel.CRITICAL;
    } else if (totalScore >= 50) {
      riskLevel = RiskLevel.HIGH;
    } else if (totalScore >= 30) {
      riskLevel = RiskLevel.MEDIUM;
    } else {
      riskLevel = RiskLevel.LOW;
    }

    // 권장 조치 결정
    let recommendedAction: RecommendedAction;
    if (riskLevel === RiskLevel.CRITICAL) {
      recommendedAction = RecommendedAction.REJECT;
    } else if (riskLevel === RiskLevel.HIGH) {
      recommendedAction = RecommendedAction.INVESTIGATE;
    } else if (riskLevel === RiskLevel.MEDIUM) {
      recommendedAction = RecommendedAction.REVIEW;
    } else {
      recommendedAction = RecommendedAction.APPROVE;
    }

    // 결과 저장
    await db.query(`
      INSERT INTO fraud_detection_results (
        claim_id, total_score, risk_level, detected_patterns, recommended_action
      ) VALUES ($1, $2, $3, $4, $5)
    `, [claimId, totalScore, riskLevel, JSON.stringify(detectedPatterns), recommendedAction]);

    // 청구에 점수 업데이트
    await db.query(`
      UPDATE claims SET
        fraud_score = $1,
        fraud_flags = $2,
        fraud_check_passed = $3
      WHERE id = $4
    `, [
      totalScore,
      JSON.stringify(detectedPatterns),
      riskLevel === RiskLevel.LOW || riskLevel === RiskLevel.MEDIUM,
      claimId,
    ]);

    return {
      totalScore,
      riskLevel,
      detectedPatterns,
      recommendedAction,
    };
  }

  // 청구 빈도 체크 (30일 내 3건 이상)
  private static async checkClaimFrequency(
    customerId: number,
    currentClaimId: number
  ): Promise<{ detected: boolean; score: number; pattern: string; details: string }> {
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM claims
      WHERE customer_id = $1
        AND id != $2
        AND claim_date >= CURRENT_DATE - INTERVAL '30 days'
    `, [customerId, currentClaimId]);

    const count = parseInt(result.rows[0].count);

    if (count >= 3) {
      return {
        detected: true,
        score: 30,
        pattern: 'FRD001',
        details: `최근 30일 내 ${count + 1}건 청구 (기준: 3건 이상)`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 동일 진단코드 반복 청구 (연 5회 이상)
  private static async checkDiagnosisFrequency(
    customerId: number,
    diagnosisCode: string,
    currentClaimId: number
  ): Promise<{ detected: boolean; score: number; pattern: string; details: string }> {
    if (!diagnosisCode) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    // 요통(M54.5) 같은 위험 진단코드는 더 엄격하게
    const highRiskCodes = ['M54.5', 'M51.1', 'M51.2', 'S13.4'];
    const maxCount = highRiskCodes.includes(diagnosisCode) ? 3 : 5;

    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM claims
      WHERE customer_id = $1
        AND diagnosis_code = $2
        AND id != $3
        AND claim_date >= CURRENT_DATE - INTERVAL '12 months'
    `, [customerId, diagnosisCode, currentClaimId]);

    const count = parseInt(result.rows[0].count);

    if (count >= maxCount) {
      const isHighRisk = highRiskCodes.includes(diagnosisCode);
      return {
        detected: true,
        score: isHighRisk ? 40 : 25,
        pattern: 'FRD002',
        details: `동일 진단코드(${diagnosisCode}) 연간 ${count + 1}회 청구 (기준: ${maxCount}회 이상)`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 주말 입원 패턴 (금요일 입원, 월요일 퇴원)
  private static async checkWeekendAdmission(
    claim: any
  ): Promise<{ detected: boolean; score: number; pattern: string; details: string }> {
    if (!claim.treatment_start_date || !claim.treatment_end_date) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    const startDate = new Date(claim.treatment_start_date);
    const endDate = new Date(claim.treatment_end_date);

    // 금요일(5) 입원, 월요일(1) 퇴원
    if (startDate.getDay() === 5 && endDate.getDay() === 1) {
      // 과거에도 같은 패턴이 있었는지 확인
      const result = await db.query(`
        SELECT COUNT(*) as count
        FROM claims
        WHERE customer_id = $1
          AND EXTRACT(DOW FROM treatment_start_date) = 5
          AND EXTRACT(DOW FROM treatment_end_date) = 1
          AND id != $2
      `, [claim.customer_id, claim.id]);

      const count = parseInt(result.rows[0].count);

      if (count >= 1) {
        return {
          detected: true,
          score: 25,
          pattern: 'FRD003',
          details: `주말 입원 패턴 반복 (금요일 입원 → 월요일 퇴원) ${count + 1}회`,
        };
      }
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 고액 청구 (500만원 초과)
  private static checkHighAmount(
    claim: any
  ): { detected: boolean; score: number; pattern: string; details: string } {
    const amount = claim.total_claimed_amount || 0;

    if (amount >= 10000000) { // 1000만원 이상
      return {
        detected: true,
        score: 25,
        pattern: 'FRD004',
        details: `고액 청구: ${amount.toLocaleString()}원`,
      };
    } else if (amount >= 5000000) { // 500만원 이상
      return {
        detected: true,
        score: 15,
        pattern: 'FRD004',
        details: `고액 청구: ${amount.toLocaleString()}원`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 조기 청구 (계약 후 6개월 이내)
  private static checkEarlyClaim(
    claim: any
  ): { detected: boolean; score: number; pattern: string; details: string } {
    if (!claim.coverage_start_date || !claim.claim_date) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    const coverageStart = new Date(claim.coverage_start_date);
    const claimDate = new Date(claim.claim_date);
    const monthsDiff = (claimDate.getTime() - coverageStart.getTime()) / (1000 * 60 * 60 * 24 * 30);

    if (monthsDiff <= 3) { // 3개월 이내
      return {
        detected: true,
        score: 30,
        pattern: 'FRD005',
        details: `계약 후 ${Math.round(monthsDiff)}개월 만에 청구 (고위험)`,
      };
    } else if (monthsDiff <= 6) { // 6개월 이내
      return {
        detected: true,
        score: 20,
        pattern: 'FRD005',
        details: `계약 후 ${Math.round(monthsDiff)}개월 만에 청구`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 병원 집중도 (동일 병원 연 10회 이상)
  private static async checkHospitalConcentration(
    customerId: number,
    hospitalName: string
  ): Promise<{ detected: boolean; score: number; pattern: string; details: string }> {
    if (!hospitalName) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM claims
      WHERE customer_id = $1
        AND hospital_name = $2
        AND claim_date >= CURRENT_DATE - INTERVAL '12 months'
    `, [customerId, hospitalName]);

    const count = parseInt(result.rows[0].count);

    if (count >= 10) {
      return {
        detected: true,
        score: 30,
        pattern: 'FRD006',
        details: `동일 병원(${hospitalName}) 연간 ${count}회 방문`,
      };
    } else if (count >= 5) {
      return {
        detected: true,
        score: 15,
        pattern: 'FRD006',
        details: `동일 병원(${hospitalName}) 연간 ${count}회 방문`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 진단코드 기본 위험도
  private static async checkDiagnosisRisk(
    diagnosisCode: string
  ): Promise<{ detected: boolean; score: number; pattern: string; details: string }> {
    if (!diagnosisCode) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    const result = await db.query(`
      SELECT fraud_risk_base, name FROM diagnosis_codes WHERE code = $1
    `, [diagnosisCode]);

    if (result.rows.length === 0) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    const riskBase = parseFloat(result.rows[0].fraud_risk_base) || 0;
    const diagnosisName = result.rows[0].name;

    if (riskBase >= 0.3) {
      return {
        detected: true,
        score: Math.round(riskBase * 30),
        pattern: 'FRD_DIAG',
        details: `고위험 진단코드: ${diagnosisCode} (${diagnosisName})`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 고객 기존 위험도
  private static checkCustomerRisk(
    claim: any
  ): { detected: boolean; score: number; pattern: string; details: string } {
    const riskGrade = claim.customer_risk_grade;
    const riskScore = parseFloat(claim.customer_risk_score) || 0;

    if (riskGrade === 'HIGH_RISK' || riskScore >= 70) {
      return {
        detected: true,
        score: 25,
        pattern: 'FRD_CUST',
        details: `고위험 고객 등급: ${riskGrade} (점수: ${riskScore})`,
      };
    } else if (riskGrade === 'WATCH' || riskScore >= 40) {
      return {
        detected: true,
        score: 15,
        pattern: 'FRD_CUST',
        details: `주의 고객 등급: ${riskGrade} (점수: ${riskScore})`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 입원일수 적정성 (표준 치료기간 대비)
  private static async checkHospitalDays(
    claim: any
  ): Promise<{ detected: boolean; score: number; pattern: string; details: string }> {
    if (!claim.diagnosis_code || !claim.hospitalization_days) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    const result = await db.query(`
      SELECT default_treatment_days FROM diagnosis_codes WHERE code = $1
    `, [claim.diagnosis_code]);

    if (result.rows.length === 0 || !result.rows[0].default_treatment_days) {
      return { detected: false, score: 0, pattern: '', details: '' };
    }

    const standardDays = result.rows[0].default_treatment_days;
    const actualDays = claim.hospitalization_days;

    // 표준 대비 2배 이상이면 위험
    if (actualDays >= standardDays * 2) {
      return {
        detected: true,
        score: 20,
        pattern: 'FRD_DAYS',
        details: `입원일수 ${actualDays}일 (표준: ${standardDays}일, ${Math.round(actualDays / standardDays * 100)}%)`,
      };
    }

    return { detected: false, score: 0, pattern: '', details: '' };
  }

  // 고객 청구 패턴 분석
  static async analyzeCustomerPattern(customerId: number): Promise<any> {
    // 기본 통계
    const statsResult = await db.query(`
      SELECT
        COUNT(*) as total_claims,
        SUM(total_claimed_amount) as total_claimed,
        SUM(total_approved_amount) as total_approved,
        AVG(total_claimed_amount) as avg_claim_amount,
        MIN(claim_date) as first_claim,
        MAX(claim_date) as last_claim
      FROM claims
      WHERE customer_id = $1
    `, [customerId]);

    // 진단코드별 빈도
    const diagnosisResult = await db.query(`
      SELECT diagnosis_code, diagnosis_name, COUNT(*) as count
      FROM claims
      WHERE customer_id = $1 AND diagnosis_code IS NOT NULL
      GROUP BY diagnosis_code, diagnosis_name
      ORDER BY count DESC
      LIMIT 10
    `, [customerId]);

    // 병원별 빈도
    const hospitalResult = await db.query(`
      SELECT hospital_name, COUNT(*) as count
      FROM claims
      WHERE customer_id = $1 AND hospital_name IS NOT NULL
      GROUP BY hospital_name
      ORDER BY count DESC
      LIMIT 10
    `, [customerId]);

    // 월별 청구 패턴
    const monthlyResult = await db.query(`
      SELECT
        TO_CHAR(claim_date, 'YYYY-MM') as month,
        COUNT(*) as count,
        SUM(total_claimed_amount) as amount
      FROM claims
      WHERE customer_id = $1
        AND claim_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY TO_CHAR(claim_date, 'YYYY-MM')
      ORDER BY month
    `, [customerId]);

    const stats = statsResult.rows[0];

    // 패턴 점수 계산
    const claimFrequencyScore = Math.min(100, (parseInt(stats.total_claims) / 12) * 20);
    const diagnosisVarietyScore = diagnosisResult.rows.length > 0
      ? Math.max(0, 100 - (parseInt(diagnosisResult.rows[0].count) / parseInt(stats.total_claims)) * 100)
      : 50;
    const hospitalConcentrationScore = hospitalResult.rows.length > 0
      ? Math.max(0, 100 - (parseInt(hospitalResult.rows[0].count) / parseInt(stats.total_claims)) * 100)
      : 50;

    const totalRiskScore = Math.round(
      (claimFrequencyScore + (100 - diagnosisVarietyScore) + (100 - hospitalConcentrationScore)) / 3
    );

    // 결과 저장
    await db.query(`
      INSERT INTO customer_claim_patterns (
        customer_id, analysis_period_start, analysis_period_end,
        total_claims, total_claimed_amount, total_paid_amount, avg_claim_amount,
        claim_frequency_score, diagnosis_variety_score, hospital_concentration_score,
        total_risk_score, risk_level
      ) VALUES (
        $1, CURRENT_DATE - INTERVAL '12 months', CURRENT_DATE,
        $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
    `, [
      customerId,
      stats.total_claims,
      stats.total_claimed,
      stats.total_approved,
      stats.avg_claim_amount,
      claimFrequencyScore,
      diagnosisVarietyScore,
      hospitalConcentrationScore,
      totalRiskScore,
      totalRiskScore >= 70 ? 'HIGH' : totalRiskScore >= 40 ? 'MEDIUM' : 'LOW',
    ]);

    return {
      statistics: stats,
      diagnosisDistribution: diagnosisResult.rows,
      hospitalDistribution: hospitalResult.rows,
      monthlyPattern: monthlyResult.rows,
      scores: {
        claimFrequency: claimFrequencyScore,
        diagnosisVariety: diagnosisVarietyScore,
        hospitalConcentration: hospitalConcentrationScore,
        totalRisk: totalRiskScore,
      },
      riskLevel: totalRiskScore >= 70 ? 'HIGH' : totalRiskScore >= 40 ? 'MEDIUM' : 'LOW',
    };
  }

  // 사기 탐지 결과 조회
  static async getFraudDetectionResults(claimId: number): Promise<any[]> {
    const result = await db.query(`
      SELECT * FROM fraud_detection_results
      WHERE claim_id = $1
      ORDER BY created_at DESC
    `, [claimId]);

    return result.rows;
  }

  // 고위험 청구 목록 조회
  static async getHighRiskClaims(filters?: {
    minScore?: number;
    riskLevel?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: any[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const minScore = filters?.minScore || 50;
    conditions.push(`c.fraud_score >= $${paramIndex++}`);
    params.push(minScore);

    if (filters?.riskLevel) {
      conditions.push(`fdr.risk_level = $${paramIndex++}`);
      params.push(filters.riskLevel);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = filters?.limit || 20;
    const offset = ((filters?.page || 1) - 1) * limit;

    const countResult = await db.query(`
      SELECT COUNT(*) as total
      FROM claims c
      LEFT JOIN fraud_detection_results fdr ON c.id = fdr.claim_id
      ${whereClause}
    `, params);

    const result = await db.query(`
      SELECT
        c.id, c.claim_number, c.claim_date, c.claim_type,
        c.total_claimed_amount, c.diagnosis_name, c.fraud_score,
        c.status, c.fraud_flags,
        cu.name as customer_name, cu.risk_grade as customer_risk_grade,
        fdr.risk_level, fdr.recommended_action, fdr.detected_patterns
      FROM claims c
      JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN fraud_detection_results fdr ON c.id = fdr.claim_id
      ${whereClause}
      ORDER BY c.fraud_score DESC, c.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, limit, offset]);

    return {
      items: result.rows,
      total: parseInt(countResult.rows[0].total) || 0,
    };
  }

  // 사기 탐지 통계
  static async getFraudStats(startDate?: string, endDate?: string): Promise<any> {
    const dateCondition = startDate && endDate
      ? `AND c.created_at BETWEEN '${startDate}' AND '${endDate}'`
      : `AND c.created_at > NOW() - INTERVAL '30 days'`;

    // 위험 레벨별 분포
    const riskDistribution = await db.query(`
      SELECT
        CASE
          WHEN fraud_score >= 70 THEN 'CRITICAL'
          WHEN fraud_score >= 50 THEN 'HIGH'
          WHEN fraud_score >= 30 THEN 'MEDIUM'
          ELSE 'LOW'
        END as risk_level,
        COUNT(*) as count,
        SUM(total_claimed_amount) as total_amount
      FROM claims c
      WHERE fraud_score IS NOT NULL ${dateCondition}
      GROUP BY
        CASE
          WHEN fraud_score >= 70 THEN 'CRITICAL'
          WHEN fraud_score >= 50 THEN 'HIGH'
          WHEN fraud_score >= 30 THEN 'MEDIUM'
          ELSE 'LOW'
        END
    `);

    // 탐지된 패턴별 빈도
    const patternStats = await db.query(`
      SELECT
        pattern->>'pattern' as pattern_code,
        pattern->>'details' as pattern_details,
        COUNT(*) as count
      FROM fraud_detection_results fdr,
           jsonb_array_elements(detected_patterns::jsonb) as pattern
      WHERE fdr.created_at > NOW() - INTERVAL '30 days'
      GROUP BY pattern->>'pattern', pattern->>'details'
      ORDER BY count DESC
      LIMIT 10
    `);

    // 평균 사기 점수 추이
    const trendResult = await db.query(`
      SELECT
        DATE(created_at) as date,
        AVG(fraud_score) as avg_score,
        COUNT(*) as count
      FROM claims
      WHERE fraud_score IS NOT NULL
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);

    return {
      riskDistribution: riskDistribution.rows,
      topPatterns: patternStats.rows,
      scoreTrend: trendResult.rows,
    };
  }

  // 사기 탐지 트렌드
  static async getFraudTrends(period: string = '30d'): Promise<any> {
    const intervalMap: Record<string, string> = {
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
      '1y': '1 year',
    };
    const interval = intervalMap[period] || '30 days';

    const trendResult = await db.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total_claims,
        COUNT(*) FILTER (WHERE fraud_score >= 50) as high_risk_count,
        AVG(fraud_score) as avg_fraud_score,
        SUM(total_claimed_amount) FILTER (WHERE fraud_score >= 50) as high_risk_amount
      FROM claims
      WHERE created_at > NOW() - INTERVAL '${interval}'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);

    return {
      period,
      data: trendResult.rows,
    };
  }

  // 병원 네트워크 분석
  static async getHospitalNetwork(hospitalId: number): Promise<any> {
    // 병원에 연결된 고객들과 청구 패턴
    const result = await db.query(`
      SELECT
        c.hospital_name,
        COUNT(DISTINCT c.customer_id) as unique_customers,
        COUNT(*) as total_claims,
        SUM(c.total_claimed_amount) as total_claimed,
        AVG(c.fraud_score) as avg_fraud_score
      FROM claims c
      WHERE c.hospital_id = $1 OR c.hospital_name = (
        SELECT hospital_name FROM claims WHERE id = $1 LIMIT 1
      )
      GROUP BY c.hospital_name
    `, [hospitalId]);

    return result.rows[0] || null;
  }

  // 사기 지표 업데이트
  static async updateFraudIndicators(
    claimId: number,
    indicators: any,
    userId: number
  ): Promise<boolean> {
    try {
      await db.query(`
        UPDATE claims SET
          fraud_flags = $1,
          fraud_score = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [JSON.stringify(indicators.flags), indicators.score, claimId]);

      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        action: 'FRAUD_INDICATOR_UPDATE',
        additionalInfo: { indicators, updatedBy: userId },
      });

      return true;
    } catch (error) {
      logger.error('Update fraud indicators error:', error);
      return false;
    }
  }

  // SIU 의뢰
  static async referToSIU(
    claimId: number,
    reason: string,
    userId: number
  ): Promise<boolean> {
    try {
      await db.query(`
        UPDATE claims SET
          status = 'SIU_REFERRED',
          siu_referral_date = CURRENT_TIMESTAMP,
          siu_referral_reason = $1
        WHERE id = $2
      `, [reason, claimId]);

      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        action: 'SIU_REFERRAL',
        additionalInfo: { reason, referredBy: userId },
      });

      return true;
    } catch (error) {
      logger.error('SIU referral error:', error);
      return false;
    }
  }
}
