import { db } from '../database/connection';
import { logger } from '../utils/logger';
import { AuthUser } from '../middlewares/auth.middleware';
import { AuditService } from '../middlewares/audit.middleware';

// 서류 유형
export enum DocumentType {
  DIAGNOSIS = 'DIAGNOSIS',           // 진단서
  RECEIPT = 'RECEIPT',               // 진료비 영수증
  DETAIL_RECEIPT = 'DETAIL_RECEIPT', // 진료비 세부내역서
  ADMISSION = 'ADMISSION',           // 입퇴원확인서
  SURGERY = 'SURGERY',               // 수술확인서
  PRESCRIPTION = 'PRESCRIPTION',     // 처방전
  ID_CARD = 'ID_CARD',              // 신분증
  BANKBOOK = 'BANKBOOK',            // 통장사본
  OTHER = 'OTHER',                   // 기타
}

// 서류 상태
export enum DocumentStatus {
  PENDING = 'PENDING',       // 미제출
  SUBMITTED = 'SUBMITTED',   // 제출됨
  VERIFIED = 'VERIFIED',     // 검증완료
  REJECTED = 'REJECTED',     // 반려
  WAIVED = 'WAIVED',        // 면제
}

export class DocumentService {
  // 서류 요건 목록 조회
  static async getDocumentRequirements(filters?: {
    claimType?: string;
    isActive?: boolean;
  }): Promise<any[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.claimType) {
      conditions.push(`(claim_type IS NULL OR claim_type = $${paramIndex++})`);
      params.push(filters.claimType);
    }
    if (filters?.isActive !== undefined) {
      conditions.push(`is_active = $${paramIndex++}`);
      params.push(filters.isActive);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(`
      SELECT * FROM document_requirements
      ${whereClause}
      ORDER BY claim_type, id
    `, params);

    return result.rows;
  }

  // 청구 유형에 맞는 필수 서류 조회
  static async getRequiredDocuments(claim: any): Promise<any[]> {
    const isHospitalization = claim.claim_type === 'HOSPITALIZATION' || claim.hospitalization_days > 0;
    const isSurgery = !!claim.surgery_code;
    const claimType = claim.claim_type;
    const amount = claim.total_claimed_amount || 0;

    // 가장 적합한 서류 요건 조회
    const result = await db.query(`
      SELECT *
      FROM document_requirements
      WHERE is_active = TRUE
        AND (claim_type IS NULL OR claim_type = $1)
        AND (is_hospitalization IS NULL OR is_hospitalization = $2)
        AND (is_surgery IS NULL OR is_surgery = $3)
        AND (min_amount IS NULL OR $4 >= min_amount)
      ORDER BY
        CASE WHEN claim_type IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN is_hospitalization IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN is_surgery IS NOT NULL THEN 0 ELSE 1 END
      LIMIT 1
    `, [claimType, isHospitalization, isSurgery, amount]);

    if (result.rows.length === 0) {
      // 기본 서류 반환
      return [
        { doc_type: 'RECEIPT', doc_name: '진료비 영수증', is_mandatory: true },
      ];
    }

    return result.rows[0].required_documents;
  }

  // 서류 체크리스트 생성
  static async createDocumentChecklist(claimId: number): Promise<number> {
    // 청구 정보 조회
    const claimResult = await db.query('SELECT * FROM claims WHERE id = $1', [claimId]);

    if (claimResult.rows.length === 0) {
      throw new Error('청구를 찾을 수 없습니다.');
    }

    const claim = claimResult.rows[0];

    // 필수 서류 조회
    const requiredDocs = await this.getRequiredDocuments(claim);

    // 기존 체크리스트 확인
    const existingResult = await db.query(
      'SELECT id FROM document_checklists WHERE claim_id = $1',
      [claimId]
    );

    if (existingResult.rows.length > 0) {
      // 기존 체크리스트 업데이트
      await db.query(`
        UPDATE document_checklists SET
          required_docs = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE claim_id = $2
      `, [JSON.stringify(requiredDocs), claimId]);

      return existingResult.rows[0].id;
    }

    // 새 체크리스트 생성
    const result = await db.query(`
      INSERT INTO document_checklists (
        claim_id, required_docs, submitted_docs, missing_docs, status, completion_rate
      ) VALUES ($1, $2, '[]', $3, 'INCOMPLETE', 0)
      RETURNING id
    `, [claimId, JSON.stringify(requiredDocs), JSON.stringify(requiredDocs.filter((d: any) => d.is_mandatory))]);

    return result.rows[0].id;
  }

