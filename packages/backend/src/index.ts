import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { syncRoutes } from './routes/syncRoutes.js';
import { resolveJwtSecret, verifyJWT } from './auth/authPlugin.js';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const loggerLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

export async function buildApp() {
    const fastify = Fastify({
        logger: isTest
            ? false
            : isProduction
            ? { level: loggerLevel }
            : {
                  level: loggerLevel,
                  transport: {
                      target: 'pino-pretty',
                      options: {
                          colorize: true,
                          translateTime: 'SYS:standard',
                      },
                  },
              },
    });

    try {
        resolveJwtSecret();
    } catch (err) {
        fastify.log.error(
            { err },
            'SUPABASE_JWT_SECRET environment variable must be provided before starting the sync service.'
        );
        throw err;
    }

    // 1. CORS 配置
    await fastify.register(cors, {
        origin: '*', // 生产环境需限制为前端域名
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
    });

    // 2. Auth Pre-Handler (保护 /sync 路由)
    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
        // 假设只有 /api/v1/sync/* 需要鉴权
        if (request.url.startsWith('/api/v1/sync/')) {
            try {
                await verifyJWT(request, reply);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unauthorized';

                if (message.includes('SUPABASE_JWT_SECRET')) {
                    request.log.error(
                        { err },
                        'Supabase JWT secret is not configured. Rejecting authenticated request.'
                    );
                    reply.code(500).send({
                        statusCode: 500,
                        error: 'Internal Server Error',
                        message,
                    });
                    return;
                }

                const statusCode = (err as { statusCode?: number })?.statusCode ?? 401;
                reply.code(statusCode).send({
                    statusCode,
                    error: 'Unauthorized',
                    message,
                });
                return;
            }
        }
    });

    fastify.get('/healthz', async () => ({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    }));

    // 3. 注册同步路由
    fastify.register(syncRoutes, { prefix: '/api/v1/sync' });

    return fastify;
}

const PORT = parseInt(process.env.PORT || '3000', 10);

if (process.env.NODE_ENV !== 'test') {
    buildApp()
        .then(app => {
            app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
                if (err) {
                    app.log.error({ err }, 'Failed to start sync service');
                    process.exit(1);
                }
                app.log.info({ event: 'server_started', address, port: PORT, env: process.env.NODE_ENV ?? 'development' }, 'Sync Service is listening');
            });
        })
        .catch(err => {
            console.error('Failed to initialize Fastify application:', err);
            process.exit(1);
        });
}
