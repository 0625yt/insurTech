import bcrypt from 'bcrypt';
import { db } from '../database/connection';
import { logger } from '../utils/logger';
import { AuthUser, generateToken } from '../middlewares/auth.middleware';
import { AuditService } from '../middlewares/audit.middleware';

const SALT_ROUNDS = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

export class AuthService {
  // 로그인
  static async login(
    userCodeOrUsername: string,
    password: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; token?: string; user?: any; message?: string }> {
    try {
      // 사용자 조회 (user_code 또는 username으로)
      const userResult = await db.query(`
        SELECT
          u.id, u.user_code, u.username, u.password_hash, u.name, u.email,
          u.department, u.team, u.position,
          u.role_id, u.approval_limit, u.can_final_approve,
          u.status, u.login_fail_count,
          r.role_code, r.role_name, r.level as role_level
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.user_code = $1 OR u.username = $1
      `, [userCodeOrUsername]);

      if (userResult.rows.length === 0) {
        return { success: false, message: '아이디 또는 비밀번호가 잘못되었습니다.' };
      }

      const userRow = userResult.rows[0];

      // 계정 상태 확인
      if (userRow.status === 'LOCKED') {
        return { success: false, message: '계정이 잠겼습니다. 관리자에게 문의하세요.' };
      }
      if (userRow.status !== 'ACTIVE') {
        return { success: false, message: '비활성화된 계정입니다.' };
      }

      // 비밀번호 확인
      const isValid = await bcrypt.compare(password, userRow.password_hash);

      if (!isValid) {
        // 로그인 실패 카운트 증가
        const newFailCount = (userRow.login_fail_count || 0) + 1;
        const shouldLock = newFailCount >= MAX_LOGIN_ATTEMPTS;

        await db.query(`
          UPDATE users SET
            login_fail_count = $1,
            status = CASE WHEN $2 THEN 'LOCKED' ELSE status END
          WHERE id = $3
        `, [newFailCount, shouldLock, userRow.id]);

        // 감사 로그
        await AuditService.logFailure(
          { entityType: 'USER', entityId: userRow.id, action: 'LOGIN' },
          '비밀번호 불일치',
          undefined,
          { ip: ipAddress, headers: { 'user-agent': userAgent } } as any
        );

        if (shouldLock) {
          return { success: false, message: '로그인 시도 횟수 초과로 계정이 잠겼습니다.' };
        }
        return { success: false, message: '아이디 또는 비밀번호가 잘못되었습니다.' };
      }

      // 권한 조회
      const permResult = await db.query(`
        SELECT p.permission_code
        FROM role_permissions rp
        JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = $1
      `, [userRow.role_id]);

      const permissions = permResult.rows.map(r => r.permission_code);

      // 로그인 성공 처리
      await db.query(`
        UPDATE users SET
          login_fail_count = 0,
          last_login_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [userRow.id]);

      const user: AuthUser = {
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

      const token = generateToken(user);

      // 세션 저장
      await db.query(`
        INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, expires_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '8 hours')
      `, [userRow.id, token, ipAddress, userAgent]);

      // 감사 로그
      await AuditService.log(
        { entityType: 'USER', entityId: userRow.id, action: 'LOGIN' },
        user,
        { ip: ipAddress, headers: { 'user-agent': userAgent } } as any
      );

      return { success: true, token, user };
    } catch (error) {
      logger.error('Login error:', error);
      return { success: false, message: '로그인 처리 중 오류가 발생했습니다.' };
    }
  }

  // 세션 생성 (토큰 갱신용)
  static async createSession(
    userId: number,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ success: boolean; token?: string }> {
    try {
      // 사용자 정보 조회
      const userResult = await db.query(`
        SELECT
          u.id, u.user_code, u.username, u.name, u.email,
          u.department, u.team, u.position,
          u.role_id, u.approval_limit, u.can_final_approve,
          r.role_code, r.role_name, r.level as role_level
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1 AND u.status = 'ACTIVE'
      `, [userId]);

      if (userResult.rows.length === 0) {
        return { success: false };
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

      const user: AuthUser = {
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

      const token = generateToken(user);

      // 세션 저장
      await db.query(`
        INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, expires_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '8 hours')
      `, [userId, token, ipAddress, userAgent]);

      return { success: true, token };
    } catch (error) {
      logger.error('Create session error:', error);
      return { success: false };
    }
  }

  // 로그아웃
  static async logout(userId: number, token: string): Promise<boolean> {
    try {
      await db.query(`
        DELETE FROM user_sessions WHERE user_id = $1 AND session_token = $2
      `, [userId, token]);

      // 감사 로그
      await AuditService.log({
        entityType: 'USER',
        entityId: userId,
        action: 'LOGOUT',
      });

      return true;
    } catch (error) {
      logger.error('Logout error:', error);
      return false;
    }
  }

  // 비밀번호 변경
  static async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      // 현재 비밀번호 확인
      const userResult = await db.query(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return { success: false, message: '사용자를 찾을 수 없습니다.' };
      }

      const isValid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
      if (!isValid) {
        return { success: false, message: '현재 비밀번호가 일치하지 않습니다.' };
      }

      // 새 비밀번호 해싱
      const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

      await db.query(`
        UPDATE users SET
          password_hash = $1,
          password_changed_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [newHash, userId]);

