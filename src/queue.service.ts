redisInstance = new Redis(process.env.REDIS_URL || 'redis://default:rodaid2026@rodaid-redis:6379', {
  maxRetriesPerRequest: 10,
  retryStrategy(times) {
    return Math.min(times * 500, 2000);
  }
});