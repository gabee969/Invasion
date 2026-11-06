import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetLeaderboardQueryParams,
  GetLeaderboardResponse,
  PurchaseWeaponBody,
  PurchaseWeaponResponse,
  SubmitMatchBody,
  SubmitMatchResponse,
} from "@workspace/api-zod";
import {
  db,
  playerMatchesTable,
  playersTable,
} from "@workspace/db";
import { getPlayerForRequest, toPublicPlayer } from "../lib/player-auth";

const router: IRouter = Router();
const WEAPON_PRICES: Record<string, number> = {
  smg: 800,
  ak: 1800,
  m4: 2600,
  shot: 3200,
  lmg: 5000,
  awp: 6400,
  minigun: 10000,
};

router.get("/leaderboard", async (req, res): Promise<void> => {
  const parsed = GetLeaderboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choisis un classement valide." });
    return;
  }

  const { category } = parsed.data;
  const scoreColumn =
    category === "kills"
      ? playersTable.kills
      : category === "coins"
        ? playersTable.coins
        : playersTable.playTimeSeconds;
  const rows = await db
    .select({
      username: playersTable.username,
      usernameNormalized: playersTable.usernameNormalized,
      score: scoreColumn,
      createdAt: playersTable.createdAt,
    })
    .from(playersTable)
    .orderBy(
      desc(scoreColumn),
      asc(playersTable.createdAt),
      asc(playersTable.usernameNormalized),
    )
    .limit(50);

  res.json(
    GetLeaderboardResponse.parse({
      category,
      entries: rows.map((row, index) => ({
        rank: index + 1,
        username: row.username,
        score: row.score,
      })),
    }),
  );
});

router.post("/player/matches", async (req, res): Promise<void> => {
  const player = await getPlayerForRequest(req);
  if (!player) {
    res.status(401).json({ error: "Connecte-toi pour enregistrer cette partie." });
    return;
  }

  const parsed = SubmitMatchBody.safeParse(req.body);
  if (!parsed.success || parsed.data.headshots > parsed.data.kills) {
    res.status(400).json({ error: "Les résultats de la partie sont invalides." });
    return;
  }

  const match = parsed.data;
  const earnedCoins =
    match.kills * 20 + match.headshots * 5 + match.captures * 20;

  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(playerMatchesTable)
      .values({
        playerId: player.id,
        matchId: match.matchId,
        kills: match.kills,
        headshots: match.headshots,
        captures: match.captures,
        durationSeconds: match.durationSeconds,
      })
      .onConflictDoNothing()
      .returning({ id: playerMatchesTable.id });

    if (inserted.length === 0) {
      const [existingPlayer] = await tx
        .select()
        .from(playersTable)
        .where(eq(playersTable.id, player.id))
        .limit(1);
      return {
        user: existingPlayer ? toPublicPlayer(existingPlayer) : null,
        earnedCoins: 0,
        alreadyRecorded: true,
      };
    }

    const [updatedPlayer] = await tx
      .update(playersTable)
      .set({
        kills: sql`${playersTable.kills} + ${match.kills}`,
        playTimeSeconds: sql`${playersTable.playTimeSeconds} + ${match.durationSeconds}`,
        coins: sql`${playersTable.coins} + ${earnedCoins}`,
        gamesPlayed: sql`${playersTable.gamesPlayed} + 1`,
      })
      .where(eq(playersTable.id, player.id))
      .returning();

    return {
      user: updatedPlayer ? toPublicPlayer(updatedPlayer) : null,
      earnedCoins,
      alreadyRecorded: false,
    };
  });

  if (!result.user) {
    res.status(401).json({ error: "Connecte-toi pour enregistrer cette partie." });
    return;
  }

  res.json(
    SubmitMatchResponse.parse({
      user: result.user,
      earnedCoins: result.earnedCoins,
      alreadyRecorded: result.alreadyRecorded,
    }),
  );
});

router.post("/player/purchases", async (req, res): Promise<void> => {
  const player = await getPlayerForRequest(req);
  if (!player) {
    res.status(401).json({ error: "Connecte-toi pour utiliser tes crédits." });
    return;
  }

  const parsed = PurchaseWeaponBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Cette arme ne peut pas être achetée." });
    return;
  }

  const weaponId = parsed.data.weaponId;
  const price = WEAPON_PRICES[weaponId];
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(playersTable)
      .where(eq(playersTable.id, player.id))
      .for("update")
      .limit(1);

    if (!current) return { error: "Compte introuvable." as const };

    const ownedWeapons = Array.isArray(current.ownedWeapons)
      ? current.ownedWeapons
      : ["pistol"];
    if (ownedWeapons.includes(weaponId)) {
      return { error: "Cette arme est déjà achetée." as const };
    }
    if (current.coins < price) {
      return { error: "Tu n’as pas assez de crédits." as const };
    }

    const [updatedPlayer] = await tx
      .update(playersTable)
      .set({
        coins: current.coins - price,
        ownedWeapons: [...ownedWeapons, weaponId],
      })
      .where(and(eq(playersTable.id, player.id), eq(playersTable.coins, current.coins)))
      .returning();

    return updatedPlayer
      ? { user: toPublicPlayer(updatedPlayer) }
      : { error: "Achat impossible. Réessaie." as const };
  });

  if ("error" in result) {
    res.status(409).json({ error: result.error });
    return;
  }

  res.json(PurchaseWeaponResponse.parse({ user: result.user }));
});

export default router;
