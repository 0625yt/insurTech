import { Request, Response, NextFunction } from 'express';
import { db } from '../database/connection';
import { logger } from '../utils/logger';
import { AuthUser } from './auth.middleware';

// 감사 로그 인터페이스
export interface AuditLogData {
  entityType: string;
  entityId: number;
  entityName?: string;
  action: string;
  actionCategory?: string;
  oldValue?: any;
  newValue?: any;
  changedFields?: string[];
  additionalInfo?: any;
}

// 확장된 감사 로그 인터페이스 (컨트롤러용)
export interface ExtendedAuditLogData {
  userId?: number;
  userCode?: string;
  userName?: string;
  action: string;
  entityType: string;
  entityId?: number;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
  isSuccess?: boolean;
}

// 민감 데이터 접근 로그 인터페이스
export interface SensitiveAccessLogData {
  userId: number;
  userCode: string;
  userName: string;
  dataType: string;
  entityType: string;
  entityId: number;
  accessReason?: string;
  ipAddress?: string;
  userAgent?: string;
}

// 감사 로그 서비스
export class AuditService {
  // 감사 로그 기록 (확장된 인터페이스)
  static async log(
    data: AuditLogData | ExtendedAuditLogData,
    user?: AuthUser,
    req?: Request
  ): Promise<number> {
    // ExtendedAuditLogData 형식인 경우
    if ('userId' in data || 'ipAddress' in data) {
      const extData = data as ExtendedAuditLogData;
      try {
        const result = await db.query(`
          INSERT INTO audit_logs (
            entity_type, entity_id,
            action, action_category,
            old_value, new_value,
            user_id, user_name,
            ip_address, user_agent,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `, [
          extData.entityType,
          extData.entityId || 0,
          extData.action,
          categorizeAction(extData.action),
          extData.oldValue ? JSON.stringify(extData.oldValue) : null,
          extData.newValue ? JSON.stringify(extData.newValue) : null,
          extData.userId || null,
          extData.userName || 'SYSTEM',
          extData.ipAddress || null,
          extData.userAgent || null,
          extData.isSuccess !== false ? 'SUCCESS' : 'FAILED',
        ]);
        return result.rows[0].id;
      } catch (error) {
        logger.error('Extended audit log error:', error);
        return 0;
      }
    }

    // 기존 AuditLogData 형식
    const auditData = data as AuditLogData;
    try {
      const result = await db.query(`
        INSERT INTO audit_logs (
          entity_type, entity_id, entity_name,
          action, action_category,
          old_value, new_value, changed_fields,
          user_id, user_name, user_role, user_department,
          ip_address, user_agent, session_id,
          request_id, additional_info,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'SUCCESS')
        RETURNING id
      `, [
        data.entityType,
        data.entityId,
        data.entityName || null,
        data.action,
        data.actionCategory || categorizeAction(data.action),
        data.oldValue ? JSON.stringify(data.oldValue) : null,
        data.newValue ? JSON.stringify(data.newValue) : null,
        data.changedFields || null,
        user?.id || null,
        user?.name || 'SYSTEM',
        user?.roleCode || null,
        user?.department || null,
        req?.ip || req?.headers['x-forwarded-for'] || null,
        req?.headers['user-agent'] || null,
        (req as any)?.sessionId || null,
        `req_${Date.now()}`,
        data.additionalInfo ? JSON.stringify(data.additionalInfo) : null,
      ]);

      return result.rows[0].id;
    } catch (error) {
      logger.error('Audit log error:', error);
      throw error;
    }
  }

  // 실패 로그 기록
  static async logFailure(
    data: AuditLogData,
    errorMessage: string,
    user?: AuthUser,
    req?: Request
  ): Promise<number> {
    try {
      const result = await db.query(`
        INSERT INTO audit_logs (
          entity_type, entity_id, entity_name,
          action, action_category,
          user_id, user_name, user_role, user_department,
          ip_address, user_agent,
          status, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'FAILED', $12)
        RETURNING id
      `, [
        data.entityType,
        data.entityId,
        data.entityName || null,
        data.action,
        data.actionCategory || categorizeAction(data.action),
        user?.id || null,
        user?.name || 'SYSTEM',
        user?.roleCode || null,
        user?.department || null,
        req?.ip || null,
        req?.headers['user-agent'] || null,
        errorMessage,
      ]);

      return result.rows[0].id;
    } catch (error) {
      logger.error('Audit failure log error:', error);
      throw error;
    }
  }

