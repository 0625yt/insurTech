# n8n 설정 가이드

## 1. n8n 설치 및 실행

### Docker로 실행 (권장)
```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -e N8N_BASIC_AUTH_ACTIVE=true \
  -e N8N_BASIC_AUTH_USER=admin \
  -e N8N_BASIC_AUTH_PASSWORD=password \
  -e USE_MOCK=true \
  -e GOOGLE_API_KEY=your-key \
  -v n8n_data:/home/node/.n8n \
  n8nio/n8n
```

### npm으로 실행
```bash
npm install -g n8n
USE_MOCK=true n8n start
```

## 2. 워크플로우 Import

1. n8n 웹 UI 접속: http://localhost:5678
2. 좌측 메뉴 → Workflows → Import from File
3. `workflows/insurance_claim_v3_final.json` 선택

## 3. Credentials 설정

### PostgreSQL (필수)
1. Settings → Credentials → Add Credential
2. 타입: **PostgreSQL**
3. 설정:
   - Host: `localhost`
   - Database: `insurtech`
   - User: `insurtech_user`
   - Password: `1234`
   - Port: `5432`
4. Save 후 credential ID 복사

### OpenAI API (Mock 모드 아닐 때)
1. Add Credential → **OpenAI API**
2. API Key 입력

### Anthropic API (Mock 모드 아닐 때)
1. Add Credential → **Header Auth**
2. Name: `x-api-key`
3. Value: `your-anthropic-api-key`

## 4. 워크플로우 Credential 연결

1. 워크플로우 열기
2. 각 PostgreSQL 노드 클릭 → Credentials 선택
3. 저장

## 5. 환경변수 설정

n8n Settings → Variables에서 설정:

| 변수명 | 값 | 설명 |
|--------|-----|------|
| `USE_MOCK` | `true` | Mock 모드 활성화 (AI API 없이 테스트) |
| `GOOGLE_API_KEY` | `AIza...` | Gemini API 키 |

## 6. 테스트

### Mock 모드로 테스트 (AI API 불필요)
```bash
curl -X POST http://localhost:5678/webhook/insurance-claim/submit \
  -H "Content-Type: application/json" \
  -d '{
    "policy_id": "POL-2024-001",
    "customer_name": "홍길동",
    "diagnosis_base64": "test",
    "receipt_base64": "test"
  }'
```

### 응답 예시
```json
{
  "success": true,
  "claim_case_id": "CLM-1734567890-abc123",
  "status": "approved",
  "total_claimed": 1500000,
  "total_approved": 2350000,
  "decision": "질병입원의료비 90% + 수술비 정액 지급 승인"
}
```

## 7. 백엔드 연동

백엔드 `.env`에 추가:
```
N8N_WEBHOOK_BASE_URL=http://localhost:5678/webhook
```

백엔드 API 테스트:
```bash
curl -X POST http://localhost:3000/api/claims \
  -H "Content-Type: application/json" \
  -d '{
    "policy_id": "POL-2024-001",
    "customer_name": "홍길동",
    "diagnosis_base64": "test",
    "receipt_base64": "test"
  }'
```

## 8. 주의사항

1. **Mock 모드**: `USE_MOCK=true`로 설정하면 AI API 호출 없이 테스트 가능
2. **PostgreSQL 연결**: n8n이 PostgreSQL에 접근 가능해야 함
3. **Webhook 활성화**: 워크플로우를 "Active"로 설정해야 webhook 동작

## 9. 트러블슈팅

### PostgreSQL 연결 오류
- n8n과 PostgreSQL이 같은 네트워크에 있는지 확인
- Docker 사용 시 `host.docker.internal` 사용

### Webhook 404 오류
- 워크플로우가 Active 상태인지 확인
- webhook path가 올바른지 확인 (`/webhook/insurance-claim/submit`)

### Credential ID 오류
- JSON에서 `POSTGRES_CREDENTIAL_ID`를 실제 credential ID로 교체
