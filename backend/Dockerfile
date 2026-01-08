FROM node:20-alpine

WORKDIR /app

# 패키지 파일 복사
COPY package*.json ./

# 의존성 설치 (devDependencies 포함 - TypeScript 빌드용)
RUN npm ci

# 소스 코드 복사
COPY . .

# 개발용 실행을 위해 빌드 생략 (타입 에러 무시)

# 포트 노출
EXPOSE 3000

# 헬스체크
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# 애플리케이션 실행
CMD ["npm", "run", "dev"]
