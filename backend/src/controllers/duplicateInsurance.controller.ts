import { Request, Response, NextFunction } from 'express';
import { DuplicateInsuranceService } from '../services/duplicateInsurance.service';
import { AuditService } from '../middlewares/audit.middleware';
import { AuthUser } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: AuthUser;
}

export class DuplicateInsuranceController {
  /**
   * 중복보험 정보 추가
   * POST /api/duplicate-insurance
   */
  static async addOtherInsurance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const {
        claimId,
        insuranceCompany,
        policyNumber,
        productType,
        coverageType,
        coverageAmount,
        effectiveDate,
        expirationDate,
        contactInfo,
      } = req.body;

      if (!claimId || !insuranceCompany || !productType || !coverageType) {
        res.status(400).json({
          success: false,
          error: '청구 ID, 보험사명, 상품유형, 담보유형이 필요합니다.',
        });
        return;
      }

      const result = await DuplicateInsuranceService.addOtherInsuranceInfo(
        claimId,
        {
          insuranceCompany,
          policyNumber,
          productType,
          coverageType,
          coverageAmount,
          effectiveDate,
          expirationDate,
          contactInfo,
        },
        user.id
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DUPLICATE_INSURANCE_ADD',
          entityType: 'other_insurance_info',
          entityId: result.insuranceId!,
          newValue: { claimId, insuranceCompany, productType },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(201).json({
          success: true,
          data: {
            insuranceId: result.insuranceId,
          },
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
        });
      }
    } catch (error) {
      logger.error('Add other insurance error:', error);
      next(error);
    }
  }

  /**
   * 청구의 중복보험 정보 조회
   * GET /api/duplicate-insurance/claim/:claimId
   */
  static async getClaimInsurances(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const insurances = await DuplicateInsuranceService.getOtherInsurances(claimId);

      res.status(200).json({
        success: true,
        data: insurances,
        count: insurances.length,
      });
    } catch (error) {
      logger.error('Get claim insurances error:', error);
      next(error);
    }
  }

  /**
   * 실손보험 조회 요청 (시뮬레이션)
   * POST /api/duplicate-insurance/inquiry
   */
  static async requestRealLossInquiry(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { claimId, customerId, customerName, birthDate, treatmentStartDate, treatmentEndDate } = req.body;

      if (!claimId || !customerId || !customerName || !birthDate) {
        res.status(400).json({
          success: false,
          error: '청구 ID, 고객 ID, 고객명, 생년월일이 필요합니다.',
        });
        return;
      }

      const result = await DuplicateInsuranceService.requestRealLossInquiry(
        claimId,
        {
          customerId,
          customerName,
          birthDate,
          treatmentStartDate,
          treatmentEndDate,
        },
        user.id
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'REAL_LOSS_INQUIRY_REQUEST',
          entityType: 'real_loss_inquiry',
          entityId: claimId,
          newValue: { customerId, customerName },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(200).json({
          success: true,
          data: result.inquiryResults,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
        });
      }
    } catch (error) {
      logger.error('Request real loss inquiry error:', error);
      next(error);
    }
  }

  /**
   * 실손보험 조회 결과 조회
   * GET /api/duplicate-insurance/inquiry-results/:claimId
   */
  static async getInquiryResults(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const results = await DuplicateInsuranceService.getInquiryResults(claimId);

      res.status(200).json({
        success: true,
        data: results,
        count: results.length,
      });
    } catch (error) {
      logger.error('Get inquiry results error:', error);
      next(error);
    }
  }

  /**
   * 비례분담 계산
   * POST /api/duplicate-insurance/calculate
   */
  static async calculateProRataShare(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { claimId, totalClaimAmount, actualLoss } = req.body;

      if (!claimId || !totalClaimAmount) {
        res.status(400).json({
          success: false,
          error: '청구 ID와 총 청구금액이 필요합니다.',
        });
        return;
      }

      const result = await DuplicateInsuranceService.calculateProRataShare(
        claimId,
        totalClaimAmount,
        actualLoss || totalClaimAmount,
        user.id
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'PRORATA_CALCULATION',
          entityType: 'duplicate_insurance_calculation',
          entityId: result.calculationId!,
          newValue: { claimId, totalClaimAmount, ourShare: result.ourShare },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(200).json({
          success: true,
          data: {
            calculationId: result.calculationId,
            ourShare: result.ourShare,
            details: result.details,
          },
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
        });
      }
    } catch (error) {
      logger.error('Calculate pro-rata share error:', error);
      next(error);
    }
  }

  /**
   * 비례분담 계산 결과 조회
   * GET /api/duplicate-insurance/calculation/:claimId
   */
  static async getCalculation(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const calculation = await DuplicateInsuranceService.getCalculation(claimId);

      if (calculation) {
        res.status(200).json({
          success: true,
          data: calculation,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '비례분담 계산 결과가 없습니다.',
        });
      }
    } catch (error) {
      logger.error('Get calculation error:', error);
      next(error);
    }
  }

  /**
   * 중복보험 정보 수정
   * PUT /api/duplicate-insurance/:insuranceId
   */
  static async updateOtherInsurance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const insuranceId = parseInt(req.params.insuranceId);
      const updateData = req.body;

      const result = await DuplicateInsuranceService.updateOtherInsurance(insuranceId, updateData, user.id);

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DUPLICATE_INSURANCE_UPDATE',
          entityType: 'other_insurance_info',
          entityId: insuranceId,
          newValue: updateData,
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(200).json({
          success: true,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
        });
      }
    } catch (error) {
      logger.error('Update other insurance error:', error);
      next(error);
    }
  }

  /**
   * 중복보험 정보 삭제
   * DELETE /api/duplicate-insurance/:insuranceId
   */
  static async deleteOtherInsurance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const insuranceId = parseInt(req.params.insuranceId);

      const result = await DuplicateInsuranceService.deleteOtherInsurance(insuranceId, user.id);

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DUPLICATE_INSURANCE_DELETE',
          entityType: 'other_insurance_info',
          entityId: insuranceId,
          newValue: { deleted: true },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(200).json({
          success: true,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
        });
      }
    } catch (error) {
      logger.error('Delete other insurance error:', error);
      next(error);
    }
  }

  /**
   * 중복보험 요약 정보 조회
   * GET /api/duplicate-insurance/summary/:claimId
   */
  static async getDuplicateSummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const summary = await DuplicateInsuranceService.getDuplicateSummary(claimId);

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      logger.error('Get duplicate summary error:', error);
      next(error);
    }
  }
}
