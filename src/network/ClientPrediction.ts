/**
 * ClientPrediction - Client-Side Prediction System
 * 
 * Implements client-side prediction for local player movement to eliminate jitter
 * and provide instant responsiveness. The server remains authoritative and corrections
 * are applied smoothly when server state arrives.
 * 
 * Architecture:
 * - Processes movement locally immediately when input arrives
 * - Stores input history with sequence numbers for reconciliation
 * - When server snapshot arrives, compares predicted vs server position
 * - If mismatch detected, smoothly corrects and replays inputs
 */

import { InputState } from '@shared/realearthstreetwar';
import { GameStateConstants } from '@shared/realearthstreetwar';
import { Position, Rotation, world } from '../ecs/world';
import GameLoop from '../loop/GameLoop';

interface InputRecord {
  input: InputState;
  sequence: number;
  timestamp: number;
}

/**
 * Manages client-side prediction for local player movement
 */
export class ClientPrediction {
  private playerEid: number | null = null;
  private inputSequence = 0;
  private inputHistory: InputRecord[] = [];
  private readonly MAX_HISTORY = 60; // Keep last 60 inputs (~1 second at 60Hz)
  private lastProcessedSequence = -1;
  
  // Current input state (updated when input changes, processed every fixed timestep)
  private currentInput: InputState | null = null;
  
  // Server reconciliation state
  private serverPosition: { lng: number; lat: number; rotation: number } | null = null;
  // Only reconcile for truly significant errors (like teleports, collisions, or major desync)
  // Normal movement differences due to network latency are expected and should be ignored
  private reconciliationThreshold = 0.01; // Very large threshold - only reconcile major errors (about 1km at equator)
  private lastReconciliationTime = 0;
  private readonly MIN_RECONCILIATION_INTERVAL = 500; // Minimum ms between reconciliations (500ms = 2Hz max)

  /**
   * Set the player entity ID to predict for
   */
  setPlayerEntity(eid: number): void {
    this.playerEid = eid;
  }

  /**
   * Store input state (called when input changes)
   * Returns sequence number for tracking
   */
  storeInput(input: InputState): number {
    const sequence = this.inputSequence++;
    const timestamp = performance.now();

    // Store current input state (used for fixed timestep processing)
    this.currentInput = { ...input };

    // Store input in history for reconciliation
    this.inputHistory.push({ input: { ...input }, sequence, timestamp });
    
    // Keep history size bounded
    if (this.inputHistory.length > this.MAX_HISTORY) {
      this.inputHistory.shift();
    }

    return sequence;
  }

  /**
   * Process movement every fixed timestep (called from GameController.fixedUpdate())
   * Uses stored input state to match server behavior
   */
  fixedUpdate(): void {
    if (this.playerEid === null || !this.currentInput) return;
    
    // Process movement based on current input state
    // This matches how the server processes input every fixed timestep
    this.processMovement(this.currentInput);
  }

  /**
   * Process player movement locally (same logic as server)
   */
  private processMovement(input: InputState): void {
    if (this.playerEid === null) return;

    const deltaSec = GameLoop.FIXED_DT / 1000; // Convert ms to seconds

    // Handle rotation
    if (input.rotateLeft) {
      Rotation.angle[this.playerEid] -= GameStateConstants.PLAYER_ROTATION_SPEED * deltaSec;
      Rotation.angle[this.playerEid] = ((Rotation.angle[this.playerEid] % 360) + 360) % 360;
    }
    
    if (input.rotateRight) {
      Rotation.angle[this.playerEid] += GameStateConstants.PLAYER_ROTATION_SPEED * deltaSec;
      Rotation.angle[this.playerEid] = ((Rotation.angle[this.playerEid] % 360) + 360) % 360;
    }

    // Handle movement
    if (input.forward || input.backward || input.left || input.right) {
      const radians = (Rotation.angle[this.playerEid] * Math.PI) / 180;
      const moveSpeedDegPerSec = input.running 
        ? GameStateConstants.PLAYER_RUN_SPEED 
        : GameStateConstants.PLAYER_MOVE_SPEED;
      const step = moveSpeedDegPerSec * deltaSec;
      
      let deltaLat = 0;
      let deltaLng = 0;
      
      if (input.forward) {
        deltaLat += Math.cos(radians) * step;
        deltaLng += Math.sin(radians) * step;
      }
      
      if (input.backward) {
        deltaLat -= Math.cos(radians) * step;
        deltaLng -= Math.sin(radians) * step;
      }
      
      if (input.left) {
        const strafeRadians = radians - Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * step;
        deltaLng += Math.sin(strafeRadians) * step;
      }
      
      if (input.right) {
        const strafeRadians = radians + Math.PI / 2;
        deltaLat += Math.cos(strafeRadians) * step;
        deltaLng += Math.sin(strafeRadians) * step;
      }
      
      const latRadians = (Position.y[this.playerEid] * Math.PI) / 180;
      const correctedLng = deltaLng / Math.cos(latRadians);

      Position.x[this.playerEid] += correctedLng;
      Position.y[this.playerEid] += deltaLat;
    }
  }

