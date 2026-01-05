#!/bin/bash

# 보험금 청구 자동 심사 시스템 시작 스크립트

echo "=================================="
echo "  InsurTech v3 - Starting System  "
echo "=================================="
echo ""

# 환경변수 파일 확인
if [ ! -f .env ]; then
    echo "⚠️  .env 파일이 없습니다. .env.example을 복사하여 생성합니다..."
    cp .env.example .env
    echo "✅ .env 파일이 생성되었습니다. AI API 키를 입력해주세요!"
    exit 1
fi

# Docker 실행 확인
if ! command -v docker &> /dev/null; then
    echo "❌ Docker가 설치되어 있지 않습니다."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose가 설치되어 있지 않습니다."
    exit 1
fi

# 기존 컨테이너 정리 (선택사항)
read -p "기존 컨테이너를 제거하고 새로 시작하시겠습니까? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 기존 컨테이너 제거 중..."
    docker-compose down -v
fi

# Docker Compose로 시작
echo "🚀 Docker Compose로 서비스 시작 중..."
docker-compose up -d

# 서비스 상태 확인
echo ""
echo "⏳ 서비스 초기화 대기 중 (30초)..."
sleep 30

echo ""
echo "✅ 서비스 상태 확인:"
docker-compose ps

echo ""
echo "=================================="
echo "  시스템이 시작되었습니다!"
echo "=================================="
echo ""
echo "📡 서비스 URL:"
echo "  - Backend API:    http://localhost:3000"
echo "  - Health Check:   http://localhost:3000/health"
echo "  - n8n:            http://localhost:5678"
echo "  - PgAdmin:        http://localhost:5050"
echo ""
echo "🔑 로그인 정보:"
echo "  - n8n:      admin / admin123"
echo "  - PgAdmin:  admin@insurtech.com / admin123"
echo ""
echo "📚 다음 단계:"
echo "  1. n8n에 접속하여 워크플로우 임포트"
echo "  2. AI API Credentials 설정"
echo "  3. 워크플로우 활성화"
echo "  4. API 테스트 (README.md 참고)"
echo ""
echo "🛑 종료: docker-compose down"
echo "📊 로그: docker-compose logs -f"
echo ""
