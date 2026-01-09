-- ═══════════════════════════════════════════════════════════════════════════
-- AI 모델 비교 및 평가 시스템 마이그레이션
-- ═══════════════════════════════════════════════════════════════════════════

-- 기존 테이블 삭제 (있다면)
DROP TABLE IF EXISTS claim_ai_results CASCADE;
DROP TABLE IF EXISTS ai_model_evaluations CASCADE;
DROP TABLE IF EXISTS ai_models CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. AI 모델 정보 테이블
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE ai_models (
    id SERIAL PRIMARY KEY,
    model_code VARCHAR(50) NOT NULL UNIQUE,          -- 모델 코드 (gpt-4o, claude-3.5-sonnet 등)
    model_name VARCHAR(100) NOT NULL,                -- 표시 이름
    provider VARCHAR(50) NOT NULL,                   -- 제공자 (OpenAI, Anthropic, Google)
    version VARCHAR(30),                             -- 버전

    -- 모델 특성
    specialization VARCHAR(50),                      -- 특화 분야 (GENERAL, OCR, FRAUD, COVERAGE)
    description TEXT,

    -- 성능 지표 (집계)
    total_evaluations INT DEFAULT 0,
    avg_accuracy DECIMAL(5,2) DEFAULT 0,             -- 평균 정확도 (0-100)
    avg_response_time_ms INT DEFAULT 0,              -- 평균 응답시간
    avg_user_rating DECIMAL(3,2) DEFAULT 0,          -- 평균 사용자 평점 (1-5)

    -- 비용
    cost_per_1k_tokens DECIMAL(10,6) DEFAULT 0,      -- 1000 토큰당 비용

    -- 상태
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,                -- 기본 모델 여부

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE ai_models IS 'AI 모델 정보 및 성능 통계';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 청구별 AI 모델 심사 결과
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE claim_ai_results (
    id SERIAL PRIMARY KEY,
    claim_id INT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    model_id INT NOT NULL REFERENCES ai_models(id),

    -- 분석 결과
    recommendation VARCHAR(30) NOT NULL,             -- AUTO_APPROVE, MANUAL_REVIEW, REJECT
    confidence_score DECIMAL(5,2) NOT NULL,          -- 신뢰도 (0-100)

    -- 지급액 산정
    total_approved_amount BIGINT DEFAULT 0,
    total_rejected_amount BIGINT DEFAULT 0,

    -- 상세 분석 결과
    coverage_analysis JSONB,                         -- 담보별 분석 결과
    validation_result JSONB,                         -- 검증 결과
    fraud_analysis JSONB,                            -- 사기 탐지 결과
    payout_breakdown JSONB,                          -- 지급액 산출 내역

    -- 추론 과정
    reasoning TEXT,                                  -- 판단 근거 설명
    risk_factors JSONB,                              -- 위험 요소 목록

    -- 성능 측정
    response_time_ms INT,                            -- 응답 시간
    tokens_used INT,                                 -- 사용된 토큰 수

    -- 선택 여부
    is_selected BOOLEAN DEFAULT FALSE,               -- 최종 선택된 결과인지
    selected_at TIMESTAMP,
    selected_by VARCHAR(50),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE claim_ai_results IS '청구별 AI 모델 심사 결과';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AI 모델 평가 테이블
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE ai_model_evaluations (
    id SERIAL PRIMARY KEY,
    claim_ai_result_id INT NOT NULL REFERENCES claim_ai_results(id) ON DELETE CASCADE,
    claim_id INT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    model_id INT NOT NULL REFERENCES ai_models(id),

    -- 평가자 정보
    evaluator_id INT,
    evaluator_name VARCHAR(50) NOT NULL,
    evaluator_role VARCHAR(30),                      -- REVIEWER, MANAGER, ADMIN

    -- 평가 내용
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),  -- 1-5점
    accuracy_rating INT CHECK (accuracy_rating >= 1 AND accuracy_rating <= 5),  -- 정확도 평가
    reasoning_rating INT CHECK (reasoning_rating >= 1 AND reasoning_rating <= 5),  -- 추론 품질 평가

    -- 상세 피드백
    is_correct BOOLEAN,                              -- 결과가 정확한지
    feedback_type VARCHAR(30),                       -- POSITIVE, NEGATIVE, CORRECTION
    feedback_text TEXT,                              -- 피드백 내용

    -- 수정 내역 (오류시)
    correction_needed BOOLEAN DEFAULT FALSE,
    corrected_recommendation VARCHAR(30),
    corrected_amount BIGINT,
    correction_reason TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE ai_model_evaluations IS 'AI 모델 결과에 대한 평가';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. 인덱스
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX idx_claim_ai_results_claim ON claim_ai_results(claim_id);
CREATE INDEX idx_claim_ai_results_model ON claim_ai_results(model_id);
CREATE INDEX idx_claim_ai_results_selected ON claim_ai_results(is_selected) WHERE is_selected = TRUE;
CREATE INDEX idx_ai_model_evaluations_result ON ai_model_evaluations(claim_ai_result_id);
CREATE INDEX idx_ai_model_evaluations_model ON ai_model_evaluations(model_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 초기 AI 모델 데이터
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO ai_models (model_code, model_name, provider, version, specialization, description, cost_per_1k_tokens, is_default) VALUES
('gpt-4o', 'GPT-4o', 'OpenAI', '2024-08', 'GENERAL', '최신 GPT-4 Omni 모델. 빠른 응답과 높은 정확도', 0.005, TRUE),
('gpt-4o-mini', 'GPT-4o Mini', 'OpenAI', '2024-07', 'GENERAL', 'GPT-4o의 경량 버전. 비용 효율적', 0.00015, FALSE),
('claude-3.5-sonnet', 'Claude 3.5 Sonnet', 'Anthropic', '2024-10', 'GENERAL', '복잡한 추론에 강점. 상세한 분석 제공', 0.003, FALSE),
('claude-3-haiku', 'Claude 3 Haiku', 'Anthropic', '2024-03', 'GENERAL', '빠른 응답 속도의 경량 모델', 0.00025, FALSE),
('gemini-1.5-pro', 'Gemini 1.5 Pro', 'Google', '2024-05', 'GENERAL', 'Google의 최신 모델. 긴 컨텍스트 처리', 0.00125, FALSE);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 모델 통계 업데이트 함수
-- ═══════════════════════════════════════════════════════════════════════════
-- Mock AI ensemble results per claim (for selectable options)
INSERT INTO claim_ai_results (
    claim_id, model_id, recommendation, confidence_score,
    total_approved_amount, total_rejected_amount,
    coverage_analysis, validation_result, fraud_analysis, payout_breakdown,
    reasoning, risk_factors, response_time_ms, tokens_used, is_selected
) VALUES
((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00001'),
 (SELECT id FROM ai_models WHERE model_code = 'gpt-4o'),
 'AUTO_APPROVE', 88.0, 1886000, 0,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":990000,"calculation":"(1,200,000-100,000)*0.9","termReference":{"article":"Art 15-1","title":"Inpatient insured coverage","content":"Insured inpatient medical coverage at 90% after deductible.","formula":"(insured - deductible) * 90%"}},{"item":"Inpatient Medical (Uninsured)","approvedAmount":96000,"calculation":"(320,000-200,000)*0.8","termReference":{"article":"Art 15-2","title":"Inpatient uninsured coverage","content":"Uninsured inpatient medical coverage at 80% after deductible.","formula":"(uninsured - deductible) * 80%"}},{"item":"Hospital Daily","approvedAmount":200000,"calculation":"50,000 * 4 days","termReference":{"article":"Art 16-1","title":"Hospital daily allowance","content":"Daily allowance per inpatient day.","formula":"daily_amount * days"}},{"item":"Surgery Class 2","approvedAmount":600000,"calculation":"Class 2 fixed amount","termReference":{"article":"Art 17-1","title":"Surgery benefit","content":"Lump-sum by surgery class.","formula":"class_amount"}}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.10,"risk_level":"LOW"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":990000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":96000},{"item":"Hospital Daily","approvedAmount":200000},{"item":"Surgery Class 2","approvedAmount":600000}]',
 'All coverages applicable; low fraud risk.', '["NORMAL"]', 3200, 2100, TRUE),
((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00001'),
 (SELECT id FROM ai_models WHERE model_code = 'claude-3.5-sonnet'),
 'AUTO_APPROVE', 86.0, 1850000, 36000,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":990000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":96000},{"item":"Hospital Daily","approvedAmount":200000},{"item":"Surgery Class 2","approvedAmount":560000}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.10,"risk_level":"LOW"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":990000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":96000},{"item":"Hospital Daily","approvedAmount":200000},{"item":"Surgery Class 2","approvedAmount":560000}]',
 'Slightly conservative surgery amount.', '["NORMAL"]', 3500, 2200, FALSE),
((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00001'),
 (SELECT id FROM ai_models WHERE model_code = 'gemini-1.5-pro'),
 'AUTO_APPROVE', 84.0, 1820000, 66000,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":970000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":96000},{"item":"Hospital Daily","approvedAmount":200000},{"item":"Surgery Class 2","approvedAmount":550000}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.12,"risk_level":"LOW"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":970000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":96000},{"item":"Hospital Daily","approvedAmount":200000},{"item":"Surgery Class 2","approvedAmount":550000}]',
 'Conservative inpatient adjustment.', '["NORMAL"]', 3400, 2300, FALSE),

