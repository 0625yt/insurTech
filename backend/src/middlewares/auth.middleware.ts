import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../database/connection';
import { logger } from '../utils/logger';

// JWT 시크릿 (실제 환경에서는 환경변수로 관리)
const JWT_SECRET = process.env.JWT_SECRET || 'insurtech-secret-key-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// 사용자 정보 인터페이스
export interface AuthUser {
  id: number;
  userCode: string;
  username: string;
  name: string;
  email: string;
  department: string;
  team: string;
  position: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  roleLevel: number;
  approvalLimit: number;
  canFinalApprove: boolean;
  permissions: string[];
}

// Request 확장
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

// JWT 토큰 생성
export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      userCode: user.userCode,
      username: user.username,
      name: user.name,
      roleCode: user.roleCode,
      roleLevel: user.roleLevel,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// JWT 토큰 검증
export function verifyToken(token: string): any {
  return jwt.verify(token, JWT_SECRET);
}

// 인증 미들웨어
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 토큰 추출
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: '인증 토큰이 필요합니다.',
        code: 'AUTH_TOKEN_REQUIRED'
      });
      return;
    }

    const token = authHeader.substring(7);

    // 토큰 검증
    let decoded: any;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      res.status(401).json({
        success: false,
        error: '유효하지 않은 토큰입니다.',
        code: 'AUTH_TOKEN_INVALID'
      });
      return;
    }

    // 사용자 정보 조회
    const userResult = await db.query(`
      SELECT
        u.id, u.user_code, u.username, u.name, u.email,
        u.department, u.team, u.position,
        u.role_id, u.approval_limit, u.can_final_approve, u.status,
        r.role_code, r.role_name, r.level as role_level
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1 AND u.status = 'ACTIVE'
    `, [decoded.id]);

    if (userResult.rows.length === 0) {
      res.status(401).json({
        success: false,
        error: '사용자를 찾을 수 없습니다.',
        code: 'AUTH_USER_NOT_FOUND'
      });
      return;
    }

    const userRow = userResult.rows[0];

    // 권한 조회
    const permResult = await db.query(`
      SELECT p.permission_code
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      WHERE rp.role_id = $1
    `, [userRow.role_id]);

    const permissions = permResult.rows.map(r => r.permission_code);

    // 사용자 정보 설정
    req.user = {
      id: userRow.id,
      userCode: userRow.user_code,
      username: userRow.username,
      name: userRow.name,
      email: userRow.email,
      department: userRow.department,
      team: userRow.team,
      position: userRow.position,
      roleId: userRow.role_id,
      roleCode: userRow.role_code,
      roleName: userRow.role_name,
      roleLevel: userRow.role_level,
      approvalLimit: parseInt(userRow.approval_limit) || 0,
      canFinalApprove: userRow.can_final_approve,
      permissions,
    };

    req.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: '인증 처리 중 오류가 발생했습니다.',
      code: 'AUTH_ERROR'
    });
  }
}

// 권한 확인 미들웨어
export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: '인증이 필요합니다.',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    // 관리자는 모든 권한
    if (req.user.roleCode === 'ADMIN') {
      next();
      return;
    }

    // 필요한 권한 중 하나라도 있으면 통과
    const hasPermission = requiredPermissions.some(
      perm => req.user!.permissions.includes(perm)
    );

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        error: '권한이 없습니다.',
        code: 'PERMISSION_DENIED',
        required: requiredPermissions,
        has: req.user.permissions
      });
      return;
    }

    next();
  };
}

// 역할 레벨 확인 미들웨어
export function requireRoleLevel(minLevel: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: '인증이 필요합니다.',
        code: 'AUTH_REQUIRED'
      });
      return;
    }

    if (req.user.roleLevel < minLevel) {
      res.status(403).json({
        success: false,
        error: '해당 기능에 대한 권한이 부족합니다.',
        code: 'ROLE_LEVEL_INSUFFICIENT',
        required: minLevel,
        current: req.user.roleLevel
      });
      return;
    }

    next();
  };
}

// 선택적 인증 미들웨어 (로그인 안해도 됨)
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  // 토큰이 있으면 검증 시도
  try {
    await authMiddleware(req, res, () => {
      next();
    });
  } catch {
    // 실패해도 계속 진행
    next();
  }
}