  // 민감 데이터 접근 로그
  static async logSensitiveAccess(
    auditLogId: number,
    dataType: string,
    dataFields: string[],
    customerId: number,
    accessReason?: string,
    wasMasked: boolean = true
  ): Promise<void> {
    try {
      await db.query(`
        INSERT INTO sensitive_data_access_logs (
          audit_log_id, data_type, data_fields, customer_id, access_reason, was_masked
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [auditLogId, dataType, dataFields, customerId, accessReason, wasMasked]);
    } catch (error) {
      logger.error('Sensitive data access log error:', error);
    }
  }

  // 감사 로그 조회
  static async getAuditLogs(filters: {
    entityType?: string;
    entityId?: number;
    action?: string;
    userId?: number;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: any[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.entityType) {
      conditions.push(`entity_type = $${paramIndex++}`);
      params.push(filters.entityType);
    }
    if (filters.entityId) {
      conditions.push(`entity_id = $${paramIndex++}`);
      params.push(filters.entityId);
    }
    if (filters.action) {
      conditions.push(`action = $${paramIndex++}`);
      params.push(filters.action);
    }
    if (filters.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(filters.userId);
    }
    if (filters.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 총 개수
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // 로그 조회
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const logsResult = await db.query(`
      SELECT *
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, limit, offset]);

    return {
      logs: logsResult.rows,
      total,
    };
  }

  // 실패 로그 간편 기록
  static async logFailure(data: {
    action: string;
    entityType: string;
    errorMessage?: string;
    ipAddress?: string;
    userAgent?: string;
    additionalData?: any;
  }): Promise<void> {
    try {
      await db.query(`
        INSERT INTO audit_logs (
          entity_type, entity_id, action, action_category,
          ip_address, user_agent, status, error_message, additional_info
        ) VALUES ($1, 0, $2, $3, $4, $5, 'FAILED', $6, $7)
      `, [
        data.entityType,
        data.action,
        categorizeAction(data.action),
        data.ipAddress || null,
        data.userAgent || null,
        data.errorMessage || null,
        data.additionalData ? JSON.stringify(data.additionalData) : null,
      ]);
    } catch (error) {
      logger.error('Log failure error:', error);
    }
  }

  // 민감 데이터 접근 로그 기록 (확장)
  static async logSensitiveAccess(data: SensitiveAccessLogData): Promise<void> {
    try {
      // 먼저 감사 로그 생성
      const auditResult = await db.query(`
        INSERT INTO audit_logs (
          entity_type, entity_id, action, action_category,
          user_id, user_name, ip_address, user_agent, status
        ) VALUES ($1, $2, 'SENSITIVE_ACCESS', 'DATA', $3, $4, $5, $6, 'SUCCESS')
        RETURNING id
      `, [
        data.entityType,
        data.entityId,
        data.userId,
        data.userName,
        data.ipAddress || null,
        data.userAgent || null,
      ]);

      const auditLogId = auditResult.rows[0].id;

      // 민감 데이터 접근 로그 추가
      await db.query(`
        INSERT INTO sensitive_data_access_logs (
          audit_log_id, data_type, access_reason
        ) VALUES ($1, $2, $3)
      `, [auditLogId, data.dataType, data.accessReason || null]);
    } catch (error) {
      logger.error('Sensitive access log error:', error);
    }
  }

