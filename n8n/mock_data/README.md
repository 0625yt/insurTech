# n8n Mock 데이터 가이드

AI API 없이 n8n 워크플로우를 테스트하기 위한 Mock 데이터입니다.

## 파일 목록

| 파일 | 용도 | n8n 사용 위치 |
|------|------|---------------|
| `submit_claim_request.json` | 청구서 제출 요청 | Webhook 트리거 테스트 |
| `mock_ocr_results.json` | OCR 결과 (3개 모델) | AI API 대신 사용 |
| `mock_coverage_analysis.json` | 담보 분석 결과 | AI API 대신 사용 |
| `mock_review_result.json` | 최종 심사 결과 | 응답 형식 참고 |
| `verify_claim_request.json` | 검증 승인 요청 | Verify Webhook 테스트 |
| `verify_claim_modify.json` | 검증 수정 요청 | OCR 수정 시나리오 |
| `feedback_request.json` | 모델 피드백 요청 | Feedback Webhook 테스트 |

## n8n에서 Mock 데이터 사용 방법

### 1. AI API 호출 대신 Mock 데이터 사용

```javascript
// n8n Function 노드에서
// AI API 호출 대신 Mock 데이터 반환

const mockOcrResult = {
  patient_name: "홍길동",
  diagnosis_code: "K35.0",
  diagnosis_name: "급성충수염",
  total_amount: 1500000,
  confidence: 0.92
};

return { json: mockOcrResult };
```

### 2. Switch 노드로 Mock/실제 API 전환

```
[환경변수 체크] → USE_MOCK=true → [Mock 데이터]
                → USE_MOCK=false → [실제 AI API]
```

### 3. Webhook 테스트 (curl)

```bash
# 청구서 제출 테스트
curl -X POST http://localhost:5678/webhook/insurance-claim/submit \
  -H "Content-Type: application/json" \
  -d @submit_claim_request.json

# OCR 검증 테스트
curl -X POST http://localhost:5678/webhook/insurance-claim/verify \
  -H "Content-Type: application/json" \
  -d @verify_claim_request.json

# 피드백 제출 테스트
curl -X POST http://localhost:5678/webhook/insurance-claim/feedback \
  -H "Content-Type: application/json" \
  -d '{"claim_case_id":"CLM-TEST-001","model_name":"gpt","is_correct":true}'
```

## 테스트 시나리오

### 시나리오 1: 자동 승인 (Happy Path)
1. `submit_claim_request.json`으로 청구 제출
2. 3개 모델 OCR 결과 일치 (mock_ocr_results.json)
3. 신뢰도 85% 이상 → 자동 승인
4. 담보 분석 후 지급액 산출
5. `auto_approved_response` 형식으로 응답

### 시나리오 2: 수동 검증 필요
1. 청구 제출
2. Gemini 결과 불일치 (금액 오인식)
3. 신뢰도 72% → 검증 대기열 저장
4. `pending_verification_response` 형식으로 응답
5. 검증자가 `verify_claim_modify.json`으로 수정 승인
6. 담보 분석 → 심사 완료

### 시나리오 3: 거부
1. 청구 제출
2. 면책기간 미경과 확인
3. `rejected_response` 형식으로 응답

## DB에 Mock 데이터 확인

```sql
-- 증권 데이터 확인
SELECT policy_id, policyholder_name, policy_type FROM insurance_policies;

-- 모델 통계 확인
SELECT model_name, accuracy_pct, avg_confidence FROM ai_model_feedback_stats;
```
