import { afterEach, describe, expect, it } from 'bun:test';
import { resolveJwtSecret } from '../authPlugin.js';

describe('resolveJwtSecret', () => {
  const originalSecret = process.env.SUPABASE_JWT_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = originalSecret;
    }
  });

  it('throws when SUPABASE_JWT_SECRET is not defined', () => {
    delete process.env.SUPABASE_JWT_SECRET;
    expect(() => resolveJwtSecret()).toThrowError(
      /SUPABASE_JWT_SECRET environment variable must be set/
    );
  });
});
