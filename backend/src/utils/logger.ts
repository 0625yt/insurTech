import winston from 'winston';

// 로그 레벨 정의
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// 개발/프로덕션 환경별 로그 레벨
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'info';
};

// 로그 색상 정의
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(colors);

// 로그 포맷 정의
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// 트랜스포트 설정
const transports = [
  // 콘솔 출력
  new winston.transports.Console(),

  // 에러 로그 파일
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
  }),

  // 전체 로그 파일
  new winston.transports.File({
    filename: 'logs/combined.log',
  }),
];

// Logger 생성
export const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});
