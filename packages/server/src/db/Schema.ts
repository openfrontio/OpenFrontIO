// src/db/schema.ts
export const TABLES = {
  PLAYER_SESSIONS: "player_sessions",
} as const;

export const schemas = {
  playerSessions: `
        CREATE TABLE IF NOT EXISTS ${TABLES.PLAYER_SESSIONS} (
          id SERIAL PRIMARY KEY,
          discord_id TEXT NOT NULL,
          session_id TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB DEFAULT '{}'::jsonb
        );
        
        CREATE INDEX IF NOT EXISTS idx_discord_id 
          ON ${TABLES.PLAYER_SESSIONS}(discord_id);
        CREATE INDEX IF NOT EXISTS idx_session_id 
          ON ${TABLES.PLAYER_SESSIONS}(session_id);
      `,
};
