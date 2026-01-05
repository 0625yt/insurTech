-- ═══════════════════════════════════════════════════════════════════════════
-- 보험금 청구 자동 심사 시스템 v4 - 풀버전 데이터베이스 스키마
-- 실제 보험사 심사 로직 반영
-- ═══════════════════════════════════════════════════════════════════════════

-- 기존 테이블 정리
DROP TABLE IF EXISTS claim_reviews CASCADE;
DROP TABLE IF EXISTS claim_items CASCADE;
DROP TABLE IF EXISTS claim_documents CASCADE;
DROP TABLE IF EXISTS claims CASCADE;
DROP TABLE IF EXISTS policy_coverages CASCADE;
DROP TABLE IF EXISTS policies CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS surgery_classification CASCADE;
DROP TABLE IF EXISTS diagnosis_codes CASCADE;
DROP TABLE IF EXISTS coverage_types CASCADE;
DROP TABLE IF EXISTS fraud_patterns CASCADE;
DROP TABLE IF EXISTS fraud_detection_results CASCADE;
DROP TABLE IF EXISTS ai_model_feedback CASCADE;
DROP TABLE IF EXISTS workflow_error_logs CASCADE;
DROP TABLE IF EXISTS claim_verification_queue CASCADE;
DROP TABLE IF EXISTS claim_review_results CASCADE;
DROP TABLE IF EXISTS insurance_policies CASCADE;
DROP TABLE IF EXISTS coverage_definitions CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 기준 정보 테이블 (Master Data)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1-1. 진단코드 테이블 (KCD-7 한국표준질병사인분류)
CREATE TABLE diagnosis_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    chapter VARCHAR(100),                        -- 대분류 (예: 소화기계 질환)
    is_critical_illness BOOLEAN DEFAULT FALSE,  -- 중대질병 해당 여부
    is_cancer BOOLEAN DEFAULT FALSE,            -- 암 여부
    default_treatment_days INT DEFAULT 0,       -- 표준 치료기간
    fraud_risk_base DECIMAL(3,2) DEFAULT 0.0,   -- 기본 사기위험점수 (0~1)
    requires_surgery BOOLEAN DEFAULT FALSE,     -- 수술 필요 질환 여부
    chronic_disease BOOLEAN DEFAULT FALSE,      -- 만성질환 여부
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE diagnosis_codes IS 'KCD-7 진단코드 기준정보';