  // 서류 체크리스트 조회
  static async getDocumentChecklist(claimId: number): Promise<any> {
    const result = await db.query(`
      SELECT dc.*, c.claim_number, c.claim_type
      FROM document_checklists dc
      JOIN claims c ON dc.claim_id = c.id
      WHERE dc.claim_id = $1
    `, [claimId]);

    if (result.rows.length === 0) {
      // 체크리스트가 없으면 생성
      await this.createDocumentChecklist(claimId);
      return this.getDocumentChecklist(claimId);
    }

    const checklist = result.rows[0];

    // 제출된 서류 목록 조회
    const docsResult = await db.query(`
      SELECT * FROM claim_documents WHERE claim_id = $1
    `, [claimId]);

    return {
      ...checklist,
      documents: docsResult.rows,
    };
  }

  // 서류 제출 처리
  static async submitDocument(
    claimId: number,
    document: {
      documentType: string;
      documentName: string;
      filePath: string;
      fileSize?: number;
      mimeType?: string;
    },
    user?: AuthUser
  ): Promise<{ success: boolean; documentId?: number; error?: string }> {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 서류 등록
      const docResult = await client.query(`
        INSERT INTO claim_documents (
          claim_id, document_type, document_name, file_path, file_size, mime_type
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        claimId,
        document.documentType,
        document.documentName,
        document.filePath,
        document.fileSize || null,
        document.mimeType || null,
      ]);

      const documentId = docResult.rows[0].id;

      // 체크리스트 업데이트
      await this.updateChecklistAfterSubmission(claimId, document.documentType, client);

      // 감사 로그
      await AuditService.log({
        entityType: 'DOCUMENT',
        entityId: documentId,
        action: 'CREATE',
        additionalInfo: {
          claimId,
          documentType: document.documentType,
          fileName: document.documentName,
        },
      }, user);

      await client.query('COMMIT');
      return { success: true, documentId };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Submit document error:', error);
      return { success: false, error: '서류 제출 중 오류가 발생했습니다.' };
    } finally {
      client.release();
    }
  }

  // 체크리스트 업데이트
  private static async updateChecklistAfterSubmission(
    claimId: number,
    documentType: string,
    client: any
  ): Promise<void> {
    const checklistResult = await client.query(
      'SELECT * FROM document_checklists WHERE claim_id = $1',
      [claimId]
    );

    if (checklistResult.rows.length === 0) return;

    const checklist = checklistResult.rows[0];
    const requiredDocs = checklist.required_docs || [];
    let submittedDocs = checklist.submitted_docs || [];

    // 제출된 서류 추가
    if (!submittedDocs.some((d: any) => d.doc_type === documentType)) {
      submittedDocs.push({
        doc_type: documentType,
        submitted_at: new Date().toISOString(),
      });
    }

    // 미제출 서류 계산
    const submittedTypes = submittedDocs.map((d: any) => d.doc_type);
    const missingDocs = requiredDocs.filter(
      (d: any) => d.is_mandatory && !submittedTypes.includes(d.doc_type)
    );

    // 완료율 계산
    const mandatoryDocs = requiredDocs.filter((d: any) => d.is_mandatory);
    const submittedMandatory = mandatoryDocs.filter(
      (d: any) => submittedTypes.includes(d.doc_type)
    );
    const completionRate = mandatoryDocs.length > 0
      ? Math.round((submittedMandatory.length / mandatoryDocs.length) * 100)
      : 100;

    const status = completionRate === 100 ? 'COMPLETE' : 'INCOMPLETE';

    await client.query(`
      UPDATE document_checklists SET
        submitted_docs = $1,
        missing_docs = $2,
        completion_rate = $3,
        status = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE claim_id = $5
    `, [
      JSON.stringify(submittedDocs),
      JSON.stringify(missingDocs),
      completionRate,
      status,
      claimId,
    ]);
  }

  // 서류 검증
  static async verifyDocument(
    documentId: number,
    verificationData: {
      verificationType: string;
      isPassed: boolean;
      confidenceScore?: number;
      expectedValue?: string;
      actualValue?: string;
      discrepancy?: string;
      notes?: string;
    },
    user?: AuthUser
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 서류 정보 조회
      const docResult = await db.query(
        'SELECT * FROM claim_documents WHERE id = $1',
        [documentId]
      );

      if (docResult.rows.length === 0) {
        return { success: false, error: '서류를 찾을 수 없습니다.' };
      }

      const document = docResult.rows[0];

      // 검증 결과 저장
      await db.query(`
        INSERT INTO document_verifications (
          document_id, claim_id, verification_type,
          is_passed, confidence_score,
          expected_value, actual_value, discrepancy,
          verified_by, verifier_id, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        documentId,
        document.claim_id,
        verificationData.verificationType,
        verificationData.isPassed,
        verificationData.confidenceScore || null,
        verificationData.expectedValue || null,
        verificationData.actualValue || null,
        verificationData.discrepancy || null,
        user ? 'HUMAN' : 'AI',
        user?.id || null,
        verificationData.notes || null,
      ]);

      // 서류 상태 업데이트
      if (verificationData.isPassed) {
        await db.query(`
          UPDATE claim_documents SET
            is_verified = TRUE,
            verified_by = $1,
            verified_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [user?.name || 'AI', documentId]);
      }

      // 감사 로그
      await AuditService.log({
        entityType: 'DOCUMENT',
        entityId: documentId,
        action: 'VERIFY',
        additionalInfo: {
          verificationType: verificationData.verificationType,
          isPassed: verificationData.isPassed,
        },
      }, user);

      return { success: true };
    } catch (error) {
      logger.error('Verify document error:', error);
      return { success: false, error: '서류 검증 중 오류가 발생했습니다.' };
    }
  }

  // 추가 서류 요청
  static async requestAdditionalDocuments(
    claimId: number,
    documents: { docType: string; docName: string; reason: string }[],
    dueDate: Date,
    user: AuthUser
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 청구 업데이트
      await db.query(`
        UPDATE claims SET
          additional_docs_requested = TRUE,
          docs_request_date = CURRENT_TIMESTAMP,
          docs_due_date = $1,
          status = 'PENDING_DOCUMENTS'
        WHERE id = $2
      `, [dueDate, claimId]);

      // 체크리스트 업데이트
      await db.query(`
        UPDATE document_checklists SET
          additional_request = $1,
          request_sent_at = CURRENT_TIMESTAMP,
          request_due_date = $2
        WHERE claim_id = $3
      `, [JSON.stringify(documents), dueDate, claimId]);

      // 감사 로그
      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        action: 'DOCUMENT_REQUEST',
        additionalInfo: {
          requestedDocuments: documents,
          dueDate,
        },
      }, user);

      return { success: true };
    } catch (error) {
      logger.error('Request additional documents error:', error);
      return { success: false, error: '추가 서류 요청 중 오류가 발생했습니다.' };
    }
  }

  // 서류 면제 처리
  static async waiveDocument(
    claimId: number,
    documentType: string,
    reason: string,
    user: AuthUser
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const checklistResult = await db.query(
        'SELECT * FROM document_checklists WHERE claim_id = $1',
        [claimId]
      );

      if (checklistResult.rows.length === 0) {
        return { success: false, error: '체크리스트를 찾을 수 없습니다.' };
      }

      const checklist = checklistResult.rows[0];
      let waivedDocs = checklist.waived_docs || [];

      waivedDocs.push({
        doc_type: documentType,
        reason,
        waived_at: new Date().toISOString(),
        waived_by: user.name,
      });

      await db.query(`
        UPDATE document_checklists SET
          waived_docs = $1,
          waiver_reason = $2,
          waived_by = $3,
          waived_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE claim_id = $4
      `, [JSON.stringify(waivedDocs), reason, user.id, claimId]);

      // 감사 로그
      await AuditService.log({
        entityType: 'CLAIM',
        entityId: claimId,
        action: 'DOCUMENT_WAIVE',
        additionalInfo: {
          documentType,
          reason,
        },
      }, user);

      return { success: true };
    } catch (error) {
      logger.error('Waive document error:', error);
      return { success: false, error: '서류 면제 처리 중 오류가 발생했습니다.' };
    }
  }
}
