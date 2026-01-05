// 데이터베이스 설정
export const databaseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'insurtech',
  user: process.env.DB_USER || 'insurtech_user',
  password: process.env.DB_PASSWORD || 'insurtech_password_2024',
  max: 20, // 최대 연결 수
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // 한글 인코딩 설정
  options: '-c client_encoding=UTF8',
};
