export interface PlayerSession {
  discord_id: string;
  session_id: string;
  created_at?: Date;
  last_active?: Date;
  metadata?: Record<string, any>;
}
