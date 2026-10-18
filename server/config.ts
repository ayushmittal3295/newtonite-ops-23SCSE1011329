import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET;
if (isProduction && (!jwtSecret || jwtSecret.length < 32 || jwtSecret === 'dev-secret-key-change-me')) {
  throw new Error('Production requires a private JWT_SECRET of at least 32 characters');
}

export const config = {
  port: Number(process.env.PORT ?? 4100),
  jwtSecret: jwtSecret ?? 'dev-secret-key-change-me',
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/newtonite_ops?schema=public',
};
