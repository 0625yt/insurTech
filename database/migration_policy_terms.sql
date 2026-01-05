-- ═══════════════════════════════════════════════════════════════════════════
-- 약관 조항 및 근거 데이터 마이그레이션
-- 심사자가 보험금 산출 근거를 명확히 확인할 수 있도록 약관 조문 추가
-- ═══════════════════════════════════════════════════════════════════════════

-- 기존 테이블 삭제
DROP TABLE IF EXISTS policy_terms CASCADE;
DROP TABLE IF EXISTS coverage_term_mappings CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 약관 조항 테이블 (보험 약관의 실제 조문)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE policy_terms (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(50) NOT NULL,               -- 상품 코드
    term_code VARCHAR(30) NOT NULL,                  -- 조항 코드 (예: ART_15_1)
    article_number VARCHAR(20) NOT NULL,             -- 조문 번호 (예: 제15조)
    clause_number VARCHAR(20),                       -- 항 번호 (예: 제1항)
    sub_clause VARCHAR(20),                          -- 호 번호 (예: 제1호)

    -- 조항 내용
    title VARCHAR(200) NOT NULL,                     -- 조항 제목
    content TEXT NOT NULL,                           -- 조항 본문
    summary VARCHAR(500),                            -- 요약

    -- 분류
    term_category VARCHAR(50) NOT NULL,              -- 조항 분류: COVERAGE(보장), EXCLUSION(면책), DEDUCTIBLE(자기부담), LIMIT(한도), PERIOD(기간), PAYMENT(지급)
    applies_to VARCHAR(50)[],                        -- 적용 담보 타입: HOSP_INS, HOSP_UNINS, SURGERY 등

    -- 계산 관련
    calculation_type VARCHAR(30),                    -- PERCENTAGE, FIXED, DAILY, LIMIT
    calculation_value DECIMAL(10,2),                 -- 적용 값 (비율, 금액, 일수 등)
    calculation_formula VARCHAR(200),                -- 계산 공식

    -- 버전 관리
    effective_date DATE NOT NULL,
    expiry_date DATE,
    version VARCHAR(10) DEFAULT '1.0',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_code, term_code, effective_date)
);

