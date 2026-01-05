import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../middlewares/audit.middleware';
import { AuthUser } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: AuthUser;
}

export class AuditController {
  /**
   * 감사 로그 조회
   * GET /api/audit/logs
   */
  static async getAuditLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        userId,
        action,
        entityType,
        entityId,
        startDate,
        endDate,
        isSuccess,
        page,
        limit,
      } = req.query;

      const filters: {
        userId?: number;
        action?: string;
        entityType?: string;
        entityId?: number;
        startDate?: string;
        endDate?: string;
        isSuccess?: boolean;
        page?: number;
        limit?: number;
      } = {};

      if (userId) filters.userId = parseInt(userId as string);
      if (action) filters.action = action as string;
      if (entityType) filters.entityType = entityType as string;
      if (entityId) filters.entityId = parseInt(entityId as string);
      if (startDate) filters.startDate = startDate as string;
      if (endDate) filters.endDate = endDate as string;
      if (isSuccess !== undefined) filters.isSuccess = isSuccess === 'true';
      filters.page = parseInt(page as string) || 1;
      filters.limit = parseInt(limit as string) || 50;

      const result = await AuditService.getAuditLogs(filters);

      res.status(200).json({
        success: true,
        data: result.logs,
        pagination: {
          total: result.total,
          page: filters.page,
          limit: filters.limit,
          totalPages: Math.ceil(result.total / filters.limit),
        },
      });
    } catch (error) {
      logger.error('Get audit logs error:', error);
      next(error);
    }
  }

  /**
   * 특정 엔티티의 감사 이력 조회
   * GET /api/audit/entity/:entityType/:entityId
   */
  static async getEntityAuditHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { entityType, entityId } = req.params;
      const { page, limit } = req.query;

      const result = await AuditService.getAuditLogs({
        entityType,
        entityId: parseInt(entityId),
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 50,
      });

      res.status(200).json({
        success: true,
        data: result.logs,
        pagination: {
          total: result.total,
          page: parseInt(page as string) || 1,
          limit: parseInt(limit as string) || 50,
          totalPages: Math.ceil(result.total / (parseInt(limit as string) || 50)),
        },
      });
    } catch (error) {
      logger.error('Get entity audit history error:', error);
      next(error);
    }
  }

  /**
   * 민감 데이터 접근 로그 조회
   * GET /api/audit/sensitive-access
   */
  static async getSensitiveAccessLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        userId,
        dataType,
        entityType,
        startDate,
        endDate,
        page,
        limit,
      } = req.query;

      const result = await AuditService.getSensitiveAccessLogs({
        userId: userId ? parseInt(userId as string) : undefined,
        dataType: dataType as string,
        entityType: entityType as string,
        startDate: startDate as string,
        endDate: endDate as string,
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 50,
      });

      res.status(200).json({
        success: true,
        data: result.logs,
        pagination: {
          total: result.total,
          page: parseInt(page as string) || 1,
          limit: parseInt(limit as string) || 50,
          totalPages: Math.ceil(result.total / (parseInt(limit as string) || 50)),
        },
      });
    } catch (error) {
      logger.error('Get sensitive access logs error:', error);
      next(error);
    }
  }

  /**
   * 사용자별 활동 요약
   * GET /api/audit/user-activity/:userId
   */
  static async getUserActivitySummary(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = parseInt(req.params.userId);
      const { startDate, endDate } = req.query;

      const summary = await AuditService.getUserActivitySummary(
        userId,
        startDate as string,
        endDate as string
      );

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      logger.error('Get user activity summary error:', error);
      next(error);
    }
  }

  /**
   * 감사 통계
   * GET /api/audit/stats
   */
  static async getAuditStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate, groupBy } = req.query;

      const stats = await AuditService.getAuditStats(
        startDate as string,
        endDate as string,
        groupBy as string || 'day'
      );

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Get audit stats error:', error);
      next(error);
    }
  }

  /**
   * 이상 행동 탐지 (비정상적인 패턴)
   * GET /api/audit/anomalies
   */
  static async getAnomalies(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { period, threshold } = req.query;

      const anomalies = await AuditService.detectAnomalies(
        period as string || '24h',
        parseFloat(threshold as string) || 3.0
      );

      res.status(200).json({
        success: true,
        data: anomalies,
      });
    } catch (error) {
      logger.error('Get anomalies error:', error);
      next(error);
    }
  }

  /**
   * 로그인 이력 조회
   * GET /api/audit/login-history
   */
  static async getLoginHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        userId,
        startDate,
        endDate,
        includeFailures,
        page,
        limit,
      } = req.query;

      const result = await AuditService.getLoginHistory({
        userId: userId ? parseInt(userId as string) : undefined,
        startDate: startDate as string,
        endDate: endDate as string,
        includeFailures: includeFailures === 'true',
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 50,
      });

      res.status(200).json({
        success: true,
        data: result.logs,
        pagination: {
          total: result.total,
          page: parseInt(page as string) || 1,
          limit: parseInt(limit as string) || 50,
          totalPages: Math.ceil(result.total / (parseInt(limit as string) || 50)),
        },
      });
    } catch (error) {
      logger.error('Get login history error:', error);
      next(error);
    }
  }

  /**
   * 청구 변경 이력 조회
   * GET /api/audit/claim-history/:claimId
   */
  static async getClaimHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const result = await AuditService.getAuditLogs({
        entityType: 'claim',
        entityId: claimId,
        page: 1,
        limit: 100,
      });

      res.status(200).json({
        success: true,
        data: result.logs,
        count: result.total,
      });
    } catch (error) {
      logger.error('Get claim history error:', error);
      next(error);
    }
  }

  /**
   * 감사 로그 내보내기 (금감원 보고용)
   * GET /api/audit/export
   */
  static async exportAuditLogs(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { startDate, endDate, format } = req.query;

      if (!startDate || !endDate) {
        res.status(400).json({
          success: false,
          error: '조회 기간(startDate, endDate)이 필요합니다.',
        });
        return;
      }

      // 감사 로그 내보내기 자체도 로깅
      await AuditService.log({
        userId: user.id,
        userCode: user.userCode,
        userName: user.name,
        action: 'AUDIT_LOG_EXPORT',
        entityType: 'audit_log',
        entityId: 0,
        newValue: { startDate, endDate, format },
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        isSuccess: true,
      });

      const result = await AuditService.exportAuditLogs(
        startDate as string,
        endDate as string,
        format as string || 'json'
      );

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=audit_logs_${startDate}_${endDate}.csv`);
        res.send(result.data);
      } else {
        res.status(200).json({
          success: true,
          data: result.data,
          count: result.count,
        });
      }
    } catch (error) {
      logger.error('Export audit logs error:', error);
      next(error);
    }
  }
}
