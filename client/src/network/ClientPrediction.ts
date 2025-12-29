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
  
  // Smooth reconciliation thresholds (three-tier system)
  // Tiny differences (<10m): ignored - within acceptable tolerance
  // Medium differences (10m-1km): smooth gradual correction over multiple reconciliations
  // Catastrophic errors (>1km): instant snap (teleports, major bugs)
  private readonly SMOOTH_RECONCILIATION_THRESHOLD = 0.0001; // ~10m at equator - smooth correct below catastrophic
  private readonly CATASTROPHIC_THRESHOLD = 0.01; // ~1km at equator - instant snap above this
  private readonly SMOOTH_CORRECTION_RATE = 0.1; // Blend 10% towards server per reconciliation (adjustable)
  
  // Rotation reconciliation thresholds
  // Rotation differences accumulate due to network latency, but need to be corrected to prevent drift
  private readonly ROTATION_SMOOTH_THRESHOLD = 5; // Smooth correct rotations >5° difference
  private readonly ROTATION_CATASTROPHIC_THRESHOLD = 90; // Instant snap for rotations >90° difference
  private readonly ROTATION_CORRECTION_RATE = 0.2; // Blend 20% towards server rotation per reconciliation (faster than position)

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
        deltaLat += Math.sin(radians) * step;
        deltaLng += Math.cos(radians) * step;
      }
      
      if (input.backward) {
        deltaLat -= Math.sin(radians) * step;
        deltaLng -= Math.cos(radians) * step;
      }
      
      if (input.left) {
        const strafeRadians = radians + Math.PI / 2;
        deltaLat += Math.sin(strafeRadians) * step;
        deltaLng += Math.cos(strafeRadians) * step;
      }
      
      if (input.right) {
        const strafeRadians = radians - Math.PI / 2;
        deltaLat += Math.sin(strafeRadians) * step;
        deltaLng += Math.cos(strafeRadians) * step;
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
   * Implements three-tier reconciliation system:
   * 1. Catastrophic errors (>1km): Instant snap (teleports, major bugs)
   * 2. Medium differences (10m-1km): Smooth gradual correction over multiple reconciliations
   * 3. Tiny differences (<10m): Ignored (within acceptable tolerance)
   * 
   * This prevents drift while avoiding visible snap-backs, ensuring accurate P2P interactions.
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

    // Tier 1: Catastrophic error - instant snap (teleports, major bugs)
    const catastrophicPosError = lngDiff > this.CATASTROPHIC_THRESHOLD || 
                                  latDiff > this.CATASTROPHIC_THRESHOLD;
    const catastrophicRotError = rotDiff > this.ROTATION_CATASTROPHIC_THRESHOLD;

    if (catastrophicPosError || catastrophicRotError) {
      console.error('[ClientPrediction] CATASTROPHIC desync - instant reconciliation:', {
        predicted: { lng: predictedLng.toFixed(8), lat: predictedLat.toFixed(8), rot: predictedRot.toFixed(2) },
        server: { lng: serverLng.toFixed(8), lat: serverLat.toFixed(8), rot: serverRotation.toFixed(2) },
        diff: { lng: lngDiff.toFixed(8), lat: latDiff.toFixed(8), rot: rotDiff.toFixed(2) }
      });

      // Instant snap for catastrophic errors
      Position.x[this.playerEid] = serverLng;
      Position.y[this.playerEid] = serverLat;
      Rotation.angle[this.playerEid] = serverRotation;
      return;
    }

    // Tier 2: Medium differences - smooth gradual correction
    // This prevents drift while avoiding visible snap-backs
    // Correction happens over multiple reconciliations (every ~16ms at 60Hz broadcast)
    // Spread over several frames, making it imperceptible
    const needsSmoothCorrection = lngDiff > this.SMOOTH_RECONCILIATION_THRESHOLD || 
                                   latDiff > this.SMOOTH_RECONCILIATION_THRESHOLD;

    if (needsSmoothCorrection) {
      // Gradually blend towards server position
      // At 10% per reconciliation, a 100m error corrects in ~10 reconciliations (~160ms)
      const correctionFactor = this.SMOOTH_CORRECTION_RATE;
      
      Position.x[this.playerEid] = predictedLng + (serverLng - predictedLng) * correctionFactor;
      Position.y[this.playerEid] = predictedLat + (serverLat - predictedLat) * correctionFactor;
      
    }
    // Tier 3: Tiny differences (<10m) - ignored
    // These are within acceptable tolerance for gameplay and P2P interactions
    // Prevents micro-corrections that could cause jitter

    // Rotation reconciliation - smooth correction for rotation differences
    // Rotation drift causes movement direction mismatch, so we need to correct it
    if (rotDiff > this.ROTATION_SMOOTH_THRESHOLD) {
      // Smoothly correct rotation difference
      // Use shortest path around circle (already handled by rotDiff calculation)
      let rotationCorrection = serverRotation - predictedRot;
      
      // Handle wrapping - take shortest path
      if (rotationCorrection > 180) {
        rotationCorrection -= 360;
      } else if (rotationCorrection < -180) {
        rotationCorrection += 360;
      }
      
      // Apply smooth correction
      Rotation.angle[this.playerEid] = predictedRot + rotationCorrection * this.ROTATION_CORRECTION_RATE;
      
      // Normalize to 0-360 range
      Rotation.angle[this.playerEid] = ((Rotation.angle[this.playerEid] % 360) + 360) % 360;
    }
    // Small rotation differences (<5°) are ignored to prevent micro-corrections

    // Store server position for reference (but don't use it for normal movement)
    this.serverPosition = { lng: serverLng, lat: serverLat, rotation: serverRotation };
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

