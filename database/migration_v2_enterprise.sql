-- ═══════════════════════════════════════════════════════════════════════════
-- InsurTech 엔터프라이즈 확장 마이그레이션 v2
-- 실제 보험사 수준 기능: 결재, 감사, 인증, 서류검증, 중복보험
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 사용자 및 인증 시스템
-- ═══════════════════════════════════════════════════════════════════════════

-- 1-1. 역할 정의
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    role_code VARCHAR(30) NOT NULL UNIQUE,
    role_name VARCHAR(50) NOT NULL,
    description TEXT,
    level INT NOT NULL DEFAULT 1,              -- 결재 레벨 (1: 담당자, 2: 팀장, 3: 부장, 4: 임원)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE roles IS '사용자 역할 정의';

-- 1-2. 권한 정의
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    permission_code VARCHAR(50) NOT NULL UNIQUE,
    permission_name VARCHAR(100) NOT NULL,
    category VARCHAR(30),                      -- CLAIM, POLICY, CUSTOMER, ADMIN, REPORT
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE permissions IS '시스템 권한 정의';

-- 1-3. 역할-권한 매핑
CREATE TABLE IF NOT EXISTS role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INT REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, permission_id)
);

-- 1-4. 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_code VARCHAR(20) NOT NULL UNIQUE,     -- 사번
    username VARCHAR(50) NOT NULL UNIQUE,      -- 로그인 ID
    password_hash VARCHAR(255) NOT NULL,

    -- 기본 정보
    name VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20),

    -- 조직 정보
    department VARCHAR(50),                    -- 부서
    team VARCHAR(50),                          -- 팀
    position VARCHAR(30),                      -- 직급
    role_id INT REFERENCES roles(id),

    -- 결재 정보
    approval_limit BIGINT DEFAULT 0,           -- 개인 결재 한도 금액
    can_final_approve BOOLEAN DEFAULT FALSE,   -- 최종 결재 가능 여부

    -- 상태
    status VARCHAR(20) DEFAULT 'ACTIVE',       -- ACTIVE, INACTIVE, LOCKED, RESIGNED
    last_login_at TIMESTAMP,
    login_fail_count INT DEFAULT 0,
    password_changed_at TIMESTAMP,

    -- 메타
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE users IS '시스템 사용자';

-- 1-5. 사용자 세션
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 결재 워크플로우 시스템
-- ═══════════════════════════════════════════════════════════════════════════

