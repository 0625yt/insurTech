import { Request, Response, NextFunction } from 'express';
import { ApprovalService, ApprovalAction } from '../services/approval.service';
import { AuditService } from '../middlewares/audit.middleware';
import { AuthUser } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: AuthUser;
}

export class ApprovalController {
  /**
   * 결재 프로세스 시작
   * POST /api/approvals/start
   */
  static async startApproval(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { claimId, urgency, notes } = req.body;

      if (!claimId) {
        res.status(400).json({
          success: false,
          error: '청구 ID가 필요합니다.',
        });
        return;
      }

      const result = await ApprovalService.startApprovalProcess(
        claimId,
        user.id,
        urgency || 'NORMAL',
        notes
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'APPROVAL_START',
          entityType: 'claim_approval',
          entityId: claimId,
          newValue: { approvalId: result.approvalId, urgency },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(201).json({
          success: true,
          data: {
            approvalId: result.approvalId,
            nextApproverName: result.nextApproverName,
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
      logger.error('Start approval error:', error);
      next(error);
    }
  }

  /**
   * 결재 처리 (승인/반려/보류 등)
   * POST /api/approvals/:approvalId/process
   */
  static async processApproval(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const approvalId = parseInt(req.params.approvalId);
      const { action, comments, adjustedAmount, delegateTo } = req.body;

      if (!action || !Object.values(ApprovalAction).includes(action)) {
        res.status(400).json({
          success: false,
          error: '유효한 결재 액션을 지정해주세요. (APPROVE, REJECT, RETURN, HOLD, DELEGATE, SKIP)',
        });
        return;
      }

      const result = await ApprovalService.processApproval(
        approvalId,
        user.id,
        action as ApprovalAction,
        comments,
        adjustedAmount,
        delegateTo
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: `APPROVAL_${action}`,
          entityType: 'claim_approval',
          entityId: approvalId,
          newValue: { action, comments, adjustedAmount, delegateTo },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(200).json({
          success: true,
          data: {
            isComplete: result.isComplete,
            finalStatus: result.finalStatus,
            nextApproverName: result.nextApproverName,
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
      logger.error('Process approval error:', error);
      next(error);
    }
  }

  /**
   * 내 결재함 조회
   * GET /api/approvals/inbox
   */
  static async getMyInbox(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { status, urgency, page, limit } = req.query;

      const filters: {
        status?: string;
        urgency?: string;
        page?: number;
        limit?: number;
      } = {};

      if (status) filters.status = status as string;
      if (urgency) filters.urgency = urgency as string;
      filters.page = parseInt(page as string) || 1;
      filters.limit = parseInt(limit as string) || 20;

      const result = await ApprovalService.getApprovalInbox(user.id, filters);

      res.status(200).json({
        success: true,
        data: result.items,
        pagination: {
          total: result.total,
          page: filters.page,
          limit: filters.limit,
          totalPages: Math.ceil(result.total / filters.limit),
        },
      });
    } catch (error) {
      logger.error('Get inbox error:', error);
      next(error);
    }
  }

  /**
   * 청구 결재 상태 조회
   * GET /api/approvals/claim/:claimId
   */
  static async getClaimApprovalStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const result = await ApprovalService.getApprovalStatus(claimId);

      if (result) {
        res.status(200).json({
          success: true,
          data: result,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '결재 정보를 찾을 수 없습니다.',
        });
      }
    } catch (error) {
      logger.error('Get claim approval status error:', error);
      next(error);
    }
  }

  /**
   * 결재 이력 조회
   * GET /api/approvals/:approvalId/history
   */
  static async getApprovalHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const approvalId = parseInt(req.params.approvalId);

      const history = await ApprovalService.getApprovalHistory(approvalId);

      res.status(200).json({
        success: true,
        data: history,
        count: history.length,
      });
    } catch (error) {
      logger.error('Get approval history error:', error);
      next(error);
    }
  }

  /**
   * 결재 라인 템플릿 목록 조회
   * GET /api/approvals/templates
   */
  static async getApprovalTemplates(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const templates = await ApprovalService.getApprovalTemplates();

      res.status(200).json({
        success: true,
        data: templates,
        count: templates.length,
      });
    } catch (error) {
      logger.error('Get approval templates error:', error);
      next(error);
    }
  }

  /**
   * 결재 통계 조회
   * GET /api/approvals/stats
   */
  static async getApprovalStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { startDate, endDate } = req.query;

      const stats = await ApprovalService.getApprovalStats(
        user.id,
        startDate as string,
        endDate as string
      );

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error('Get approval stats error:', error);
      next(error);
    }
  }

  /**
   * 대기 중인 결재 건수 조회
   * GET /api/approvals/pending-count
   */
  static async getPendingCount(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;

      const count = await ApprovalService.getPendingApprovalCount(user.id);

      res.status(200).json({
        success: true,
        data: {
          pendingCount: count,
        },
      });
    } catch (error) {
      logger.error('Get pending count error:', error);
      next(error);
    }
  }
}
