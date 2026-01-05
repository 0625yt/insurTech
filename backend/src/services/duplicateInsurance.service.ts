import { db } from '../database/connection';
import { logger } from '../utils/logger';
import { AuthUser } from '../middlewares/auth.middleware';
import { AuditService } from '../middlewares/audit.middleware';

// 중복 유형
export enum DuplicateType {
  FULL = 'FULL',         // 전액 중복
  PARTIAL = 'PARTIAL',   // 일부 중복
  NONE = 'NONE',         // 중복 없음
}

// 분담 방식
export enum CalculationMethod {
  PRO_RATA = 'PRO_RATA',     // 비례분담 (각사 한도 비율)
  EXCESS = 'EXCESS',         // 초과분담 (선순위-후순위)
  PRIMARY = 'PRIMARY',       // 우선분담 (1사 전액, 나머지 잔액)
}

export class DuplicateInsuranceService {
  // 고객의 타사 보험 정보 조회
  static async getOtherInsuranceInfo(customerId: number): Promise<any[]> {
    const result = await db.query(`
      SELECT * FROM other_insurance_info
      WHERE customer_id = $1 AND is_active = TRUE
      ORDER BY insurance_company
    `, [customerId]);

    return result.rows;
  }

  // 타사 보험 정보 등록/수정
  static async upsertOtherInsuranceInfo(
    customerId: number,
    insuranceInfo: {
      insuranceCompany: string;
      policyNumber?: string;
      productType: string;
      productName?: string;
      coverageTypes?: string[];
      coverageStartDate?: Date;
      coverageEndDate?: Date;
      source: string;
    },
    user?: AuthUser
  ): Promise<{ success: boolean; id?: number; error?: string }> {
    try {
      // 기존 동일 보험 확인
      const existingResult = await db.query(`
        SELECT id FROM other_insurance_info
        WHERE customer_id = $1 AND insurance_company = $2 AND is_active = TRUE
      `, [customerId, insuranceInfo.insuranceCompany]);

      let id: number;

      if (existingResult.rows.length > 0) {
        // 업데이트
        id = existingResult.rows[0].id;
        await db.query(`
          UPDATE other_insurance_info SET
            policy_number = COALESCE($1, policy_number),
            product_type = $2,
            product_name = COALESCE($3, product_name),
            coverage_types = COALESCE($4, coverage_types),
            coverage_start_date = COALESCE($5, coverage_start_date),
            coverage_end_date = COALESCE($6, coverage_end_date),
            source = $7,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $8
        `, [
          insuranceInfo.policyNumber,
          insuranceInfo.productType,
          insuranceInfo.productName,
          insuranceInfo.coverageTypes,
          insuranceInfo.coverageStartDate,
          insuranceInfo.coverageEndDate,
          insuranceInfo.source,
          id,
        ]);
      } else {
        // 신규 등록
        const insertResult = await db.query(`
          INSERT INTO other_insurance_info (
            customer_id, insurance_company, policy_number, product_type, product_name,
            coverage_types, coverage_start_date, coverage_end_date, source
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [
          customerId,
          insuranceInfo.insuranceCompany,
          insuranceInfo.policyNumber || null,
          insuranceInfo.productType,
          insuranceInfo.productName || null,
          insuranceInfo.coverageTypes || null,
          insuranceInfo.coverageStartDate || null,
          insuranceInfo.coverageEndDate || null,
          insuranceInfo.source,
        ]);
        id = insertResult.rows[0].id;
      }

      // 감사 로그
      await AuditService.log({
        entityType: 'OTHER_INSURANCE',
        entityId: id,
        action: existingResult.rows.length > 0 ? 'UPDATE' : 'CREATE',
        additionalInfo: {
          customerId,
          insuranceCompany: insuranceInfo.insuranceCompany,
        },
      }, user);

      return { success: true, id };
    } catch (error) {
      logger.error('Upsert other insurance info error:', error);
      return { success: false, error: '타사 보험 정보 등록 중 오류가 발생했습니다.' };
    }
  }

  // 실손 조회 (시뮬레이션 - 실제로는 손해보험협회 API 연동)
  static async inquireRealLossClaims(
    claimId: number,
    user?: AuthUser
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 청구 정보 조회
      const claimResult = await client.query(`
        SELECT c.*, cu.name as customer_name, cu.birth_date
        FROM claims c
        JOIN customers cu ON c.customer_id = cu.id
        WHERE c.id = $1
      `, [claimId]);

      if (claimResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: '청구를 찾을 수 없습니다.' };
      }

      const claim = claimResult.rows[0];

      // 고객의 타사 보험 조회
      const otherInsuranceResult = await client.query(`
        SELECT * FROM other_insurance_info
        WHERE customer_id = $1 AND is_active = TRUE AND product_type = 'REAL_LOSS'
      `, [claim.customer_id]);

      // 시뮬레이션: 타사 청구 내역 생성
      // 실제로는 손해보험협회 API를 통해 조회
      const otherClaims: any[] = [];
      let totalOtherPaid = 0;

      for (const insurance of otherInsuranceResult.rows) {
        // 동일 치료건에 대한 타사 지급 내역 (시뮬레이션)
        // 실제로는 치료일자, 병원, 진단코드로 매칭
        const hasMatchingClaim = Math.random() > 0.5; // 50% 확률로 중복 발생

        if (hasMatchingClaim) {
          const paidAmount = Math.round(claim.total_claimed_amount * (Math.random() * 0.5));
          otherClaims.push({
            company: insurance.insurance_company,
            claimDate: new Date().toISOString(),
            treatmentDate: claim.treatment_start_date,
            paidAmount,
            status: 'PAID',
          });
          totalOtherPaid += paidAmount;
        }
      }

      // 중복 유형 판정
      let duplicateType = DuplicateType.NONE;
      if (totalOtherPaid >= claim.total_claimed_amount) {
        duplicateType = DuplicateType.FULL;
      } else if (totalOtherPaid > 0) {
        duplicateType = DuplicateType.PARTIAL;
      }

      // 비례분담 계산 (당사 분담률)
      const totalLimit = claim.total_claimed_amount * (otherInsuranceResult.rows.length + 1);
      const ourShareRate = totalLimit > 0 ? claim.total_claimed_amount / totalLimit : 1;
      const calculatedOurAmount = Math.round(claim.total_claimed_amount * ourShareRate);

      // 조회 결과 저장
      const inquiryResult = await client.query(`
        INSERT INTO real_loss_inquiry_results (
          claim_id, customer_id, inquiry_reference,
          other_claims, total_other_paid,
          is_duplicate, duplicate_type,
          our_share_rate, calculated_our_amount,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'COMPLETED')
        RETURNING id
      `, [
        claimId,
        claim.customer_id,
        `INQ-${Date.now()}`,
        JSON.stringify(otherClaims),
        totalOtherPaid,
        duplicateType !== DuplicateType.NONE,
        duplicateType,
        ourShareRate,
        calculatedOurAmount,
      ]);

      // 청구 업데이트
      await client.query(`
        UPDATE claims SET
          has_other_insurance = $1,
          duplicate_insurance_checked = TRUE,
          is_duplicate = $2
        WHERE id = $3
      `, [
        otherInsuranceResult.rows.length > 0,
        duplicateType !== DuplicateType.NONE,
        claimId,
      ]);

      // 감사 로그
      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        action: 'DUPLICATE_INQUIRY',
        additionalInfo: {
          otherCompanies: otherInsuranceResult.rows.map((r: any) => r.insurance_company),
          duplicateType,
          totalOtherPaid,
        },
      }, user);

      await client.query('COMMIT');

      return {
        success: true,
        data: {
          inquiryId: inquiryResult.rows[0].id,
          otherInsurance: otherInsuranceResult.rows,
          otherClaims,
          totalOtherPaid,
          duplicateType,
          ourShareRate,
          calculatedOurAmount,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Inquire real loss claims error:', error);
      return { success: false, error: '실손 조회 중 오류가 발생했습니다.' };
    } finally {
      client.release();
    }
  }

  // 비례분담 계산
  static async calculateProRataShare(
    claimId: number,
    companies: { company: string; policyLimit: number }[],
    user?: AuthUser
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // 청구 조회
      const claimResult = await db.query(
        'SELECT * FROM claims WHERE id = $1',
        [claimId]
      );

      if (claimResult.rows.length === 0) {
        return { success: false, error: '청구를 찾을 수 없습니다.' };
      }

      const claim = claimResult.rows[0];
      const totalMedicalExpense = claim.total_medical_expense || claim.total_claimed_amount;

      // 총 한도 합계
      const totalCoverageLimit = companies.reduce((sum, c) => sum + c.policyLimit, 0);

      // 각사 분담액 계산
      const companiesWithShare = companies.map(c => ({
        ...c,
        shareRate: c.policyLimit / totalCoverageLimit,
        shareAmount: Math.round(totalMedicalExpense * (c.policyLimit / totalCoverageLimit)),
      }));

      // 당사 찾기 (첫 번째가 당사라고 가정)
      const ourShare = companiesWithShare[0];

      // 저장
      const inquiryResult = await db.query(
        'SELECT id FROM real_loss_inquiry_results WHERE claim_id = $1 ORDER BY id DESC LIMIT 1',
        [claimId]
      );

      const inquiryId = inquiryResult.rows[0]?.id || null;

      await db.query(`
        INSERT INTO duplicate_insurance_calculations (
          claim_id, inquiry_result_id, calculation_method,
          companies, total_companies,
          total_medical_expense, total_coverage_limit,
          our_share_rate, our_share_amount, final_payout_amount,
          calculation_formula, calculation_detail
        ) VALUES ($1, $2, 'PRO_RATA', $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        claimId,
        inquiryId,
        JSON.stringify(companiesWithShare),
        companies.length,
        totalMedicalExpense,
        totalCoverageLimit,
        ourShare.shareRate,
        ourShare.shareAmount,
        ourShare.shareAmount,
        `당사 지급액 = 총 의료비 ${totalMedicalExpense.toLocaleString()} × (당사 한도 ${ourShare.policyLimit.toLocaleString()} / 총 한도 ${totalCoverageLimit.toLocaleString()}) = ${ourShare.shareAmount.toLocaleString()}원`,
        JSON.stringify({
          method: 'PRO_RATA',
          formula: 'our_amount = total_expense × (our_limit / total_limit)',
          steps: companiesWithShare,
        }),
      ]);

      // 감사 로그
      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        action: 'DUPLICATE_CALCULATION',
        additionalInfo: {
          method: 'PRO_RATA',
          companies: companies.length,
          ourShareAmount: ourShare.shareAmount,
        },
      }, user);

      return {
        success: true,
        data: {
          method: 'PRO_RATA',
          totalMedicalExpense,
          totalCoverageLimit,
          companies: companiesWithShare,
          ourShare,
          formula: `총 의료비 × (당사 한도 / 총 한도합)`,
        },
      };
    } catch (error) {
      logger.error('Calculate pro rata share error:', error);
      return { success: false, error: '분담금 계산 중 오류가 발생했습니다.' };
    }
  }

  // 중복보험 조회 결과 조회
  static async getDuplicateInsuranceResults(claimId: number): Promise<any> {
    const inquiryResult = await db.query(`
      SELECT * FROM real_loss_inquiry_results
      WHERE claim_id = $1
      ORDER BY inquiry_date DESC
      LIMIT 1
    `, [claimId]);

    const calculationResult = await db.query(`
      SELECT * FROM duplicate_insurance_calculations
      WHERE claim_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [claimId]);

    return {
      inquiry: inquiryResult.rows[0] || null,
      calculation: calculationResult.rows[0] || null,
    };
  }

  // 중복보험 수동 입력
  static async manualDuplicateEntry(
    claimId: number,
    data: {
      hasOtherInsurance: boolean;
      otherPaidAmount?: number;
      otherCompanies?: { company: string; amount: number }[];
    },
    user: AuthUser
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const totalOtherPaid = data.otherPaidAmount ||
        (data.otherCompanies?.reduce((sum, c) => sum + c.amount, 0) || 0);

      // 청구 조회
      const claimResult = await db.query(
        'SELECT total_claimed_amount FROM claims WHERE id = $1',
        [claimId]
      );

      if (claimResult.rows.length === 0) {
        return { success: false, error: '청구를 찾을 수 없습니다.' };
      }

      const totalClaimed = claimResult.rows[0].total_claimed_amount;

      // 중복 유형 판정
      let duplicateType = DuplicateType.NONE;
      if (!data.hasOtherInsurance) {
        duplicateType = DuplicateType.NONE;
      } else if (totalOtherPaid >= totalClaimed) {
        duplicateType = DuplicateType.FULL;
      } else if (totalOtherPaid > 0) {
        duplicateType = DuplicateType.PARTIAL;
      }

      // 조회 결과 저장
      await db.query(`
        INSERT INTO real_loss_inquiry_results (
          claim_id, customer_id, inquiry_reference,
          other_claims, total_other_paid,
          is_duplicate, duplicate_type,
          status
        )
        SELECT
          $1, customer_id, $2, $3, $4, $5, $6, 'COMPLETED'
        FROM claims WHERE id = $1
      `, [
        claimId,
        `MANUAL-${Date.now()}`,
        JSON.stringify(data.otherCompanies || []),
        totalOtherPaid,
        duplicateType !== DuplicateType.NONE,
        duplicateType,
      ]);

      // 청구 업데이트
      await db.query(`
        UPDATE claims SET
          has_other_insurance = $1,
          duplicate_insurance_checked = TRUE,
          is_duplicate = $2
        WHERE id = $3
      `, [data.hasOtherInsurance, duplicateType !== DuplicateType.NONE, claimId]);

      // 감사 로그
      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        action: 'DUPLICATE_MANUAL_ENTRY',
        additionalInfo: {
          hasOtherInsurance: data.hasOtherInsurance,
          totalOtherPaid,
          duplicateType,
        },
      }, user);

      return { success: true };
    } catch (error) {
      logger.error('Manual duplicate entry error:', error);
      return { success: false, error: '중복보험 정보 입력 중 오류가 발생했습니다.' };
    }
  }
}
