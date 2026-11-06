import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, playerSessionsTable, playersTable } from "@workspace/db";

const SESSION_COOKIE = "invasion_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type PlayerRecord = typeof playersTable.$inferSelect;

function getCookie(req: Request, name: string): string | null {
  const prefix = `${name}=`;
  const cookie = req
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return null;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getPlayerForRequest(
  req: Request,
): Promise<PlayerRecord | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const [session] = await db
    .select()
    .from(playerSessionsTable)
    .where(eq(playerSessionsTable.tokenHash, hashToken(token)))
    .limit(1);

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(playerSessionsTable)
      .where(eq(playerSessionsTable.tokenHash, session.tokenHash));
    return null;
  }

  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.id, session.playerId))
    .limit(1);

  return player ?? null;
}

export async function createPlayerSession(
  req: Request,
  res: Response,
  playerId: string,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(playerSessionsTable).values({
    tokenHash: hashToken(token),
    playerId,
    expiresAt,
  });

  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0];
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: req.secure || forwardedProtocol === "https",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export async function deletePlayerSession(
  req: Request,
  res: Response,
): Promise<void> {
  const token = getCookie(req, SESSION_COOKIE);

  if (token) {
    await db
      .delete(playerSessionsTable)
      .where(eq(playerSessionsTable.tokenHash, hashToken(token)));
  }

  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure:
      req.secure || req.get("x-forwarded-proto")?.split(",")[0] === "https",
    sameSite: "lax",
    path: "/",
  });
}

export function toPublicPlayer(player: PlayerRecord) {
  return {
    id: player.id,
    username: player.username,
    kills: player.kills,
    playTimeSeconds: player.playTimeSeconds,
    coins: player.coins,
    ownedWeapons: Array.isArray(player.ownedWeapons)
      ? player.ownedWeapons
      : ["pistol"],
    gamesPlayed: player.gamesPlayed,
  };
}
