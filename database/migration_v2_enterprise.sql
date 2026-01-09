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
-- ═══════════════════════════════════════════════════════════════════════════
-- 상세 Mock 데이터 - 청구 상세보기용
-- ═══════════════════════════════════════════════════════════════════════════

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. 청구 항목 상세 (claim_items) - 기존 청구 5건에 대한 항목별 산정 내역
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- CLM-2024-00001 (홍길동 - 급성 충수염 + 복강경 충수절제술)
INSERT INTO claim_items (claim_id, policy_coverage_id, item_type, item_name, sequence_no, claimed_amount, calculation_base, base_amount_type, deductible_applied, payout_rate_applied, days_applied, reduction_rate, reduction_amount, limit_exceeded_amount, calculated_amount, approved_amount, rejected_amount, calculation_formula, calculation_detail) VALUES
-- 입원 의료비 (급여)
(1, 1, 'HOSP_MEDICAL', '입원의료비(급여)', 1, 1200000, 1200000, 'MEDICAL_EXPENSE', 100000, 90, 4, 0, 0, 0, 990000, 990000, 0,
'(1,200,000원 - 100,000원) × 90% = 990,000원',
'{"급여항목": 1200000, "본인부담금": 100000, "지급률": 90, "산정액": 990000}'::jsonb),

-- 입원 의료비 (비급여)
(1, 2, 'HOSP_MEDICAL', '입원의료비(비급여)', 2, 320000, 320000, 'MEDICAL_EXPENSE', 200000, 80, 4, 0, 0, 0, 96000, 96000, 0,
'(320,000원 - 200,000원) × 80% = 96,000원',
'{"비급여항목": 320000, "본인부담금": 200000, "지급률": 80, "산정액": 96000}'::jsonb),

-- 입원 일당
(1, 3, 'HOSP_DAILY', '질병입원일당', 3, 200000, 50000, 'DAILY_RATE', 0, 100, 4, 0, 0, 0, 200000, 200000, 0,
'50,000원 × 4일 = 200,000원',
'{"일당단가": 50000, "입원일수": 4, "산정액": 200000}'::jsonb),

-- 수술비 (2종)
(1, 5, 'SURGERY', '질병수술비(2종)', 4, 600000, 600000, 'FIXED_AMOUNT', 0, 100, NULL, 0, 0, 0, 600000, 600000, 0,
'2종 수술비 = 600,000원',
'{"수술등급": 2, "가입금액": 600000, "산정액": 600000}'::jsonb);

-- CLM-2024-00002 (김철수 - 담석증 + 복강경 담낭절제술)
INSERT INTO claim_items (claim_id, policy_coverage_id, item_type, item_name, sequence_no, claimed_amount, calculation_base, base_amount_type, deductible_applied, payout_rate_applied, days_applied, reduction_rate, reduction_amount, limit_exceeded_amount, calculated_amount, approved_amount, rejected_amount, calculation_formula, calculation_detail) VALUES
-- 입원 의료비 (급여)
(2, 9, 'HOSP_MEDICAL', '입원의료비(급여)', 1, 2800000, 2800000, 'MEDICAL_EXPENSE', 100000, 90, 3, 0, 0, 0, 2430000, 2430000, 0,
'(2,800,000원 - 100,000원) × 90% = 2,430,000원',
'{"급여항목": 2800000, "본인부담금": 100000, "지급률": 90, "산정액": 2430000}'::jsonb),

-- 입원 의료비 (비급여)
(2, 10, 'HOSP_MEDICAL', '입원의료비(비급여)', 2, 700000, 700000, 'MEDICAL_EXPENSE', 200000, 80, 3, 0, 0, 0, 400000, 400000, 0,
'(700,000원 - 200,000원) × 80% = 400,000원',
'{"비급여항목": 700000, "본인부담금": 200000, "지급률": 80, "산정액": 400000}'::jsonb),

-- 입원 일당
(2, 11, 'HOSP_DAILY', '질병입원일당', 3, 300000, 100000, 'DAILY_RATE', 0, 100, 3, 0, 0, 0, 300000, 300000, 0,
'100,000원 × 3일 = 300,000원',
'{"일당단가": 100000, "입원일수": 3, "산정액": 300000}'::jsonb),

-- 수술비 (2종)
(2, 13, 'SURGERY', '질병수술비(2종)', 4, 1000000, 1000000, 'FIXED_AMOUNT', 0, 100, NULL, 0, 0, 0, 1000000, 1000000, 0,
'2종 수술비 = 1,000,000원',
'{"수술등급": 2, "가입금액": 1000000, "산정액": 1000000}'::jsonb);

-- CLM-2024-00003 (이영희 - 폐렴 통원 - 감액기간 적용)
INSERT INTO claim_items (claim_id, policy_coverage_id, item_type, item_name, sequence_no, claimed_amount, calculation_base, base_amount_type, deductible_applied, payout_rate_applied, days_applied, reduction_rate, reduction_amount, limit_exceeded_amount, calculated_amount, approved_amount, rejected_amount, calculation_formula, calculation_detail) VALUES
-- 통원 외래 (감액 50% 적용)
(3, 18, 'OUTPATIENT', '통원의료비(급여)', 1, 70000, 70000, 'MEDICAL_EXPENSE', 10000, 90, 1, 50, 27000, 0, 54000, 27000, 27000,
'[(70,000원 - 10,000원) × 90%] × 50% = 27,000원 (감액기간 적용)',
'{"급여항목": 70000, "공제금액": 10000, "지급률": 90, "산정전액": 54000, "감액률": 50, "감액금액": 27000, "최종산정액": 27000, "거절사유": "감액기간 적용"}'::jsonb),

-- 통원 비급여 (감액 50% 적용)
(3, 19, 'OUTPATIENT', '통원의료비(비급여)', 2, 15000, 15000, 'MEDICAL_EXPENSE', 30000, 80, 1, 50, 0, 0, 0, 0, 15000,
'15,000원 < 30,000원 공제금액 → 지급 불가',
'{"비급여항목": 15000, "공제금액": 30000, "산정액": 0, "거절사유": "공제금액 미만"}'::jsonb);

