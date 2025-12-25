/**
 * WebSocketServer - Handles WebSocket connections and message routing
 * 
 * Manages client connections, message parsing, and routing to appropriate handlers.
 */

import { WebSocket, WebSocketServer as WSServer } from 'ws';
import { PlayerManager } from '../players/PlayerManager';
import { GameWorld } from '../game/GameWorld';
import { ClientMessage, ServerMessage } from './types';
import type { InputState } from '../shared/input';

export interface MessageHandlers {
  onInput?: (playerId: string, input: InputState) => void;
  onSpawnNpc?: (playerId: string, count: number) => void;
}

/**
 * WebSocket server for game communication
 */
export class WebSocketServer {
  private wss: WSServer;
  private playerManager: PlayerManager;
  private gameWorld: GameWorld;
  private handlers: MessageHandlers = {};
  private broadcastInterval: NodeJS.Timeout | null = null;
  private readonly BROADCAST_RATE = 20; // Broadcast state 20 times per second

  constructor(port: number, playerManager: PlayerManager, gameWorld: GameWorld) {
    this.playerManager = playerManager;
    this.gameWorld = gameWorld;
    
    this.wss = new WSServer({ port });
    
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });
    
    console.log(`[WebSocketServer] Listening on port ${port}`);
  }

  /**
   * Set message handlers
   */
  setHandlers(handlers: MessageHandlers): void {
    this.handlers = handlers;
  }

  /**
   * Start broadcasting game state to all clients
   */
  startBroadcasting(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }
    
    const intervalMs = 1000 / this.BROADCAST_RATE;
    this.broadcastInterval = setInterval(() => {
      this.broadcastState();
    }, intervalMs);
    
    console.log(`[WebSocketServer] Started broadcasting at ${this.BROADCAST_RATE}Hz`);
  }

  /**
   * Stop broadcasting
   */
  stopBroadcasting(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  /**
   * Broadcast current game state to all clients
   */
  broadcastState(): void {
    const snapshot = this.gameWorld.createSnapshot();
    const message: ServerMessage = {
      type: 'state_snapshot',
      state: snapshot,
      timestamp: Date.now(),
    };
    
    this.playerManager.broadcast(JSON.stringify(message));
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const player = this.playerManager.addPlayer(ws);
    
    // Send welcome message
    const welcomeMessage: ServerMessage = {
      type: 'player_joined',
      playerId: player.id,
    };
    ws.send(JSON.stringify(welcomeMessage));
    
    // Create player entity in game world
    this.gameWorld.createPlayer(
      player.id,
      -74.05682, // Default starting position (NYC)
      40.69337,
      180
    );
    
    // Send immediate state snapshot so client gets current game state
    const snapshot = this.gameWorld.createSnapshot();
    const initialStateMessage: ServerMessage = {
      type: 'state_snapshot',
      state: snapshot,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(initialStateMessage));
    
    // Notify other players
    const joinMessage: ServerMessage = {
      type: 'player_joined',
      playerId: player.id,
    };
    this.playerManager.broadcast(JSON.stringify(joinMessage));
    
    // Handle messages
    ws.on('message', (data: Buffer) => {
      this.handleMessage(player.id, data.toString());
    });
    
    // Handle disconnect
    ws.on('close', () => {
      this.handleDisconnect(player.id);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error(`[WebSocketServer] Error for player ${player.id}:`, error);
    });
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(playerId: string, data: string): void {
    try {
      const message: ClientMessage = JSON.parse(data);
      
      switch (message.type) {
        case 'input':
          if (this.handlers.onInput) {
            this.handlers.onInput(playerId, message.input);
          }
          break;
          
        case 'spawn_npc':
          if (this.handlers.onSpawnNpc) {
            this.handlers.onSpawnNpc(playerId, message.count);
          }
          break;
          
        case 'ping':
          // Respond to ping
          const pongMessage: ServerMessage = {
            type: 'pong',
            timestamp: message.timestamp,
          };
          this.playerManager.sendToPlayer(playerId, JSON.stringify(pongMessage));
          this.playerManager.updatePing(playerId);
          break;
          
        default:
          console.warn(`[WebSocketServer] Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      console.error(`[WebSocketServer] Error parsing message from ${playerId}:`, error);
      const errorMessage: ServerMessage = {
        type: 'error',
        message: 'Invalid message format',
      };
      this.playerManager.sendToPlayer(playerId, JSON.stringify(errorMessage));
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(playerId: string): void {
    // Remove player entity from game world
    this.gameWorld.removePlayer(playerId);
    
    // Remove from player manager
    this.playerManager.removePlayer(playerId);
    
    // Notify other players
    const leaveMessage: ServerMessage = {
      type: 'player_left',
      playerId,
    };
    this.playerManager.broadcast(JSON.stringify(leaveMessage));
  }

  /**
   * Close the server
   */
  close(): void {
    this.stopBroadcasting();
    this.wss.close();
  }
}

