import { Pool } from "pg";

export interface SessionData {
  discord_id: string;
  session_id: string;
  metadata?: Record<string, any>;
  created_at?: Date;
  last_active?: Date;
}

export class Database {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Creates or updates a session
   */
  async upsertSession(data: {
    discord_id: string;
    session_id: string;
    metadata?: Record<string, any>;
  }): Promise<SessionData> {
    const { discord_id, session_id, metadata = {} } = data;

    try {
      const result = await this.pool.query(
        `INSERT INTO player_sessions (discord_id, session_id, metadata)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id) 
         DO UPDATE SET 
           last_active = CURRENT_TIMESTAMP,
           metadata = player_sessions.metadata || $3::jsonb
         RETURNING *`,
        [discord_id, session_id, metadata],
      );
      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to create/update session: ${error}`);
    }
  }

  /**
   * Retrieves a session by its ID
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const result = await this.pool.query(
        "SELECT * FROM player_sessions WHERE session_id = $1",
        [sessionId],
      );
      return result.rows[0] || null;
    } catch (error) {
      throw new Error(`Failed to fetch session: ${error}`);
    }
  }

  /**
   * Retrieves all sessions for a Discord user
   */
  async getUserSessions(discordId: string): Promise<SessionData[]> {
    try {
      const result = await this.pool.query(
        "SELECT * FROM player_sessions WHERE discord_id = $1 ORDER BY last_active DESC",
        [discordId],
      );
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to fetch user sessions: ${error}`);
    }
  }

  /**
   * Deletes a session by its ID
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        "DELETE FROM player_sessions WHERE session_id = $1 RETURNING *",
        [sessionId],
      );
      return result.rows.length > 0;
    } catch (error) {
      throw new Error(`Failed to delete session: ${error}`);
    }
  }
}