-- CLM-2024-00004 (박민수 - 요통 입원 - 사기 의심)
INSERT INTO claim_items (claim_id, policy_coverage_id, item_type, item_name, sequence_no, claimed_amount, calculation_base, base_amount_type, deductible_applied, payout_rate_applied, days_applied, reduction_rate, reduction_amount, limit_exceeded_amount, calculated_amount, approved_amount, rejected_amount, rejection_code, rejection_reason, calculation_formula, calculation_detail) VALUES
-- 입원 의료비 (심사 보류)
(4, NULL, 'HOSP_MEDICAL', '입원의료비(급여)', 1, 1500000, 1500000, 'MEDICAL_EXPENSE', 100000, 90, 9, 0, 0, 0, 1260000, 0, 0,
'PENDING_REVIEW', '사기 의심으로 인한 정밀 심사 필요',
'(1,500,000원 - 100,000원) × 90% = 1,260,000원 (심사 보류중)',
'{"급여항목": 1500000, "본인부담금": 100000, "지급률": 90, "산정액": 1260000, "상태": "심사보류", "사유": "요통 반복청구 패턴 감지"}'::jsonb),

-- 입원 의료비 비급여 (심사 보류)
(4, NULL, 'HOSP_MEDICAL', '입원의료비(비급여)', 2, 600000, 600000, 'MEDICAL_EXPENSE', 200000, 80, 9, 0, 0, 0, 320000, 0, 0,
'PENDING_REVIEW', '사기 의심으로 인한 정밀 심사 필요',
'(600,000원 - 200,000원) × 80% = 320,000원 (심사 보류중)',
'{"비급여항목": 600000, "본인부담금": 200000, "지급률": 80, "산정액": 320000, "상태": "심사보류"}'::jsonb);

-- CLM-2024-00005 (정수진 - 심근경색 + PCI 수술)
INSERT INTO claim_items (claim_id, policy_coverage_id, item_type, item_name, sequence_no, claimed_amount, calculation_base, base_amount_type, deductible_applied, payout_rate_applied, days_applied, reduction_rate, reduction_amount, limit_exceeded_amount, calculated_amount, approved_amount, rejected_amount, calculation_formula, calculation_detail) VALUES
-- 입원 의료비 (급여) - 고액
(5, 21, 'HOSP_MEDICAL', '입원의료비(급여)', 1, 10000000, 10000000, 'MEDICAL_EXPENSE', 100000, 90, 7, 0, 0, 0, 8910000, 8910000, 0,
'(10,000,000원 - 100,000원) × 90% = 8,910,000원',
'{"급여항목": 10000000, "본인부담금": 100000, "지급률": 90, "산정액": 8910000, "고액청구": true}'::jsonb),

-- 입원 의료비 (비급여)
(5, 22, 'HOSP_MEDICAL', '입원의료비(비급여)', 2, 2000000, 2000000, 'MEDICAL_EXPENSE', 200000, 80, 7, 0, 0, 0, 1440000, 1440000, 0,
'(2,000,000원 - 200,000원) × 80% = 1,440,000원',
'{"비급여항목": 2000000, "본인부담금": 200000, "지급률": 80, "산정액": 1440000}'::jsonb),

-- 입원 일당
(5, 23, 'HOSP_DAILY', '질병입원일당', 3, 700000, 100000, 'DAILY_RATE', 0, 100, 7, 0, 0, 0, 700000, 700000, 0,
'100,000원 × 7일 = 700,000원',
'{"일당단가": 100000, "입원일수": 7, "산정액": 700000}'::jsonb),

-- 수술비 (4종 - PCI)
(5, 25, 'SURGERY', '질병수술비(4종)', 4, 3000000, 3000000, 'FIXED_AMOUNT', 0, 100, NULL, 0, 0, 0, 3000000, 3000000, 0,
'4종 수술비(경피적 관상동맥중재술) = 3,000,000원',
'{"수술등급": 4, "가입금액": 3000000, "산정액": 3000000, "수술명": "PCI"}'::jsonb);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. 청구 서류 (claim_documents)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- CLM-2024-00001 서류
INSERT INTO claim_documents (claim_id, document_type, document_name, file_path, file_size, mime_type, ocr_status, ocr_result, ocr_confidence, ocr_model_used, ocr_processed_at, is_verified, verified_by, verified_at) VALUES
(1, 'RECEIPT', '진료비영수증_20241214.pdf', '/uploads/claims/CLM-2024-00001/receipt.pdf', 245678, 'application/pdf', 'COMPLETED',
'{"병원명": "서울대학교병원", "환자명": "홍길동", "진료기간": "2024-12-10 ~ 2024-12-14", "총진료비": 1520000, "급여": 1200000, "비급여": 320000, "본인부담금": 152000}'::jsonb,
0.95, 'claude-3.5-sonnet', '2024-12-15 09:32:15', TRUE, 'system', '2024-12-15 09:35:20'),

(1, 'DIAGNOSIS', '진단서_급성충수염.pdf', '/uploads/claims/CLM-2024-00001/diagnosis.pdf', 198234, 'application/pdf', 'COMPLETED',
'{"병명": "급성 충수염, 범발성 복막염 동반", "진단코드": "K35.0", "진단일": "2024-12-10", "의사소견": "응급수술 필요", "발병일": "2024-12-10"}'::jsonb,
0.92, 'gpt-4o', '2024-12-15 09:33:22', TRUE, 'system', '2024-12-15 09:35:20'),

