// 加载环境变量
require('dotenv').config();

const fastify = require('fastify')({
  logger: true,
  disableRequestLogging: process.env.NODE_ENV === 'production'
});

// 注册CORS插件（可通过环境变量 FASTIFY_CORS_ORIGIN 指定，默认允许所有来源 *）
const allowOrigin = process.env.FASTIFY_CORS_ORIGIN || '*';
fastify.register(require('@fastify/cors'), {
  origin: allowOrigin,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// 注册multipart插件用于文件上传
fastify.register(require('@fastify/multipart'));

// 注册路由
fastify.register(require('./routes/i18n'), { prefix: '/api/i18n' });

// 健康检查路由
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', message: 'I18n API Server is running' };
});

// 健康 + 基本信息
fastify.get('/', async () => ({
  name: 'vue3-i18n-api',
  version: process.env.npm_package_version,
  timestamp: Date.now()
}));

// 启动服务器
const start = async () => {
  try {
    const port = process.env.PORT || 3400;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`Server is running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

