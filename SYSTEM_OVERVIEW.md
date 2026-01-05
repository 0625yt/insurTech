# 시스템 전체 구성 및 Mock 데이터 설명

## 📌 완성된 시스템 구성 요소

### ✅ 1. 완전히 구현된 부분

#### **Backend API 서버**
- ✅ Node.js + Express + TypeScript로 구현
- ✅ PostgreSQL 연결 및 쿼리
- ✅ Redis 캐싱
- ✅ RESTful API 엔드포인트
- ✅ 에러 핸들링
- ✅ 로깅 시스템
- ✅ Health Check

#### **데이터베이스 (PostgreSQL)**
- ✅ 전체 테이블 스키마 (6개 테이블)
- ✅ Mock 데이터 (보험증권 3건, 담보 정의, AI 피드백 등)
- ✅ 인덱스 및 트리거

#### **인프라 (Docker)**
- ✅ Docker Compose 전체 구성
- ✅ PostgreSQL 컨테이너
- ✅ Redis 컨테이너
- ✅ n8n 워크플로우 엔진
- ✅ Backend API 컨테이너
- ✅ PgAdmin (DB 관리 도구)

#### **n8n 워크플로우**
- ✅ 완전한 워크플로우 JSON (47개 노드)
- ✅ OCR 앙상블 알고리즘
- ✅ 자동/수동 검증 분기
- ✅ 담보 분석 로직
- ✅ AI 자동 심사

---

### ⚠️ 2. Mock 데이터 (실제 데이터 필요)

#### **진단서 및 영수증 이미지**
- ❌ **실제 이미지 Base64 없음**
- 📁 위치: `mock-data/sample_claim_request.json`
- 💡 **필요 작업**:
  - 실제 진단서/영수증 이미지를 촬영하거나 스캔
  - Base64로 인코딩하여 `diagnosis_base64`, `receipt_base64`에 삽입
  - 또는 온라인 도구 사용: https://www.base64-image.de/

**Base64 생성 예시:**
```bash
# Node.js
const fs = require('fs');
const base64 = fs.readFileSync('diagnosis.jpg', 'base64');
console.log(base64);

# Python
import base64
with open('diagnosis.jpg', 'rb') as f:
    base64_str = base64.b64encode(f.read()).decode()
    print(base64_str)
```

#### **AI API Keys**
- ❌ **실제 API 키 없음** (`.env` 파일에 입력 필요)
- 💡 **필요 작업**:
  - OpenAI API Key 발급: https://platform.openai.com/api-keys
  - Anthropic API Key 발급: https://console.anthropic.com/
  - Google Gemini API Key 발급: https://makersuite.google.com/app/apikey

**.env 파일에 입력:**
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
```

---

### 🔧 3. n8n 워크플로우 설정 필요

#### **n8n Credentials 설정**
n8n에 접속 후 다음 Credentials를 추가해야 합니다:

1. **OpenAI (HTTP Header Auth)**
   ```
   Header Name: Authorization
   Header Value: Bearer YOUR_OPENAI_API_KEY
   ```

2. **Anthropic (HTTP Header Auth)**
   ```
   Header Name: x-api-key
   Header Value: YOUR_ANTHROPIC_API_KEY
   ```

3. **Google Gemini (HTTP Query Auth)**
   ```
   Query Parameter: key
   Value: YOUR_GOOGLE_API_KEY
   ```

4. **PostgreSQL**
   ```
   Host: postgres
   Database: insurtech
   User: insurtech_user
   Password: insurtech_password_2024
   Port: 5432
   ```

#### **워크플로우 임포트**
1. n8n 접속: http://localhost:5678
2. 우측 상단 메뉴 → "Import from File"
3. `보험금_청구_자동_심사_시스템_v3.json` 선택
4. 각 AI 노드의 Credentials 연결
5. 워크플로우 활성화

---

## 🚀 실제 동작 테스트 방법

### Step 1: 시스템 시작

```bash
# Windows
start.bat