(1, 'SURGERY', '수술확인서_복강경충수절제술.pdf', '/uploads/claims/CLM-2024-00001/surgery.pdf', 176543, 'application/pdf', 'COMPLETED',
'{"수술명": "복강경 충수절제술", "수술코드": "S0401", "수술일": "2024-12-10", "집도의": "김외과", "수술시간": "2시간 30분", "마취방법": "전신마취"}'::jsonb,
0.88, 'gemini-1.5-pro', '2024-12-15 09:34:10', TRUE, 'system', '2024-12-15 09:35:20'),

(1, 'ADMISSION', '입퇴원확인서.pdf', '/uploads/claims/CLM-2024-00001/admission.pdf', 123456, 'application/pdf', 'COMPLETED',
'{"입원일": "2024-12-10", "퇴원일": "2024-12-14", "입원일수": 4, "입원경로": "응급실"}'::jsonb,
0.94, 'claude-3.5-sonnet', '2024-12-15 09:34:45', TRUE, 'system', '2024-12-15 09:35:20');

-- CLM-2024-00002 서류
INSERT INTO claim_documents (claim_id, document_type, document_name, file_path, file_size, mime_type, ocr_status, ocr_result, ocr_confidence, ocr_model_used, ocr_processed_at, is_verified, verified_by, verified_at) VALUES
(2, 'RECEIPT', '진료비영수증_20241215.pdf', '/uploads/claims/CLM-2024-00002/receipt.pdf', 267890, 'application/pdf', 'COMPLETED',
'{"병원명": "삼성서울병원", "환자명": "김철수", "진료기간": "2024-12-12 ~ 2024-12-15", "총진료비": 3500000, "급여": 2800000, "비급여": 700000, "본인부담금": 350000}'::jsonb,
0.96, 'gpt-4o', '2024-12-16 10:15:30', TRUE, 'system', '2024-12-16 10:20:15'),

(2, 'DIAGNOSIS', '진단서_담석증.pdf', '/uploads/claims/CLM-2024-00002/diagnosis.pdf', 189456, 'application/pdf', 'COMPLETED',
'{"병명": "담석증, 급성 담낭염 동반", "진단코드": "K80.0", "진단일": "2024-12-12", "의사소견": "복강경 수술 시행", "발병일": "2024-12-11"}'::jsonb,
0.93, 'claude-3.5-sonnet', '2024-12-16 10:16:45', TRUE, 'system', '2024-12-16 10:20:15'),

(2, 'SURGERY', '수술확인서_복강경담낭절제술.pdf', '/uploads/claims/CLM-2024-00002/surgery.pdf', 198765, 'application/pdf', 'COMPLETED',
'{"수술명": "복강경 담낭절제술", "수술코드": "S0501", "수술일": "2024-12-12", "집도의": "박외과", "수술시간": "1시간 45분", "마취방법": "전신마취"}'::jsonb,
0.91, 'gemini-1.5-pro', '2024-12-16 10:17:20', TRUE, 'system', '2024-12-16 10:20:15');

-- CLM-2024-00003 서류 (통원)
INSERT INTO claim_documents (claim_id, document_type, document_name, file_path, file_size, mime_type, ocr_status, ocr_result, ocr_confidence, ocr_model_used, ocr_processed_at, is_verified, verified_by, verified_at) VALUES
(3, 'RECEIPT', '외래진료비영수증.pdf', '/uploads/claims/CLM-2024-00003/receipt.pdf', 123789, 'application/pdf', 'COMPLETED',
'{"병원명": "강남세브란스병원", "환자명": "이영희", "진료일": "2024-12-15", "총진료비": 85000, "급여": 70000, "비급여": 15000, "본인부담금": 35000}'::jsonb,
0.89, 'gpt-4o', '2024-12-15 14:22:10', TRUE, 'system', '2024-12-15 14:25:30'),

(3, 'DIAGNOSIS', '진단서_폐렴.pdf', '/uploads/claims/CLM-2024-00003/diagnosis.pdf', 145678, 'application/pdf', 'COMPLETED',
'{"병명": "폐렴, 상세불명", "진단코드": "J18.9", "진단일": "2024-12-15", "의사소견": "외래 치료 가능", "발병일": "2024-12-14"}'::jsonb,
0.87, 'claude-3.5-sonnet', '2024-12-15 14:23:35', TRUE, 'system', '2024-12-15 14:25:30');

-- CLM-2024-00004 서류 (사기 의심)
INSERT INTO claim_documents (claim_id, document_type, document_name, file_path, file_size, mime_type, ocr_status, ocr_result, ocr_confidence, ocr_model_used, ocr_processed_at, is_verified, verified_by, verified_at) VALUES
(4, 'RECEIPT', '진료비영수증_20241210.pdf', '/uploads/claims/CLM-2024-00004/receipt.pdf', 234567, 'application/pdf', 'COMPLETED',
'{"병원명": "분당서울대병원", "환자명": "박민수", "진료기간": "2024-12-01 ~ 2024-12-10", "총진료비": 2100000, "급여": 1500000, "비급여": 600000, "본인부담금": 330000}'::jsonb,
0.82, 'gemini-1.5-pro', '2024-12-11 15:10:20', FALSE, NULL, NULL),

(4, 'DIAGNOSIS', '진단서_요통.pdf', '/uploads/claims/CLM-2024-00004/diagnosis.pdf', 167890, 'application/pdf', 'COMPLETED',
'{"병명": "요통", "진단코드": "M54.5", "진단일": "2024-12-01", "의사소견": "보존적 치료 시행", "발병일": "2024-11-28"}'::jsonb,
0.78, 'gpt-4o', '2024-12-11 15:11:45', FALSE, NULL, NULL),

(4, 'ADMISSION', '입퇴원확인서.pdf', '/uploads/claims/CLM-2024-00004/admission.pdf', 134567, 'application/pdf', 'COMPLETED',
'{"입원일": "2024-12-01", "퇴원일": "2024-12-10", "입원일수": 9, "입원경로": "외래", "특이사항": "주말 포함 입원"}'::jsonb,
0.85, 'claude-3.5-sonnet', '2024-12-11 15:12:30', FALSE, NULL, NULL);

