/**
 * GameClient - WebSocket Client for Server Communication
 * 
 * Handles all communication between the client and game server.
 * Manages connection, sends input, receives state snapshots, and applies them.
 */

import { ClientMessage, ServerMessage, GameStateSnapshot } from './types';
import { InputState } from '@shared/realearthstreetwar';

export interface GameClientCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onStateSnapshot?: (snapshot: GameStateSnapshot) => void;
  onPlayerIdReceived?: (playerId: string) => void;
  onPossessionTransferred?: (newEntityId: number, oldEntityId: number) => void;
  onPossessionFailed?: (reason: string) => void;
  onError?: (error: Error) => void;
}

/**
 * WebSocket client for game server communication
 */
export class GameClient {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: GameClientCallbacks = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private reconnectTimer: number | null = null;
  private connected = false;
  private playerId: string | null = null;

  constructor(url: string = 'ws://localhost:8080') {
    this.url = url;
  }

  /**
   * Set callbacks for client events
   * Merges with existing callbacks (doesn't replace them)
   */
  setCallbacks(callbacks: GameClientCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Connect to the game server
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn('[GameClient] Already connected');
      return;
    }

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (error) {
      console.error('[GameClient] Connection error:', error);
      this.handleError(error as Error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.playerId = null;
  }

  /**
   * Send input state to the server
   */
  sendInput(input: InputState): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[GameClient] Cannot send input - not connected');
      return;
    }

    const message: ClientMessage = {
      type: 'input',
      input,
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[GameClient] Error sending input:', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Send ping to server (for latency measurement)
   */
  ping(): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: ClientMessage = {
      type: 'ping',
      timestamp: Date.now(),
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[GameClient] Error sending ping:', error);
    }
  }

  /**
   * Send a generic message to the server
   */
  sendMessage(message: ClientMessage): void {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[GameClient] Error sending message:', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Get current connection status
   */
  isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get player ID assigned by server
   */
  getPlayerId(): string | null {
    return this.playerId;
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('[GameClient] Connected to server');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      
      if (this.callbacks.onConnected) {
        this.callbacks.onConnected();
      }
    };

    this.ws.onmessage = async (event) => {
      try {
        // Handle both string and Blob data
        let data: string;
        if (event.data instanceof Blob) {
          data = await event.data.text();
        } else if (typeof event.data === 'string') {
          data = event.data;
        } else {
          // ArrayBuffer case
          data = new TextDecoder().decode(event.data);
        }
        
        const message: ServerMessage = JSON.parse(data);
        this.handleServerMessage(message);
      } catch (error) {
        console.error('[GameClient] Error parsing server message:', error);
        this.handleError(error as Error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[GameClient] WebSocket error:', error);
      this.handleError(new Error('WebSocket error'));
    };

    this.ws.onclose = () => {
      console.log('[GameClient] Disconnected from server');
      this.connected = false;
      
      if (this.callbacks.onDisconnected) {
        this.callbacks.onDisconnected();
      }

      // Attempt to reconnect if not manually closed
      if (this.ws) {
        this.scheduleReconnect();
      }
    };
  }

  /**
   * Handle incoming server messages
   */
  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'state_snapshot':
        if (this.callbacks.onStateSnapshot) {
          this.callbacks.onStateSnapshot(message.state);
        }
        break;

      case 'player_joined':
        if (message.playerId) {
          this.playerId = message.playerId;
          console.log(`[GameClient] Player ID assigned: ${this.playerId}`);
          if (this.callbacks.onPlayerIdReceived) {
            this.callbacks.onPlayerIdReceived(message.playerId);
          }
        }
        break;

      case 'player_left':
        // Handle other players leaving (for future multiplayer)
        break;

      case 'pong':
        // Handle ping response (for latency measurement)
        // const latency = Date.now() - message.timestamp;
        break;

      case 'possession_transferred':
        console.log(`[GameClient] Possession transferred: ${message.oldEntityId} -> ${message.newEntityId}`);
        if (this.callbacks.onPossessionTransferred) {
          this.callbacks.onPossessionTransferred(message.newEntityId, message.oldEntityId);
        }
        break;

      case 'possession_failed':
        console.warn(`[GameClient] Possession failed: ${message.reason}`);
        if (this.callbacks.onPossessionFailed) {
          this.callbacks.onPossessionFailed(message.reason);
        }
        break;

      case 'error':
        console.error('[GameClient] Server error:', message.message);
        this.handleError(new Error(message.message));
        break;

      default:
        console.warn('[GameClient] Unknown message type:', (message as any).type);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[GameClient] Max reconnection attempts reached');
      return;
    }

    if (this.reconnectTimer !== null) {
      return; // Already scheduled
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`[GameClient] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      console.log(`[GameClient] Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.connect();
    }, delay);
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }
}

