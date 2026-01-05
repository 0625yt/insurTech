import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AuditService } from '../middlewares/audit.middleware';
import { AuthUser } from '../middlewares/auth.middleware';
import { logger } from '../utils/logger';

// Request with auth user
interface AuthRequest extends Request {
  user?: AuthUser;
}

export class AuthController {
  /**
   * 로그인
   * POST /api/auth/login
   */
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userCode, password } = req.body;
      const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      if (!userCode || !password) {
        res.status(400).json({
          success: false,
          error: '사용자 코드와 비밀번호를 입력해주세요.',
        });
        return;
      }

      const result = await AuthService.login(userCode, password, ipAddress, userAgent);

      if (result.success) {
        // 로그인 성공 감사 로그
        await AuditService.log({
          userId: result.user!.id,
          userCode: result.user!.userCode,
          userName: result.user!.name,
          action: 'LOGIN',
          entityType: 'user',
          entityId: result.user!.id,
          newValue: { loginTime: new Date().toISOString() },
          ipAddress,
          userAgent,
          isSuccess: true,
        });

        res.status(200).json({
          success: true,
          data: {
            token: result.token,
            user: result.user,
          },
          message: '로그인 성공',
        });
      } else {
        // 로그인 실패 감사 로그
        await AuditService.logFailure({
          action: 'LOGIN',
          entityType: 'user',
          errorMessage: result.message,
          ipAddress,
          userAgent,
          additionalData: { attemptedUserCode: userCode },
        });

        res.status(401).json({
          success: false,
          error: result.message,
        });
      }
    } catch (error) {
      logger.error('Login error:', error);
      next(error);
    }
  }

  /**
   * 로그아웃
   * POST /api/auth/logout
   */
  static async logout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const user = req.user;

      if (token && user) {
        await AuthService.logout(user.id, token);

        // 로그아웃 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'LOGOUT',
          entityType: 'user',
          entityId: user.id,
          newValue: { logoutTime: new Date().toISOString() },
          ipAddress: req.ip || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
          isSuccess: true,
        });
      }

      res.status(200).json({
        success: true,
        message: '로그아웃 되었습니다.',
      });
    } catch (error) {
      logger.error('Logout error:', error);
      next(error);
    }
  }

  /**
   * 비밀번호 변경
   * PUT /api/auth/password
   */
  static async changePassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          error: '현재 비밀번호와 새 비밀번호를 입력해주세요.',
        });
        return;
      }

      // 비밀번호 유효성 검사
      if (newPassword.length < 8) {
        res.status(400).json({
          success: false,
          error: '비밀번호는 최소 8자 이상이어야 합니다.',
        });
        return;
      }

      // 복잡성 검사: 대문자, 소문자, 숫자, 특수문자 포함
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
      if (!passwordRegex.test(newPassword)) {
        res.status(400).json({
          success: false,
          error: '비밀번호는 대문자, 소문자, 숫자, 특수문자를 포함해야 합니다.',
        });
        return;
      }

      const result = await AuthService.changePassword(user.id, currentPassword, newPassword);

      if (result.success) {
        // 비밀번호 변경 감사 로그
        await AuditService.log({
          userId: user.id,
          userCode: user.userCode,
          userName: user.name,
          action: 'PASSWORD_CHANGE',
          entityType: 'user',
          entityId: user.id,
          newValue: { changedAt: new Date().toISOString() },
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
      logger.error('Change password error:', error);
      next(error);
    }
  }

  /**
   * 현재 사용자 정보 조회
   * GET /api/auth/me
   */
  static async getCurrentUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;

      res.status(200).json({
        success: true,
        data: {
          id: user.id,
          userCode: user.userCode,
          username: user.username,
          name: user.name,
          email: user.email,
          departmentCode: user.departmentCode,
          departmentName: user.departmentName,
          roleCode: user.roleCode,
          roleLevel: user.roleLevel,
          permissions: user.permissions,
        },
      });
    } catch (error) {
      logger.error('Get current user error:', error);
      next(error);
    }
  }

  /**
   * 사용자 목록 조회 (관리자용)
   * GET /api/auth/users
   */
  static async getUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { departmentCode, roleCode, isActive } = req.query;

      const filters: { departmentCode?: string; roleCode?: string; isActive?: boolean } = {};
      if (departmentCode) filters.departmentCode = departmentCode as string;
      if (roleCode) filters.roleCode = roleCode as string;
      if (isActive !== undefined) filters.isActive = isActive === 'true';

      const users = await AuthService.getUsers(filters);

      res.status(200).json({
        success: true,
        data: users,
        count: users.length,
      });
    } catch (error) {
      logger.error('Get users error:', error);
      next(error);
    }
  }

  /**
   * 결재자 목록 조회
   * GET /api/auth/approvers
   */
  static async getApprovers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const minRoleLevel = parseInt(req.query.minRoleLevel as string) || 1;
      const departmentCode = req.query.departmentCode as string | undefined;

      const approvers = await AuthService.getApprovers(minRoleLevel, departmentCode);

      res.status(200).json({
        success: true,
        data: approvers,
        count: approvers.length,
      });
    } catch (error) {
      logger.error('Get approvers error:', error);
      next(error);
    }
  }

  /**
   * 토큰 갱신
   * POST /api/auth/refresh
   */
  static async refreshToken(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const oldToken = req.headers.authorization?.replace('Bearer ', '');
      const ipAddress = req.ip || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      // 기존 세션 무효화
      if (oldToken) {
        await AuthService.logout(user.id, oldToken);
      }

      // 새 로그인 세션 생성 (비밀번호 없이 - 이미 인증된 사용자)
      const result = await AuthService.createSession(user.id, ipAddress, userAgent);

      if (result.success) {
        res.status(200).json({
          success: true,
          data: {
            token: result.token,
          },
          message: '토큰이 갱신되었습니다.',
        });
      } else {
        res.status(400).json({
          success: false,
          error: '토큰 갱신에 실패했습니다.',
        });
      }
    } catch (error) {
      logger.error('Refresh token error:', error);
      next(error);
    }
  }
}