-- CLM-2024-00005 서류 (심근경색 - 중대질병)
INSERT INTO claim_documents (claim_id, document_type, document_name, file_path, file_size, mime_type, ocr_status, ocr_result, ocr_confidence, ocr_model_used, ocr_processed_at, is_verified, verified_by, verified_at) VALUES
(5, 'RECEIPT', '진료비영수증_심근경색.pdf', '/uploads/claims/CLM-2024-00005/receipt.pdf', 345678, 'application/pdf', 'COMPLETED',
'{"병원명": "서울아산병원", "환자명": "정수진", "진료기간": "2024-12-08 ~ 2024-12-15", "총진료비": 12000000, "급여": 10000000, "비급여": 2000000, "본인부담금": 1400000}'::jsonb,
0.97, 'claude-3.5-sonnet', '2024-12-16 08:45:20', TRUE, 'system', '2024-12-16 08:50:30'),

(5, 'DIAGNOSIS', '진단서_급성심근경색.pdf', '/uploads/claims/CLM-2024-00005/diagnosis.pdf', 223456, 'application/pdf', 'COMPLETED',
'{"병명": "급성 심근경색증, 상세불명", "진단코드": "I21.9", "진단일": "2024-12-08", "의사소견": "응급 PCI 시행", "발병일": "2024-12-08", "중대질병": true}'::jsonb,
0.95, 'gpt-4o', '2024-12-16 08:46:50', TRUE, 'system', '2024-12-16 08:50:30'),

(5, 'SURGERY', '수술확인서_PCI.pdf', '/uploads/claims/CLM-2024-00005/surgery.pdf', 267890, 'application/pdf', 'COMPLETED',
'{"수술명": "경피적 관상동맥중재술", "수술코드": "S0802", "수술일": "2024-12-08", "집도의": "이심장", "수술시간": "3시간 20분", "마취방법": "국소마취", "스텐트개수": 2}'::jsonb,
0.93, 'gemini-1.5-pro', '2024-12-16 08:48:15', TRUE, 'system', '2024-12-16 08:50:30'),

(5, 'ADMISSION', '입퇴원확인서.pdf', '/uploads/claims/CLM-2024-00005/admission.pdf', 156789, 'application/pdf', 'COMPLETED',
'{"입원일": "2024-12-08", "퇴원일": "2024-12-15", "입원일수": 7, "입원경로": "응급실", "중환자실": "2일"}'::jsonb,
0.94, 'claude-3.5-sonnet', '2024-12-16 08:49:20', TRUE, 'system', '2024-12-16 08:50:30');


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. 청구 심사 이력 (claim_reviews)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- CLM-2024-00001 심사 이력
INSERT INTO claim_reviews (claim_id, reviewer_type, reviewer_id, reviewer_name, action, previous_status, new_status, decision, decision_reason, confidence_score, ai_analysis, processing_time_ms, created_at) VALUES
(1, 'AI', NULL, 'AI-Engine', 'OCR_PROCESS', 'RECEIVED', 'OCR_PROCESSING', NULL, 'OCR 처리 시작', NULL, NULL, 1200, '2024-12-15 09:30:00'),
(1, 'AI', NULL, 'AI-Engine', 'OCR_COMPLETE', 'OCR_PROCESSING', 'OCR_COMPLETED', NULL, 'OCR 처리 완료 (4개 문서)', 0.92, '{"documents_processed": 4, "total_confidence": 0.92, "errors": 0}'::jsonb, 8500, '2024-12-15 09:35:20'),
(1, 'AI', NULL, 'AI-Engine', 'AUTO_REVIEW', 'OCR_COMPLETED', 'AI_REVIEW', 'AUTO_APPROVE', '정상 청구 - 자동승인 추천', 0.88,
'{"보장확인": "적합", "면책기간": "통과", "진단코드": "유효", "청구금액": "적정", "사기위험": "낮음 (0.10)", "추천": "자동승인"}'::jsonb,
3400, '2024-12-15 09:36:00'),
(1, 'HUMAN', 101, '심사역_김민지', 'FINAL_APPROVE', 'AI_REVIEW', 'APPROVED', 'APPROVED', 'AI 추천 확인 후 최종 승인', NULL,
'{"검토사항": "AI 분석 타당함", "추가확인": "없음", "승인금액": 1886000}'::jsonb,
NULL, '2024-12-15 10:15:30');

-- CLM-2024-00002 심사 이력
INSERT INTO claim_reviews (claim_id, reviewer_type, reviewer_id, reviewer_name, action, previous_status, new_status, decision, decision_reason, confidence_score, ai_analysis, processing_time_ms, created_at) VALUES
(2, 'AI', NULL, 'AI-Engine', 'OCR_PROCESS', 'RECEIVED', 'OCR_PROCESSING', NULL, 'OCR 처리 시작', NULL, NULL, 1500, '2024-12-16 10:10:00'),
(2, 'AI', NULL, 'AI-Engine', 'OCR_COMPLETE', 'OCR_PROCESSING', 'OCR_COMPLETED', NULL, 'OCR 처리 완료 (3개 문서)', 0.93, '{"documents_processed": 3, "total_confidence": 0.93, "errors": 0}'::jsonb, 7200, '2024-12-16 10:20:15'),
(2, 'AI', NULL, 'AI-Engine', 'AUTO_REVIEW', 'OCR_COMPLETED', 'AI_REVIEW', 'AUTO_APPROVE', '정상 청구 - 자동승인 추천', 0.91,
'{"보장확인": "적합", "면책기간": "통과", "진단코드": "유효", "청구금액": "적정", "사기위험": "낮음 (0.08)", "추천": "자동승인"}'::jsonb,
2900, '2024-12-16 10:21:30'),
(2, 'HUMAN', 102, '심사역_이정훈', 'FINAL_APPROVE', 'AI_REVIEW', 'APPROVED', 'APPROVED', 'AI 추천 확인 후 최종 승인', NULL,
'{"검토사항": "수술 적정성 확인 완료", "추가확인": "없음", "승인금액": 4130000}'::jsonb,
NULL, '2024-12-16 11:05:20');

