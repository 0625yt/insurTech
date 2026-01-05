/**
 * 보험금 청구 심사 서비스
 * 실제 보험사 심사 로직 구현
 */

import { db } from '../database/connection';
import { logger } from '../utils/logger';

// ========================================
// 타입 정의
// ========================================

interface ClaimInput {
  policy_number: string;
  customer_name: string;
  claim_type: 'HOSPITALIZATION' | 'OUTPATIENT' | 'SURGERY' | 'DIAGNOSIS';
  treatment_start_date: string;
  treatment_end_date: string;
  hospital_name: string;
  diagnosis_code: string;
  diagnosis_name: string;
  surgery_code?: string;
  surgery_name?: string;
  hospitalization_days?: number;
  total_medical_expense: number;
  insured_expense: number;
  uninsured_expense: number;
}

interface PolicyValidation {
  isValid: boolean;
  policy: any;
  customer: any;
  issues: string[];
  isInExemptionPeriod: boolean;
  isInReductionPeriod: boolean;
  reductionRate: number;
}

interface CoverageAnalysis {
  coverages: CoverageItem[];
  totalApproved: number;
  totalRejected: number;
  breakdown: PayoutItem[];
}

interface CoverageItem {
  id: number;
  name: string;
  code: string;
  type: string;
  insuredAmount: number;
  deductibleAmount: number;
  deductibleRate: number;
  payoutRate: number;
  maxDays?: number;
  surgeryClassification?: number;
  annualLimit?: number;
  usedAnnualAmount?: number;
}

interface PayoutItem {
  item: string;
  claimedAmount: number;
  approvedAmount: number;
  rejectedAmount: number;
  calculation: string;
  rejectionReason?: string;
  // 약관 조항 인용
  termReference?: {
    article: string;        // 조문 번호 (예: 제15조 제1항)
    title: string;          // 조항 제목
    content: string;        // 조항 본문 (발췌)
    formula: string;        // 계산 공식
  };
}

interface PolicyTerm {
  id: number;
  term_code: string;
  article_number: string;
  clause_number?: string;
  title: string;
  content: string;
  summary: string;
  calculation_formula?: string;
  calculation_value?: number;
}

interface AIModelResult {
  modelId: number;
  modelCode: string;
  modelName: string;
  recommendation: string;
  confidenceScore: number;
  totalApproved: number;
  totalRejected: number;
  breakdown: PayoutItem[];
  reasoning: string;
  responseTimeMs: number;
}

interface FraudAnalysis {
  score: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  detectedPatterns: FraudPattern[];
  recommendation: 'AUTO_APPROVE' | 'MANUAL_REVIEW' | 'INVESTIGATE' | 'REJECT';
}

interface FraudPattern {
  code: string;
  name: string;
  score: number;
  details: string;
}

interface ClaimReviewResult {
  success: boolean;
  claim_number: string;
  status: string;
  customer: any;
  policy: any;
  validation: PolicyValidation;
  ocr_summary: any;
  coverage_analysis: CoverageAnalysis;
  fraud_analysis: FraudAnalysis;
  review_result: {
    status: string;
    decision: string;
    confidence_score: number;
    auto_approved: boolean;
  };
  payout_details: {
    total_claimed: number;
    total_approved: number;
    total_rejected: number;
    breakdown: PayoutItem[];
  };
  metadata: {
    processing_time_ms: number;
    reviewed_at: string;
  };
}

// ========================================
// 메인 서비스 클래스
// ========================================

export class ClaimService {

  /**
   * 청구 접수 및 전체 심사 프로세스
   */
  async processClaimReview(input: ClaimInput): Promise<ClaimReviewResult> {
    const startTime = Date.now();
    const claimNumber = this.generateClaimNumber();

    try {
      // 1. 증권 유효성 검증
      const validation = await this.validatePolicy(input.policy_number, input);

      if (!validation.isValid) {
        return this.createRejectionResult(claimNumber, input, validation, startTime);
      }

      // 2. 진단코드 검증
      const diagnosisInfo = await this.getDiagnosisInfo(input.diagnosis_code);

      // 3. 수술코드 검증 (있는 경우)
      let surgeryInfo = null;
      if (input.surgery_code) {
        surgeryInfo = await this.getSurgeryInfo(input.surgery_code);
      }

      // 3.5. 약관 조항 조회
      const policyTerms = await this.getPolicyTerms('PREMIUM_HEALTH');

      // 4. 다중 AI 모델로 보장 분석 및 지급액 산정
      const aiModelResults = await this.processWithMultipleModels(
        validation.policy.id,
        input,
        validation,
        diagnosisInfo,
        surgeryInfo,
        policyTerms
      );

      // 기본 모델 결과 사용 (첫 번째 = 기본 모델)
      const defaultResult = aiModelResults[0];
      const coverageAnalysis: CoverageAnalysis = {
        coverages: [],
        totalApproved: defaultResult.totalApproved,
        totalRejected: defaultResult.totalRejected,
        breakdown: defaultResult.breakdown
      };

      // 5. 사기 탐지
      const fraudAnalysis = await this.detectFraud(
        validation.customer.id,
        validation.policy.id,
        input,
        diagnosisInfo
      );

      // 6. 자동 심사 결정
      const reviewDecision = this.makeReviewDecision(
        validation,
        coverageAnalysis,
        fraudAnalysis
      );

      // 7. 청구 저장
      const claimId = await this.saveClaim(claimNumber, input, validation, coverageAnalysis, fraudAnalysis, reviewDecision);

      // 8. AI 모델 결과 저장
      if (claimId) {
        await this.saveAIResults(claimId, aiModelResults);
      }

      // 결과 반환
      return {
        success: true,
        claim_number: claimNumber,
        status: reviewDecision.status,
        customer: {
          name: validation.customer.name,
          birth: validation.customer.birth_date,
          phone: validation.customer.phone,
          risk_grade: validation.customer.risk_grade
        },
        policy: {
          policy_number: validation.policy.policy_number,
          product_name: validation.policy.product_name,
          status: validation.policy.status,
          coverage_period: `${validation.policy.coverage_start_date} ~ ${validation.policy.coverage_end_date}`
        },
        validation: {
          isValid: validation.isValid,
          policy: null,
          customer: null,
          issues: validation.issues,
          isInExemptionPeriod: validation.isInExemptionPeriod,
          isInReductionPeriod: validation.isInReductionPeriod,
          reductionRate: validation.reductionRate
        },
        ocr_summary: {
          patient_name: input.customer_name,
          diagnosis: `${input.diagnosis_name} (${input.diagnosis_code})`,
          treatment: input.claim_type === 'HOSPITALIZATION' ? '입원' :
                     input.claim_type === 'OUTPATIENT' ? '통원' :
                     input.claim_type === 'SURGERY' ? '수술' : '진단',
          hospital: input.hospital_name,
          surgery: input.surgery_name || null,
          hospital_days: input.hospitalization_days || 0,
          ocr_confidence: 0.94,
          ocr_method: 'ensemble',
          models_used: ['gpt-4o', 'claude-3.5-sonnet', 'gemini-1.5-pro']
        },
        coverage_analysis: coverageAnalysis,
        fraud_analysis: fraudAnalysis,
        review_result: reviewDecision,
        payout_details: {
          total_claimed: input.total_medical_expense,
          total_approved: coverageAnalysis.totalApproved,
          total_rejected: coverageAnalysis.totalRejected,
          breakdown: coverageAnalysis.breakdown
        },
        metadata: {
          processing_time_ms: Date.now() - startTime,
          reviewed_at: new Date().toISOString()
        }
      };

    } catch (error) {
      logger.error('Claim processing error:', error);
      throw error;
    }
  }

