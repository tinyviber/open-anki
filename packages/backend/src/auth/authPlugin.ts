import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

// 扩展 FastifyRequest 以包含用户上下文
declare module 'fastify' {
    interface FastifyRequest {
        user: {
            id: string; // auth.users UUID
        };
    }
}

// 确保在环境变量中设置了 SUPABASE_JWT_SECRET
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your_super_secret_jwt_key_from_supabase_config'; 


/**
 * Decodes the Supabase JWT, validates it, and sets the user ID on the request object.
 */
export async function verifyJWT(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing or invalid Authorization header' });
        throw new Error('Unauthorized');
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
        const userId = decoded.sub as string; // 'sub' (subject) claim is the User ID in Supabase
        
        if (!userId) {
            reply.code(401).send({ error: 'Token is valid but missing User ID (sub claim)' });
            throw new Error('Unauthorized: Missing User ID');
        }

        request.user = { id: userId };

    } catch (err) {
        console.error("JWT verification failed:", err);
        reply.code(401).send({ error: 'Invalid or expired token' });
        throw new Error('Unauthorized');
    }
}