-- CLM-2024-00003 심사 이력 (감액)
INSERT INTO claim_reviews (claim_id, reviewer_type, reviewer_id, reviewer_name, action, previous_status, new_status, decision, decision_reason, confidence_score, ai_analysis, processing_time_ms, created_at) VALUES
(3, 'AI', NULL, 'AI-Engine', 'OCR_PROCESS', 'RECEIVED', 'OCR_PROCESSING', NULL, 'OCR 처리 시작', NULL, NULL, 1100, '2024-12-15 14:20:00'),
(3, 'AI', NULL, 'AI-Engine', 'OCR_COMPLETE', 'OCR_PROCESSING', 'OCR_COMPLETED', NULL, 'OCR 처리 완료 (2개 문서)', 0.88, '{"documents_processed": 2, "total_confidence": 0.88, "errors": 0}'::jsonb, 5800, '2024-12-15 14:25:30'),
(3, 'AI', NULL, 'AI-Engine', 'AUTO_REVIEW', 'OCR_COMPLETED', 'AI_REVIEW', 'MANUAL_REVIEW', '감액기간 적용 - 수동 검토 필요', 0.85,
'{"보장확인": "적합", "면책기간": "통과", "감액기간": "적용대상", "감액률": 50, "진단코드": "유효", "사기위험": "낮음 (0.15)", "추천": "수동검토"}'::jsonb,
2100, '2024-12-15 14:26:45'),
(3, 'HUMAN', 101, '심사역_김민지', 'REDUCTION_APPLY', 'AI_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', '감액기간 적용하여 50% 지급', NULL,
'{"감액기간": "2024-01-10 ~ 2025-01-10", "감액률": 50, "원산정액": 54000, "감액후지급액": 27000}'::jsonb,
NULL, '2024-12-15 15:10:00');

-- CLM-2024-00004 심사 이력 (사기 의심)
INSERT INTO claim_reviews (claim_id, reviewer_type, reviewer_id, reviewer_name, action, previous_status, new_status, decision, decision_reason, confidence_score, ai_analysis, processing_time_ms, created_at) VALUES
(4, 'AI', NULL, 'AI-Engine', 'OCR_PROCESS', 'RECEIVED', 'OCR_PROCESSING', NULL, 'OCR 처리 시작', NULL, NULL, 1400, '2024-12-11 15:05:00'),
(4, 'AI', NULL, 'AI-Engine', 'OCR_COMPLETE', 'OCR_PROCESSING', 'OCR_COMPLETED', NULL, 'OCR 처리 완료 (3개 문서)', 0.82, '{"documents_processed": 3, "total_confidence": 0.82, "errors": 0, "warnings": ["저신뢰도 문서 존재"]}'::jsonb, 9200, '2024-12-11 15:12:30'),
(4, 'AI', NULL, 'AI-Engine', 'FRAUD_DETECT', 'OCR_COMPLETED', 'FRAUD_CHECK', 'INVESTIGATE', '사기 패턴 감지 - 정밀 조사 필요', 0.75,
'{"사기위험점수": 0.68, "감지패턴": ["요통반복청구", "주말입원패턴", "단기다수청구"], "위험등급": "HIGH", "추천": "정밀조사"}'::jsonb,
4500, '2024-12-11 15:14:00'),
(4, 'HUMAN', 103, '심사역_박수진', 'ASSIGN_INVESTIGATOR', 'FRAUD_CHECK', 'PENDING_REVIEW', NULL, '사기조사팀 배정', NULL,
'{"조사팀": "FDS-Team", "조사담당": "강철민", "조사시작일": "2024-12-12"}'::jsonb,
NULL, '2024-12-11 16:20:00');

-- CLM-2024-00005 심사 이력 (진행중)
INSERT INTO claim_reviews (claim_id, reviewer_type, reviewer_id, reviewer_name, action, previous_status, new_status, decision, decision_reason, confidence_score, ai_analysis, processing_time_ms, created_at) VALUES
(5, 'AI', NULL, 'AI-Engine', 'OCR_PROCESS', 'RECEIVED', 'OCR_PROCESSING', NULL, 'OCR 처리 시작', NULL, NULL, 1600, '2024-12-16 08:40:00'),
(5, 'AI', NULL, 'AI-Engine', 'OCR_COMPLETE', 'OCR_PROCESSING', 'OCR_COMPLETED', NULL, 'OCR 처리 완료 (4개 문서)', 0.95, '{"documents_processed": 4, "total_confidence": 0.95, "errors": 0}'::jsonb, 10200, '2024-12-16 08:50:30'),
(5, 'AI', NULL, 'AI-Engine', 'AUTO_REVIEW', 'OCR_COMPLETED', 'AI_PROCESSING', 'MANUAL_REVIEW', '중대질병 고액청구 - 수동 검토 필요', 0.89,
'{"보장확인": "적합", "면책기간": "통과", "진단코드": "유효", "중대질병": true, "청구금액": "고액 (12,000,000원)", "사기위험": "낮음 (0.05)", "추천": "수동검토-고액청구"}'::jsonb,
5200, '2024-12-16 08:52:00');


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. 사기 탐지 결과 (fraud_detection_results)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- CLM-2024-00001 (정상)
INSERT INTO fraud_detection_results (claim_id, total_score, risk_level, detected_patterns, recommended_action, action_taken, action_by, action_at, investigation_required, created_at) VALUES
(1, 0.10, 'LOW',
'[{"pattern_code": "NORMAL", "pattern_name": "정상 청구", "score": 0.10, "details": "이상 패턴 없음"}]'::jsonb,
'APPROVE', 'APPROVED', '심사역_김민지', '2024-12-15 10:15:30', FALSE, '2024-12-15 09:36:00');