-- 1-2. 수술분류표 (1~5종)
CREATE TABLE surgery_classification (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    classification INT NOT NULL CHECK (classification BETWEEN 1 AND 5),
    category VARCHAR(100),
    related_diagnosis_codes TEXT[],             -- 관련 진단코드
    average_cost INT,                           -- 평균 수술비용
    average_hospital_days INT,                  -- 평균 입원일수
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE surgery_classification IS '수술분류표 (1종~5종)';
COMMENT ON COLUMN surgery_classification.classification IS '1종: 소수술, 2종: 중수술, 3종: 대수술, 4종: 특대수술, 5종: 최대수술';

-- 1-3. 보장유형 기준표
CREATE TABLE coverage_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(20) NOT NULL,              -- REAL_LOSS(실손), FIXED(정액)
    calculation_type VARCHAR(20) NOT NULL,      -- DAILY(일당), LUMP_SUM(일시금), PERCENTAGE(비율)
    default_payout_rate DECIMAL(5,2),           -- 기본 지급률
    default_deductible INT,                     -- 기본 본인부담금
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE coverage_types IS '보장유형 기준정보';

-- 1-4. 사기 패턴 정의
CREATE TABLE fraud_patterns (
    id SERIAL PRIMARY KEY,
    pattern_code VARCHAR(20) NOT NULL UNIQUE,
    pattern_name VARCHAR(100) NOT NULL,
    description TEXT,
    detection_rule JSONB NOT NULL,              -- 탐지 규칙 (SQL 조건 등)
    risk_weight DECIMAL(3,2) NOT NULL,          -- 가중치 (0~1)
    action_required VARCHAR(50),                -- AUTO_REJECT, MANUAL_REVIEW, ALERT
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE fraud_patterns IS '사기 탐지 패턴 정의';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 고객 및 증권 테이블
-- ═══════════════════════════════════════════════════════════════════════════

-- 2-1. 고객 테이블
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    customer_code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    birth_date DATE NOT NULL,
    gender VARCHAR(1) CHECK (gender IN ('M', 'F')),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,

    -- 위험 관리
    risk_grade VARCHAR(20) DEFAULT 'NORMAL',    -- NORMAL, WATCH, HIGH_RISK, BLACKLIST
    risk_score DECIMAL(5,2) DEFAULT 0,          -- 누적 위험점수
    risk_factors JSONB,                         -- 위험 요소 상세

    -- 통계
    total_policies INT DEFAULT 0,
    active_policies INT DEFAULT 0,
    total_claim_count INT DEFAULT 0,
    total_claim_amount BIGINT DEFAULT 0,
    total_paid_amount BIGINT DEFAULT 0,
    last_claim_date DATE,

    -- 메모
    internal_notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE customers IS '고객 정보';

-- 2-2. 보험증권 테이블
CREATE TABLE policies (
    id SERIAL PRIMARY KEY,
    policy_number VARCHAR(20) NOT NULL UNIQUE,
    customer_id INT REFERENCES customers(id) ON DELETE CASCADE,

    -- 상품 정보
    product_name VARCHAR(100) NOT NULL,
    product_code VARCHAR(20),
    product_version VARCHAR(10),

    -- 계약 상태
    status VARCHAR(20) DEFAULT 'ACTIVE',        -- ACTIVE, LAPSED, TERMINATED, SUSPENDED
    status_reason TEXT,

    -- 날짜
    contract_date DATE NOT NULL,                -- 계약일 (청약일)
    coverage_start_date DATE NOT NULL,          -- 보장개시일
    coverage_end_date DATE NOT NULL,            -- 보장만료일

    -- 보험료
    premium_amount INT NOT NULL,                -- 월 보험료
    premium_status VARCHAR(20) DEFAULT 'PAID',  -- PAID, OVERDUE, GRACE_PERIOD
    premium_overdue_months INT DEFAULT 0,       -- 연체 개월수
    last_premium_date DATE,                     -- 최종 납입일
    next_premium_date DATE,                     -- 다음 납입일

    -- 면책/감액 기간
    exemption_end_date DATE,                    -- 면책기간 종료일 (계약일+90일)
    reduction_end_date DATE,                    -- 감액기간 종료일 (계약일+1년 또는 2년)
    reduction_rate DECIMAL(5,2) DEFAULT 50,     -- 감액률 (보통 50%)

    -- 고지사항
    pre_existing_conditions JSONB,              -- 기왕증 정보
    disclosure_violations JSONB,                -- 고지의무 위반 사항

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE policies IS '보험증권 정보';
COMMENT ON COLUMN policies.exemption_end_date IS '면책기간: 이 기간 내 발생 질병은 보장 제외';
COMMENT ON COLUMN policies.reduction_end_date IS '감액기간: 이 기간 내 발생 질병은 50% 감액 지급';

-- 2-3. 증권별 보장내역
CREATE TABLE policy_coverages (
    id SERIAL PRIMARY KEY,
    policy_id INT REFERENCES policies(id) ON DELETE CASCADE,
    coverage_type_id INT REFERENCES coverage_types(id),

    -- 보장 정보
    coverage_name VARCHAR(100) NOT NULL,
    coverage_code VARCHAR(30),

    -- 가입 금액
    insured_amount BIGINT NOT NULL,             -- 가입금액 (정액형: 지급액, 실손형: 한도)

    -- 실손형 전용
    deductible_type VARCHAR(20),                -- FIXED(정액), RATE(비율), MAX(둘 중 큰 금액)
    deductible_amount INT DEFAULT 0,            -- 정액 본인부담금
    deductible_rate DECIMAL(5,2) DEFAULT 0,     -- 비율 본인부담금 (%)
    payout_rate DECIMAL(5,2) DEFAULT 100,       -- 지급률 (%)

    -- 정액형 전용
    max_days INT,                               -- 최대 보장일수 (입원일당)
    max_times INT,                              -- 최대 보장횟수 (수술비)
    surgery_classification INT,                 -- 해당 수술 등급 (1~5)

    -- 한도 관리
    per_occurrence_limit BIGINT,                -- 사고당 한도
    annual_limit BIGINT,                        -- 연간 한도
    lifetime_limit BIGINT,                      -- 평생 한도

    -- 사용 현황
    used_annual_amount BIGINT DEFAULT 0,        -- 금년 사용액
    used_lifetime_amount BIGINT DEFAULT 0,      -- 누적 사용액
    used_days INT DEFAULT 0,                    -- 사용 일수 (일당용)
    used_times INT DEFAULT 0,                   -- 사용 횟수 (수술용)

    -- 특약 조건
    waiting_days INT DEFAULT 0,                 -- 대기기간 (일)
    applicable_diagnosis_codes TEXT[],          -- 적용 진단코드 (특정 질병만 보장시)
    excluded_diagnosis_codes TEXT[],            -- 제외 진단코드

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE policy_coverages IS '증권별 보장내역 상세';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 청구 테이블
-- ═══════════════════════════════════════════════════════════════════════════

-- 3-1. 청구 메인
CREATE TABLE claims (
    id SERIAL PRIMARY KEY,
    claim_number VARCHAR(20) NOT NULL UNIQUE,
    policy_id INT REFERENCES policies(id),
    customer_id INT REFERENCES customers(id),

    -- 청구 유형
    claim_type VARCHAR(30) NOT NULL,            -- HOSPITALIZATION, OUTPATIENT, SURGERY, DIAGNOSIS
    claim_subtype VARCHAR(30),                  -- DISEASE(질병), ACCIDENT(상해)

    -- 청구일
    claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
    claim_channel VARCHAR(20),                  -- APP, WEB, FAX, MAIL, AGENT

    -- 치료 정보
    treatment_start_date DATE,
    treatment_end_date DATE,
    hospital_name VARCHAR(100),
    hospital_type VARCHAR(30),                  -- GENERAL(종합), HOSPITAL(병원), CLINIC(의원)
    department VARCHAR(50),                     -- 진료과

    -- 진단 정보
    diagnosis_code VARCHAR(10),
    diagnosis_name VARCHAR(200),
    is_first_diagnosis BOOLEAN DEFAULT TRUE,    -- 최초 진단 여부 (진단비용)

    -- 수술 정보
    surgery_code VARCHAR(20),
    surgery_name VARCHAR(200),
    surgery_classification INT,                 -- 수술 등급 (1~5)

    -- 입원 정보
    hospitalization_days INT DEFAULT 0,
    icu_days INT DEFAULT 0,                     -- 중환자실 일수

    -- 금액
    total_medical_expense BIGINT,               -- 총 의료비 (영수증 기준)
    insured_expense BIGINT,                     -- 급여 항목
    uninsured_expense BIGINT,                   -- 비급여 항목
    total_claimed_amount BIGINT NOT NULL,       -- 청구금액

    -- 심사 결과
    total_approved_amount BIGINT DEFAULT 0,
    total_rejected_amount BIGINT DEFAULT 0,
    net_payout_amount BIGINT DEFAULT 0,         -- 실 지급액 (세금 등 공제 후)

    -- 상태
    status VARCHAR(30) DEFAULT 'RECEIVED',
    status_history JSONB DEFAULT '[]',          -- 상태 변경 이력

    -- AI 심사
    ai_confidence_score DECIMAL(5,2),
    ai_recommendation VARCHAR(30),              -- AUTO_APPROVE, MANUAL_REVIEW, REJECT, INVESTIGATE
    ai_analysis_result JSONB,                   -- AI 분석 상세

    -- 사기 탐지
    fraud_score DECIMAL(5,2) DEFAULT 0,
    fraud_flags JSONB DEFAULT '[]',             -- 탐지된 사기 패턴
    fraud_check_passed BOOLEAN,

    -- 중복 청구 검사
    is_duplicate BOOLEAN DEFAULT FALSE,
    duplicate_claim_ids INT[],

    -- 심사 처리
    auto_processable BOOLEAN,                   -- 자동처리 가능 여부
    assigned_reviewer_id INT,
    assigned_reviewer_name VARCHAR(50),
    review_priority INT DEFAULT 5,              -- 1(긴급)~10(낮음)
    review_due_date DATE,
    review_started_at TIMESTAMP,
    review_completed_at TIMESTAMP,

    -- 승인/거절
    decision VARCHAR(20),                       -- APPROVED, PARTIALLY_APPROVED, REJECTED
    decision_reason TEXT,
    approved_by VARCHAR(50),
    approved_at TIMESTAMP,

    -- 지급
    payment_status VARCHAR(20),                 -- PENDING, PROCESSING, COMPLETED, FAILED
    payment_date DATE,
    payment_account VARCHAR(50),

    -- OCR
    ocr_processed BOOLEAN DEFAULT FALSE,
    ocr_confidence DECIMAL(5,2),
    ocr_models_used TEXT[],
    ocr_raw_data JSONB,

    -- 메타
    external_reference VARCHAR(50),             -- 외부 시스템 참조번호
    notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE claims IS '보험금 청구 메인 테이블';

-- 3-2. 청구 항목별 상세 (보장별 지급 산정)
CREATE TABLE claim_items (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,
    policy_coverage_id INT REFERENCES policy_coverages(id),

    -- 항목 정보
    item_type VARCHAR(50) NOT NULL,             -- HOSP_MEDICAL(입원의료비), HOSP_DAILY(입원일당), SURGERY(수술비), etc.
    item_name VARCHAR(100) NOT NULL,
    sequence_no INT,                            -- 항목 순서

    -- 청구 금액
    claimed_amount BIGINT NOT NULL,

    -- 산정 기준
    calculation_base BIGINT,                    -- 산정 기준금액
    base_amount_type VARCHAR(30),               -- MEDICAL_EXPENSE, FIXED_AMOUNT, DAILY_RATE

    -- 적용 내역
    deductible_applied BIGINT DEFAULT 0,        -- 적용 본인부담금
    payout_rate_applied DECIMAL(5,2),           -- 적용 지급률
    days_applied INT,                           -- 적용 일수

    -- 감액/한도
    reduction_rate DECIMAL(5,2) DEFAULT 0,      -- 감액률 (감액기간)
    reduction_amount BIGINT DEFAULT 0,          -- 감액 금액
    limit_exceeded_amount BIGINT DEFAULT 0,     -- 한도초과 금액

    -- 결과
    calculated_amount BIGINT DEFAULT 0,         -- 산정 금액 (감액 전)
    approved_amount BIGINT DEFAULT 0,           -- 최종 승인 금액
    rejected_amount BIGINT DEFAULT 0,           -- 거절 금액

    -- 거절 사유
    rejection_code VARCHAR(20),
    rejection_reason VARCHAR(200),

    -- 계산 상세
    calculation_formula TEXT,                   -- 계산식 (예: "(152,000 - 10,000) × 90% = 127,800원")
    calculation_detail JSONB,                   -- 상세 계산 내역

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE claim_items IS '청구 항목별 지급 산정 상세';

-- 3-3. 청구 서류
CREATE TABLE claim_documents (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,

    document_type VARCHAR(30) NOT NULL,         -- DIAGNOSIS(진단서), RECEIPT(영수증), ADMISSION(입퇴원확인서), SURGERY(수술확인서)
    document_name VARCHAR(200),
    file_path VARCHAR(500),
    file_size INT,
    mime_type VARCHAR(50),

    -- OCR 결과
    ocr_status VARCHAR(20) DEFAULT 'PENDING',
    ocr_result JSONB,
    ocr_confidence DECIMAL(5,2),
    ocr_model_used VARCHAR(30),
    ocr_processed_at TIMESTAMP,

    -- 검증
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(50),
    verified_at TIMESTAMP,
    verification_notes TEXT,

    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE claim_documents IS '청구 첨부 서류';

-- 3-4. 청구 심사 이력
CREATE TABLE claim_reviews (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,

    -- 심사자
    reviewer_type VARCHAR(20) NOT NULL,         -- AI, HUMAN
    reviewer_id INT,
    reviewer_name VARCHAR(50),

    -- 액션
    action VARCHAR(30) NOT NULL,
    previous_status VARCHAR(30),
    new_status VARCHAR(30),

    -- 결정
    decision VARCHAR(30),
    decision_reason TEXT,
    confidence_score DECIMAL(5,2),

    -- AI 분석 (AI 심사시)
    ai_analysis JSONB,

    -- 소요시간
    processing_time_ms INT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE claim_reviews IS '청구 심사 이력';

-- 3-5. 사기 탐지 결과
CREATE TABLE fraud_detection_results (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id) ON DELETE CASCADE,

    -- 전체 점수
    total_score DECIMAL(5,2) NOT NULL,
    risk_level VARCHAR(20),                     -- LOW, MEDIUM, HIGH, CRITICAL

    -- 탐지된 패턴
    detected_patterns JSONB NOT NULL,           -- [{pattern_code, score, details}]

    -- 조치
    recommended_action VARCHAR(30),             -- APPROVE, REVIEW, INVESTIGATE, REJECT
    action_taken VARCHAR(30),
    action_by VARCHAR(50),
    action_at TIMESTAMP,
    action_notes TEXT,

    -- 조사
    investigation_required BOOLEAN DEFAULT FALSE,
    investigation_id VARCHAR(30),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE fraud_detection_results IS '사기 탐지 결과';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. AI 모델 관리
-- ═══════════════════════════════════════════════════════════════════════════

-- AI 모델 피드백
CREATE TABLE ai_model_feedback (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id),

    model_name VARCHAR(30) NOT NULL,            -- gpt-4o, claude-3.5-sonnet, gemini-1.5-pro
    task_type VARCHAR(30) NOT NULL,             -- OCR, COVERAGE_ANALYSIS, FRAUD_DETECTION, AUTO_REVIEW

    -- 결과
    is_correct BOOLEAN,
    confidence_score DECIMAL(5,2),
    response_time_ms INT,

    -- 오류 분석
    error_type VARCHAR(50),
    error_details TEXT,

    -- 피드백
    feedback_by VARCHAR(50),
    feedback_notes TEXT,
    corrected_result JSONB,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 시스템 테이블
-- ═══════════════════════════════════════════════════════════════════════════

-- 워크플로우 로그
CREATE TABLE workflow_logs (
    id SERIAL PRIMARY KEY,
    claim_id INT REFERENCES claims(id),
    workflow_id VARCHAR(50),
    execution_id VARCHAR(50),

    node_name VARCHAR(100),
    node_type VARCHAR(50),

    status VARCHAR(20),                         -- STARTED, COMPLETED, FAILED
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,

    execution_time_ms INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 인덱스
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_policy ON claims(policy_id);
CREATE INDEX idx_claims_customer ON claims(customer_id);
CREATE INDEX idx_claims_date ON claims(claim_date DESC);
CREATE INDEX idx_claims_fraud_score ON claims(fraud_score DESC);
CREATE INDEX idx_claims_ai_recommendation ON claims(ai_recommendation);
CREATE INDEX idx_claims_assigned_reviewer ON claims(assigned_reviewer_id);

CREATE INDEX idx_policies_customer ON policies(customer_id);
CREATE INDEX idx_policies_status ON policies(status);
CREATE INDEX idx_policies_number ON policies(policy_number);

CREATE INDEX idx_policy_coverages_policy ON policy_coverages(policy_id);
CREATE INDEX idx_claim_items_claim ON claim_items(claim_id);
CREATE INDEX idx_claim_documents_claim ON claim_documents(claim_id);
CREATE INDEX idx_claim_reviews_claim ON claim_reviews(claim_id);

CREATE INDEX idx_diagnosis_codes_code ON diagnosis_codes(code);
CREATE INDEX idx_surgery_classification_code ON surgery_classification(code);

CREATE INDEX idx_customers_code ON customers(customer_code);
CREATE INDEX idx_customers_risk ON customers(risk_grade);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. 트리거
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_policies_updated BEFORE UPDATE ON policies FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER tr_claims_updated BEFORE UPDATE ON claims FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. 초기 데이터
-- ═══════════════════════════════════════════════════════════════════════════

-- 보장유형
INSERT INTO coverage_types (code, name, category, calculation_type, default_payout_rate, default_deductible, description) VALUES
('REAL_LOSS_HOSP_INS', '실손의료비(입원-급여)', 'REAL_LOSS', 'PERCENTAGE', 90, 100000, '입원 급여항목 실손보상'),
('REAL_LOSS_HOSP_UNINS', '실손의료비(입원-비급여)', 'REAL_LOSS', 'PERCENTAGE', 80, 200000, '입원 비급여항목 실손보상'),
('REAL_LOSS_OUT_INS', '실손의료비(통원-급여)', 'REAL_LOSS', 'PERCENTAGE', 90, 10000, '통원 급여항목 실손보상'),
('REAL_LOSS_OUT_UNINS', '실손의료비(통원-비급여)', 'REAL_LOSS', 'PERCENTAGE', 80, 30000, '통원 비급여항목 실손보상'),
('FIXED_HOSP_DAILY', '질병입원일당', 'FIXED', 'DAILY', 100, 0, '입원 1일당 정액 지급'),
('FIXED_SURGERY_1', '질병수술비(1종)', 'FIXED', 'LUMP_SUM', 100, 0, '1종 수술시 정액 지급'),
('FIXED_SURGERY_2', '질병수술비(2종)', 'FIXED', 'LUMP_SUM', 100, 0, '2종 수술시 정액 지급'),
('FIXED_SURGERY_3', '질병수술비(3종)', 'FIXED', 'LUMP_SUM', 100, 0, '3종 수술시 정액 지급'),
('FIXED_SURGERY_4', '질병수술비(4종)', 'FIXED', 'LUMP_SUM', 100, 0, '4종 수술시 정액 지급'),
('FIXED_SURGERY_5', '질병수술비(5종)', 'FIXED', 'LUMP_SUM', 100, 0, '5종 수술시 정액 지급'),
('FIXED_DIAGNOSIS', '질병진단비', 'FIXED', 'LUMP_SUM', 100, 0, '최초 진단시 정액 지급'),
('FIXED_CANCER', '암진단비', 'FIXED', 'LUMP_SUM', 100, 0, '암 최초 진단시 정액 지급'),
('FIXED_CI', '중대질병진단비', 'FIXED', 'LUMP_SUM', 100, 0, '중대질병 진단시 정액 지급');

-- 진단코드 (주요 질환)
INSERT INTO diagnosis_codes (code, name, category, chapter, is_critical_illness, is_cancer, default_treatment_days, fraud_risk_base, requires_surgery, chronic_disease) VALUES
-- 소화기계
('K35.0', '급성 충수염, 범발성 복막염 동반', '소화기계', 'K00-K93', FALSE, FALSE, 7, 0.10, TRUE, FALSE),
('K35.1', '급성 충수염, 복막 농양 동반', '소화기계', 'K00-K93', FALSE, FALSE, 10, 0.10, TRUE, FALSE),
('K35.9', '급성 충수염, 상세불명', '소화기계', 'K00-K93', FALSE, FALSE, 5, 0.15, TRUE, FALSE),
('K80.0', '담석증, 급성 담낭염 동반', '소화기계', 'K00-K93', FALSE, FALSE, 7, 0.10, TRUE, FALSE),
('K80.1', '담석증, 기타 담낭염 동반', '소화기계', 'K00-K93', FALSE, FALSE, 5, 0.12, TRUE, FALSE),
-- 호흡기계
('J18.0', '기관지폐렴, 상세불명', '호흡기계', 'J00-J99', FALSE, FALSE, 7, 0.15, FALSE, FALSE),
('J18.9', '폐렴, 상세불명', '호흡기계', 'J00-J99', FALSE, FALSE, 7, 0.20, FALSE, FALSE),
-- 근골격계 (사기 위험 높음)
('M54.5', '요통', '근골격계', 'M00-M99', FALSE, FALSE, 3, 0.45, FALSE, TRUE),
('M51.1', '요추 및 기타 추간판 장애, 신경근병증 동반', '근골격계', 'M00-M99', FALSE, FALSE, 14, 0.30, TRUE, FALSE),
('M51.2', '기타 명시된 추간판 변성', '근골격계', 'M00-M99', FALSE, FALSE, 7, 0.35, FALSE, TRUE),
-- 손상
('S72.0', '대퇴골 경부의 골절', '손상', 'S00-T98', FALSE, FALSE, 30, 0.12, TRUE, FALSE),
('S82.0', '무릎뼈의 골절', '손상', 'S00-T98', FALSE, FALSE, 21, 0.15, TRUE, FALSE),
-- 순환기계 (중대질병)
('I21.0', '전벽의 급성 심근경색증', '순환기계', 'I00-I99', TRUE, FALSE, 14, 0.05, TRUE, FALSE),
('I21.9', '급성 심근경색증, 상세불명', '순환기계', 'I00-I99', TRUE, FALSE, 14, 0.05, TRUE, FALSE),
('I63.9', '뇌경색증, 상세불명', '순환기계', 'I00-I99', TRUE, FALSE, 21, 0.05, FALSE, FALSE),
-- 신생물 (암)
('C34.9', '기관지 및 폐의 악성 신생물, 상세불명', '신생물', 'C00-D48', TRUE, TRUE, 0, 0.03, FALSE, FALSE),
('C50.9', '유방의 악성 신생물, 상세불명', '신생물', 'C00-D48', TRUE, TRUE, 0, 0.03, TRUE, FALSE),
('C18.9', '결장의 악성 신생물, 상세불명', '신생물', 'C00-D48', TRUE, TRUE, 0, 0.03, TRUE, FALSE),
-- 내분비계
('E11.9', '제2형 당뇨병, 합병증이 없는', '내분비계', 'E00-E90', FALSE, FALSE, 0, 0.30, FALSE, TRUE),
('E78.0', '순수 고콜레스테롤혈증', '내분비계', 'E00-E90', FALSE, FALSE, 0, 0.25, FALSE, TRUE);

-- 수술분류
INSERT INTO surgery_classification (code, name, classification, category, related_diagnosis_codes, average_cost, average_hospital_days) VALUES
('S0401', '복강경 충수절제술', 2, '소화기수술', ARRAY['K35.0', 'K35.1', 'K35.9'], 2000000, 4),
('S0402', '개복 충수절제술', 3, '소화기수술', ARRAY['K35.0', 'K35.1', 'K35.9'], 2500000, 7),
('S0501', '복강경 담낭절제술', 2, '소화기수술', ARRAY['K80.0', 'K80.1'], 2500000, 3),
('S0502', '개복 담낭절제술', 3, '소화기수술', ARRAY['K80.0', 'K80.1'], 3000000, 7),
('S0801', '관상동맥우회술(CABG)', 5, '심장수술', ARRAY['I21.0', 'I21.9', 'I25.1'], 30000000, 14),
('S0802', '경피적 관상동맥중재술(PCI)', 4, '심장수술', ARRAY['I21.0', 'I21.9'], 10000000, 5),
('S0901', '대퇴골 내고정술', 3, '정형외과수술', ARRAY['S72.0'], 5000000, 14),
('S0902', '인공관절치환술(고관절)', 4, '정형외과수술', ARRAY['S72.0', 'M16.1'], 15000000, 14),
('S1001', '추간판절제술(미세현미경)', 3, '신경외과수술', ARRAY['M51.1', 'M51.2'], 5000000, 7),
('S1002', '척추유합술', 4, '신경외과수술', ARRAY['M51.1', 'M43.1'], 15000000, 14),
('S1101', '백내장수술(수정체유화술)', 1, '안과수술', ARRAY['H25.0', 'H25.1'], 1500000, 1),
('S1201', '유방절제술', 3, '유방수술', ARRAY['C50.9'], 5000000, 7),
('S1301', '대장절제술(복강경)', 3, '소화기수술', ARRAY['C18.9'], 8000000, 10);

-- 사기패턴
INSERT INTO fraud_patterns (pattern_code, pattern_name, description, detection_rule, risk_weight, action_required) VALUES
('FRD001', '단기다수청구', '30일 내 3건 이상 청구', '{"type": "frequency", "period_days": 30, "min_claims": 3}', 0.30, 'MANUAL_REVIEW'),
('FRD002', '요통반복청구', '요통 진단 연 5회 이상', '{"type": "diagnosis_frequency", "diagnosis_code": "M54.5", "period_months": 12, "max_count": 5}', 0.40, 'INVESTIGATE'),
('FRD003', '주말입원패턴', '금요일 입원 월요일 퇴원 반복', '{"type": "admission_pattern", "pattern": "friday_monday"}', 0.25, 'MANUAL_REVIEW'),
('FRD004', '고액단건청구', '1회 청구 500만원 초과', '{"type": "amount", "min_amount": 5000000}', 0.20, 'MANUAL_REVIEW'),
('FRD005', '조기청구', '계약 후 6개월 내 청구', '{"type": "early_claim", "months_from_contract": 6}', 0.25, 'MANUAL_REVIEW'),
('FRD006', '동일병원집중', '동일 병원에서 연 10회 이상', '{"type": "hospital_concentration", "max_visits": 10, "period_months": 12}', 0.30, 'INVESTIGATE'),
('FRD007', '진단서불일치', 'OCR 추출 정보와 청구 내용 불일치', '{"type": "document_mismatch"}', 0.50, 'INVESTIGATE'),
('FRD008', '중복청구', '동일 치료건 중복 청구', '{"type": "duplicate", "match_fields": ["treatment_date", "hospital", "diagnosis"]}', 0.60, 'REJECT');

-- 고객 데이터
INSERT INTO customers (customer_code, name, birth_date, gender, phone, email, risk_grade, risk_score) VALUES
('CUST-2024-001', '홍길동', '1985-03-15', 'M', '010-1234-5678', 'hong@email.com', 'NORMAL', 10),
('CUST-2024-002', '김철수', '1978-07-22', 'M', '010-2345-6789', 'kim@email.com', 'NORMAL', 15),
('CUST-2024-003', '이영희', '1990-11-08', 'F', '010-3456-7890', 'lee@email.com', 'NORMAL', 5),
('CUST-2024-004', '박민수', '1982-05-30', 'M', '010-4567-8901', 'park@email.com', 'WATCH', 55),
('CUST-2024-005', '정수진', '1995-01-25', 'F', '010-5678-9012', 'jung@email.com', 'NORMAL', 8),
('CUST-2024-006', '최동현', '1970-09-10', 'M', '010-6789-0123', 'choi@email.com', 'HIGH_RISK', 75),
('CUST-2024-007', '강미영', '1988-12-03', 'F', '010-7890-1234', 'kang@email.com', 'NORMAL', 12);

-- 증권 데이터
INSERT INTO policies (policy_number, customer_id, product_name, product_code, status, contract_date, coverage_start_date, coverage_end_date, premium_amount, premium_status, exemption_end_date, reduction_end_date, reduction_rate) VALUES
('POL-2024-001', 1, '(무)프리미엄건강보험', 'PRD001', 'ACTIVE', '2023-01-15', '2023-01-15', '2043-01-14', 85000, 'PAID', '2023-04-15', '2024-01-15', 50),
('POL-2024-002', 2, '(무)프리미엄건강보험', 'PRD001', 'ACTIVE', '2023-06-01', '2023-06-01', '2043-05-31', 92000, 'PAID', '2023-09-01', '2024-06-01', 50),
('POL-2024-003', 3, '(무)실속건강보험', 'PRD002', 'ACTIVE', '2024-01-10', '2024-01-10', '2044-01-09', 65000, 'PAID', '2024-04-10', '2025-01-10', 50),
('POL-2024-004', 4, '(무)프리미엄건강보험', 'PRD001', 'ACTIVE', '2022-03-20', '2022-03-20', '2042-03-19', 78000, 'OVERDUE', '2022-06-20', '2023-03-20', 50),
('POL-2024-005', 5, '(무)프리미엄건강보험', 'PRD001', 'ACTIVE', '2023-09-05', '2023-09-05', '2043-09-04', 88000, 'PAID', '2023-12-05', '2024-09-05', 50),
('POL-2024-006', 6, '(무)실버건강보험', 'PRD003', 'ACTIVE', '2021-05-01', '2021-05-01', '2041-04-30', 120000, 'PAID', '2021-08-01', '2022-05-01', 50),
('POL-2024-007', 7, '(무)프리미엄건강보험', 'PRD001', 'ACTIVE', '2024-06-01', '2024-06-01', '2044-05-31', 75000, 'PAID', '2024-09-01', '2025-06-01', 50),
('POL-EXPIRED', 3, '(무)구실손보험', 'PRD-OLD', 'TERMINATED', '2020-01-01', '2020-01-01', '2023-12-31', 45000, 'PAID', '2020-04-01', '2021-01-01', 50);

-- 보장내역 (POL-2024-001 - 홍길동)
INSERT INTO policy_coverages (policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount, deductible_type, deductible_amount, deductible_rate, payout_rate, max_days, annual_limit, used_annual_amount, surgery_classification) VALUES
(1, 1, '질병입원의료비(급여)', 'DIS_HOSP_INS', 50000000, 'MAX', 100000, 10, 90, NULL, 50000000, 0, NULL),
(1, 2, '질병입원의료비(비급여)', 'DIS_HOSP_UNINS', 50000000, 'MAX', 200000, 20, 80, NULL, 50000000, 0, NULL),
(1, 5, '질병입원일당', 'DIS_HOSP_DAILY', 50000, 'FIXED', 0, 0, 100, 180, NULL, 0, NULL),
(1, 6, '질병수술비(1종)', 'DIS_SURG_1', 300000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 1),
(1, 7, '질병수술비(2종)', 'DIS_SURG_2', 600000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 2),
(1, 8, '질병수술비(3종)', 'DIS_SURG_3', 1000000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 3),
(1, 9, '질병수술비(4종)', 'DIS_SURG_4', 1500000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 4),
(1, 10, '질병수술비(5종)', 'DIS_SURG_5', 3000000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 5);

-- 보장내역 (POL-2024-002 - 김철수)
INSERT INTO policy_coverages (policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount, deductible_type, deductible_amount, deductible_rate, payout_rate, max_days, annual_limit, used_annual_amount, surgery_classification) VALUES
(2, 1, '질병입원의료비(급여)', 'DIS_HOSP_INS', 100000000, 'MAX', 100000, 10, 90, NULL, 100000000, 0, NULL),
(2, 2, '질병입원의료비(비급여)', 'DIS_HOSP_UNINS', 50000000, 'MAX', 200000, 20, 80, NULL, 50000000, 0, NULL),
(2, 5, '질병입원일당', 'DIS_HOSP_DAILY', 100000, 'FIXED', 0, 0, 100, 180, NULL, 0, NULL),
(2, 6, '질병수술비(1종)', 'DIS_SURG_1', 500000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 1),
(2, 7, '질병수술비(2종)', 'DIS_SURG_2', 1000000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 2),
(2, 8, '질병수술비(3종)', 'DIS_SURG_3', 2000000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 3),
(2, 9, '질병수술비(4종)', 'DIS_SURG_4', 3000000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 4),
(2, 10, '질병수술비(5종)', 'DIS_SURG_5', 5000000, 'FIXED', 0, 0, 100, NULL, NULL, 0, 5);

-- 보장내역 (POL-2024-003 - 이영희, 감액기간)
INSERT INTO policy_coverages (policy_id, coverage_type_id, coverage_name, coverage_code, insured_amount, deductible_type, deductible_amount, deductible_rate, payout_rate, max_days, annual_limit, surgery_classification) VALUES
(3, 1, '질병입원의료비(급여)', 'DIS_HOSP_INS', 30000000, 'MAX', 100000, 10, 90, NULL, 30000000, NULL),
(3, 3, '통원의료비(급여)', 'OUT_INS', 200000, 'FIXED', 10000, 0, 90, NULL, 2400000, NULL),
(3, 4, '통원의료비(비급여)', 'OUT_UNINS', 200000, 'FIXED', 30000, 0, 80, NULL, 2400000, NULL);

-- 샘플 청구
INSERT INTO claims (claim_number, policy_id, customer_id, claim_type, claim_subtype, treatment_start_date, treatment_end_date, hospital_name, hospital_type, diagnosis_code, diagnosis_name, surgery_code, surgery_name, surgery_classification, hospitalization_days, total_medical_expense, insured_expense, uninsured_expense, total_claimed_amount, status) VALUES
('CLM-2024-00001', 1, 1, 'HOSPITALIZATION', 'DISEASE', '2024-12-10', '2024-12-14', '서울대학교병원', 'GENERAL', 'K35.0', '급성 충수염, 범발성 복막염 동반', 'S0401', '복강경 충수절제술', 2, 4, 1520000, 1200000, 320000, 1520000, 'RECEIVED'),
('CLM-2024-00002', 2, 2, 'SURGERY', 'DISEASE', '2024-12-12', '2024-12-15', '삼성서울병원', 'GENERAL', 'K80.0', '담석증, 급성 담낭염 동반', 'S0501', '복강경 담낭절제술', 2, 3, 3500000, 2800000, 700000, 3500000, 'RECEIVED'),
('CLM-2024-00003', 3, 3, 'OUTPATIENT', 'DISEASE', '2024-12-15', '2024-12-15', '강남세브란스병원', 'GENERAL', 'J18.9', '폐렴, 상세불명', NULL, NULL, NULL, 0, 85000, 70000, 15000, 85000, 'APPROVED'),
('CLM-2024-00004', 4, 4, 'HOSPITALIZATION', 'DISEASE', '2024-12-01', '2024-12-10', '분당서울대병원', 'GENERAL', 'M54.5', '요통', NULL, NULL, NULL, 9, 2100000, 1500000, 600000, 2100000, 'PENDING_REVIEW'),
('CLM-2024-00005', 5, 5, 'SURGERY', 'DISEASE', '2024-12-08', '2024-12-15', '서울아산병원', 'GENERAL', 'I21.9', '급성 심근경색증, 상세불명', 'S0802', '경피적 관상동맥중재술', 4, 7, 12000000, 10000000, 2000000, 12000000, 'AI_PROCESSING');

-- 권한/뷰
CREATE OR REPLACE VIEW v_claim_summary AS
SELECT
    c.claim_number,
    c.claim_date,
    cu.name as customer_name,
    p.policy_number,
    c.claim_type,
    c.diagnosis_name,
    c.surgery_name,
    c.hospitalization_days,
    c.total_claimed_amount,
    c.total_approved_amount,
    c.status,
    c.ai_confidence_score,
    c.fraud_score
FROM claims c
JOIN customers cu ON c.customer_id = cu.id
JOIN policies p ON c.policy_id = p.id
ORDER BY c.created_at DESC;

COMMENT ON VIEW v_claim_summary IS '청구 요약 뷰';
