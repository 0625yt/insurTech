import { db } from '../database/connection';
import { logger } from '../utils/logger';
import { AuthUser } from '../middlewares/auth.middleware';
import { AuditService } from '../middlewares/audit.middleware';

// 결재 상태
export enum ApprovalStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  CANCELLED = 'CANCELLED',
}

// 결재 액션
export enum ApprovalAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  RETURN = 'RETURN',
  HOLD = 'HOLD',
  DELEGATE = 'DELEGATE',
  SKIP = 'SKIP',
}

export class ApprovalService {
  // 청구에 맞는 결재 라인 템플릿 찾기
  static async findApprovalTemplate(claim: any): Promise<any> {
    const amount = claim.total_claimed_amount || 0;
    const fraudScore = claim.fraud_score || 0;
    const claimType = claim.claim_type;

    // 우선순위 순으로 템플릿 조회
    const result = await db.query(`
      SELECT *
      FROM approval_line_templates
      WHERE is_active = TRUE
        AND (claim_type IS NULL OR claim_type = $1)
        AND (min_amount IS NULL OR $2 >= min_amount)
        AND (max_amount IS NULL OR $2 <= max_amount)
        AND (fraud_score_threshold IS NULL OR $3 >= fraud_score_threshold)
      ORDER BY priority ASC, template_code
      LIMIT 1
    `, [claimType, amount, fraudScore]);

    return result.rows[0] || null;
  }

  // 결재 프로세스 시작
  static async startApprovalProcess(
    claimId: number,
    initiatorUserId: number,
    urgency: string = 'NORMAL',
    notes?: string
  ): Promise<{ success: boolean; approvalId?: number; nextApproverName?: string; message?: string }> {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 청구 정보 조회
      const claimResult = await client.query(
        'SELECT * FROM claims WHERE id = $1',
        [claimId]
      );

      if (claimResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: '청구를 찾을 수 없습니다.' };
      }

      const claim = claimResult.rows[0];

      // 이미 결재 진행 중인지 확인
      const existingResult = await client.query(`
        SELECT id FROM claim_approvals
        WHERE claim_id = $1 AND status IN ('PENDING', 'IN_PROGRESS')
      `, [claimId]);

      if (existingResult.rows.length > 0) {
        await client.query('ROLLBACK');
        return { success: false, error: '이미 결재가 진행 중입니다.' };
      }

      // 결재 템플릿 찾기
      const template = await this.findApprovalTemplate(claim);

      if (!template) {
        await client.query('ROLLBACK');
        return { success: false, error: '적용 가능한 결재 라인이 없습니다.' };
      }

      const approvalSteps = template.approval_steps;
      const totalSteps = approvalSteps.length;