-- CLM-2024-00002 (정상)
INSERT INTO fraud_detection_results (claim_id, total_score, risk_level, detected_patterns, recommended_action, action_taken, action_by, action_at, investigation_required, created_at) VALUES
(2, 0.08, 'LOW',
'[{"pattern_code": "NORMAL", "pattern_name": "정상 청구", "score": 0.08, "details": "이상 패턴 없음"}]'::jsonb,
'APPROVE', 'APPROVED', '심사역_이정훈', '2024-12-16 11:05:20', FALSE, '2024-12-16 10:21:30');

-- CLM-2024-00003 (경미)
INSERT INTO fraud_detection_results (claim_id, total_score, risk_level, detected_patterns, recommended_action, action_taken, action_by, action_at, investigation_required, created_at) VALUES
(3, 0.15, 'LOW',
'[{"pattern_code": "FRD005", "pattern_name": "조기청구", "score": 0.15, "details": "계약 후 11개월 내 청구", "weight": 0.25}]'::jsonb,
'REVIEW', 'APPROVED', '심사역_김민지', '2024-12-15 15:10:00', FALSE, '2024-12-15 14:26:45');

-- CLM-2024-00004 (고위험)
INSERT INTO fraud_detection_results (claim_id, total_score, risk_level, detected_patterns, recommended_action, action_taken, action_by, action_at, action_notes, investigation_required, investigation_id, created_at) VALUES
(4, 0.68, 'HIGH',
'[
  {"pattern_code": "FRD002", "pattern_name": "요통반복청구", "score": 0.40, "details": "최근 6개월간 요통 진단 4회 청구", "weight": 0.40},
  {"pattern_code": "FRD003", "pattern_name": "주말입원패턴", "score": 0.25, "details": "금요일 입원, 월요일 퇴원 패턴 2회 반복", "weight": 0.25},
  {"pattern_code": "FRD001", "pattern_name": "단기다수청구", "score": 0.20, "details": "최근 30일 내 3건 청구", "weight": 0.30}
]'::jsonb,
'INVESTIGATE', 'UNDER_INVESTIGATION', '심사역_박수진', '2024-12-11 16:20:00',
'사기조사팀 배정 완료. 과거 청구이력 및 병원 방문 패턴 정밀 분석 중',
TRUE, 'INV-2024-0012', '2024-12-11 15:14:00');

-- CLM-2024-00005 (정상 - 중대질병)
INSERT INTO fraud_detection_results (claim_id, total_score, risk_level, detected_patterns, recommended_action, created_at) VALUES
(5, 0.05, 'LOW',
'[{"pattern_code": "FRD004", "pattern_name": "고액단건청구", "score": 0.05, "details": "1회 청구 12,000,000원 (중대질병으로 정상)", "weight": 0.20}]'::jsonb,
'REVIEW', '2024-12-16 08:52:00');


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. 청구 상태 및 금액 업데이트
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- CLM-2024-00001 업데이트
UPDATE claims SET
    status = 'APPROVED',
    ai_confidence_score = 0.88,
    ai_recommendation = 'AUTO_APPROVE',
    ai_analysis_result = '{"보장확인":"적합","면책기간":"통과","진단코드":"유효","청구금액":"적정","사기위험":"낮음","coverage_analysis":{"breakdown":[{"item":"입원의료비(급여)","approvedAmount":990000,"calculation":"(1,200,000-100,000)*90%","termReference":{"article":"제15조-1","title":"입원의료비(급여)","content":"급여 입원의료비는 본인부담금 공제 후 90% 지급.","formula":"(급여-본인부담금)×90%"}},{"item":"입원의료비(비급여)","approvedAmount":96000,"calculation":"(320,000-200,000)*80%","termReference":{"article":"제15조-2","title":"입원의료비(비급여)","content":"비급여 입원의료비는 공제 후 80% 지급.","formula":"(비급여-본인부담금)×80%"}},{"item":"질병입원일당","approvedAmount":200000,"calculation":"50,000×4일","termReference":{"article":"제16조-1","title":"입원일당","content":"입원 1일당 정액 지급.","formula":"일당×일수"}},{"item":"질병수술비(2종)","approvedAmount":600000,"calculation":"2종 수술비 정액","termReference":{"article":"제17조-1","title":"수술비","content":"수술 등급별 정액 지급.","formula":"등급별 정액"}}],"total_approved":1886000,"total_rejected":0}}'::jsonb,
    fraud_score = 0.10,
    fraud_flags = '["정상"]'::jsonb,
    fraud_check_passed = TRUE,
    auto_processable = TRUE,
    assigned_reviewer_id = 101,
    assigned_reviewer_name = '심사역_김민지',
    review_priority = 3,
    review_started_at = '2024-12-15 09:36:00',
    review_completed_at = '2024-12-15 10:15:30',
    decision = 'APPROVED',
    decision_reason = 'AI 추천 확인 후 최종 승인',
    approved_by = '심사역_김민지',
    approved_at = '2024-12-15 10:15:30',
    total_approved_amount = 1886000,
    total_rejected_amount = 0,
    net_payout_amount = 1886000,
    payment_status = 'COMPLETED',
    payment_date = '2024-12-16',
    ocr_processed = TRUE,
    ocr_confidence = 0.92,
    ocr_models_used = ARRAY['claude-3.5-sonnet', 'gpt-4o', 'gemini-1.5-pro']
WHERE claim_number = 'CLM-2024-00001';

