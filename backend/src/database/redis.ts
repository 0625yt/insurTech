import { logger } from '../utils/logger';

// Redis Mock - Redis 없이도 서버가 작동하도록 함
const memoryCache: Map<string, { value: string; expiry?: number }> = new Map();

const cleanExpired = () => {
  const now = Date.now();
  for (const [key, data] of memoryCache.entries()) {
    if (data.expiry && data.expiry < now) {
      memoryCache.delete(key);
    }
  }
};

setInterval(cleanExpired, 60000);

export const redis = {
  async set(key: string, value: string, expiresInSeconds?: number): Promise<void> {
    const expiry = expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : undefined;
    memoryCache.set(key, { value, expiry });
  },

  async get(key: string): Promise<string | null> {
    const data = memoryCache.get(key);
    if (!data) return null;
    if (data.expiry && data.expiry < Date.now()) {
      memoryCache.delete(key);
      return null;
    }
    return data.value;
  },

  async setJSON(key: string, value: any, expiresInSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), expiresInSeconds);
  },

  async getJSON<T = any>(key: string): Promise<T | null> {
    const value = await this.get(key);
    return value ? JSON.parse(value) : null;
  },

  async del(key: string): Promise<void> {
    memoryCache.delete(key);
  },

  async exists(key: string): Promise<boolean> {
    const data = memoryCache.get(key);
    if (!data) return false;
    if (data.expiry && data.expiry < Date.now()) {
      memoryCache.delete(key);
      return false;
    }
    return true;
  },

  async expire(key: string, seconds: number): Promise<void> {
    const data = memoryCache.get(key);
    if (data) {
      data.expiry = Date.now() + seconds * 1000;
    }
  },

  async ping(): Promise<string> {
    return 'PONG';
  },

  async quit(): Promise<void> {
    memoryCache.clear();
    logger.info('Memory cache cleared');
  },

  client: null
};

logger.info('Using in-memory cache (Redis disabled)');