((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00002'),
 (SELECT id FROM ai_models WHERE model_code = 'gpt-4o'),
 'AUTO_APPROVE', 91.0, 4130000, 0,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":2430000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":400000},{"item":"Hospital Daily","approvedAmount":300000},{"item":"Surgery Class 2","approvedAmount":1000000}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.08,"risk_level":"LOW"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":2430000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":400000},{"item":"Hospital Daily","approvedAmount":300000},{"item":"Surgery Class 2","approvedAmount":1000000}]',
 'Standard coverage application.', '["NORMAL"]', 3100, 2100, TRUE),
((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00002'),
 (SELECT id FROM ai_models WHERE model_code = 'claude-3.5-sonnet'),
 'AUTO_APPROVE', 89.0, 4050000, 80000,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":2400000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":400000},{"item":"Hospital Daily","approvedAmount":300000},{"item":"Surgery Class 2","approvedAmount":950000}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.08,"risk_level":"LOW"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":2400000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":400000},{"item":"Hospital Daily","approvedAmount":300000},{"item":"Surgery Class 2","approvedAmount":950000}]',
 'Surgery amount slightly reduced.', '["NORMAL"]', 3300, 2200, FALSE),
((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00002'),
 (SELECT id FROM ai_models WHERE model_code = 'gemini-1.5-pro'),
 'AUTO_APPROVE', 87.0, 4020000, 110000,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":2380000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":400000},{"item":"Hospital Daily","approvedAmount":300000},{"item":"Surgery Class 2","approvedAmount":940000}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.08,"risk_level":"LOW"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":2380000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":400000},{"item":"Hospital Daily","approvedAmount":300000},{"item":"Surgery Class 2","approvedAmount":940000}]',
 'Conservative inpatient adjustment.', '["NORMAL"]', 3600, 2300, FALSE),