COMMENT ON TABLE policy_terms IS '보험 약관 조항 (실제 약관 문구)';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 담보-약관 조항 매핑
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE coverage_term_mappings (
    id SERIAL PRIMARY KEY,
    coverage_type_id INT REFERENCES coverage_types(id),
    term_id INT REFERENCES policy_terms(id),
    priority INT DEFAULT 1,                          -- 적용 우선순위
    is_primary BOOLEAN DEFAULT FALSE,                -- 주 조항 여부
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 약관 조항 샘플 데이터 (실제 보험 약관 형식)
-- ═══════════════════════════════════════════════════════════════════════════

-- 보장 조항
INSERT INTO policy_terms (product_code, term_code, article_number, clause_number, title, content, summary, term_category, applies_to, calculation_type, calculation_value, calculation_formula, effective_date) VALUES

-- 입원의료비(급여) 관련 조항
('PREMIUM_HEALTH', 'ART_15_1', '제15조', '제1항', '입원의료비(급여) 보장',
'회사는 피보험자가 상해 또는 질병의 치료를 직접적인 목적으로 병원에 입원하여 치료를 받은 경우, 입원의료비 중 급여 부분에 대하여 다음과 같이 보험금을 지급합니다.

보험금 = (급여 입원의료비 - 본인부담금) × 보상비율(90%)

단, 본인부담금은 급여 입원의료비의 10%와 1회당 10만원 중 큰 금액으로 합니다.',
'급여 입원의료비의 90%를 본인부담금 공제 후 지급',
'COVERAGE', ARRAY['HOSP_INS'], 'PERCENTAGE', 90.00, '(급여의료비 - MAX(급여의료비×10%, 10만원)) × 90%',
'2023-01-01'),

('PREMIUM_HEALTH', 'ART_15_2', '제15조', '제2항', '입원의료비(비급여) 보장',
'회사는 피보험자가 상해 또는 질병의 치료를 직접적인 목적으로 병원에 입원하여 치료를 받은 경우, 입원의료비 중 비급여 부분에 대하여 다음과 같이 보험금을 지급합니다.

보험금 = (비급여 입원의료비 - 본인부담금) × 보상비율(80%)

단, 본인부담금은 비급여 입원의료비의 20%와 1회당 20만원 중 큰 금액으로 합니다.',
'비급여 입원의료비의 80%를 본인부담금 공제 후 지급',
'COVERAGE', ARRAY['HOSP_UNINS'], 'PERCENTAGE', 80.00, '(비급여의료비 - MAX(비급여의료비×20%, 20만원)) × 80%',
'2023-01-01'),

-- 입원일당 관련 조항
('PREMIUM_HEALTH', 'ART_16_1', '제16조', '제1항', '질병입원일당 보장',
'회사는 피보험자가 질병으로 인하여 병원에 입원한 경우, 입원 1일당 아래의 금액을 질병입원일당으로 지급합니다.

지급금액 = 가입금액(5만원) × 입원일수

단, 동일한 질병으로 인한 입원의 경우 최초 입원일로부터 180일을 한도로 합니다. 180일 초과 입원의 경우에도 동일 질병 여부에 따라 재입원으로 간주할 수 있습니다.',
'입원 1일당 5만원, 180일 한도',
'COVERAGE', ARRAY['HOSP_DAILY'], 'DAILY', 50000, '가입금액(5만원) × 입원일수 (최대 180일)',
'2023-01-01'),

-- 수술비 관련 조항
('PREMIUM_HEALTH', 'ART_17_1', '제17조', '제1항', '질병수술비 보장',
'회사는 피보험자가 질병의 치료를 직접적인 목적으로 수술을 받은 경우, 수술의 종류에 따라 아래와 같이 수술비를 지급합니다.

[수술 분류표]
- 1종 수술: 30만원 (단순 수술, 내시경적 시술 등)
- 2종 수술: 60만원 (복강경 수술, 중등도 수술 등)
- 3종 수술: 100만원 (개복 수술, 복잡 수술 등)
- 4종 수술: 150만원 (고난도 수술, 장기이식 관련 등)
- 5종 수술: 300만원 (심장·뇌 수술, 최고난도 수술 등)

수술의 분류는 「별표 수술분류표」에 따릅니다.',
'수술 종류에 따라 30만원~300만원 지급',
'COVERAGE', ARRAY['SURGERY'], 'LUMP_SUM', NULL, '수술분류표에 따른 정액 지급',
'2023-01-01'),

-- 면책기간 조항
('PREMIUM_HEALTH', 'ART_8_1', '제8조', '제1항', '면책기간',
'회사는 계약일(부활일)로부터 그 날을 포함하여 90일이 지나기 전에 발생한 질병에 대해서는 보험금을 지급하지 아니합니다. 다만, 상해로 인한 경우에는 그러하지 아니합니다.

면책기간: 계약일로부터 90일

면책기간 중 발생한 질병의 경우, 해당 질병과 인과관계가 있는 모든 치료에 대해 보험금을 지급하지 않습니다.',
'계약일로부터 90일간 질병에 대해 면책',
'EXCLUSION', ARRAY['HOSP_INS', 'HOSP_UNINS', 'HOSP_DAILY', 'SURGERY'], NULL, 90, '계약일 + 90일',
'2023-01-01'),

-- 감액기간 조항
('PREMIUM_HEALTH', 'ART_8_2', '제8조', '제2항', '감액기간',
'회사는 계약일(부활일)로부터 그 날을 포함하여 1년이 지나기 전에 발생한 질병에 대해서는 보험금의 50%만을 지급합니다. 다만, 상해로 인한 경우에는 그러하지 아니합니다.

감액기간: 계약일로부터 1년
감액률: 50%

이 조항은 면책기간(90일) 이후부터 1년까지의 기간에 적용됩니다.',
'계약일로부터 1년간 보험금의 50% 감액',
'PERIOD', ARRAY['HOSP_INS', 'HOSP_UNINS', 'HOSP_DAILY', 'SURGERY'], 'PERCENTAGE', 50.00, '산정보험금 × 50%',
'2023-01-01'),

-- 본인부담금 조항
('PREMIUM_HEALTH', 'ART_15_3', '제15조', '제3항', '본인부담금 적용',
'제1항 및 제2항의 본인부담금은 다음과 같이 계산합니다.

1. 급여 입원의료비:
   본인부담금 = MAX(급여의료비 × 10%, 100,000원)
   ※ 급여의료비의 10%와 10만원 중 큰 금액

2. 비급여 입원의료비:
   본인부담금 = MAX(비급여의료비 × 20%, 200,000원)
   ※ 비급여의료비의 20%와 20만원 중 큰 금액

본인부담금은 피보험자가 실제 부담하는 금액으로, 보험금 산정 시 공제됩니다.',
'급여 10%(최소 10만원), 비급여 20%(최소 20만원) 본인부담',
'DEDUCTIBLE', ARRAY['HOSP_INS', 'HOSP_UNINS'], 'PERCENTAGE', NULL, 'MAX(의료비×부담률, 최소부담금)',
'2023-01-01'),

-- 연간 한도 조항
('PREMIUM_HEALTH', 'ART_20_1', '제20조', '제1항', '보험금 지급 한도',
'회사가 이 계약에 따라 지급하는 보험금은 다음의 한도 내에서 지급합니다.

1. 입원의료비(급여): 연간 5,000만원 한도
2. 입원의료비(비급여): 연간 5,000만원 한도
3. 질병입원일당: 1입원 180일 한도

연간 한도는 매년 계약해당일을 기준으로 갱신됩니다. 한도 초과 금액은 보험금으로 지급하지 아니합니다.',
'입원의료비 연 5천만원, 입원일당 180일 한도',
'LIMIT', ARRAY['HOSP_INS', 'HOSP_UNINS', 'HOSP_DAILY'], 'LIMIT', 50000000, NULL,
'2023-01-01'),

-- 보험금 청구 조항
('PREMIUM_HEALTH', 'ART_25_1', '제25조', '제1항', '보험금 청구 및 지급',
'보험수익자가 보험금을 청구할 때에는 다음의 서류를 제출하여야 합니다.

1. 청구서 (회사 소정 양식)
2. 사고증명서 (진단서, 입·퇴원확인서, 수술확인서 등)
3. 신분증 (주민등록증 또는 운전면허증 등)
4. 기타 보험수익자가 보험금 수령에 필요한 서류

회사는 위 서류를 접수한 날로부터 3영업일 이내에 보험금을 지급합니다. 단, 보험금 지급사유의 조사나 확인이 필요한 경우에는 30일 이내에 지급합니다.',
'청구서류 접수 후 3영업일 이내 지급',
'PAYMENT', NULL, NULL, NULL, NULL,
'2023-01-01'),

-- 통원의료비 조항
('PREMIUM_HEALTH', 'ART_18_1', '제18조', '제1항', '통원의료비(급여) 보장',
'회사는 피보험자가 상해 또는 질병의 치료를 직접적인 목적으로 병원에 통원하여 치료를 받은 경우, 통원의료비 중 급여 부분에 대하여 다음과 같이 보험금을 지급합니다.

보험금 = (급여 통원의료비 - 본인부담금) × 보상비율(90%)

단, 본인부담금은 1만원과 급여 통원의료비의 20% 중 큰 금액으로 하며, 1회당 보상한도는 20만원입니다.',
'급여 통원의료비 90% 보상, 1회 20만원 한도',
'COVERAGE', ARRAY['OUT_INS'], 'PERCENTAGE', 90.00, '(급여통원의료비 - MAX(1만원, 20%)) × 90%, 최대 20만원',
'2023-01-01'),

('PREMIUM_HEALTH', 'ART_18_2', '제18조', '제2항', '통원의료비(비급여) 보장',
'회사는 피보험자가 상해 또는 질병의 치료를 직접적인 목적으로 병원에 통원하여 치료를 받은 경우, 통원의료비 중 비급여 부분에 대하여 다음과 같이 보험금을 지급합니다.

보험금 = (비급여 통원의료비 - 본인부담금) × 보상비율(80%)

단, 본인부담금은 3만원과 비급여 통원의료비의 30% 중 큰 금액으로 하며, 1회당 보상한도는 20만원입니다.',
'비급여 통원의료비 80% 보상, 1회 20만원 한도',
'COVERAGE', ARRAY['OUT_UNINS'], 'PERCENTAGE', 80.00, '(비급여통원의료비 - MAX(3만원, 30%)) × 80%, 최대 20만원',
'2023-01-01');

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 인덱스
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX idx_policy_terms_product ON policy_terms(product_code);
CREATE INDEX idx_policy_terms_category ON policy_terms(term_category);
CREATE INDEX idx_policy_terms_effective ON policy_terms(effective_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 담보-약관 매핑 데이터
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO coverage_term_mappings (coverage_type_id, term_id, priority, is_primary)
SELECT ct.id, pt.id, 1, TRUE
FROM coverage_types ct
JOIN policy_terms pt ON pt.applies_to && ARRAY[ct.code]::VARCHAR[]
WHERE pt.term_category = 'COVERAGE';