      // 자동 승인 체크
      if (template.template_code === 'AUTO_APPROVE') {
        await client.query(`
          UPDATE claims SET
            status = 'APPROVED',
            approval_status = 'APPROVED',
            decision = 'APPROVED',
            approved_by = 'SYSTEM',
            approved_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [claimId]);

        // 감사 로그
        await AuditService.log({
          entityType: 'CLAIM',
          entityId: claimId,
          entityName: claim.claim_number,
          action: 'AUTO_APPROVE',
          additionalInfo: { template: template.template_code, initiatorId: initiatorUserId },
        });

        await client.query('COMMIT');
        return { success: true, approvalId: 0, message: '자동 승인되었습니다.' };
      }

      // 결재 인스턴스 생성
      const approvalResult = await client.query(`
        INSERT INTO claim_approvals (
          claim_id, template_id, status, current_step, total_steps,
          approval_line, is_urgent
        ) VALUES ($1, $2, 'IN_PROGRESS', 1, $3, $4, FALSE)
        RETURNING id
      `, [claimId, template.id, totalSteps, JSON.stringify(approvalSteps)]);

      const approvalId = approvalResult.rows[0].id;

      // 첫 번째 결재자에게 결재 대기함 배정
      const firstStep = approvalSteps[0];
      const approvers = await this.getApproversByRole(firstStep.role_code);

      if (approvers.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: `${firstStep.role_code} 역할의 결재자가 없습니다.` };
      }

      // 첫 번째 결재자에게 배정
      for (const approver of approvers) {
        await client.query(`
          INSERT INTO approval_inbox (
            claim_approval_id, claim_id, user_id, step_no, status
          ) VALUES ($1, $2, $3, 1, 'PENDING')
        `, [approvalId, claimId, approver.id]);
      }

      // 청구 상태 업데이트
      await client.query(`
        UPDATE claims SET
          status = 'PENDING_REVIEW',
          approval_status = 'IN_PROGRESS',
          current_approver_id = $1
        WHERE id = $2
      `, [approvers[0].id, claimId]);

      // 감사 로그
      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        entityName: claim.claim_number,
        action: 'APPROVAL_STARTED',
        additionalInfo: {
          template: template.template_code,
          totalSteps,
          firstApprovers: approvers.map(a => a.name),
          initiatorId: initiatorUserId,
          urgency,
          notes,
        },
      });

      await client.query('COMMIT');
      return {
        success: true,
        approvalId,
        nextApproverName: approvers[0]?.name,
        message: `결재가 시작되었습니다. ${approvers[0]?.name}님에게 전달되었습니다.`,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Start approval process error:', error);
      return { success: false, error: '결재 프로세스 시작 중 오류가 발생했습니다.' };
    } finally {
      client.release();
    }
  }

  // 결재 처리
  static async processApproval(
    approvalId: number,
    userId: number,
    action: ApprovalAction,
    comments?: string,
    adjustedAmount?: number,
    delegateTo?: number
  ): Promise<{ success: boolean; message?: string; isComplete?: boolean; finalStatus?: string; nextApproverName?: string }> {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 사용자 정보 조회
      const userResult = await client.query(`
        SELECT u.*, r.role_code FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1
      `, [userId]);

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: '사용자를 찾을 수 없습니다.' };
      }
      const user = userResult.rows[0];

      // 현재 결재 인스턴스 조회
      const approvalResult = await client.query(`
        SELECT ca.*, c.id as claim_id, c.claim_number, c.total_claimed_amount
        FROM claim_approvals ca
        JOIN claims c ON ca.claim_id = c.id
        WHERE ca.id = $1 AND ca.status = 'IN_PROGRESS'
      `, [approvalId]);

      if (approvalResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: '진행 중인 결재가 없습니다.' };
      }

      const approval = approvalResult.rows[0];
      const claimId = approval.claim_id;

      // 결재 권한 확인
      const inboxResult = await client.query(`
        SELECT * FROM approval_inbox
        WHERE claim_approval_id = $1 AND user_id = $2 AND status = 'PENDING'
      `, [approvalId, userId]);

      if (inboxResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: '결재 권한이 없습니다.' };
      }

      const inbox = inboxResult.rows[0];
      const receivedAt = inbox.assigned_at;
      const processingTime = Math.round((Date.now() - new Date(receivedAt).getTime()) / 60000);

      // 결재 이력 기록
      await client.query(`
        INSERT INTO approval_history (
          claim_approval_id, claim_id, step_no, step_name,
          approver_id, approver_name, approver_role, approver_department,
          action, decision_amount, comment,
          received_at, processing_time_minutes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        approvalId, claimId, approval.current_step,
        `${approval.current_step}단계 결재`,
        userId, user.name, user.role_code, user.department,
        action, adjustedAmount || null, comments || null,
        receivedAt, processingTime,
      ]);

      // 대기함 완료 처리
      await client.query(`
        UPDATE approval_inbox SET status = 'COMPLETED'
        WHERE claim_approval_id = $1 AND step_no = $2
      `, [approvalId, approval.current_step]);

      let isComplete = false;
      let finalStatus = '';
      let nextApproverName = '';

      // 액션에 따른 처리
      switch (action) {
        case ApprovalAction.APPROVE:
          if (approval.current_step >= approval.total_steps) {
            // 최종 승인
            await client.query(`
              UPDATE claim_approvals SET
                status = 'APPROVED',
                completed_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `, [approvalId]);

            await client.query(`
              UPDATE claims SET
                status = 'APPROVED',
                approval_status = 'APPROVED',
                decision = 'APPROVED',
                total_approved_amount = COALESCE($1, total_claimed_amount),
                approved_by = $2,
                approved_at = CURRENT_TIMESTAMP
              WHERE id = $3
            `, [adjustedAmount, user.name, claimId]);

            isComplete = true;
            finalStatus = 'APPROVED';
          } else {
            // 다음 단계로
            const nextStep = approval.current_step + 1;
            const approvalLine = approval.approval_line;
            const nextStepConfig = approvalLine[nextStep - 1];

            await client.query(`
              UPDATE claim_approvals SET current_step = $1 WHERE id = $2
            `, [nextStep, approvalId]);

            // 다음 결재자 배정
            const nextApprovers = await this.getApproversByRole(nextStepConfig.role_code);

            for (const approver of nextApprovers) {
              await client.query(`
                INSERT INTO approval_inbox (
                  claim_approval_id, claim_id, user_id, step_no, status
                ) VALUES ($1, $2, $3, $4, 'PENDING')
              `, [approvalId, claimId, approver.id, nextStep]);
            }

            if (nextApprovers.length > 0) {
              await client.query(`
                UPDATE claims SET current_approver_id = $1 WHERE id = $2
              `, [nextApprovers[0].id, claimId]);
              nextApproverName = nextApprovers[0].name;
            }
          }
          break;

        case ApprovalAction.REJECT:
          await client.query(`
            UPDATE claim_approvals SET
              status = 'REJECTED',
              completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [approvalId]);

          await client.query(`
            UPDATE claims SET
              status = 'REJECTED',
              approval_status = 'REJECTED',
              decision = 'REJECTED',
              decision_reason = $1,
              approved_by = $2,
              approved_at = CURRENT_TIMESTAMP
            WHERE id = $3
          `, [comments, user.name, claimId]);

          isComplete = true;
          finalStatus = 'REJECTED';
          break;

        case ApprovalAction.RETURN:
          await client.query(`
            UPDATE claim_approvals SET
              status = 'RETURNED',
              completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [approvalId]);

          await client.query(`
            UPDATE claims SET
              status = 'RETURNED',
              approval_status = 'RETURNED',
              decision_reason = $1
            WHERE id = $2
          `, [comments, claimId]);

          isComplete = true;
          finalStatus = 'RETURNED';
          break;

        case ApprovalAction.HOLD:
          await client.query(`
            UPDATE claims SET
              status = 'ON_HOLD',
              hold_status = 'HELD',
              hold_reason = $1
            WHERE id = $2
          `, [comments, claimId]);
          break;
      }

      // 감사 로그
      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        entityName: approval.claim_number,
        action: `APPROVAL_${action}`,
        actionCategory: 'APPROVAL',
        additionalInfo: {
          step: approval.current_step,
          totalSteps: approval.total_steps,
          comments,
          adjustedAmount,
          processingTime,
          approverId: userId,
        },
      });

      await client.query('COMMIT');

      const actionMessages: Record<string, string> = {
        APPROVE: isComplete ? '최종 승인되었습니다.' : `승인되었습니다. ${nextApproverName}님에게 전달되었습니다.`,
        REJECT: '반려되었습니다.',
        RETURN: '보완 요청되었습니다.',
        HOLD: '보류 처리되었습니다.',
      };

      return {
        success: true,
        isComplete,
        finalStatus,
        nextApproverName,
        message: actionMessages[action] || '처리되었습니다.',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Process approval error:', error);
      return { success: false, message: '결재 처리 중 오류가 발생했습니다.' };
    } finally {
      client.release();
    }
  }

  // 역할별 결재자 조회
  static async getApproversByRole(roleCode: string): Promise<any[]> {
    const result = await db.query(`
      SELECT u.id, u.name, u.department, u.team, r.role_code
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.role_code = $1 AND u.status = 'ACTIVE'
    `, [roleCode]);

    return result.rows;
  }

  // 결재 대기함 조회
  static async getApprovalInbox(
    userId: number,
    filters?: {
      status?: string;
      urgency?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ items: any[]; total: number }> {
    const conditions: string[] = ['ai.user_id = $1'];
    const params: any[] = [userId];
    let paramIndex = 2;

    if (filters?.status) {
      conditions.push(`ai.status = $${paramIndex++}`);
      params.push(filters.status);
    }
    if (filters?.urgency === 'URGENT') {
      conditions.push(`ca.is_urgent = TRUE`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = filters?.limit || 20;
    const offset = ((filters?.page || 1) - 1) * limit;

    // 총 개수 조회
    const countResult = await db.query(`
      SELECT COUNT(*) as total
      FROM approval_inbox ai
      JOIN claim_approvals ca ON ai.claim_approval_id = ca.id
      ${whereClause}
    `, params);

    const total = parseInt(countResult.rows[0].total) || 0;

    // 목록 조회
    const result = await db.query(`
      SELECT
        ai.id as inbox_id,
        ai.step_no,
        ai.status as inbox_status,
        ai.is_overdue,
        ai.assigned_at,
        ca.id as approval_id,
        ca.status as approval_status,
        ca.current_step,
        ca.total_steps,
        ca.is_urgent,
        c.id as claim_id,
        c.claim_number,
        c.claim_type,
        c.total_claimed_amount,
        c.diagnosis_name,
        c.fraud_score,
        cu.name as customer_name
      FROM approval_inbox ai
      JOIN claim_approvals ca ON ai.claim_approval_id = ca.id
      JOIN claims c ON ca.claim_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      ${whereClause}
      ORDER BY ai.is_overdue DESC, ca.is_urgent DESC, ai.assigned_at
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, limit, offset]);

    return { items: result.rows, total };
  }

  // 결재 이력 조회
  static async getApprovalHistory(claimId: number): Promise<any[]> {
    const result = await db.query(`
      SELECT
        ah.*,
        u.name as approver_display_name,
        u.position
      FROM approval_history ah
      LEFT JOIN users u ON ah.approver_id = u.id
      WHERE ah.claim_id = $1
      ORDER BY ah.created_at
    `, [claimId]);

    return result.rows;
  }

  // 결재 현황 요약
  static async getApprovalSummary(userId: number): Promise<{
    pending: number;
    overdue: number;
    todayProcessed: number;
  }> {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND is_overdue = TRUE) as overdue,
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND DATE(assigned_at) = CURRENT_DATE) as today_processed
      FROM approval_inbox
      WHERE user_id = $1
    `, [userId]);

    const row = result.rows[0];
    return {
      pending: parseInt(row.pending) || 0,
      overdue: parseInt(row.overdue) || 0,
      todayProcessed: parseInt(row.today_processed) || 0,
    };
  }

  // 청구의 결재 상태 조회
  static async getApprovalStatus(claimId: number): Promise<any> {
    const result = await db.query(`
      SELECT
        ca.id,
        ca.status,
        ca.current_step,
        ca.total_steps,
        ca.approval_line,
        ca.is_urgent,
        ca.created_at,
        ca.completed_at,
        c.claim_number,
        c.total_claimed_amount,
        c.total_approved_amount
      FROM claim_approvals ca
      JOIN claims c ON ca.claim_id = c.id
      WHERE ca.claim_id = $1
      ORDER BY ca.created_at DESC
      LIMIT 1
    `, [claimId]);

    if (result.rows.length === 0) return null;

    const approval = result.rows[0];

    // 결재 이력 조회
    const historyResult = await db.query(`
      SELECT
        ah.*,
        u.name as approver_display_name,
        u.position
      FROM approval_history ah
      LEFT JOIN users u ON ah.approver_id = u.id
      WHERE ah.claim_approval_id = $1
      ORDER BY ah.created_at
    `, [approval.id]);

    return {
      ...approval,
      history: historyResult.rows,
    };
  }

  // 결재 라인 템플릿 조회
  static async getApprovalTemplates(): Promise<any[]> {
    const result = await db.query(`
      SELECT
        id,
        template_code,
        template_name,
        description,
        claim_type,
        min_amount,
        max_amount,
        fraud_score_threshold,
        approval_steps,
        priority,
        is_active
      FROM approval_line_templates
      WHERE is_active = TRUE
      ORDER BY priority, template_code
    `);

    return result.rows;
  }

  // 결재 통계 조회
  static async getApprovalStats(
    userId: number,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const dateCondition = startDate && endDate
      ? `AND ah.created_at BETWEEN '${startDate}' AND '${endDate}'`
      : `AND ah.created_at > NOW() - INTERVAL '30 days'`;

    // 내 결재 처리 통계
    const myStatsResult = await db.query(`
      SELECT
        action,
        COUNT(*) as count,
        AVG(processing_time_minutes) as avg_processing_time
      FROM approval_history ah
      WHERE ah.approver_id = $1 ${dateCondition}
      GROUP BY action
    `, [userId]);

    // 전체 결재 현황
    const overallResult = await db.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM claim_approvals
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY status
    `);

    // 일별 처리량
    const dailyResult = await db.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM approval_history
      WHERE approver_id = $1 ${dateCondition}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `, [userId]);

    return {
      myStats: myStatsResult.rows,
      overall: overallResult.rows,
      daily: dailyResult.rows,
    };
  }

  // 대기 중인 결재 건수
  static async getPendingApprovalCount(userId: number): Promise<number> {
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM approval_inbox
      WHERE user_id = $1 AND status = 'PENDING'
    `, [userId]);

    return parseInt(result.rows[0].count) || 0;
  }
}
