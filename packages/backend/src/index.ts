import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { syncRoutes } from './routes/syncRoutes.js';
import { verifyJWT } from './auth/authPlugin.js';

export async function buildApp() {
    const fastify = Fastify({
        logger: { level: 'info' } 
    });

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
                // verifyJWT 中已发送 401 响应
                reply.sent = true; 
            }
        }
    });

    // 3. 注册同步路由
    fastify.register(syncRoutes, { prefix: '/api/v1/sync' }); 

    return fastify;
}

const PORT = parseInt(process.env.PORT || '3000', 10);

buildApp().then(app => {
    app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log(`Sync Service is listening on ${address}`);
    });
});