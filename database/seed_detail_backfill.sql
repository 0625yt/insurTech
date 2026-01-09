-- Backfill claim detail data for claims missing AI analysis / AI model results.

UPDATE claims c
SET ai_analysis_result = jsonb_build_object(
    '보장확인', '적합',
    '면책기간', '통과',
    '진단코드', '유효',
    '청구금액', '적정',
    'coverage_analysis', jsonb_build_object(
        'breakdown', CASE
            WHEN c.claim_type = 'OUTPATIENT' THEN jsonb_build_array(
                jsonb_build_object(
                    'item', '통원의료비(급여)',
                    'calculation', '(급여-공제)×90%',
                    'termReference', jsonb_build_object(
                        'article', '제18조-1',
                        'title', '통원의료비(급여)',
                        'content', '통원 급여 의료비는 공제 후 90% 지급.',
                        'formula', '(급여-공제)×90%'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.6)
                ),
                jsonb_build_object(
                    'item', '통원의료비(비급여)',
                    'calculation', '(비급여-공제)×80%',
                    'termReference', jsonb_build_object(
                        'article', '제18조-2',
                        'title', '통원의료비(비급여)',
                        'content', '통원 비급여 의료비는 공제 후 80% 지급.',
                        'formula', '(비급여-공제)×80%'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.3)
                )
            )
            WHEN c.claim_type = 'SURGERY' THEN jsonb_build_array(
                jsonb_build_object(
                    'item', '질병수술비(2종)',
                    'calculation', '수술 정액',
                    'termReference', jsonb_build_object(
                        'article', '제17조-1',
                        'title', '수술비',
                        'content', '수술 등급별 정액 지급.',
                        'formula', '등급별 정액'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.7)
                ),
                jsonb_build_object(
                    'item', '입원의료비(급여)',
                    'calculation', '(급여-공제)×90%',
                    'termReference', jsonb_build_object(
                        'article', '제15조-1',
                        'title', '입원의료비(급여)',
                        'content', '급여 입원의료비는 본인부담금 공제 후 90% 지급.',
                        'formula', '(급여-본인부담금)×90%'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.2)
                ),
                jsonb_build_object(
                    'item', '입원의료비(비급여)',
                    'calculation', '(비급여-공제)×80%',
                    'termReference', jsonb_build_object(
                        'article', '제15조-2',
                        'title', '입원의료비(비급여)',
                        'content', '비급여 입원의료비는 공제 후 80% 지급.',
                        'formula', '(비급여-본인부담금)×80%'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.1)
                )
            )
            ELSE jsonb_build_array(
                jsonb_build_object(
                    'item', '입원의료비(급여)',
                    'calculation', '(급여-공제)×90%',
                    'termReference', jsonb_build_object(
                        'article', '제15조-1',
                        'title', '입원의료비(급여)',
                        'content', '급여 입원의료비는 본인부담금 공제 후 90% 지급.',
                        'formula', '(급여-본인부담금)×90%'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.6)
                ),
                jsonb_build_object(
                    'item', '입원의료비(비급여)',
                    'calculation', '(비급여-공제)×80%',
                    'termReference', jsonb_build_object(
                        'article', '제15조-2',
                        'title', '입원의료비(비급여)',
                        'content', '비급여 입원의료비는 공제 후 80% 지급.',
                        'formula', '(비급여-본인부담금)×80%'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.2)
                ),
                jsonb_build_object(
                    'item', '질병입원일당',
                    'calculation', '일당×일수',
                    'termReference', jsonb_build_object(
                        'article', '제16조-1',
                        'title', '입원일당',
                        'content', '입원 1일당 정액 지급.',
                        'formula', '일당×일수'
                    ),
                    'approvedAmount', round(coalesce(c.total_claimed_amount, 0) * 0.2)
                )
            )
        END,
        'total_approved', round(coalesce(c.total_claimed_amount, 0) * 0.85),
        'total_rejected', 0
    )
)
WHERE c.ai_analysis_result IS NULL;

UPDATE claims
SET total_approved_amount = COALESCE(total_approved_amount, round(coalesce(total_claimed_amount, 0) * 0.85)),
    total_rejected_amount = COALESCE(total_rejected_amount, 0)
WHERE total_approved_amount IS NULL OR total_rejected_amount IS NULL;

WITH default_model AS (
    SELECT id FROM ai_models WHERE is_default = TRUE ORDER BY id LIMIT 1
),
alt_model AS (
    SELECT id FROM ai_models WHERE is_default = FALSE ORDER BY id LIMIT 1
)
INSERT INTO claim_ai_results (
    claim_id, model_id, recommendation, confidence_score,
    total_approved_amount, total_rejected_amount,
    coverage_analysis, validation_result, fraud_analysis, payout_breakdown,
    reasoning, risk_factors, response_time_ms, tokens_used,
    is_selected, selected_at, selected_by, created_at
)
SELECT
    c.id,
    m.model_id,
    m.recommendation,
    m.confidence_score,
    round(coalesce(c.total_claimed_amount, 0) * m.approve_rate),
    0,
    c.ai_analysis_result->'coverage_analysis',
    jsonb_build_object(
        'policy_valid', TRUE,
        'premium_paid', TRUE,
        'within_coverage_period', TRUE
    ),
    jsonb_build_object(
        'risk_score', coalesce(c.fraud_score, 0.1),
        'risk_level', 'LOW'
    ),
    c.ai_analysis_result->'coverage_analysis'->'breakdown',
    m.reasoning,
    jsonb_build_array(
        jsonb_build_object('factor', '진단코드', 'impact', 'low'),
        jsonb_build_object('factor', '청구금액', 'impact', 'medium')
    ),
    m.response_time_ms,
    NULL,
    m.is_selected,
    CASE WHEN m.is_selected THEN NOW() ELSE NULL END,
    CASE WHEN m.is_selected THEN 'system' ELSE NULL END,
    NOW()
FROM claims c
CROSS JOIN (
    SELECT dm.id AS model_id, 'AUTO_APPROVE'::varchar AS recommendation,
           0.88::numeric AS confidence_score, 0.85::numeric AS approve_rate,
           '기본 모델 자동 승인' AS reasoning, 2800 AS response_time_ms, TRUE AS is_selected
    FROM default_model dm
    UNION ALL
    SELECT am.id, 'MANUAL_REVIEW',
           0.82::numeric, 0.80::numeric,
           '보수적 재검토 필요', 3400, FALSE
    FROM alt_model am
) m
WHERE c.ai_analysis_result IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM claim_ai_results car WHERE car.claim_id = c.id
  );