-- 2-1. 결재 라인 템플릿
CREATE TABLE IF NOT EXISTS approval_line_templates (
    id SERIAL PRIMARY KEY,
    template_code VARCHAR(30) NOT NULL UNIQUE,
    template_name VARCHAR(100) NOT NULL,

    -- 적용 조건
    claim_type VARCHAR(30),                    -- 청구 유형 (NULL이면 전체)
    min_amount BIGINT DEFAULT 0,               -- 최소 금액
    max_amount BIGINT,                         -- 최대 금액 (NULL이면 무제한)
    fraud_score_threshold DECIMAL(5,2),        -- 사기점수 기준

    -- 결재 라인 (JSON)
    approval_steps JSONB NOT NULL,             -- [{level, role_code, required, timeout_hours}]

    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 10,                   -- 조건 매칭 우선순위 (낮을수록 우선)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE approval_line_templates IS '결재 라인 템플릿';

-- 2-2. 청구별 결재 인스턴스
CREATE TABLE IF NOT EXISTS claim_approvals (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,
    template_id INT REFERENCES approval_line_templates(id),

    -- 결재 상태
    status VARCHAR(30) DEFAULT 'PENDING',      -- PENDING, IN_PROGRESS, APPROVED, REJECTED, RETURNED, CANCELLED
    current_step INT DEFAULT 1,                -- 현재 결재 단계
    total_steps INT NOT NULL,                  -- 총 결재 단계

    -- 결재 라인 스냅샷
    approval_line JSONB NOT NULL,              -- 결재 라인 상세 (시작 시점 스냅샷)

    -- 시간
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    due_date TIMESTAMP,                        -- 결재 기한

    -- 긴급 결재
    is_urgent BOOLEAN DEFAULT FALSE,
    urgent_reason TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE claim_approvals IS '청구별 결재 인스턴스';

-- 2-3. 결재 이력 상세
CREATE TABLE IF NOT EXISTS approval_history (
    id SERIAL PRIMARY KEY,
    claim_approval_id INT REFERENCES claim_approvals(id) ON DELETE CASCADE,
    claim_id INT REFERENCES claims(id),

    -- 단계 정보
    step_no INT NOT NULL,
    step_name VARCHAR(50),

    -- 결재자
    approver_id INT REFERENCES users(id),
    approver_name VARCHAR(50),
    approver_role VARCHAR(30),
    approver_department VARCHAR(50),

    -- 결정
    action VARCHAR(30) NOT NULL,               -- APPROVE, REJECT, RETURN, HOLD, DELEGATE, SKIP
    decision_amount BIGINT,                    -- 결정 금액 (수정한 경우)
    comment TEXT,

    -- 위임 (대결재)
    delegated_from_id INT REFERENCES users(id),
    delegation_reason TEXT,

    -- 시간
    received_at TIMESTAMP,                     -- 결재 도착 시간
    decided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_time_minutes INT,               -- 처리 소요시간

    -- 메타
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE approval_history IS '결재 이력 상세';

-- 2-4. 결재 대기함
CREATE TABLE IF NOT EXISTS approval_inbox (
    id SERIAL PRIMARY KEY,
    claim_approval_id INT REFERENCES claim_approvals(id) ON DELETE CASCADE,
    claim_id INT REFERENCES claims(id),
    user_id INT REFERENCES users(id),

    step_no INT NOT NULL,

    -- 상태
    status VARCHAR(20) DEFAULT 'PENDING',      -- PENDING, PROCESSING, COMPLETED
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP,

    -- 기한
    due_date TIMESTAMP,
    is_overdue BOOLEAN DEFAULT FALSE,
    reminder_sent_at TIMESTAMP,

    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE approval_inbox IS '결재 대기함';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 감사 로그 시스템 (Audit Trail)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3-1. 감사 로그 메인
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,

    -- 대상
    entity_type VARCHAR(50) NOT NULL,          -- CLAIM, POLICY, CUSTOMER, USER, APPROVAL
    entity_id INT NOT NULL,
    entity_name VARCHAR(100),                  -- 표시용 이름 (청구번호, 고객명 등)

    -- 행위
    action VARCHAR(50) NOT NULL,               -- CREATE, UPDATE, DELETE, VIEW, APPROVE, REJECT, LOGIN, LOGOUT
    action_category VARCHAR(30),               -- DATA, APPROVAL, AUTH, SYSTEM

    -- 변경 내용
    old_value JSONB,
    new_value JSONB,
    changed_fields TEXT[],                     -- 변경된 필드 목록

    -- 행위자
    user_id INT REFERENCES users(id),
    user_name VARCHAR(50),
    user_role VARCHAR(30),
    user_department VARCHAR(50),

    -- 접속 정보
    ip_address VARCHAR(45),
    user_agent TEXT,
    session_id VARCHAR(100),

    -- 결과
    status VARCHAR(20) DEFAULT 'SUCCESS',      -- SUCCESS, FAILED, BLOCKED
    error_message TEXT,

    -- 메타
    request_id VARCHAR(50),                    -- 요청 추적 ID
    additional_info JSONB,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE audit_logs IS '시스템 감사 로그 (금감원 대응용)';

-- 3-2. 민감 데이터 접근 로그
CREATE TABLE IF NOT EXISTS sensitive_data_access_logs (
    id BIGSERIAL PRIMARY KEY,
    audit_log_id BIGINT REFERENCES audit_logs(id),

    data_type VARCHAR(30) NOT NULL,            -- PERSONAL_INFO, MEDICAL_INFO, FINANCIAL_INFO
    data_fields TEXT[],                        -- 접근한 필드 목록

    -- 대상
    customer_id INT REFERENCES customers(id),

    -- 접근 사유
    access_reason VARCHAR(100),

    -- 마스킹 여부
    was_masked BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE sensitive_data_access_logs IS '민감 정보 접근 로그';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 서류 검증 시스템
-- ═══════════════════════════════════════════════════════════════════════════

-- 4-1. 서류 요건 정의
CREATE TABLE IF NOT EXISTS document_requirements (
    id SERIAL PRIMARY KEY,
    requirement_code VARCHAR(30) NOT NULL UNIQUE,

    -- 조건
    claim_type VARCHAR(30),                    -- 청구 유형 (NULL이면 전체)
    is_hospitalization BOOLEAN,                -- 입원 여부
    is_surgery BOOLEAN,                        -- 수술 여부
    min_amount BIGINT,                         -- 최소 청구금액

    -- 필수 서류
    required_documents JSONB NOT NULL,         -- [{doc_type, doc_name, is_mandatory, description}]

    -- 설명
    description TEXT,

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE document_requirements IS '청구 유형별 필수 서류 정의';

-- 4-2. 서류 체크리스트 (청구별)
CREATE TABLE IF NOT EXISTS document_checklists (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,
    requirement_id INT REFERENCES document_requirements(id),

    -- 서류 현황
    required_docs JSONB NOT NULL,              -- 필요한 서류 목록
    submitted_docs JSONB DEFAULT '[]',         -- 제출된 서류 목록
    missing_docs JSONB DEFAULT '[]',           -- 미제출 서류 목록

    -- 상태
    status VARCHAR(30) DEFAULT 'INCOMPLETE',   -- INCOMPLETE, COMPLETE, WAIVED
    completion_rate DECIMAL(5,2) DEFAULT 0,    -- 완료율 %

    -- 면제
    waived_docs JSONB DEFAULT '[]',            -- 면제된 서류
    waiver_reason TEXT,
    waived_by INT REFERENCES users(id),
    waived_at TIMESTAMP,

    -- 추가 서류 요청
    additional_request JSONB,                  -- 추가 요청 서류
    request_sent_at TIMESTAMP,
    request_due_date DATE,

    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE document_checklists IS '청구별 서류 체크리스트';

-- 4-3. 서류 검증 결과
CREATE TABLE IF NOT EXISTS document_verifications (
    id SERIAL PRIMARY KEY,
    document_id INT REFERENCES claim_documents(id) ON DELETE CASCADE,
    claim_id INT REFERENCES claims(id),

    -- 검증 항목
    verification_type VARCHAR(30) NOT NULL,    -- OCR_MATCH, AMOUNT_MATCH, DATE_MATCH, SIGNATURE, SEAL

    -- 결과
    is_passed BOOLEAN,
    confidence_score DECIMAL(5,2),

    -- 비교 데이터
    expected_value TEXT,
    actual_value TEXT,
    discrepancy TEXT,

    -- 검증 방법
    verified_by VARCHAR(30),                   -- AI, HUMAN, SYSTEM
    verifier_id INT REFERENCES users(id),

    -- 상세
    verification_detail JSONB,
    notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE document_verifications IS '서류 검증 결과';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 중복보험 처리 시스템
-- ═══════════════════════════════════════════════════════════════════════════

-- 5-1. 타사 보험 정보
CREATE TABLE IF NOT EXISTS other_insurance_info (
    id SERIAL PRIMARY KEY,
    customer_id INT REFERENCES customers(id),

    -- 타사 정보
    insurance_company VARCHAR(50) NOT NULL,    -- 보험사명
    policy_number VARCHAR(50),                 -- 증권번호 (알 수 있는 경우)
    product_type VARCHAR(30),                  -- REAL_LOSS(실손), FIXED(정액)
    product_name VARCHAR(100),

    -- 보장 정보
    coverage_types TEXT[],                     -- 보장 유형
    coverage_start_date DATE,
    coverage_end_date DATE,

    -- 상태
    is_active BOOLEAN DEFAULT TRUE,

    -- 입력 방식
    source VARCHAR(30),                        -- SELF_REPORT(고객신고), INQUIRY(조회), CLAIM_DOC(청구서류)
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE other_insurance_info IS '고객의 타사 보험 정보';

-- 5-2. 실손 조회 결과 (손해보험협회 연동 시뮬레이션)
CREATE TABLE IF NOT EXISTS real_loss_inquiry_results (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,
    customer_id INT REFERENCES customers(id),

    -- 조회 정보
    inquiry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    inquiry_reference VARCHAR(50),             -- 조회 참조번호

    -- 동일 치료건 타사 청구 내역
    other_claims JSONB,                        -- [{company, claim_date, treatment_date, paid_amount, status}]
    total_other_paid BIGINT DEFAULT 0,         -- 타사 지급 총액

    -- 중복 판정
    is_duplicate BOOLEAN DEFAULT FALSE,
    duplicate_type VARCHAR(30),                -- FULL(전액중복), PARTIAL(일부중복), NONE

    -- 비례분담 계산
    our_share_rate DECIMAL(5,4),               -- 우리 분담률
    calculated_our_amount BIGINT,              -- 분담 후 지급액

    -- 상태
    status VARCHAR(20) DEFAULT 'PENDING',      -- PENDING, COMPLETED, FAILED, NOT_FOUND

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE real_loss_inquiry_results IS '실손보험 타사 조회 결과';

-- 5-3. 중복보험 분담금 계산
CREATE TABLE IF NOT EXISTS duplicate_insurance_calculations (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,
    inquiry_result_id INT REFERENCES real_loss_inquiry_results(id),

    -- 분담 방식
    calculation_method VARCHAR(30) NOT NULL,   -- PRO_RATA(비례분담), EXCESS(초과분담), PRIMARY(우선분담)

    -- 각사 정보
    companies JSONB NOT NULL,                  -- [{company, policy_limit, share_rate, share_amount}]
    total_companies INT,

    -- 계산 내역
    total_medical_expense BIGINT,              -- 총 의료비
    total_coverage_limit BIGINT,               -- 각사 한도 합계

    -- 당사 분담
    our_share_rate DECIMAL(5,4),
    our_share_amount BIGINT,

    -- 최종
    final_payout_amount BIGINT,                -- 최종 지급액

    -- 계산식
    calculation_formula TEXT,
    calculation_detail JSONB,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE duplicate_insurance_calculations IS '중복보험 분담금 계산';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 약관 버전 관리
-- ═══════════════════════════════════════════════════════════════════════════

-- 6-1. 약관 버전
CREATE TABLE IF NOT EXISTS policy_terms_versions (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(30) NOT NULL,
    version VARCHAR(20) NOT NULL,

    -- 적용 기간
    effective_date DATE NOT NULL,
    expiry_date DATE,

    -- 약관 내용
    terms_content JSONB NOT NULL,              -- 전체 약관 내용

    -- 변경 사항
    change_summary TEXT,
    major_changes JSONB,                       -- 주요 변경 사항

    -- 상태
    status VARCHAR(20) DEFAULT 'ACTIVE',       -- DRAFT, ACTIVE, EXPIRED

    -- 승인
    approved_by INT REFERENCES users(id),
    approved_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(product_code, version)
);

COMMENT ON TABLE policy_terms_versions IS '약관 버전 관리';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 사기 탐지 고도화
-- ═══════════════════════════════════════════════════════════════════════════

-- 7-1. 고객별 청구 패턴 분석
CREATE TABLE IF NOT EXISTS customer_claim_patterns (
    id SERIAL PRIMARY KEY,
    customer_id INT REFERENCES customers(id) ON DELETE CASCADE,

    -- 기간
    analysis_period_start DATE,
    analysis_period_end DATE,

    -- 통계
    total_claims INT DEFAULT 0,
    total_claimed_amount BIGINT DEFAULT 0,
    total_paid_amount BIGINT DEFAULT 0,
    avg_claim_amount BIGINT,

    -- 패턴 분석
    claim_frequency_score DECIMAL(5,2),        -- 청구 빈도 점수
    amount_pattern_score DECIMAL(5,2),         -- 금액 패턴 점수
    diagnosis_variety_score DECIMAL(5,2),      -- 진단 다양성 점수
    hospital_concentration_score DECIMAL(5,2), -- 병원 집중도 점수

    -- 이상 패턴
    anomalies JSONB,                           -- 탐지된 이상 패턴

    -- 종합
    total_risk_score DECIMAL(5,2),
    risk_level VARCHAR(20),                    -- LOW, MEDIUM, HIGH, CRITICAL

    analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE customer_claim_patterns IS '고객별 청구 패턴 분석';

-- 7-2. 병원-환자 네트워크
CREATE TABLE IF NOT EXISTS hospital_patient_network (
    id SERIAL PRIMARY KEY,

    hospital_name VARCHAR(100) NOT NULL,

    -- 통계
    total_patients INT DEFAULT 0,
    total_claims INT DEFAULT 0,
    total_amount BIGINT DEFAULT 0,
    avg_amount_per_claim BIGINT,

    -- 네트워크 분석
    patient_overlap_score DECIMAL(5,2),        -- 환자 중복 점수 (같은 환자가 자주 오는 정도)
    referral_pattern_score DECIMAL(5,2),       -- 의뢰 패턴 점수

    -- 위험도
    risk_score DECIMAL(5,2),
    is_flagged BOOLEAN DEFAULT FALSE,
    flag_reason TEXT,

    analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE hospital_patient_network IS '병원-환자 네트워크 분석';

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 청구 상태 확장
-- ═══════════════════════════════════════════════════════════════════════════

-- claims 테이블에 컬럼 추가 (없는 경우)
DO $$
BEGIN
    -- 보류 관련
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'hold_status') THEN
        ALTER TABLE claims ADD COLUMN hold_status VARCHAR(30);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'hold_reason') THEN
        ALTER TABLE claims ADD COLUMN hold_reason TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'hold_until') THEN
        ALTER TABLE claims ADD COLUMN hold_until DATE;
    END IF;

    -- 추가 서류 요청
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'additional_docs_requested') THEN
        ALTER TABLE claims ADD COLUMN additional_docs_requested BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'docs_request_date') THEN
        ALTER TABLE claims ADD COLUMN docs_request_date TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'docs_due_date') THEN
        ALTER TABLE claims ADD COLUMN docs_due_date DATE;
    END IF;

    -- 결재 관련
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'approval_status') THEN
        ALTER TABLE claims ADD COLUMN approval_status VARCHAR(30) DEFAULT 'NOT_STARTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'current_approver_id') THEN
        ALTER TABLE claims ADD COLUMN current_approver_id INT REFERENCES users(id);
    END IF;

    -- 중복보험
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'has_other_insurance') THEN
        ALTER TABLE claims ADD COLUMN has_other_insurance BOOLEAN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'claims' AND column_name = 'duplicate_insurance_checked') THEN
        ALTER TABLE claims ADD COLUMN duplicate_insurance_checked BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. 인덱스 추가
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_inbox_user ON approval_inbox(user_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_history_claim ON approval_history(claim_id);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department);

CREATE INDEX IF NOT EXISTS idx_document_checklists_claim ON document_checklists(claim_id);
CREATE INDEX IF NOT EXISTS idx_document_verifications_claim ON document_verifications(claim_id);

CREATE INDEX IF NOT EXISTS idx_other_insurance_customer ON other_insurance_info(customer_id);
CREATE INDEX IF NOT EXISTS idx_real_loss_inquiry_claim ON real_loss_inquiry_results(claim_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. 초기 데이터
-- ═══════════════════════════════════════════════════════════════════════════

-- 역할
INSERT INTO roles (role_code, role_name, description, level) VALUES
('ADMIN', '시스템관리자', '시스템 전체 관리 권한', 99),
('EXECUTIVE', '임원', '최종 결재 및 전체 승인', 4),
('MANAGER', '부장', '고액 청구 결재', 3),
('TEAM_LEAD', '팀장', '일반 청구 결재', 2),
('REVIEWER', '심사역', '청구 심사 담당', 1),
('INVESTIGATOR', '조사역', '사기 조사 담당', 1),
('VIEWER', '조회자', '조회만 가능', 0)
ON CONFLICT (role_code) DO NOTHING;

-- 권한
INSERT INTO permissions (permission_code, permission_name, category) VALUES
-- 청구 관련
('CLAIM_VIEW', '청구 조회', 'CLAIM'),
('CLAIM_CREATE', '청구 등록', 'CLAIM'),
('CLAIM_REVIEW', '청구 심사', 'CLAIM'),
('CLAIM_APPROVE', '청구 승인', 'CLAIM'),
('CLAIM_REJECT', '청구 거절', 'CLAIM'),
('CLAIM_HOLD', '청구 보류', 'CLAIM'),
('CLAIM_RETURN', '청구 반려', 'CLAIM'),
('CLAIM_AMOUNT_MODIFY', '청구 금액 수정', 'CLAIM'),
-- 결재 관련
('APPROVAL_LEVEL_1', '1단계 결재', 'APPROVAL'),
('APPROVAL_LEVEL_2', '2단계 결재', 'APPROVAL'),
('APPROVAL_LEVEL_3', '3단계 결재', 'APPROVAL'),
('APPROVAL_FINAL', '최종 결재', 'APPROVAL'),
('APPROVAL_SKIP', '결재 생략', 'APPROVAL'),
-- 고객/증권 관련
('CUSTOMER_VIEW', '고객 조회', 'CUSTOMER'),
('CUSTOMER_MODIFY', '고객 정보 수정', 'CUSTOMER'),
('POLICY_VIEW', '증권 조회', 'POLICY'),
-- 관리 관련
('USER_MANAGE', '사용자 관리', 'ADMIN'),
('ROLE_MANAGE', '역할 관리', 'ADMIN'),
('SYSTEM_CONFIG', '시스템 설정', 'ADMIN'),
('AUDIT_VIEW', '감사로그 조회', 'ADMIN'),
-- 리포트
('REPORT_VIEW', '리포트 조회', 'REPORT'),
('REPORT_EXPORT', '리포트 내보내기', 'REPORT')
ON CONFLICT (permission_code) DO NOTHING;

-- 역할-권한 매핑 (심사역)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.role_code = 'REVIEWER' AND p.permission_code IN (
    'CLAIM_VIEW', 'CLAIM_REVIEW', 'CLAIM_HOLD', 'CUSTOMER_VIEW', 'POLICY_VIEW', 'REPORT_VIEW'
) ON CONFLICT DO NOTHING;

-- 역할-권한 매핑 (팀장)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.role_code = 'TEAM_LEAD' AND p.permission_code IN (
    'CLAIM_VIEW', 'CLAIM_REVIEW', 'CLAIM_APPROVE', 'CLAIM_REJECT', 'CLAIM_HOLD', 'CLAIM_RETURN',
    'APPROVAL_LEVEL_1', 'APPROVAL_LEVEL_2', 'CUSTOMER_VIEW', 'POLICY_VIEW', 'REPORT_VIEW'
) ON CONFLICT DO NOTHING;

-- 역할-권한 매핑 (부장)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.role_code = 'MANAGER' AND p.permission_code IN (
    'CLAIM_VIEW', 'CLAIM_REVIEW', 'CLAIM_APPROVE', 'CLAIM_REJECT', 'CLAIM_HOLD', 'CLAIM_RETURN',
    'CLAIM_AMOUNT_MODIFY', 'APPROVAL_LEVEL_1', 'APPROVAL_LEVEL_2', 'APPROVAL_LEVEL_3',
    'CUSTOMER_VIEW', 'CUSTOMER_MODIFY', 'POLICY_VIEW', 'REPORT_VIEW', 'REPORT_EXPORT'
) ON CONFLICT DO NOTHING;

-- 역할-권한 매핑 (관리자)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.role_code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- 샘플 사용자 (비밀번호: 'password123' -> bcrypt 해시)
INSERT INTO users (user_code, username, password_hash, name, email, department, team, position, role_id, approval_limit, can_final_approve) VALUES
('EMP001', 'admin', '$2b$10$rIC/Hx.yQHBVQHqf/1xj8OvQZvjsKxvAz.rM1m1Py1qM8qzKYjK2.', '관리자', 'admin@insurtech.com', '정보시스템부', 'IT팀', '과장', (SELECT id FROM roles WHERE role_code = 'ADMIN'), 999999999, TRUE),
('EMP002', 'reviewer1', '$2b$10$rIC/Hx.yQHBVQHqf/1xj8OvQZvjsKxvAz.rM1m1Py1qM8qzKYjK2.', '김심사', 'reviewer1@insurtech.com', '보상부', '심사1팀', '대리', (SELECT id FROM roles WHERE role_code = 'REVIEWER'), 1000000, FALSE),
('EMP003', 'reviewer2', '$2b$10$rIC/Hx.yQHBVQHqf/1xj8OvQZvjsKxvAz.rM1m1Py1qM8qzKYjK2.', '이심사', 'reviewer2@insurtech.com', '보상부', '심사1팀', '대리', (SELECT id FROM roles WHERE role_code = 'REVIEWER'), 1000000, FALSE),
('EMP004', 'teamlead1', '$2b$10$rIC/Hx.yQHBVQHqf/1xj8OvQZvjsKxvAz.rM1m1Py1qM8qzKYjK2.', '박팀장', 'teamlead1@insurtech.com', '보상부', '심사1팀', '팀장', (SELECT id FROM roles WHERE role_code = 'TEAM_LEAD'), 5000000, FALSE),
('EMP005', 'manager1', '$2b$10$rIC/Hx.yQHBVQHqf/1xj8OvQZvjsKxvAz.rM1m1Py1qM8qzKYjK2.', '최부장', 'manager1@insurtech.com', '보상부', '', '부장', (SELECT id FROM roles WHERE role_code = 'MANAGER'), 30000000, FALSE),
('EMP006', 'executive1', '$2b$10$rIC/Hx.yQHBVQHqf/1xj8OvQZvjsKxvAz.rM1m1Py1qM8qzKYjK2.', '정상무', 'exec1@insurtech.com', '보상부', '', '상무', (SELECT id FROM roles WHERE role_code = 'EXECUTIVE'), 100000000, TRUE)
ON CONFLICT (username) DO NOTHING;

-- 결재 라인 템플릿
INSERT INTO approval_line_templates (template_code, template_name, claim_type, min_amount, max_amount, fraud_score_threshold, approval_steps, priority) VALUES
-- 소액 자동승인 (100만원 이하, 사기점수 30 이하)
('AUTO_APPROVE', '자동승인', NULL, 0, 1000000, 30, '[{"level":1,"role_code":"SYSTEM","required":false,"timeout_hours":0}]', 1),
-- 일반 (100만원~500만원)
('NORMAL_SMALL', '일반심사(소)', NULL, 1000001, 5000000, NULL, '[{"level":1,"role_code":"REVIEWER","required":true,"timeout_hours":24},{"level":2,"role_code":"TEAM_LEAD","required":true,"timeout_hours":24}]', 10),
-- 일반 (500만원~3000만원)
('NORMAL_MEDIUM', '일반심사(중)', NULL, 5000001, 30000000, NULL, '[{"level":1,"role_code":"REVIEWER","required":true,"timeout_hours":24},{"level":2,"role_code":"TEAM_LEAD","required":true,"timeout_hours":24},{"level":3,"role_code":"MANAGER","required":true,"timeout_hours":48}]', 10),
-- 고액 (3000만원 초과)
('HIGH_AMOUNT', '고액심사', NULL, 30000001, NULL, NULL, '[{"level":1,"role_code":"REVIEWER","required":true,"timeout_hours":24},{"level":2,"role_code":"TEAM_LEAD","required":true,"timeout_hours":24},{"level":3,"role_code":"MANAGER","required":true,"timeout_hours":48},{"level":4,"role_code":"EXECUTIVE","required":true,"timeout_hours":72}]', 10),
-- 사기 의심 (점수 60 이상)
('FRAUD_SUSPECT', '사기의심건', NULL, 0, NULL, 60, '[{"level":1,"role_code":"INVESTIGATOR","required":true,"timeout_hours":48},{"level":2,"role_code":"TEAM_LEAD","required":true,"timeout_hours":24},{"level":3,"role_code":"MANAGER","required":true,"timeout_hours":48}]', 5)
ON CONFLICT (template_code) DO NOTHING;

-- 서류 요건
INSERT INTO document_requirements (requirement_code, claim_type, is_hospitalization, is_surgery, min_amount, required_documents, description) VALUES
('REQ_HOSP_BASIC', 'HOSPITALIZATION', TRUE, FALSE, 0,
 '[{"doc_type":"DIAGNOSIS","doc_name":"진단서","is_mandatory":true,"description":"최종 확정 진단서"},
   {"doc_type":"RECEIPT","doc_name":"진료비 영수증","is_mandatory":true,"description":"원본 또는 사본"},
   {"doc_type":"ADMISSION","doc_name":"입퇴원확인서","is_mandatory":true,"description":"입원기간 확인용"},
   {"doc_type":"DETAIL_RECEIPT","doc_name":"진료비 세부내역서","is_mandatory":false,"description":"100만원 초과 시 필수"}]',
 '입원 청구 기본 서류'),
('REQ_HOSP_SURGERY', 'HOSPITALIZATION', TRUE, TRUE, 0,
 '[{"doc_type":"DIAGNOSIS","doc_name":"진단서","is_mandatory":true,"description":"최종 확정 진단서"},
   {"doc_type":"RECEIPT","doc_name":"진료비 영수증","is_mandatory":true,"description":"원본 또는 사본"},
   {"doc_type":"ADMISSION","doc_name":"입퇴원확인서","is_mandatory":true,"description":"입원기간 확인용"},
   {"doc_type":"SURGERY","doc_name":"수술확인서","is_mandatory":true,"description":"수술명, 수술일자 확인"},
   {"doc_type":"DETAIL_RECEIPT","doc_name":"진료비 세부내역서","is_mandatory":true,"description":"수술 상세 내역"}]',
 '입원+수술 청구 서류'),
('REQ_OUTPATIENT', 'OUTPATIENT', FALSE, FALSE, 0,
 '[{"doc_type":"RECEIPT","doc_name":"진료비 영수증","is_mandatory":true,"description":"원본 또는 사본"},
   {"doc_type":"PRESCRIPTION","doc_name":"처방전","is_mandatory":false,"description":"약제비 청구 시"}]',
 '통원 청구 서류')
ON CONFLICT (requirement_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. 트리거
-- ═══════════════════════════════════════════════════════════════════════════

-- 청구 상태 변경 시 이력 기록
CREATE OR REPLACE FUNCTION log_claim_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        NEW.status_history = COALESCE(OLD.status_history, '[]'::jsonb) ||
            jsonb_build_object(
                'from', OLD.status,
                'to', NEW.status,
                'changed_at', CURRENT_TIMESTAMP,
                'changed_by', COALESCE(NEW.approved_by, 'SYSTEM')
            );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_claim_status_change ON claims;
CREATE TRIGGER tr_claim_status_change
    BEFORE UPDATE ON claims
    FOR EACH ROW
    EXECUTE FUNCTION log_claim_status_change();

-- users 업데이트 트리거
DROP TRIGGER IF EXISTS tr_users_updated ON users;
CREATE TRIGGER tr_users_updated
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- ═══════════════════════════════════════════════════════════════════════════
-- 완료
-- ═══════════════════════════════════════════════════════════════════════════