# Linux/Mac
bash start.sh
```

### Step 2: Health Check

```bash
curl http://localhost:3000/health
```

**예상 응답:**
```json
{
  "status": "healthy",
  "timestamp": "2024-12-16T10:30:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

### Step 3: Mock 보험증권 조회

```bash
curl http://localhost:3000/api/policies/POL-2024-001
```

**예상 응답:**
```json
{
  "success": true,
  "data": {
    "policy_id": "POL-2024-001",
    "policy_type": "실손의료보험",
    "policyholder_name": "홍길동",
    "coverage_start_date": "2024-01-01",
    "coverage_end_date": "2034-12-31",
    "premium_status": "active",
    "policy_terms_text": "【제1관 일반사항】..."
  },
  "source": "database"
}
```

### Step 4: AI 모델 통계 조회

```bash
curl http://localhost:3000/api/stats/models
```

**예상 응답:**
```json
{
  "success": true,
  "data": [
    {
      "model_name": "claude",
      "task_type": "ocr",
      "total_evaluations": 3,
      "correct_count": 3,
      "accuracy_pct": "100.00",
      "avg_confidence": "0.957"
    }
  ]
}
```

### Step 5: 청구서 제출 (실제 이미지 Base64 필요)

⚠️ **주의**: 이 단계는 실제 진단서/영수증 이미지의 Base64 인코딩이 필요합니다.

```bash
curl -X POST http://localhost:3000/api/claims \
  -H "Content-Type: application/json" \
  -d '{
    "policy_id": "POL-2024-001",
    "customer_name": "홍길동",
    "diagnosis_base64": "실제_이미지_Base64_문자열",
    "receipt_base64": "실제_이미지_Base64_문자열"
  }'
```

**n8n 워크플로우가 실행되면:**
1. 3개 AI 모델이 OCR 수행
2. 앙상블로 최적 결과 선택
3. 신뢰도 판단 (자동 승인 vs 수동 검증)
4. 담보 분석
5. 최종 심사 결과 반환

---

## 📊 현재 동작 가능한 API

### ✅ 완전 동작
- `GET /health` - 헬스 체크
- `GET /api/` - API 정보
- `GET /api/policies` - 보험증권 목록
- `GET /api/policies/:policyId` - 보험증권 조회
- `GET /api/policies/:policyId/coverages` - 담보 목록
- `GET /api/stats/models` - AI 모델 통계
- `GET /api/stats/claims` - 청구 통계
- `GET /api/stats/dashboard` - 대시보드 통계
- `GET /api/claims` - 청구 목록
- `GET /api/claims/:claimCaseId` - 청구 조회
- `GET /api/claims/verification-queue/list` - 검증 대기 목록

### ⚠️ AI API Key 및 실제 이미지 필요
- `POST /api/claims` - 청구서 제출 (n8n 워크플로우 실행)
- `POST /api/claims/:claimCaseId/verify` - 청구 검증

---

## 🎯 실제 운영을 위한 추가 작업

### 1. 실제 데이터 준비
- [ ] 진단서 샘플 이미지 (JPG/PNG)
- [ ] 영수증 샘플 이미지 (JPG/PNG)
- [ ] 실제 보험 약관 텍스트
- [ ] 추가 보험 상품 데이터

### 2. AI API 설정
- [ ] OpenAI API Key 발급 및 설정
- [ ] Anthropic API Key 발급 및 설정
- [ ] Google Gemini API Key 발급 및 설정
- [ ] n8n에 Credentials 등록

### 3. 보안 강화
- [ ] JWT Secret 변경
- [ ] PostgreSQL 비밀번호 변경
- [ ] n8n 관리자 비밀번호 변경
- [ ] HTTPS 인증서 적용
- [ ] Rate Limiting 설정

### 4. 모니터링 및 로깅
- [ ] 로그 수집 시스템 (ELK Stack 등)
- [ ] 모니터링 대시보드 (Grafana 등)
- [ ] 알림 시스템 (Slack, Email 등)

### 5. 프론트엔드 (선택)
- [ ] React/Vue/Next.js 프론트엔드 개발
- [ ] 청구서 업로드 UI
- [ ] 검증자 대시보드
- [ ] 통계 대시보드

---

## 💡 빠른 테스트 가이드

### Mock 데이터로 테스트하기

1. **시스템 시작**
   ```bash
   docker-compose up -d
   ```

2. **API 테스트 (Postman 또는 curl)**
   - Health Check
   - 보험증권 조회
   - 통계 조회
   - Mock 청구 목록 확인

3. **n8n 워크플로우 확인**
   - http://localhost:5678 접속
   - 워크플로우 임포트
   - 각 노드 구조 확인

4. **데이터베이스 확인 (PgAdmin)**
   - http://localhost:5050 접속
   - 테이블 데이터 확인
   - SQL 쿼리 테스트

---

## 📞 문제 해결

### Q: n8n에서 AI API 호출이 실패합니다.
**A**: `.env` 파일에 실제 API 키가 입력되어 있는지 확인하고, n8n Credentials에 올바르게 설정했는지 확인하세요.

### Q: 데이터베이스 연결 오류
**A**: PostgreSQL 컨테이너가 정상 실행 중인지 확인하세요.
```bash
docker-compose ps
docker-compose logs postgres
```

### Q: 진단서 이미지가 없어서 테스트할 수 없습니다.
**A**: 스마트폰으로 아무 문서나 촬영한 후 Base64로 변환하여 테스트하세요. OCR이 정확하지 않더라도 워크플로우 동작은 확인 가능합니다.

### Q: API 비용이 걱정됩니다.
**A**: n8n 워크플로우를 비활성화 상태로 두고, API 테스트만 먼저 진행하세요. 실제 AI 호출 없이도 대부분의 기능은 테스트 가능합니다.

---

## ✨ 요약

이 시스템은 **완전히 동작하는 백엔드 API, 데이터베이스, 인프라**를 갖추고 있으며,
**n8n 워크플로우 로직**도 모두 구현되어 있습니다.

**단지 실제 운영을 위해서는:**
1. AI API 키 발급
2. 진단서/영수증 이미지 준비
3. n8n Credentials 설정

이 3가지만 완료하면 **즉시 실제 보험금 청구 자동 심사가 가능**합니다!

---

**Happy Coding! 🚀**
