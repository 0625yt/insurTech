# n8n 워크플로우 설정 가이드

## 1. Credentials 설정 (필수)

n8n 워크플로우를 실행하기 전에 다음 Credentials를 먼저 생성해야 합니다.

### 1.1 PostgreSQL Database
```
Settings > Credentials > Add Credential > Postgres

Name: InsurTech DB
Host: localhost (또는 insurtech-postgres)
Database: insurtech
User: insurtech_user
Password: insurtech_password_2024
Port: 5432
SSL: Disable (개발환경)
```

### 1.2 Redis Cache
```
Settings > Credentials > Add Credential > Redis

Name: InsurTech Redis
Host: localhost (또는 insurtech-redis)
Port: 6379
Password: (비어있음)
```

### 1.3 OpenAI API (AI 심사용)
```
Settings > Credentials > Add Credential > OpenAI API

Name: OpenAI API
API Key: sk-your-openai-api-key
```

### 1.4 HTTP Header Auth (Backend API 호출용)
```
Settings > Credentials > Add Credential > Header Auth

Name: JWT Token
Name: Authorization
Value: Bearer <로그인 후 받은 토큰>
```

### 1.5 Slack (알림용) - 선택사항
```
Settings > Credentials > Add Credential > Slack API

Name: Slack Bot
Access Token: xoxb-your-slack-bot-token
```

### 1.6 SMTP (이메일용) - 선택사항
```
Settings > Credentials > Add Credential > SMTP

Name: SMTP
Host: smtp.gmail.com
Port: 587
User: your-email@gmail.com
Password: your-app-password
SSL/TLS: true
```

---

## 2. 워크플로우 Import 방법

1. n8n 접속 (http://localhost:5678)
2. 좌측 메뉴 > Workflows
3. 우측 상단 "..." > Import from File
4. JSON 파일 선택
5. Import 후 Credentials 연결

---

## 3. Credentials 연결 방법

Import 후 각 노드를 클릭하여 Credentials를 연결해야 합니다:

1. 노드 더블클릭
2. Credential 섹션에서 드롭다운 클릭
3. 생성한 Credential 선택
4. Save

---

## 4. 테스트 순서

### Step 1: 간단한 테스트 워크플로우 먼저
`05_test_basic_workflow.json` 파일을 import하여 기본 동작 확인

### Step 2: DB 연결 테스트
PostgreSQL Credential이 제대로 연결되는지 확인

### Step 3: API 연결 테스트
Backend API가 정상 응답하는지 확인

### Step 4: 전체 워크플로우
메인 워크플로우들 순차적으로 테스트

---

## 5. Docker 환경에서의 주의사항

Docker Compose로 실행 시, 서비스 이름으로 접근:

```yaml
# 각 서비스 접근 URL
PostgreSQL: insurtech-postgres:5432
Redis: insurtech-redis:6379
Backend API: insurtech-api:3000
n8n: insurtech-n8n:5678
```

localhost 대신 Docker 서비스 이름 사용!

---

## 6. 트러블슈팅

### "Please resolve outstanding issues"
- Credentials가 연결되지 않음
- 각 노드를 클릭하여 Credential 연결 필요

### "Connection refused"
- Docker 서비스가 실행 중인지 확인
- 네트워크 이름이 같은지 확인

### "401 Unauthorized"
- JWT 토큰이 만료됨
- 다시 로그인하여 새 토큰 발급

### "ECONNREFUSED"
- Backend API가 실행 중인지 확인
- docker-compose ps로 상태 확인