-- CLM-2024-00002 업데이트
UPDATE claims SET
    status = 'APPROVED',
    ai_confidence_score = 0.91,
    ai_recommendation = 'AUTO_APPROVE',
    ai_analysis_result = '{"보장확인":"적합","면책기간":"통과","진단코드":"유효","청구금액":"적정","사기위험":"낮음","coverage_analysis":{"breakdown":[{"item":"입원의료비(급여)","approvedAmount":2430000,"calculation":"(2,800,000-100,000)*90%","termReference":{"article":"제15조-1","title":"입원의료비(급여)","content":"급여 입원의료비는 본인부담금 공제 후 90% 지급.","formula":"(급여-본인부담금)×90%"}},{"item":"입원의료비(비급여)","approvedAmount":400000,"calculation":"(700,000-200,000)*80%","termReference":{"article":"제15조-2","title":"입원의료비(비급여)","content":"비급여 입원의료비는 공제 후 80% 지급.","formula":"(비급여-본인부담금)×80%"}},{"item":"질병입원일당","approvedAmount":300000,"calculation":"100,000×3일","termReference":{"article":"제16조-1","title":"입원일당","content":"입원 1일당 정액 지급.","formula":"일당×일수"}},{"item":"질병수술비(2종)","approvedAmount":1000000,"calculation":"2종 수술비 정액","termReference":{"article":"제17조-1","title":"수술비","content":"수술 등급별 정액 지급.","formula":"등급별 정액"}}],"total_approved":4130000,"total_rejected":0}}'::jsonb,
    fraud_score = 0.08,
    fraud_flags = '["정상"]'::jsonb,
    fraud_check_passed = TRUE,
    auto_processable = TRUE,
    assigned_reviewer_id = 102,
    assigned_reviewer_name = '심사역_이정훈',
    review_priority = 3,
    review_started_at = '2024-12-16 10:21:30',
    review_completed_at = '2024-12-16 11:05:20',
    decision = 'APPROVED',
    decision_reason = 'AI 추천 확인 후 최종 승인',
    approved_by = '심사역_이정훈',
    approved_at = '2024-12-16 11:05:20',
    total_approved_amount = 4130000,
    total_rejected_amount = 0,
    net_payout_amount = 4130000,
    payment_status = 'COMPLETED',
    payment_date = '2024-12-17',
    ocr_processed = TRUE,
    ocr_confidence = 0.93,
    ocr_models_used = ARRAY['gpt-4o', 'claude-3.5-sonnet', 'gemini-1.5-pro']
WHERE claim_number = 'CLM-2024-00002';

-- CLM-2024-00003 업데이트 (감액 적용)
UPDATE claims SET
    status = 'APPROVED',
    ai_confidence_score = 0.85,
    ai_recommendation = 'MANUAL_REVIEW',
    ai_analysis_result = '{"보장확인":"적합","면책기간":"통과","감액기간":"적용대상","진단코드":"유효","coverage_analysis":{"breakdown":[{"item":"통원의료비(급여)","approvedAmount":27000,"calculation":"(70,000-10,000)*90%*50%","termReference":{"article":"제18조-1","title":"통원의료비(급여)","content":"통원 급여 항목 공제 후 지급.","formula":"(급여-공제)×90%"}},{"item":"통원의료비(비급여)","approvedAmount":0,"calculation":"공제금액 미만","termReference":{"article":"제18조-2","title":"통원의료비(비급여)","content":"통원 비급여 항목 공제 후 지급.","formula":"(비급여-공제)×80%"}}],"total_approved":27000,"total_rejected":42000}}'::jsonb,
    fraud_score = 0.15,
    fraud_flags = '["조기청구"]'::jsonb,
    fraud_check_passed = TRUE,
    auto_processable = FALSE,
    assigned_reviewer_id = 101,
    assigned_reviewer_name = '심사역_김민지',
    review_priority = 5,
    review_started_at = '2024-12-15 14:26:45',
    review_completed_at = '2024-12-15 15:10:00',
    decision = 'PARTIALLY_APPROVED',
    decision_reason = '감액기간 적용하여 50% 지급',
    approved_by = '심사역_김민지',
    approved_at = '2024-12-15 15:10:00',
    total_approved_amount = 27000,
    total_rejected_amount = 42000,
    net_payout_amount = 27000,
    payment_status = 'COMPLETED',
    payment_date = '2024-12-16',
    ocr_processed = TRUE,
    ocr_confidence = 0.88,
    ocr_models_used = ARRAY['gpt-4o', 'claude-3.5-sonnet']
WHERE claim_number = 'CLM-2024-00003';

-- CLM-2024-00004 업데이트 (사기 의심 - 조사중)
UPDATE claims SET
    status = 'PENDING_REVIEW',
    ai_confidence_score = 0.75,
    ai_recommendation = 'INVESTIGATE',
    ai_analysis_result = '{"사기위험점수":0.68,"감지패턴":["요통반복청구","주말입원패턴","단기다수청구"],"위험등급":"HIGH","coverage_analysis":{"breakdown":[{"item":"입원의료비(급여)","approvedAmount":0,"calculation":"심사 보류","termReference":{"article":"제15조-1","title":"입원의료비(급여)","content":"급여 입원의료비는 본인부담금 공제 후 90% 지급.","formula":"(급여-본인부담금)×90%"}},{"item":"입원의료비(비급여)","approvedAmount":0,"calculation":"심사 보류","termReference":{"article":"제15조-2","title":"입원의료비(비급여)","content":"비급여 입원의료비는 공제 후 80% 지급.","formula":"(비급여-본인부담금)×80%"}}],"total_approved":0,"total_rejected":0}}'::jsonb,
    fraud_score = 0.68,
    fraud_flags = '["요통반복청구", "주말입원패턴", "단기다수청구"]'::jsonb,
    fraud_check_passed = FALSE,
    auto_processable = FALSE,
    assigned_reviewer_id = 103,
    assigned_reviewer_name = '심사역_박수진',
    review_priority = 1,
    review_started_at = '2024-12-11 15:14:00',
    total_approved_amount = 0,
    total_rejected_amount = 0,
    net_payout_amount = 0,
    payment_status = 'PENDING',
    ocr_processed = TRUE,
    ocr_confidence = 0.82,
    ocr_models_used = ARRAY['gemini-1.5-pro', 'gpt-4o', 'claude-3.5-sonnet']
