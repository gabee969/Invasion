import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const playersTable = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordHash: text("password_hash").notNull(),
    kills: integer("kills").notNull().default(0),
    playTimeSeconds: integer("play_time_seconds").notNull().default(0),
    coins: integer("coins").notNull().default(1500),
    ownedWeapons: jsonb("owned_weapons")
      .$type<string[]>()
      .notNull()
      .default(sql`'["pistol"]'::jsonb`),
    gamesPlayed: integer("games_played").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("players_username_normalized_unique").on(
      table.usernameNormalized,
    ),
  ],
);

export const playerSessionsTable = pgTable(
  "player_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const playerMatchesTable = pgTable(
  "player_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => playersTable.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull(),
    kills: integer("kills").notNull(),
    headshots: integer("headshots").notNull(),
    captures: integer("captures").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("player_matches_player_match_unique").on(
      table.playerId,
      table.matchId,
    ),
  ],
);