  // 민감 데이터 접근 로그 조회
  static async getSensitiveAccessLogs(filters: {
    userId?: number;
    dataType?: string;
    entityType?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<{ logs: any[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.userId) {
      conditions.push(`al.user_id = $${paramIndex++}`);
      params.push(filters.userId);
    }
    if (filters.dataType) {
      conditions.push(`sal.data_type = $${paramIndex++}`);
      params.push(filters.dataType);
    }
    if (filters.entityType) {
      conditions.push(`al.entity_type = $${paramIndex++}`);
      params.push(filters.entityType);
    }
    if (filters.startDate) {
      conditions.push(`al.created_at >= $${paramIndex++}`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`al.created_at <= $${paramIndex++}`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 50;
    const offset = ((filters.page || 1) - 1) * limit;

    const countResult = await db.query(`
      SELECT COUNT(*) as total
      FROM sensitive_data_access_logs sal
      JOIN audit_logs al ON sal.audit_log_id = al.id
      ${whereClause}
    `, params);

    const logsResult = await db.query(`
      SELECT sal.*, al.user_id, al.user_name, al.entity_type, al.entity_id,
             al.ip_address, al.created_at
      FROM sensitive_data_access_logs sal
      JOIN audit_logs al ON sal.audit_log_id = al.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, limit, offset]);

    return {
      logs: logsResult.rows,
      total: parseInt(countResult.rows[0].total),
    };
  }

  // 사용자 활동 요약
  static async getUserActivitySummary(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const dateCondition = startDate && endDate
      ? `AND created_at BETWEEN '${startDate}' AND '${endDate}'`
      : '';

    const result = await db.query(`
      SELECT
        action,
        COUNT(*) as count,
        MAX(created_at) as last_activity
      FROM audit_logs
      WHERE user_id = $1 ${dateCondition}
      GROUP BY action
      ORDER BY count DESC
    `, [userId]);

    const totalResult = await db.query(`
      SELECT COUNT(*) as total
      FROM audit_logs
      WHERE user_id = $1 ${dateCondition}
    `, [userId]);

    return {
      userId,
      totalActions: parseInt(totalResult.rows[0].total),
      actionBreakdown: result.rows,
      period: { startDate, endDate },
    };
  }

  // 감사 통계
  static async getAuditStats(
    startDate?: string,
    endDate?: string,
    groupBy: string = 'day'
  ): Promise<any> {
    const dateCondition = startDate && endDate
      ? `WHERE created_at BETWEEN '${startDate}' AND '${endDate}'`
      : '';

    const dateFormat = groupBy === 'hour' ? 'YYYY-MM-DD HH24' : 'YYYY-MM-DD';

    const result = await db.query(`
      SELECT
        TO_CHAR(created_at, '${dateFormat}') as period,
        action_category,
        status,
        COUNT(*) as count
      FROM audit_logs
      ${dateCondition}
      GROUP BY TO_CHAR(created_at, '${dateFormat}'), action_category, status
      ORDER BY period DESC
    `);

    const summaryResult = await db.query(`
      SELECT
        action_category,
        status,
        COUNT(*) as count
      FROM audit_logs
      ${dateCondition}
      GROUP BY action_category, status
    `);

    return {
      timeline: result.rows,
      summary: summaryResult.rows,
      period: { startDate, endDate, groupBy },
    };
  }

  // 이상 행동 탐지
  static async detectAnomalies(
    period: string = '24h',
    threshold: number = 3.0
  ): Promise<any[]> {
    const intervalMapping: Record<string, string> = {
      '1h': '1 hour',
      '6h': '6 hours',
      '12h': '12 hours',
      '24h': '24 hours',
      '7d': '7 days',
    };
    const interval = intervalMapping[period] || '24 hours';

    // 사용자별 액션 빈도 이상 탐지
    const result = await db.query(`
      WITH user_stats AS (
        SELECT
          user_id,
          user_name,
          COUNT(*) as action_count,
          AVG(COUNT(*)) OVER () as avg_count,
          STDDEV(COUNT(*)) OVER () as std_count
        FROM audit_logs
        WHERE created_at > NOW() - INTERVAL '${interval}'
          AND user_id IS NOT NULL
        GROUP BY user_id, user_name
      )
      SELECT *,
        CASE WHEN std_count > 0
          THEN (action_count - avg_count) / std_count
          ELSE 0
        END as z_score
      FROM user_stats
      WHERE CASE WHEN std_count > 0
        THEN ABS((action_count - avg_count) / std_count) > $1
        ELSE false
      END
      ORDER BY action_count DESC
    `, [threshold]);

    return result.rows.map(row => ({
      userId: row.user_id,
      userName: row.user_name,
      actionCount: parseInt(row.action_count),
      zScore: parseFloat(row.z_score),
      anomalyType: parseFloat(row.z_score) > 0 ? 'HIGH_ACTIVITY' : 'LOW_ACTIVITY',
    }));
  }

  // 로그인 이력
  static async getLoginHistory(filters: {
    userId?: number;
    startDate?: string;
    endDate?: string;
    includeFailures?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ logs: any[]; total: number }> {
    const conditions: string[] = ["action IN ('LOGIN', 'LOGOUT')"];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(filters.userId);
    }
    if (filters.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(filters.endDate);
    }
    if (!filters.includeFailures) {
      conditions.push("status = 'SUCCESS'");
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = filters.limit || 50;
    const offset = ((filters.page || 1) - 1) * limit;

    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
      params
    );

    const logsResult = await db.query(`
      SELECT id, action, user_id, user_name, ip_address, user_agent,
             status, error_message, created_at
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, limit, offset]);

    return {
      logs: logsResult.rows,
      total: parseInt(countResult.rows[0].total),
    };
  }

  // 감사 로그 내보내기
  static async exportAuditLogs(
    startDate: string,
    endDate: string,
    format: string = 'json'
  ): Promise<{ data: any; count: number }> {
    const result = await db.query(`
      SELECT *
      FROM audit_logs
      WHERE created_at BETWEEN $1 AND $2
      ORDER BY created_at
    `, [startDate, endDate]);

    if (format === 'csv') {
      const headers = [
        'id', 'entity_type', 'entity_id', 'action', 'action_category',
        'user_id', 'user_name', 'ip_address', 'status', 'created_at'
      ];
      const csvRows = [headers.join(',')];

      for (const row of result.rows) {
        const values = headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
          return val;
        });
        csvRows.push(values.join(','));
      }

      return { data: csvRows.join('\n'), count: result.rows.length };
    }

    return { data: result.rows, count: result.rows.length };
  }
}

// 액션 카테고리 분류
function categorizeAction(action: string): string {
  const dataActions = ['CREATE', 'UPDATE', 'DELETE', 'VIEW'];
  const approvalActions = ['APPROVE', 'REJECT', 'RETURN', 'HOLD'];
  const authActions = ['LOGIN', 'LOGOUT', 'PASSWORD_CHANGE'];

  if (dataActions.includes(action)) return 'DATA';
  if (approvalActions.includes(action)) return 'APPROVAL';
  if (authActions.includes(action)) return 'AUTH';
  return 'SYSTEM';
}

// 변경된 필드 추출
export function getChangedFields(oldValue: any, newValue: any): string[] {
  if (!oldValue || !newValue) return [];

  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);