  /**
   * 증권 유효성 검증
   */
  async validatePolicy(policyNumber: string, input: ClaimInput): Promise<PolicyValidation> {
    const issues: string[] = [];
    const treatmentDate = new Date(input.treatment_start_date);
    const today = new Date();

    // 증권 조회
    const policyResult = await db.query(`
      SELECT p.*, c.id as customer_id, c.name as customer_name, c.birth_date,
             c.phone, c.risk_grade, c.risk_score
      FROM policies p
      JOIN customers c ON p.customer_id = c.id
      WHERE p.policy_number = $1
    `, [policyNumber]);

    if (policyResult.rows.length === 0) {
      return {
        isValid: false,
        policy: null,
        customer: null,
        issues: ['증권을 찾을 수 없습니다.'],
        isInExemptionPeriod: false,
        isInReductionPeriod: false,
        reductionRate: 0
      };
    }

    const policy = policyResult.rows[0];
    const customer = {
      id: policy.customer_id,
      name: policy.customer_name,
      birth_date: policy.birth_date,
      phone: policy.phone,
      risk_grade: policy.risk_grade,
      risk_score: policy.risk_score
    };

    // 1. 계약 상태 확인
    if (policy.status !== 'ACTIVE') {
      issues.push(`계약 상태가 유효하지 않습니다: ${policy.status}`);
    }

    // 2. 보험료 납입 상태 확인
    if (policy.premium_status === 'OVERDUE') {
      issues.push('보험료 미납 상태입니다.');
    }

    // 3. 보장 기간 확인
    const coverageStart = new Date(policy.coverage_start_date);
    const coverageEnd = new Date(policy.coverage_end_date);

    if (treatmentDate < coverageStart) {
      issues.push('치료일이 보장개시일 이전입니다.');
    }

    if (treatmentDate > coverageEnd) {
      issues.push('치료일이 보장종료일 이후입니다.');
    }

    // 4. 면책기간 확인
    const exemptionEnd = new Date(policy.exemption_end_date);
    const isInExemptionPeriod = treatmentDate <= exemptionEnd;

    if (isInExemptionPeriod) {
      issues.push(`면책기간 내 발생 (면책기간: ~${policy.exemption_end_date})`);
    }

    // 5. 감액기간 확인
    const reductionEnd = new Date(policy.reduction_end_date);
    const isInReductionPeriod = treatmentDate <= reductionEnd && !isInExemptionPeriod;
    const reductionRate = isInReductionPeriod ? (policy.reduction_rate || 50) : 0;

    if (isInReductionPeriod) {
      issues.push(`감액기간 내 발생 (${reductionRate}% 감액 적용)`);
    }

    return {
      isValid: issues.filter(i => !i.includes('감액')).length === 0 ||
               (issues.length === 1 && isInReductionPeriod),
      policy,
      customer,
      issues,
      isInExemptionPeriod,
      isInReductionPeriod,
      reductionRate
    };
  }

  /**
   * 진단코드 정보 조회
   */
  async getDiagnosisInfo(diagnosisCode: string) {
    const result = await db.query(`
      SELECT * FROM diagnosis_codes WHERE code = $1
    `, [diagnosisCode]);

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // 기본값 반환
    return {
      code: diagnosisCode,
      name: '기타 질환',
      category: '기타',
      is_critical_illness: false,
      is_cancer: false,
      fraud_risk_base: 0.2,
      chronic_disease: false
    };
  }

