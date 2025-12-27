/**
 * Server Configuration
 * 
 * Configuration settings for the game server.
 */

export const ServerConfig = {
  /** Number of NPCs to spawn automatically at server startup */
  NPC_COUNT: 50,
  
  /** Default spawn location (NYC area) */
  DEFAULT_SPAWN_CENTER: {
    lng: -74.05682,
    lat: 40.69337,
  },
  
  /** Spawn radius in degrees (0.001 is approximately 111 meters at equator) */
  NPC_SPAWN_RADIUS: 0.0002,
  
  /** Server port */
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
} as const;