  for (const key of allKeys) {
    if (JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key])) {
      changed.push(key);
    }
  }

  return changed;
}

// 자동 감사 로그 미들웨어
export function auditMiddleware(
  entityType: string,
  getEntityId: (req: Request) => number,
  action?: string
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 원래 json 메서드 저장
    const originalJson = res.json.bind(res);

    // json 메서드 오버라이드
    res.json = function (body: any) {
      // 응답 후 감사 로그 기록
      setImmediate(async () => {
        try {
          const entityId = getEntityId(req);
          const logAction = action || getActionFromMethod(req.method);

          if (res.statusCode < 400) {
            await AuditService.log(
              {
                entityType,
                entityId,
                action: logAction,
                newValue: req.method !== 'GET' ? req.body : undefined,
                additionalInfo: {
                  method: req.method,
                  path: req.path,
                  statusCode: res.statusCode,
                },
              },
              req.user,
              req
            );
          } else {
            await AuditService.logFailure(
              {
                entityType,
                entityId,
                action: logAction,
              },
              body?.error || 'Unknown error',
              req.user,
              req
            );
          }
        } catch (err) {
          logger.error('Audit middleware error:', err);
        }
      });

      return originalJson(body);
    };

    next();
  };
}

// HTTP 메서드를 액션으로 변환
function getActionFromMethod(method: string): string {
  const mapping: Record<string, string> = {
    GET: 'VIEW',
    POST: 'CREATE',
    PUT: 'UPDATE',
    PATCH: 'UPDATE',
    DELETE: 'DELETE',
  };
  return mapping[method.toUpperCase()] || 'UNKNOWN';
}