  /**
   * 수술코드 정보 조회
   */
  async getSurgeryInfo(surgeryCode: string) {
    const result = await db.query(`
      SELECT * FROM surgery_classification WHERE code = $1
    `, [surgeryCode]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * 보장 분석 및 지급액 산정
   */
  async analyzeCoverage(
    policyId: number,
    input: ClaimInput,
    validation: PolicyValidation,
    diagnosisInfo: any,
    surgeryInfo: any
  ): Promise<CoverageAnalysis> {
    // 해당 증권의 보장 내역 조회
    const coveragesResult = await db.query(`
      SELECT pc.*, ct.code as type_code, ct.category, ct.calculation_type
      FROM policy_coverages pc
      JOIN coverage_types ct ON pc.coverage_type_id = ct.id
      WHERE pc.policy_id = $1 AND pc.is_active = TRUE
    `, [policyId]);

    const breakdown: PayoutItem[] = [];
    let totalApproved = 0;
    let totalRejected = 0;

    const coverages = coveragesResult.rows;

    // 입원의료비 (실손)
    if (input.claim_type === 'HOSPITALIZATION' || input.claim_type === 'SURGERY') {
      // 급여 부분
      const hospInsured = coverages.find((c: any) =>
        c.coverage_code === 'DIS_HOSP_INS' || c.type_code === 'REAL_LOSS_HOSP_INS'
      );

      if (hospInsured && input.insured_expense > 0) {
        const result = this.calculateRealLoss(
          '질병입원의료비(급여)',
          Number(input.insured_expense) || 0,
          Number(hospInsured.deductible_amount) || 0,
          Number(hospInsured.deductible_rate) || 0,
          Number(hospInsured.payout_rate) || 100,
          validation.reductionRate,
          hospInsured.annual_limit ? Number(hospInsured.annual_limit) : null,
          Number(hospInsured.used_annual_amount) || 0
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }

      // 비급여 부분
      const hospUninsured = coverages.find((c: any) =>
        c.coverage_code === 'DIS_HOSP_UNINS' || c.type_code === 'REAL_LOSS_HOSP_UNINS'
      );

      if (hospUninsured && input.uninsured_expense > 0) {
        const result = this.calculateRealLoss(
          '질병입원의료비(비급여)',
          Number(input.uninsured_expense) || 0,
          Number(hospUninsured.deductible_amount) || 0,
          Number(hospUninsured.deductible_rate) || 0,
          Number(hospUninsured.payout_rate) || 100,
          validation.reductionRate,
          hospUninsured.annual_limit ? Number(hospUninsured.annual_limit) : null,
          Number(hospUninsured.used_annual_amount) || 0
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }
    }

    // 입원일당 (정액)
    if (input.hospitalization_days && input.hospitalization_days > 0) {
      const hospDaily = coverages.find((c: any) =>
        c.coverage_code === 'DIS_HOSP_DAILY' || c.type_code === 'FIXED_HOSP_DAILY'
      );

      if (hospDaily) {
        const result = this.calculateDailyBenefit(
          '질병입원일당',
          Number(hospDaily.insured_amount) || 0,
          input.hospitalization_days,
          hospDaily.max_days || 180,
          hospDaily.used_days || 0,
          validation.reductionRate
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }
    }

    // 수술비 (정액)
    if (surgeryInfo && input.claim_type === 'SURGERY') {
      const surgeryClassification = surgeryInfo.classification;
      const surgeryCoverage = coverages.find((c: any) =>
        c.surgery_classification === surgeryClassification
      );

      if (surgeryCoverage) {
        const result = this.calculateSurgeryBenefit(
          `질병수술비(${surgeryClassification}종)`,
          Number(surgeryCoverage.insured_amount) || 0,
          surgeryInfo.name,
          validation.reductionRate
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }
    }

    // 통원의료비 (실손)
    if (input.claim_type === 'OUTPATIENT') {
      const outInsured = coverages.find((c: any) =>
        c.coverage_code === 'OUT_INS' || c.type_code === 'REAL_LOSS_OUT_INS'
      );

      if (outInsured && input.insured_expense > 0) {
        const result = this.calculateRealLoss(
          '통원의료비(급여)',
          Number(input.insured_expense) || 0,
          Number(outInsured.deductible_amount) || 0,
          Number(outInsured.deductible_rate) || 0,
          Number(outInsured.payout_rate) || 100,
          validation.reductionRate,
          Number(outInsured.per_occurrence_limit || outInsured.insured_amount) || null,
          0
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }

      const outUninsured = coverages.find((c: any) =>
        c.coverage_code === 'OUT_UNINS' || c.type_code === 'REAL_LOSS_OUT_UNINS'
      );

      if (outUninsured && input.uninsured_expense > 0) {
        const result = this.calculateRealLoss(
          '통원의료비(비급여)',
          Number(input.uninsured_expense) || 0,
          Number(outUninsured.deductible_amount) || 0,
          Number(outUninsured.deductible_rate) || 0,
          Number(outUninsured.payout_rate) || 100,
          validation.reductionRate,
          Number(outUninsured.per_occurrence_limit || outUninsured.insured_amount) || null,
          0
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }
    }

    return {
      coverages: coverages.map((c: any) => ({
        id: c.id,
        name: c.coverage_name,
        code: c.coverage_code,
        type: c.category,
        insuredAmount: c.insured_amount,
        deductibleAmount: c.deductible_amount,
        deductibleRate: c.deductible_rate,
        payoutRate: c.payout_rate,
        maxDays: c.max_days,
        surgeryClassification: c.surgery_classification,
        annualLimit: c.annual_limit,
        usedAnnualAmount: c.used_annual_amount
      })),
      totalApproved,
      totalRejected,
      breakdown
    };
  }

  /**
   * 실손의료비 계산
   * 지급액 = (청구액 - 본인부담금) × 지급률
   * 본인부담금 = MAX(정액, 청구액 × 비율)
   */
  calculateRealLoss(
    itemName: string,
    claimedAmount: number,
    deductibleAmount: number,
    deductibleRate: number,
    payoutRate: number,
    reductionRate: number,
    limit: number | null,
    usedAmount: number
  ): PayoutItem {
    // 본인부담금 계산 (정액과 비율 중 큰 금액)
    const rateDeductible = Math.round(claimedAmount * (deductibleRate / 100));
    const finalDeductible = Math.max(deductibleAmount, rateDeductible);

    // 지급 대상 금액
    const payableBase = Math.max(0, claimedAmount - finalDeductible);

    // 지급률 적용
    let approvedAmount = Math.round(payableBase * (payoutRate / 100));

    // 감액 적용
    if (reductionRate > 0) {
      const reduction = Math.round(approvedAmount * (reductionRate / 100));
      approvedAmount = approvedAmount - reduction;
    }

    // 한도 적용
    if (limit) {
      const remainingLimit = limit - usedAmount;
      if (approvedAmount > remainingLimit) {
        approvedAmount = Math.max(0, remainingLimit);
      }
    }

    const rejectedAmount = claimedAmount - approvedAmount;

    // 계산식 생성
    let calculation = `(${claimedAmount.toLocaleString()}원 - ${finalDeductible.toLocaleString()}원) × ${payoutRate}%`;
    if (reductionRate > 0) {
      calculation += ` × ${100 - reductionRate}%(감액)`;
    }
    calculation += ` = ${approvedAmount.toLocaleString()}원`;

    return {
      item: itemName,
      claimedAmount,
      approvedAmount,
      rejectedAmount,
      calculation,
      rejectionReason: rejectedAmount > 0 ? '본인부담금 및 지급률 적용' : undefined
    };
  }

  /**
   * 입원일당 계산 (정액형)
   */
  calculateDailyBenefit(
    itemName: string,
    dailyAmount: number,
    hospitalDays: number,
    maxDays: number,
    usedDays: number,
    reductionRate: number
  ): PayoutItem {
    const remainingDays = Math.max(0, maxDays - usedDays);
    const payableDays = Math.min(hospitalDays, remainingDays);

    let approvedAmount = dailyAmount * payableDays;

    // 감액 적용
    if (reductionRate > 0) {
      approvedAmount = Math.round(approvedAmount * (1 - reductionRate / 100));
    }

    const claimedAmount = dailyAmount * hospitalDays;
    const rejectedAmount = claimedAmount - approvedAmount;

    let calculation = `${dailyAmount.toLocaleString()}원 × ${payableDays}일`;
    if (reductionRate > 0) {
      calculation += ` × ${100 - reductionRate}%(감액)`;
    }
    calculation += ` = ${approvedAmount.toLocaleString()}원`;

    return {
      item: itemName,
      claimedAmount,
      approvedAmount,
      rejectedAmount,
      calculation,
      rejectionReason: payableDays < hospitalDays ? `최대보장일수 초과 (${maxDays}일)` : undefined
    };
  }

  /**
   * 수술비 계산 (정액형)
   */
  calculateSurgeryBenefit(
    itemName: string,
    insuredAmount: number,
    surgeryName: string,
    reductionRate: number
  ): PayoutItem {
    let approvedAmount = insuredAmount;

    // 감액 적용
    if (reductionRate > 0) {
      approvedAmount = Math.round(insuredAmount * (1 - reductionRate / 100));
    }

    const rejectedAmount = insuredAmount - approvedAmount;

    let calculation = `${surgeryName} 정액 ${insuredAmount.toLocaleString()}원`;
    if (reductionRate > 0) {
      calculation += ` × ${100 - reductionRate}%(감액) = ${approvedAmount.toLocaleString()}원`;
    }

    return {
      item: itemName,
      claimedAmount: insuredAmount,
      approvedAmount,
      rejectedAmount,
      calculation,
      rejectionReason: reductionRate > 0 ? '감액기간 적용' : undefined
    };
  }

  /**
   * 사기 탐지
   */
  async detectFraud(
    customerId: number,
    policyId: number,
    input: ClaimInput,
    diagnosisInfo: any
  ): Promise<FraudAnalysis> {
    const detectedPatterns: FraudPattern[] = [];
    let totalScore = 0;

    // 1. 기본 진단코드 위험 점수
    const diagnosisFraudRisk = diagnosisInfo.fraud_risk_base || 0;
    if (diagnosisFraudRisk > 0.3) {
      detectedPatterns.push({
        code: 'DIAG_RISK',
        name: '고위험 진단코드',
        score: diagnosisFraudRisk * 20,
        details: `${diagnosisInfo.name}: 기본 위험점수 ${(diagnosisFraudRisk * 100).toFixed(0)}%`
      });
      totalScore += diagnosisFraudRisk * 20;
    }

    // 2. 고액 청구 체크
    if (input.total_medical_expense > 5000000) {
      detectedPatterns.push({
        code: 'FRD004',
        name: '고액단건청구',
        score: 15,
        details: `청구금액 ${input.total_medical_expense.toLocaleString()}원 > 500만원`
      });
      totalScore += 15;
    }

    // 3. 단기 다수 청구 체크
    const recentClaimsResult = await db.query(`
      SELECT COUNT(*) as count
      FROM claims
      WHERE customer_id = $1
        AND claim_date > CURRENT_DATE - INTERVAL '30 days'
    `, [customerId]);

    const recentClaimCount = parseInt(recentClaimsResult.rows[0].count);
    if (recentClaimCount >= 2) {
      detectedPatterns.push({
        code: 'FRD001',
        name: '단기다수청구',
        score: 25,
        details: `30일 내 ${recentClaimCount + 1}건 청구`
      });
      totalScore += 25;
    }

    // 4. 요통 반복 청구 (요통은 사기 위험 높음)
    if (diagnosisInfo.code === 'M54.5') {
      const backPainResult = await db.query(`
        SELECT COUNT(*) as count
        FROM claims
        WHERE customer_id = $1
          AND diagnosis_code = 'M54.5'
          AND claim_date > CURRENT_DATE - INTERVAL '1 year'
      `, [customerId]);

      const backPainCount = parseInt(backPainResult.rows[0].count);
      if (backPainCount >= 3) {
        detectedPatterns.push({
          code: 'FRD002',
          name: '요통반복청구',
          score: 35,
          details: `연간 요통 청구 ${backPainCount + 1}회`
        });
        totalScore += 35;
      }
    }

    // 5. 주말 입원 패턴
    const startDate = new Date(input.treatment_start_date);
    const endDate = new Date(input.treatment_end_date);
    if (startDate.getDay() === 5 && endDate.getDay() === 1) {
      detectedPatterns.push({
        code: 'FRD003',
        name: '주말입원패턴',
        score: 20,
        details: '금요일 입원 → 월요일 퇴원'
      });
      totalScore += 20;
    }

    // 6. 중복 청구 체크
    const duplicateResult = await db.query(`
      SELECT claim_number
      FROM claims
      WHERE customer_id = $1
        AND diagnosis_code = $2
        AND hospital_name = $3
        AND treatment_start_date = $4
        AND id != COALESCE($5, 0)
    `, [customerId, input.diagnosis_code, input.hospital_name, input.treatment_start_date, null]);

    if (duplicateResult.rows.length > 0) {
      detectedPatterns.push({
        code: 'FRD008',
        name: '중복청구',
        score: 50,
        details: `동일 치료건 기존 청구: ${duplicateResult.rows[0].claim_number}`
      });
      totalScore += 50;
    }

    // 위험 등급 결정
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    let recommendation: 'AUTO_APPROVE' | 'MANUAL_REVIEW' | 'INVESTIGATE' | 'REJECT';

    if (totalScore >= 60) {
      riskLevel = 'CRITICAL';
      recommendation = 'REJECT';
    } else if (totalScore >= 40) {
      riskLevel = 'HIGH';
      recommendation = 'INVESTIGATE';
    } else if (totalScore >= 20) {
      riskLevel = 'MEDIUM';
      recommendation = 'MANUAL_REVIEW';
    } else {
      riskLevel = 'LOW';
      recommendation = 'AUTO_APPROVE';
    }

    return {
      score: totalScore,
      riskLevel,
      detectedPatterns,
      recommendation
    };
  }

  /**
   * 자동 심사 결정
   */
  makeReviewDecision(
    validation: PolicyValidation,
    coverage: CoverageAnalysis,
    fraud: FraudAnalysis
  ): {
    status: string;
    decision: string;
    confidence_score: number;
    auto_approved: boolean;
  } {
    // 면책기간이면 거절
    if (validation.isInExemptionPeriod) {
      return {
        status: 'REJECTED',
        decision: '면책기간 내 발생으로 보장 불가',
        confidence_score: 100,
        auto_approved: false
      };
    }

    // 사기 점수가 높으면 수동 검토
    if (fraud.recommendation === 'REJECT') {
      return {
        status: 'PENDING_REVIEW',
        decision: '사기 의심으로 정밀 조사 필요',
        confidence_score: fraud.score,
        auto_approved: false
      };
    }

    if (fraud.recommendation === 'INVESTIGATE') {
      return {
        status: 'PENDING_REVIEW',
        decision: '위험 패턴 감지로 수동 검토 필요',
        confidence_score: 100 - fraud.score,
        auto_approved: false
      };
    }

    if (fraud.recommendation === 'MANUAL_REVIEW') {
      return {
        status: 'PENDING_REVIEW',
        decision: '추가 검토 필요',
        confidence_score: 100 - fraud.score,
        auto_approved: false
      };
    }

    // 자동 승인 조건
    const autoApproveConditions = [
      fraud.score < 20,
      coverage.totalApproved > 0,
      coverage.totalApproved <= 3000000 // 300만원 이하만 자동승인
    ];

    if (autoApproveConditions.every(c => c)) {
      let decision = '';
      if (coverage.breakdown.length > 0) {
        const items = coverage.breakdown.map(b => b.item).join(' + ');
        decision = `${items} 지급 승인`;
      }

      if (validation.isInReductionPeriod) {
        decision += ` (감액기간 ${validation.reductionRate}% 적용)`;
      }

      return {
        status: 'APPROVED',
        decision,
        confidence_score: 100 - fraud.score,
        auto_approved: true
      };
    }

    // 고액은 수동 검토
    return {
      status: 'PENDING_REVIEW',
      decision: '고액 건으로 담당자 검토 필요',
      confidence_score: 100 - fraud.score,
      auto_approved: false
    };
  }

  /**
   * 청구 저장
   */
  async saveClaim(
    claimNumber: string,
    input: ClaimInput,
    validation: PolicyValidation,
    coverage: CoverageAnalysis,
    fraud: FraudAnalysis,
    decision: any
  ): Promise<number> {
    const result = await db.query(`
      INSERT INTO claims (
        claim_number, policy_id, customer_id,
        claim_type, treatment_start_date, treatment_end_date,
        hospital_name, diagnosis_code, diagnosis_name,
        surgery_code, surgery_name, surgery_classification,
        hospitalization_days,
        total_medical_expense, insured_expense, uninsured_expense,
        total_claimed_amount, total_approved_amount, total_rejected_amount,
        status, ai_confidence_score, ai_recommendation,
        fraud_score, fraud_flags, auto_processable,
        ai_analysis_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING id
    `, [
      claimNumber,
      validation.policy.id,
      validation.customer.id,
      input.claim_type,
      input.treatment_start_date,
      input.treatment_end_date,
      input.hospital_name,
      input.diagnosis_code,
      input.diagnosis_name,
      input.surgery_code,
      input.surgery_name,
      null, // surgery_classification
      input.hospitalization_days || 0,
      input.total_medical_expense,
      input.insured_expense,
      input.uninsured_expense,
      input.total_medical_expense,
      coverage.totalApproved,
      coverage.totalRejected,
      decision.status,
      decision.confidence_score,
      fraud.recommendation,
      fraud.score,
      JSON.stringify(fraud.detectedPatterns),
      decision.auto_approved,
      JSON.stringify({
        coverage_analysis: coverage,
        fraud_analysis: fraud,
        validation: {
          isInExemptionPeriod: validation.isInExemptionPeriod,
          isInReductionPeriod: validation.isInReductionPeriod,
          reductionRate: validation.reductionRate,
          issues: validation.issues
        }
      })
    ]);
    return result.rows[0].id;
  }

  /**
   * 거절 결과 생성
   */
  createRejectionResult(
    claimNumber: string,
    input: ClaimInput,
    validation: PolicyValidation,
    startTime: number
  ): ClaimReviewResult {
    return {
      success: false,
      claim_number: claimNumber,
      status: 'REJECTED',
      customer: validation.customer ? {
        name: validation.customer.name,
        birth: validation.customer.birth_date,
        phone: validation.customer.phone,
        risk_grade: validation.customer.risk_grade
      } : null,
      policy: validation.policy ? {
        policy_number: validation.policy.policy_number,
        product_name: validation.policy.product_name,
        status: validation.policy.status,
        coverage_period: null
      } : null,
      validation,
      ocr_summary: null,
      coverage_analysis: {
        coverages: [],
        totalApproved: 0,
        totalRejected: input.total_medical_expense,
        breakdown: []
      },
      fraud_analysis: {
        score: 0,
        riskLevel: 'LOW',
        detectedPatterns: [],
        recommendation: 'AUTO_APPROVE'
      },
      review_result: {
        status: 'REJECTED',
        decision: validation.issues.join(', '),
        confidence_score: 100,
        auto_approved: false
      },
      payout_details: {
        total_claimed: input.total_medical_expense,
        total_approved: 0,
        total_rejected: input.total_medical_expense,
        breakdown: []
      },
      metadata: {
        processing_time_ms: Date.now() - startTime,
        reviewed_at: new Date().toISOString()
      }
    };
  }

  /**
   * 약관 조항 조회
   */
  async getPolicyTerms(productCode: string = 'PREMIUM_HEALTH'): Promise<PolicyTerm[]> {
    const result = await db.query(`
      SELECT id, term_code, article_number, clause_number, title, content,
             summary, calculation_formula, calculation_value, term_category, applies_to
      FROM policy_terms
      WHERE product_code = $1
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
      ORDER BY article_number, clause_number
    `, [productCode]);
    return result.rows;
  }

  /**
   * 특정 담보에 해당하는 약관 조항 찾기
   */
  findTermForCoverage(terms: PolicyTerm[], coverageCode: string, termCategory: string = 'COVERAGE'): PolicyTerm | null {
    const codeMapping: { [key: string]: string[] } = {
      'DIS_HOSP_INS': ['HOSP_INS'],
      'DIS_HOSP_UNINS': ['HOSP_UNINS'],
      'DIS_HOSP_DAILY': ['HOSP_DAILY'],
      'DIS_SURG_1': ['SURGERY'],
      'DIS_SURG_2': ['SURGERY'],
      'DIS_SURG_3': ['SURGERY'],
      'DIS_SURG_4': ['SURGERY'],
      'DIS_SURG_5': ['SURGERY'],
      'OUT_INS': ['OUT_INS'],
      'OUT_UNINS': ['OUT_UNINS']
    };

    const appliesTo = codeMapping[coverageCode] || [];
    return terms.find(t =>
      (t as any).term_category === termCategory &&
      appliesTo.some(code => ((t as any).applies_to || []).includes(code))
    ) || null;
  }

  /**
   * 다중 AI 모델로 심사 수행
   */
  async processWithMultipleModels(
    policyId: number,
    input: ClaimInput,
    validation: PolicyValidation,
    diagnosisInfo: any,
    surgeryInfo: any,
    terms: PolicyTerm[]
  ): Promise<AIModelResult[]> {
    // AI 모델 목록 조회
    const modelsResult = await db.query(`
      SELECT id, model_code, model_name, provider FROM ai_models WHERE is_active = TRUE ORDER BY is_default DESC
    `);
    const models = modelsResult.rows;

    const results: AIModelResult[] = [];

    for (const model of models) {
      const startTime = Date.now();

      // 모델별로 다른 파라미터/가중치 적용 (시뮬레이션)
      const modelVariation = this.getModelVariation(model.model_code);

      const coverageAnalysis = await this.analyzeCoverageWithTerms(
        policyId,
        input,
        validation,
        diagnosisInfo,
        surgeryInfo,
        terms,
        modelVariation
      );

      const recommendation = this.determineRecommendation(
        validation,
        coverageAnalysis,
        modelVariation.confidenceBase
      );

      results.push({
        modelId: model.id,
        modelCode: model.model_code,
        modelName: model.model_name,
        recommendation: recommendation.status,
        confidenceScore: recommendation.confidence,
        totalApproved: coverageAnalysis.totalApproved,
        totalRejected: coverageAnalysis.totalRejected,
        breakdown: coverageAnalysis.breakdown,
        reasoning: this.generateReasoning(model.model_code, coverageAnalysis, validation),
        responseTimeMs: Date.now() - startTime
      });
    }

    return results;
  }

  /**
   * 모델별 변동 파라미터 (시뮬레이션)
   */
  getModelVariation(modelCode: string): { deductibleVariation: number; confidenceBase: number; strictness: number } {
    const variations: { [key: string]: any } = {
      'gpt-4o': { deductibleVariation: 0, confidenceBase: 85, strictness: 1.0 },
      'gpt-4o-mini': { deductibleVariation: 0.02, confidenceBase: 78, strictness: 0.95 },
      'claude-3.5-sonnet': { deductibleVariation: -0.01, confidenceBase: 88, strictness: 1.05 },
      'claude-3-haiku': { deductibleVariation: 0.03, confidenceBase: 75, strictness: 0.9 },
      'gemini-1.5-pro': { deductibleVariation: 0.01, confidenceBase: 82, strictness: 1.0 }
    };
    return variations[modelCode] || { deductibleVariation: 0, confidenceBase: 80, strictness: 1.0 };
  }

  /**
   * 담보 분석 (약관 조항 포함)
   */
  async analyzeCoverageWithTerms(
    policyId: number,
    input: ClaimInput,
    validation: PolicyValidation,
    diagnosisInfo: any,
    surgeryInfo: any,
    terms: PolicyTerm[],
    modelVariation: { deductibleVariation: number; strictness: number }
  ): Promise<CoverageAnalysis> {
    // 담보 조회
    const coveragesResult = await db.query(`
      SELECT pc.*, ct.code as type_code, ct.category as coverage_category
      FROM policy_coverages pc
      JOIN coverage_types ct ON pc.coverage_type_id = ct.id
      WHERE pc.policy_id = $1 AND pc.is_active = TRUE
    `, [policyId]);

    const coverages = coveragesResult.rows;
    const breakdown: PayoutItem[] = [];
    let totalApproved = 0;
    let totalRejected = 0;

    // 입원의료비 (실손)
    if (input.claim_type === 'HOSPITALIZATION' || input.claim_type === 'SURGERY') {
      // 급여 부분
      const hospInsured = coverages.find((c: any) =>
        c.coverage_code === 'DIS_HOSP_INS' || c.type_code === 'REAL_LOSS_HOSP_INS'
      );

      if (hospInsured && input.insured_expense > 0) {
        const term = this.findTermForCoverage(terms, 'DIS_HOSP_INS');
        const result = this.calculateRealLossWithTerm(
          '질병입원의료비(급여)',
          Number(input.insured_expense) || 0,
          Number(hospInsured.deductible_amount) || 0,
          (Number(hospInsured.deductible_rate) || 0) * (1 + modelVariation.deductibleVariation),
          Number(hospInsured.payout_rate) || 100,
          validation.reductionRate,
          hospInsured.annual_limit ? Number(hospInsured.annual_limit) : null,
          Number(hospInsured.used_annual_amount) || 0,
          term
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }

      // 비급여 부분
      const hospUninsured = coverages.find((c: any) =>
        c.coverage_code === 'DIS_HOSP_UNINS' || c.type_code === 'REAL_LOSS_HOSP_UNINS'
      );

      if (hospUninsured && input.uninsured_expense > 0) {
        const term = this.findTermForCoverage(terms, 'DIS_HOSP_UNINS');
        const result = this.calculateRealLossWithTerm(
          '질병입원의료비(비급여)',
          Number(input.uninsured_expense) || 0,
          Number(hospUninsured.deductible_amount) || 0,
          (Number(hospUninsured.deductible_rate) || 0) * (1 + modelVariation.deductibleVariation),
          Number(hospUninsured.payout_rate) || 100,
          validation.reductionRate,
          hospUninsured.annual_limit ? Number(hospUninsured.annual_limit) : null,
          Number(hospUninsured.used_annual_amount) || 0,
          term
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }
    }

    // 입원일당 (정액)
    if (input.hospitalization_days && input.hospitalization_days > 0) {
      const hospDaily = coverages.find((c: any) =>
        c.coverage_code === 'DIS_HOSP_DAILY' || c.type_code === 'FIXED_HOSP_DAILY'
      );

      if (hospDaily) {
        const term = this.findTermForCoverage(terms, 'DIS_HOSP_DAILY');
        const result = this.calculateDailyBenefitWithTerm(
          '질병입원일당',
          Number(hospDaily.insured_amount) || 0,
          input.hospitalization_days,
          hospDaily.max_days || 180,
          hospDaily.used_days || 0,
          validation.reductionRate,
          term
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }
    }

    // 수술비 (정액)
    if (surgeryInfo && input.claim_type === 'SURGERY') {
      const surgeryClassification = surgeryInfo.classification;
      const surgeryCoverage = coverages.find((c: any) =>
        c.surgery_classification === surgeryClassification
      );

      if (surgeryCoverage) {
        const term = this.findTermForCoverage(terms, `DIS_SURG_${surgeryClassification}`);
        const result = this.calculateSurgeryBenefitWithTerm(
          `질병수술비(${surgeryClassification}종)`,
          Number(surgeryCoverage.insured_amount) || 0,
          surgeryInfo.name,
          surgeryClassification,
          validation.reductionRate,
          term
        );
        breakdown.push(result);
        totalApproved += Number(result.approvedAmount) || 0;
        totalRejected += Number(result.rejectedAmount) || 0;
      }
    }

    return {
      coverages: coverages.map((c: any) => ({
        id: c.id,
        name: c.coverage_name,
        code: c.coverage_code,
        type: c.coverage_category,
        insuredAmount: Number(c.insured_amount),
        deductibleAmount: Number(c.deductible_amount),
        deductibleRate: Number(c.deductible_rate),
        payoutRate: Number(c.payout_rate),
        maxDays: c.max_days,
        surgeryClassification: c.surgery_classification,
        annualLimit: c.annual_limit ? Number(c.annual_limit) : undefined,
        usedAnnualAmount: Number(c.used_annual_amount)
      })),
      totalApproved,
      totalRejected,
      breakdown
    };
  }

  /**
   * 실손의료비 계산 (약관 조항 포함)
   */
  calculateRealLossWithTerm(
    itemName: string,
    claimedAmount: number,
    deductibleAmount: number,
    deductibleRate: number,
    payoutRate: number,
    reductionRate: number,
    limit: number | null,
    usedAmount: number,
    term: PolicyTerm | null
  ): PayoutItem {
    const baseResult = this.calculateRealLoss(
      itemName, claimedAmount, deductibleAmount, deductibleRate,
      payoutRate, reductionRate, limit, usedAmount
    );

    if (term) {
      baseResult.termReference = {
        article: `${term.article_number}${term.clause_number ? ' ' + term.clause_number : ''}`,
        title: term.title,
        content: term.summary || term.content.substring(0, 200) + '...',
        formula: term.calculation_formula || baseResult.calculation
      };
    }

    return baseResult;
  }

  /**
   * 입원일당 계산 (약관 조항 포함)
   */
  calculateDailyBenefitWithTerm(
    itemName: string,
    dailyAmount: number,
    hospitalDays: number,
    maxDays: number,
    usedDays: number,
    reductionRate: number,
    term: PolicyTerm | null
  ): PayoutItem {
    const baseResult = this.calculateDailyBenefit(
      itemName, dailyAmount, hospitalDays, maxDays, usedDays, reductionRate
    );

    if (term) {
      baseResult.termReference = {
        article: `${term.article_number}${term.clause_number ? ' ' + term.clause_number : ''}`,
        title: term.title,
        content: term.summary || term.content.substring(0, 200) + '...',
        formula: term.calculation_formula || baseResult.calculation
      };
    }

    return baseResult;
  }

  /**
   * 수술비 계산 (약관 조항 포함)
   */
  calculateSurgeryBenefitWithTerm(
    itemName: string,
    insuredAmount: number,
    surgeryName: string,
    classification: number,
    reductionRate: number,
    term: PolicyTerm | null
  ): PayoutItem {
    const baseResult = this.calculateSurgeryBenefit(
      itemName, insuredAmount, surgeryName, reductionRate
    );

    if (term) {
      baseResult.termReference = {
        article: `${term.article_number}${term.clause_number ? ' ' + term.clause_number : ''}`,
        title: term.title,
        content: term.summary || `${classification}종 수술에 대해 ${insuredAmount.toLocaleString()}원 정액 지급`,
        formula: `${classification}종 수술 정액: ${insuredAmount.toLocaleString()}원`
      };
    }

    return baseResult;
  }

  /**
   * 추천 결정
   */
  determineRecommendation(
    validation: PolicyValidation,
    coverageAnalysis: CoverageAnalysis,
    confidenceBase: number
  ): { status: string; confidence: number } {
    if (validation.isInExemptionPeriod) {
      return { status: 'REJECT', confidence: 100 };
    }

    const approvalRatio = coverageAnalysis.totalApproved /
      (coverageAnalysis.totalApproved + coverageAnalysis.totalRejected || 1);

    if (approvalRatio > 0.8 && !validation.isInReductionPeriod) {
      return { status: 'AUTO_APPROVE', confidence: confidenceBase + 10 };
    } else if (approvalRatio > 0.5) {
      return { status: 'MANUAL_REVIEW', confidence: confidenceBase };
    } else {
      return { status: 'MANUAL_REVIEW', confidence: confidenceBase - 10 };
    }
  }

  /**
   * AI 모델별 추론 근거 생성
   */
  generateReasoning(modelCode: string, analysis: CoverageAnalysis, validation: PolicyValidation): string {
    const reasoningTemplates: { [key: string]: string } = {
      'gpt-4o': `본 청구건에 대한 분석 결과입니다.

[약관 검토]
- 계약상태: ${validation.isValid ? '유효' : '무효'}
- 면책기간: ${validation.isInExemptionPeriod ? '면책기간 내 (보장 불가)' : '경과'}
- 감액기간: ${validation.isInReductionPeriod ? `적용 (${validation.reductionRate}% 감액)` : '경과'}

[보장 분석]
${analysis.breakdown.map(b => `• ${b.item}: ${b.calculation}${b.termReference ? `\n  근거: ${b.termReference.article} ${b.termReference.title}` : ''}`).join('\n')}

[결론]
총 청구액 대비 ${((analysis.totalApproved / (analysis.totalApproved + analysis.totalRejected)) * 100).toFixed(1)}% 승인 가능합니다.`,

      'claude-3.5-sonnet': `청구 심사 결과를 단계별로 설명드립니다.

1. 약관 적용 검토
   ${validation.issues.length > 0 ? validation.issues.join(', ') : '특이사항 없음'}

2. 담보별 계산 상세
${analysis.breakdown.map(b => `   [${b.item}]
   - 계산: ${b.calculation}
   - 승인: ₩${b.approvedAmount.toLocaleString()}
   ${b.termReference ? `   - 약관근거: ${b.termReference.article} "${b.termReference.title}"` : ''}`).join('\n')}

3. 종합 판단
   승인액: ₩${analysis.totalApproved.toLocaleString()}
   불인정액: ₩${analysis.totalRejected.toLocaleString()}`,

      'gemini-1.5-pro': `[심사 요약]
✓ 계약 유효성: ${validation.isValid ? 'PASS' : 'FAIL'}
✓ 보장기간: ${!validation.isInExemptionPeriod ? 'PASS' : 'FAIL (면책)'}

[산출 내역]
${analysis.breakdown.map(b => `• ${b.item}
  ${b.calculation}
  ${b.rejectionReason ? `※ ${b.rejectionReason}` : ''}`).join('\n')}

[최종 금액] ₩${analysis.totalApproved.toLocaleString()}`
    };

    return reasoningTemplates[modelCode] || reasoningTemplates['gpt-4o'];
  }

  /**
   * AI 결과 저장
   */
  async saveAIResults(claimId: number, results: AIModelResult[]): Promise<void> {
    for (const result of results) {
      await db.query(`
        INSERT INTO claim_ai_results (
          claim_id, model_id, recommendation, confidence_score,
          total_approved_amount, total_rejected_amount,
          coverage_analysis, payout_breakdown, reasoning, response_time_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        claimId, result.modelId, result.recommendation, result.confidenceScore,
        result.totalApproved, result.totalRejected,
        JSON.stringify({ breakdown: result.breakdown }),
        JSON.stringify(result.breakdown),
        result.reasoning,
        result.responseTimeMs
      ]);
    }
  }

  /**
   * 청구번호 생성
   */
  generateClaimNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    return `CLM-${year}-${random}`;
  }
}

export const claimService = new ClaimService();
