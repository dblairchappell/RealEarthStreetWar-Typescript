/**
 * Main Server Entry Point
 * 
 * Initializes and starts the game server with WebSocket support.
 */

import { PlayerManager } from './players/PlayerManager';
import { GameWorld } from './game/GameWorld';
import { ServerGameLoop } from './game/GameLoop';
import { WebSocketServer } from './network/WebSocketServer';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

console.log('========================================');
console.log('RealEarthStreetWar Server');
console.log('========================================\n');

// Initialize core systems
const playerManager = new PlayerManager();
const gameWorld = new GameWorld();
gameWorld.setPlayerManager(playerManager); // Give GameWorld access to PlayerManager
const gameLoop = new ServerGameLoop();
const wsServer = new WebSocketServer(PORT, playerManager, gameWorld);

// Set up message handlers
wsServer.setHandlers({
  onInput: (playerId: string, input) => {
    // Store input state in PlayerManager (processed every frame in game loop)
    playerManager.updateInput(playerId, input);
  },
  
  onSpawnNpc: (playerId: string, count: number) => {
    // Get player position for spawning NPCs nearby
    const player = playerManager.getPlayer(playerId);
    if (player) {
      // For now, spawn at default location
      // TODO: Get actual player position from game world
      gameWorld.spawnNpcs(count, -74.05682, 40.69337, 0.001);
    }
  },
  
  onPlaceHq: (playerId: string, hq) => {
    // TODO: Implement HQ placement logic
    console.log(`[Server] Player ${playerId} wants to place HQ:`, hq);
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

