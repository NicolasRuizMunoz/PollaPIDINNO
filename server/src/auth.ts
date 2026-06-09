import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { Request, Response, NextFunction } from "express";
import { dbGet, dbRun } from "./db.js";

export interface User {
  id: number;
  email: string;
  apodo: string;
  is_admin: number;
}

/** Si esta vacio, se usa el login de desarrollo (por email, sin contrasena). */
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClient = new OAuth2Client();

// Emails que siempre seran admin (ademas del primer usuario registrado).
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function needsApodo(user: User): boolean {
  return !user.apodo || !user.apodo.trim();
}

/** Crea o recupera un usuario por email. El apodo arranca vacio. */
async function getOrCreateUser(emailRaw: string): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, "Email invalido");

  const existing = await dbGet<User>("SELECT * FROM users WHERE email = ?", [email]);
  if (existing) return existing;

  const countRow = await dbGet<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  const isAdmin =
    (countRow?.c ?? 0) === 0 || ADMIN_EMAILS.includes(email) ? 1 : 0;
  const res = await dbRun(
    "INSERT INTO users (email, apodo, is_admin, is_active) VALUES (?, '', ?, 0)",
    [email, isAdmin]
  );
  return {
    id: Number(res.lastInsertRowid),
    email,
    apodo: "",
    is_admin: isAdmin,
  };
}

async function createSession(userId: number): Promise<string> {
  const token = randomBytes(24).toString("hex");
  await dbRun("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, userId]);
  return token;
}

export interface LoginResult {
  token: string;
  user: User;
  needsApodo: boolean;
}

/** Inicia sesion verificando el ID token de Google. */
export async function loginWithGoogle(idToken: string): Promise<LoginResult> {
  if (!GOOGLE_CLIENT_ID)
    throw new HttpError(500, "Google no esta configurado en el servidor");
  if (!idToken) throw new HttpError(400, "Falta el token de Google");

  let email: string | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    email = ticket.getPayload()?.email;
  } catch {
    throw new HttpError(401, "Token de Google invalido");
  }
  if (!email) throw new HttpError(401, "Google no entrego un email");

  const user = await getOrCreateUser(email);
  return { token: await createSession(user.id), user, needsApodo: needsApodo(user) };
}

/** Login de desarrollo por email (solo si Google no esta configurado). */
export async function loginDev(emailRaw: string): Promise<LoginResult> {
  if (GOOGLE_CLIENT_ID)
    throw new HttpError(403, "El login de desarrollo esta deshabilitado");
  const user = await getOrCreateUser(emailRaw);
  return { token: await createSession(user.id), user, needsApodo: needsApodo(user) };
}

/** Asigna o actualiza el apodo del usuario. */
export async function setApodo(userId: number, apodoRaw: string): Promise<User> {
  const apodo = apodoRaw.trim();
  if (apodo.length < 2) throw new HttpError(400, "El apodo es muy corto");
  if (apodo.length > 24) throw new HttpError(400, "El apodo es muy largo");
  await dbRun("UPDATE users SET apodo = ? WHERE id = ?", [apodo, userId]);
  const u = await dbGet<User>("SELECT * FROM users WHERE id = ?", [userId]);
  return u!;
}

async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const row = await dbGet<User>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    [token]
  );
  return row ?? null;
}

export interface AuthedRequest extends Request {
  user?: User;
}

/** Resuelve el usuario del header Authorization si existe (no obliga). */
export async function attachUser(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const user = await userFromToken(token);
    if (user) req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) throw new HttpError(401, "Necesitas iniciar sesion");
  next();
}

export function requireAdmin(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) throw new HttpError(401, "Necesitas iniciar sesion");
  if (!req.user.is_admin) throw new HttpError(403, "Solo administradores");
  next();
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
