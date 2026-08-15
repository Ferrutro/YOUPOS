import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const FRONTEND_DIR = path.resolve(ROOT_DIR, '..', 'frontend');
export const DB_PATH = process.env.POS_DB_PATH || path.join(ROOT_DIR, 'data', 'pos.db');
export const PORT = Number(process.env.PORT || 3000);
export const JWT_SECRET = process.env.POS_SECRET || 'cambia-esta-clave-en-produccion-por-una-larga-y-aleatoria';
export const TOKEN_TTL_HOURS = 12;
