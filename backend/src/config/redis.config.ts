// Redis 설정
export const redisConfig = {
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  // password: process.env.REDIS_PASSWORD, // 필요 시 설정
};