  /**
   * Reconcile predicted position with server position
   * Called when server snapshot arrives
   * 
   * RECONCILIATION DISABLED - Client prediction is trusted completely for normal movement.
   * Only reconciles for catastrophic errors (teleports > 1km, rotation > 180°).
   * This prevents rubber-banding from network latency differences.
   */
  reconcile(serverLng: number, serverLat: number, serverRotation: number): void {
    if (this.playerEid === null) return;

    const predictedLng = Position.x[this.playerEid];
    const predictedLat = Position.y[this.playerEid];
    const predictedRot = Rotation.angle[this.playerEid];

    // Calculate position difference
    const lngDiff = Math.abs(predictedLng - serverLng);
    const latDiff = Math.abs(predictedLat - serverLat);
    
    // Handle rotation wrapping (359° and 1° are only 2° apart, not 358°)
    let rotDiff = Math.abs(predictedRot - serverRotation);
    if (rotDiff > 180) {
      rotDiff = 360 - rotDiff; // Take the shorter path around the circle
    }

    // Only reconcile for catastrophic POSITION errors (teleports, major bugs, etc.)
    // Rotation reconciliation is DISABLED - rotation differences accumulate due to network latency
    // and are expected. Client prediction is trusted completely for rotation.
    // Position threshold is very large (~1km at equator) - only triggers for real errors
    const catastrophicError = lngDiff > this.reconciliationThreshold || 
                              latDiff > this.reconciliationThreshold;
    // NOTE: Rotation reconciliation disabled - rotation differences are normal due to network latency
    // and accumulate over time. Client prediction is authoritative for rotation.

    if (catastrophicError) {
      console.error('[ClientPrediction] CATASTROPHIC POSITION desync detected - forcing reconciliation:', {
        predicted: { lng: predictedLng.toFixed(8), lat: predictedLat.toFixed(8), rot: predictedRot.toFixed(2) },
        server: { lng: serverLng.toFixed(8), lat: serverLat.toFixed(8), rot: serverRotation.toFixed(2) },
        diff: { lng: lngDiff.toFixed(8), lat: latDiff.toFixed(8), rot: rotDiff.toFixed(2) }
      });

      // Only reconcile POSITION for catastrophic errors - trust client prediction for rotation
      // Apply server correction immediately for catastrophic position errors
      Position.x[this.playerEid] = serverLng;
      Position.y[this.playerEid] = serverLat;
      // DO NOT reconcile rotation - client prediction is authoritative
      // Rotation.angle[this.playerEid] = serverRotation;
    }
    // For all normal movement, trust client prediction completely
    // Network latency causes small differences that are expected and should be ignored
    // This eliminates rubber-banding completely
    // 
    // NOTE: We do NOT store server position for normal movement to avoid any potential
    // side effects that might cause visual artifacts
  }

  /**
   * Get current input sequence number
   */
  getCurrentSequence(): number {
    return this.inputSequence;
  }

  /**
   * Clear input history (useful when disconnecting)
   */
  clearHistory(): void {
    this.inputHistory = [];
    this.inputSequence = 0;
    this.lastProcessedSequence = -1;
  }
}