      // 감사 로그
      await AuditService.log({
        entityType: 'USER',
        entityId: userId,
        action: 'PASSWORD_CHANGE',
      });

      return { success: true, message: '비밀번호가 변경되었습니다.' };
    } catch (error) {
      logger.error('Password change error:', error);
      return { success: false, message: '비밀번호 변경 중 오류가 발생했습니다.' };
    }
  }

  // 사용자 목록 조회
  static async getUsers(filters?: {
    department?: string;
    roleCode?: string;
    status?: string;
  }): Promise<any[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.department) {
      conditions.push(`u.department = $${paramIndex++}`);
      params.push(filters.department);
    }
    if (filters?.roleCode) {
      conditions.push(`r.role_code = $${paramIndex++}`);
      params.push(filters.roleCode);
    }
    if (filters?.status) {
      conditions.push(`u.status = $${paramIndex++}`);
      params.push(filters.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT
        u.id, u.user_code, u.username, u.name, u.email,
        u.department, u.team, u.position,
        u.approval_limit, u.can_final_approve,
        u.status, u.last_login_at,
        r.role_code, r.role_name, r.level as role_level
      FROM users u
      JOIN roles r ON u.role_id = r.id
      ${whereClause}
      ORDER BY u.department, r.level DESC, u.name
    `, params);

    return result.rows;
  }

  // 결재 가능 사용자 조회 (특정 금액에 대해)
  static async getApprovers(amount: number, excludeUserId?: number): Promise<any[]> {
    const result = await db.query(`
      SELECT
        u.id, u.user_code, u.name, u.email,
        u.department, u.team, u.position,
        u.approval_limit, u.can_final_approve,
        r.role_code, r.role_name, r.level as role_level
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.status = 'ACTIVE'
        AND u.approval_limit >= $1
        AND ($2 IS NULL OR u.id != $2)
      ORDER BY r.level, u.approval_limit
    `, [amount, excludeUserId || null]);

    return result.rows;
  }

  // 계정 잠금 해제
  static async unlockAccount(userId: number, adminUserId: number): Promise<boolean> {
    try {
      await db.query(`
        UPDATE users SET
          status = 'ACTIVE',
          login_fail_count = 0
        WHERE id = $1
      `, [userId]);

      // 감사 로그
      await AuditService.log({
        entityType: 'USER',
        entityId: userId,
        action: 'ACCOUNT_UNLOCK',
        additionalInfo: { unlockedBy: adminUserId },
      });

      return true;
    } catch (error) {
      logger.error('Account unlock error:', error);
      return false;
    }
  }
}