((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00003'),
 (SELECT id FROM ai_models WHERE model_code = 'gpt-4o'),
 'MANUAL_REVIEW', 85.0, 27000, 42000,
 '{"breakdown":[{"item":"Outpatient Medical (Insured)","approvedAmount":27000,"calculation":"(70,000-10,000)*0.9*0.5","termReference":{"article":"Art 18-1","title":"Outpatient insured coverage","content":"Outpatient insured coverage with deductible and payout rate.","formula":"(insured - deductible) * 90%"}},{"item":"Outpatient Medical (Uninsured)","approvedAmount":0,"calculation":"below deductible"}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.15,"risk_level":"LOW"}',
 '[{"item":"Outpatient Medical (Insured)","approvedAmount":27000},{"item":"Outpatient Medical (Uninsured)","approvedAmount":0}]',
 'Reduction period applies.', '["EARLY_CLAIM"]', 2500, 1900, TRUE),
((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00003'),
 (SELECT id FROM ai_models WHERE model_code = 'claude-3.5-sonnet'),
 'MANUAL_REVIEW', 83.0, 27000, 42000,
 '{"breakdown":[{"item":"Outpatient Medical (Insured)","approvedAmount":27000},{"item":"Outpatient Medical (Uninsured)","approvedAmount":0}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.15,"risk_level":"LOW"}',
 '[{"item":"Outpatient Medical (Insured)","approvedAmount":27000},{"item":"Outpatient Medical (Uninsured)","approvedAmount":0}]',
 'Reduction period applies.', '["EARLY_CLAIM"]', 2700, 2000, FALSE),

((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00004'),
 (SELECT id FROM ai_models WHERE model_code = 'gpt-4o'),
 'MANUAL_REVIEW', 75.0, 0, 0,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":0,"calculation":"pending review"},{"item":"Inpatient Medical (Uninsured)","approvedAmount":0,"calculation":"pending review"}]}',
 '{"policy_valid":true,"premium_paid":false}',
 '{"fraud_score":0.68,"risk_level":"HIGH"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":0},{"item":"Inpatient Medical (Uninsured)","approvedAmount":0}]',
 'High fraud risk; investigation required.', '["FRAUD_SUSPECT"]', 4100, 2400, TRUE),

((SELECT id FROM claims WHERE claim_number = 'CLM-2024-00005'),
 (SELECT id FROM ai_models WHERE model_code = 'gpt-4o'),
 'MANUAL_REVIEW', 89.0, 12050000, 0,
 '{"breakdown":[{"item":"Inpatient Medical (Insured)","approvedAmount":8910000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":1440000},{"item":"Hospital Daily","approvedAmount":700000},{"item":"Surgery Class 4","approvedAmount":3000000}]}',
 '{"policy_valid":true,"premium_paid":true}',
 '{"fraud_score":0.05,"risk_level":"LOW"}',
 '[{"item":"Inpatient Medical (Insured)","approvedAmount":8910000},{"item":"Inpatient Medical (Uninsured)","approvedAmount":1440000},{"item":"Hospital Daily","approvedAmount":700000},{"item":"Surgery Class 4","approvedAmount":3000000}]',
 'High amount claim; manual review recommended.', '["HIGH_AMOUNT"]', 5200, 2600, TRUE);

CREATE OR REPLACE FUNCTION update_model_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- 평균 평점 및 정확도 업데이트
    UPDATE ai_models SET
        total_evaluations = (
            SELECT COUNT(*) FROM ai_model_evaluations WHERE model_id = NEW.model_id
        ),
        avg_user_rating = (
            SELECT COALESCE(AVG(rating), 0) FROM ai_model_evaluations WHERE model_id = NEW.model_id
        ),
        avg_accuracy = (
            SELECT COALESCE(AVG(CASE WHEN is_correct THEN 100 ELSE 0 END), 0)
            FROM ai_model_evaluations WHERE model_id = NEW.model_id
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.model_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_model_stats
AFTER INSERT ON ai_model_evaluations
FOR EACH ROW EXECUTE FUNCTION update_model_stats();
