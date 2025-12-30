/**
 * Main Server Entry Point
 * 
 * Initializes and starts the game server with WebSocket support.
 */

import { PlayerManager } from './players/PlayerManager';
import { GameWorld } from './game/GameWorld';
import { ServerGameLoop } from './game/GameLoop';
import { WebSocketServer } from './network/WebSocketServer';
import { ServerConfig } from './config';
import { ServerMessage } from './network/types';
import { watch, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';


const PORT = ServerConfig.PORT;

console.log('========================================');
console.log('RealEarthStreetWar Server');
console.log('========================================\n');

// Initialize core systems
const playerManager = new PlayerManager();
const gameWorld = new GameWorld();
gameWorld.setPlayerManager(playerManager); // Give GameWorld access to PlayerManager
const gameLoop = new ServerGameLoop();
const wsServer = new WebSocketServer(PORT, playerManager, gameWorld);

// Spawn NPCs automatically at server startup
if (ServerConfig.NPC_COUNT > 0) {
  console.log(`[Server] Spawning ${ServerConfig.NPC_COUNT} NPCs at startup...`);
  gameWorld.spawnNpcs(
    ServerConfig.NPC_COUNT,
    ServerConfig.DEFAULT_SPAWN_CENTER.lng,
    ServerConfig.DEFAULT_SPAWN_CENTER.lat,
    ServerConfig.NPC_SPAWN_RADIUS
  );
}

// Watch config file for changes (hot-reload NPC count)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// config.ts is in the same directory as server.ts (src/)
const configPath = join(__dirname, 'config.ts');

/**
 * Parse NPC_COUNT from config file
 */
function parseNpcCountFromConfig(filePath: string): number | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // Match NPC_COUNT: <number> pattern
    const match = content.match(/NPC_COUNT:\s*(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  } catch (err) {
    // File might not exist yet or be unreadable
    return null;
  }
  return null;
}

let configWatchTimeout: NodeJS.Timeout | null = null;
watch(configPath, { persistent: false }, (eventType) => {
  if (eventType === 'change') {
    // Debounce rapid file changes
    if (configWatchTimeout) {
      clearTimeout(configWatchTimeout);
    }
    
    configWatchTimeout = setTimeout(() => {
      try {
        const newNpcCount = parseNpcCountFromConfig(configPath);
        if (newNpcCount !== null && newNpcCount >= 0) {
          const currentNpcCount = gameWorld.getNpcCount();
          
          if (newNpcCount !== currentNpcCount) {
            console.log(`[Server] Config changed: NPC_COUNT ${currentNpcCount} -> ${newNpcCount}`);
            gameWorld.adjustNpcCount(
              newNpcCount,
              ServerConfig.DEFAULT_SPAWN_CENTER.lng,
              ServerConfig.DEFAULT_SPAWN_CENTER.lat,
              ServerConfig.NPC_SPAWN_RADIUS
            );
          }
        }
      } catch (err) {
        console.error('[Server] Error reloading config:', err);
      }
    }, 500); // Wait 500ms after last change before reloading
  }
});

console.log(`[Server] Watching config file for changes: ${configPath}`);

// Set up message handlers
wsServer.setHandlers({
  onInput: (playerId: string, input) => {
    // Store input state in PlayerManager (processed every frame in game loop)
    playerManager.updateInput(playerId, input);
  },
  
  onSpawnNpc: (playerId: string, count: number) => {
    // Admin/debug command: Spawn additional NPCs
    // Get player position for spawning NPCs nearby
    const player = playerManager.getPlayer(playerId);
    if (player) {
      // TODO: Get actual player position from game world for spawning near player
      console.log(`[Server] Admin spawn request: ${count} NPCs for player ${playerId}`);
      gameWorld.spawnNpcs(
        count,
        ServerConfig.DEFAULT_SPAWN_CENTER.lng,
        ServerConfig.DEFAULT_SPAWN_CENTER.lat,
        ServerConfig.NPC_SPAWN_RADIUS
      );
    }
  },
  
  onPossessEntity: (playerId: string, targetEid: number) => {
    // Handle possession transfer request
    const result = gameWorld.transferPossession(playerId, targetEid);
    
    if (result.success && result.oldEid !== undefined) {
      // Success - notify the requesting player
      const successMessage: ServerMessage = {
        type: 'possession_transferred',
        playerId: playerId,
        newEntityId: targetEid,
        oldEntityId: result.oldEid,
      };
      playerManager.sendToPlayer(playerId, JSON.stringify(successMessage));
      console.log(`[Server] Possession transferred for ${playerId}: ${result.oldEid} -> ${targetEid}`);
    } else {
      // Failure - send error message
      const errorMessage: ServerMessage = {
        type: 'possession_failed',
        reason: result.reason || 'Unknown error',
      };
      playerManager.sendToPlayer(playerId, JSON.stringify(errorMessage));
      console.log(`[Server] Possession failed for ${playerId}: ${result.reason}`);
    }
  },
});

// Register game world in game loop
gameLoop.addFixed(gameWorld);

// Set up state broadcasting
gameLoop.setBroadcastCallback(() => {
  // State broadcasting is handled by WebSocketServer's interval
  // This callback can be used for other periodic tasks
});

// Start systems
console.log('Starting game systems...\n');
gameLoop.start();
wsServer.startBroadcasting();

console.log(`Server running on port ${PORT}`);
console.log('Press Ctrl+C to stop\n');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  gameLoop.stop();
  wsServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down server...');
  gameLoop.stop();
  wsServer.close();
  process.exit(0);
});