WHERE claim_number = 'CLM-2024-00004';

-- CLM-2024-00005 업데이트 (AI 처리중)
UPDATE claims SET
    status = 'AI_PROCESSING',
    ai_confidence_score = 0.89,
    ai_recommendation = 'MANUAL_REVIEW',
    ai_analysis_result = '{"보장확인":"적합","면책기간":"통과","중대질병":true,"청구금액":"고액","추천":"수동검토-고액청구","coverage_analysis":{"breakdown":[{"item":"입원의료비(급여)","approvedAmount":8910000,"calculation":"(10,000,000-100,000)*90%","termReference":{"article":"제15조-1","title":"입원의료비(급여)","content":"급여 입원의료비는 본인부담금 공제 후 90% 지급.","formula":"(급여-본인부담금)×90%"}},{"item":"입원의료비(비급여)","approvedAmount":1440000,"calculation":"(2,000,000-200,000)*80%","termReference":{"article":"제15조-2","title":"입원의료비(비급여)","content":"비급여 입원의료비는 공제 후 80% 지급.","formula":"(비급여-본인부담금)×80%"}},{"item":"질병입원일당","approvedAmount":700000,"calculation":"100,000×7일","termReference":{"article":"제16조-1","title":"입원일당","content":"입원 1일당 정액 지급.","formula":"일당×일수"}},{"item":"질병수술비(4종)","approvedAmount":3000000,"calculation":"4종 수술비 정액","termReference":{"article":"제17조-1","title":"수술비","content":"수술 등급별 정액 지급.","formula":"등급별 정액"}}],"total_approved":14050000,"total_rejected":0}}'::jsonb,
    fraud_score = 0.05,
    fraud_flags = '["고액청구-정상"]'::jsonb,
    fraud_check_passed = TRUE,
    auto_processable = FALSE,
    review_priority = 2,
    review_started_at = '2024-12-16 08:52:00',
    total_approved_amount = 0,
    total_rejected_amount = 0,
    net_payout_amount = 0,
    payment_status = 'PENDING',
    ocr_processed = TRUE,
    ocr_confidence = 0.95,
    ocr_models_used = ARRAY['claude-3.5-sonnet', 'gpt-4o', 'gemini-1.5-pro']
WHERE claim_number = 'CLM-2024-00005';


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. 추가 청구 데이터 (더 다양한 케이스)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 추가 청구 6: 백내장 수술 (1종 수술)
INSERT INTO claims (claim_number, policy_id, customer_id, claim_type, claim_subtype, treatment_start_date, treatment_end_date, hospital_name, hospital_type, diagnosis_code, diagnosis_name, surgery_code, surgery_name, surgery_classification, hospitalization_days, total_medical_expense, insured_expense, uninsured_expense, total_claimed_amount, status) VALUES
('CLM-2024-00006', 6, 6, 'SURGERY', 'DISEASE', '2024-12-18', '2024-12-18', '서울대학교병원', 'GENERAL', 'H25.1', '노년백내장', 'S1101', '백내장수술(수정체유화술)', 1, 0, 1500000, 1200000, 300000, 1500000, 'RECEIVED');

-- 추가 청구 7: 골절 (상해)
INSERT INTO claims (claim_number, policy_id, customer_id, claim_type, claim_subtype, treatment_start_date, treatment_end_date, hospital_name, hospital_type, diagnosis_code, diagnosis_name, surgery_code, surgery_name, surgery_classification, hospitalization_days, total_medical_expense, insured_expense, uninsured_expense, total_claimed_amount, status) VALUES
('CLM-2024-00007', 7, 7, 'HOSPITALIZATION', 'ACCIDENT', '2024-12-14', '2024-12-20', '강남세브란스병원', 'GENERAL', 'S82.0', '무릎뼈의 골절', 'S0902', '인공관절치환술(슬관절)', 4, 6, 8500000, 7000000, 1500000, 8500000, 'RECEIVED');

-- 워크플로우 로그 추가
INSERT INTO workflow_logs (claim_id, workflow_id, execution_id, node_name, node_type, status, input_data, output_data, execution_time_ms, created_at) VALUES
(1, 'claim-review-workflow', 'exec-001', 'OCR Processing', 'n8n-node', 'COMPLETED', '{"claim_id": 1, "documents": 4}'::jsonb, '{"confidence": 0.92, "success": true}'::jsonb, 8500, '2024-12-15 09:35:20'),
(1, 'claim-review-workflow', 'exec-001', 'AI Review', 'n8n-node', 'COMPLETED', '{"claim_id": 1}'::jsonb, '{"recommendation": "AUTO_APPROVE", "confidence": 0.88}'::jsonb, 3400, '2024-12-15 09:36:00'),
(1, 'claim-review-workflow', 'exec-001', 'Fraud Detection', 'n8n-node', 'COMPLETED', '{"claim_id": 1}'::jsonb, '{"fraud_score": 0.10, "risk_level": "LOW"}'::jsonb, 2100, '2024-12-15 09:36:30');

-- AI 모델 피드백 추가
INSERT INTO ai_model_feedback (claim_id, model_name, task_type, is_correct, confidence_score, response_time_ms, feedback_by, created_at) VALUES
(1, 'claude-3.5-sonnet', 'OCR', TRUE, 0.95, 2100, 'system', '2024-12-15 09:32:15'),
(1, 'gpt-4o', 'OCR', TRUE, 0.92, 2800, 'system', '2024-12-15 09:33:22'),
(1, 'gemini-1.5-pro', 'OCR', TRUE, 0.88, 1900, 'system', '2024-12-15 09:34:10'),
(2, 'gpt-4o', 'OCR', TRUE, 0.96, 3000, 'system', '2024-12-16 10:15:30'),
(2, 'claude-3.5-sonnet', 'OCR', TRUE, 0.93, 2200, 'system', '2024-12-16 10:16:45');


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
