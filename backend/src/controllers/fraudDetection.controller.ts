import { Request, Response, NextFunction } from 'express';
import { FraudDetectionService } from '../services/fraudDetection.service';
import { AuditService } from '../middlewares/audit.middleware';
import { AuthUser } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: AuthUser;
}

export class FraudDetectionController {
  /**
   * 청구에 대한 종합 사기 분석
   * POST /api/fraud/analyze/:claimId
   */
  static async analyzeClaim(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const claimId = parseInt(req.params.claimId);

      const result = await FraudDetectionService.analyzeClaimForFraud(claimId);

      // 민감 데이터 접근 로그 (사기 분석은 민감한 작업)
      await AuditService.logSensitiveAccess({
        userId: user.id,
        userCode: user.userCode,
        userName: user.name,
        dataType: 'fraud_analysis',
        entityType: 'claim',
        entityId: claimId,
        accessReason: 'Fraud analysis request',
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Analyze claim fraud error:', error);
      next(error);
    }
  }

  /**
   * 고객 패턴 분석
   * GET /api/fraud/customer-pattern/:customerId
   */
  static async getCustomerPattern(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const customerId = parseInt(req.params.customerId);

      const pattern = await FraudDetectionService.getCustomerClaimPattern(customerId);

      // 민감 데이터 접근 로그
      await AuditService.logSensitiveAccess({
        userId: user.id,
        userCode: user.userCode,
        userName: user.name,
        dataType: 'customer_claim_pattern',
        entityType: 'customer',
        entityId: customerId,
        accessReason: 'Customer pattern analysis',
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      if (pattern) {
        res.status(200).json({
          success: true,
          data: pattern,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '고객 패턴 정보를 찾을 수 없습니다.',
        });
      }
    } catch (error) {
      logger.error('Get customer pattern error:', error);
      next(error);
    }
  }

  /**
   * 병원 네트워크 분석
   * GET /api/fraud/hospital-network/:hospitalId
   */
  static async getHospitalNetwork(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const hospitalId = parseInt(req.params.hospitalId);

      const network = await FraudDetectionService.getHospitalPatientNetwork(hospitalId);

      // 민감 데이터 접근 로그
      await AuditService.logSensitiveAccess({
        userId: user.id,
        userCode: user.userCode,
        userName: user.name,
        dataType: 'hospital_patient_network',
        entityType: 'hospital',
        entityId: hospitalId,
        accessReason: 'Hospital network analysis',
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      if (network) {
        res.status(200).json({
          success: true,
          data: network,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '병원 네트워크 정보를 찾을 수 없습니다.',
        });
      }
    } catch (error) {
      logger.error('Get hospital network error:', error);
      next(error);
    }
  }

  /**
   * 고위험 청구 목록 조회
   * GET /api/fraud/high-risk-claims
   */
  static async getHighRiskClaims(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { minScore, limit, offset } = req.query;

      const claims = await FraudDetectionService.getHighRiskClaims(
        parseFloat(minScore as string) || 70,
        parseInt(limit as string) || 50,
        parseInt(offset as string) || 0
      );

      res.status(200).json({
        success: true,
        data: claims,
        count: claims.length,
      });
    } catch (error) {
      logger.error('Get high risk claims error:', error);
      next(error);
    }
  }

  /**
   * 사기 지표 업데이트
   * PUT /api/fraud/indicators/:claimId
   */
  static async updateFraudIndicators(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const claimId = parseInt(req.params.claimId);
      const { indicators, notes } = req.body;

      const result = await FraudDetectionService.updateFraudIndicators(claimId, indicators, user.id, notes);

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'FRAUD_INDICATOR_UPDATE',
          entityType: 'claim',
          entityId: claimId,
          newValue: { indicators, notes },
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
      logger.error('Update fraud indicators error:', error);
      next(error);
    }
  }

  /**
   * SIU 조사 의뢰
   * POST /api/fraud/siu-referral/:claimId
   */
  static async referToSIU(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const claimId = parseInt(req.params.claimId);
      const { reason, priority, additionalInfo } = req.body;

      if (!reason) {
        res.status(400).json({
          success: false,
          error: '조사 의뢰 사유가 필요합니다.',
        });
        return;
      }

      const result = await FraudDetectionService.referToSIU(claimId, user.id, reason, priority, additionalInfo);

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'SIU_REFERRAL',
          entityType: 'claim',
          entityId: claimId,
          newValue: { reason, priority, referralId: result.referralId },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(201).json({
          success: true,
          data: {
            referralId: result.referralId,
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
      logger.error('Refer to SIU error:', error);
      next(error);
    }
  }

  /**
   * 사기 탐지 통계
   * GET /api/fraud/stats
   */
  static async getFraudStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = req.query;

      const stats = await FraudDetectionService.getFraudStats(
        startDate as string,
        endDate as string
      );

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Get fraud stats error:', error);
      next(error);
    }
  }

  /**
   * 사기 패턴 트렌드 분석
   * GET /api/fraud/trends
   */
  static async getFraudTrends(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { period, groupBy } = req.query;

      const trends = await FraudDetectionService.getFraudTrends(
        period as string || '30d',
        groupBy as string || 'day'
      );

      res.status(200).json({
        success: true,
        data: trends,
      });
    } catch (error) {
      logger.error('Get fraud trends error:', error);
      next(error);
    }
  }
}
