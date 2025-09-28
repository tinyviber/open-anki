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
export const resolveJwtSecret = () => {
    const secret = process.env.SUPABASE_JWT_SECRET?.trim();

    if (secret) {
        return secret;
    }

    throw new Error(
        'SUPABASE_JWT_SECRET environment variable must be set to verify Supabase JWTs.'
    );
};


/**
 * Decodes the Supabase JWT, validates it, and sets the user ID on the request object.
 */
const unauthorizedError = (message: string) => {
    const error = new Error(message) as Error & { statusCode: number };
    error.statusCode = 401;
    return error;
};

export async function verifyJWT(request: FastifyRequest, _reply: FastifyReply) {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw unauthorizedError('Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];

    const secret = resolveJwtSecret();

    try {
        const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
        const userId = decoded.sub as string; // 'sub' (subject) claim is the User ID in Supabase

        if (!userId) {
            throw unauthorizedError('Token is valid but missing User ID (sub claim)');
        }

        request.user = { id: userId };

    } catch (err) {
        console.error("JWT verification failed:", err);
        throw unauthorizedError('Invalid or expired token');
    }
}
