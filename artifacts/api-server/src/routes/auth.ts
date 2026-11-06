import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetCurrentPlayerResponse,
  LoginPlayerBody,
  LoginPlayerResponse,
  LogoutPlayerResponse,
  RegisterPlayerBody,
  RegisterPlayerResponse,
} from "@workspace/api-zod";
import { db, playersTable } from "@workspace/db";
import {
  createPlayerSession,
  deletePlayerSession,
  getPlayerForRequest,
  toPublicPlayer,
} from "../lib/player-auth";

const router: IRouter = Router();
const scrypt = promisify(scryptCallback);
const DUMMY_SALT = "invasion-login-check";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const attemptsByIp = new Map<string, { count: number; expiresAt: number }>();

async function passwordHash(password: string, salt: string): Promise<Buffer> {
  return (await scrypt(password, salt, 64)) as Buffer;
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = attemptsByIp.get(ip);

  if (!current || current.expiresAt <= now) {
    attemptsByIp.set(ip, { count: 1, expiresAt: now + WINDOW_MS });
    return false;
  }

  current.count += 1;
  if (attemptsByIp.size > 1000) {
    for (const [key, entry] of attemptsByIp) {
      if (entry.expiresAt <= now) attemptsByIp.delete(key);
    }
  }
  return current.count > MAX_ATTEMPTS;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  if (isRateLimited(req.ip || "unknown")) {
    res.status(429).json({ error: "Trop de tentatives. Réessaie plus tard." });
    return;
  }

  const parsed = RegisterPlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Le pseudo doit contenir 3 à 20 caractères (lettres, chiffres, _ ou -) et le code au moins 6 caractères.",
    });
    return;
  }

  const username = parsed.data.username.trim();
  const usernameNormalized = username.toLocaleLowerCase("fr");
  const salt = randomBytes(16).toString("hex");

  try {
    const [player] = await db
      .insert(playersTable)
      .values({
        username,
        usernameNormalized,
        passwordSalt: salt,
        passwordHash: (await passwordHash(parsed.data.password, salt)).toString(
          "hex",
        ),
        coins: 1500,
        ownedWeapons: ["pistol"],
      })
      .returning();

    await createPlayerSession(req, res, player.id);
    res
      .status(201)
      .json(RegisterPlayerResponse.parse({ user: toPublicPlayer(player) }));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "Ce pseudo est déjà utilisé." });
      return;
    }
    throw error;
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  if (isRateLimited(req.ip || "unknown")) {
    res.status(429).json({ error: "Trop de tentatives. Réessaie plus tard." });
    return;
  }

  const parsed = LoginPlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Pseudo ou code incorrect." });
    return;
  }

  const usernameNormalized = parsed.data.username.trim().toLocaleLowerCase("fr");
  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.usernameNormalized, usernameNormalized))
    .limit(1);

  const salt = player?.passwordSalt ?? DUMMY_SALT;
  const candidateHash = await passwordHash(parsed.data.password, salt);
  const savedHash = player ? Buffer.from(player.passwordHash, "hex") : Buffer.alloc(64);
  const passwordMatches =
    candidateHash.length === savedHash.length &&
    timingSafeEqual(candidateHash, savedHash);

  if (!player || !passwordMatches) {
    res.status(401).json({ error: "Pseudo ou code incorrect." });
    return;
  }

  await createPlayerSession(req, res, player.id);
  res.json(LoginPlayerResponse.parse({ user: toPublicPlayer(player) }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await deletePlayerSession(req, res);
  res.json(LogoutPlayerResponse.parse({ success: true }));
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const player = await getPlayerForRequest(req);
  res.json(
    GetCurrentPlayerResponse.parse({
      user: player ? toPublicPlayer(player) : null,
    }),
  );
});

export default router;
