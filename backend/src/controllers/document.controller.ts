import { Request, Response, NextFunction } from 'express';
import { DocumentService } from '../services/document.service';
import { AuditService } from '../middlewares/audit.middleware';
import { AuthUser } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

interface AuthRequest extends Request {
  user?: AuthUser;
}

export class DocumentController {
  /**
   * 청구에 대한 서류 체크리스트 생성
   * POST /api/documents/checklist
   */
  static async createChecklist(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { claimId, productType, claimType } = req.body;

      if (!claimId || !productType || !claimType) {
        res.status(400).json({
          success: false,
          error: '청구 ID, 상품 유형, 청구 유형이 필요합니다.',
        });
        return;
      }

      const result = await DocumentService.createChecklist(claimId, productType, claimType);

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DOCUMENT_CHECKLIST_CREATE',
          entityType: 'document_checklist',
          entityId: claimId,
          newValue: { productType, claimType, itemCount: result.items?.length },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(201).json({
          success: true,
          data: result.items,
          message: result.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.message,
        });
      }
    } catch (error) {
      logger.error('Create checklist error:', error);
      next(error);
    }
  }

  /**
   * 서류 체크리스트 조회
   * GET /api/documents/checklist/:claimId
   */
  static async getChecklist(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const checklist = await DocumentService.getChecklist(claimId);

      res.status(200).json({
        success: true,
        data: checklist,
        count: checklist.length,
      });
    } catch (error) {
      logger.error('Get checklist error:', error);
      next(error);
    }
  }

  /**
   * 서류 제출 처리
   * POST /api/documents/submit
   */
  static async submitDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { checklistId, fileName, filePath, fileSize, mimeType, ocrResult, extractedData } = req.body;

      if (!checklistId || !fileName || !filePath) {
        res.status(400).json({
          success: false,
          error: '체크리스트 ID, 파일명, 파일 경로가 필요합니다.',
        });
        return;
      }

      const result = await DocumentService.submitDocument(
        checklistId,
        {
          fileName,
          filePath,
          fileSize,
          mimeType,
        },
        user.id,
        ocrResult,
        extractedData
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DOCUMENT_SUBMIT',
          entityType: 'document_verification',
          entityId: result.verificationId!,
          newValue: { checklistId, fileName, filePath },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(201).json({
          success: true,
          data: {
            verificationId: result.verificationId,
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
      logger.error('Submit document error:', error);
      next(error);
    }
  }

  /**
   * 서류 검증 처리
   * PUT /api/documents/verify/:verificationId
   */
  static async verifyDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const verificationId = parseInt(req.params.verificationId);
      const { status, verificationNotes, issues } = req.body;

      if (!status || !['VERIFIED', 'REJECTED', 'NEEDS_REVIEW'].includes(status)) {
        res.status(400).json({
          success: false,
          error: '유효한 검증 상태를 지정해주세요. (VERIFIED, REJECTED, NEEDS_REVIEW)',
        });
        return;
      }

      const result = await DocumentService.verifyDocument(
        verificationId,
        user.id,
        status,
        verificationNotes,
        issues
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DOCUMENT_VERIFY',
          entityType: 'document_verification',
          entityId: verificationId,
          newValue: { status, verificationNotes, issues },
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
      logger.error('Verify document error:', error);
      next(error);
    }
  }

  /**
   * 추가 서류 요청
   * POST /api/documents/request-additional
   */
  static async requestAdditionalDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { claimId, documentName, reason, dueDate } = req.body;

      if (!claimId || !documentName || !reason) {
        res.status(400).json({
          success: false,
          error: '청구 ID, 서류명, 요청 사유가 필요합니다.',
        });
        return;
      }

      const result = await DocumentService.requestAdditionalDocument(
        claimId,
        documentName,
        reason,
        user.id,
        dueDate
      );

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DOCUMENT_REQUEST_ADDITIONAL',
          entityType: 'document_checklist',
          entityId: result.checklistId!,
          newValue: { claimId, documentName, reason, dueDate },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });

        res.status(201).json({
          success: true,
          data: {
            checklistId: result.checklistId,
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
      logger.error('Request additional document error:', error);
      next(error);
    }
  }

  /**
   * 서류 면제 처리
   * PUT /api/documents/waive/:checklistId
   */
  static async waiveDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const checklistId = parseInt(req.params.checklistId);
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({
          success: false,
          error: '면제 사유가 필요합니다.',
        });
        return;
      }

      const result = await DocumentService.waiveDocument(checklistId, user.id, reason);

      if (result.success) {
        // 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'DOCUMENT_WAIVE',
          entityType: 'document_checklist',
          entityId: checklistId,
          newValue: { reason },
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
      logger.error('Waive document error:', error);
      next(error);
    }
  }

  /**
   * 서류 완료 여부 확인
   * GET /api/documents/complete-status/:claimId
   */
  static async checkDocumentComplete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const result = await DocumentService.checkDocumentComplete(claimId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Check document complete error:', error);
      next(error);
    }
  }

  /**
   * 필수 서류 요구사항 목록 조회
   * GET /api/documents/requirements
   */
  static async getDocumentRequirements(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productType, claimType } = req.query;

      const requirements = await DocumentService.getDocumentRequirements(
        productType as string,
        claimType as string
      );

      res.status(200).json({
        success: true,
        data: requirements,
        count: requirements.length,
      });
    } catch (error) {
      logger.error('Get document requirements error:', error);
      next(error);
    }
  }

  /**
   * 서류 검증 이력 조회
   * GET /api/documents/verification-history/:claimId
   */
  static async getVerificationHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const claimId = parseInt(req.params.claimId);

      const history = await DocumentService.getVerificationHistory(claimId);

      res.status(200).json({
        success: true,
        data: history,
        count: history.length,
      });
    } catch (error) {
      logger.error('Get verification history error:', error);
      next(error);
    }
  }
}
