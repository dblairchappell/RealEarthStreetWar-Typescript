// src/view/HUDView.ts

import { formatInTimeZone } from "../utils/time";
import { Updatable } from "../loop/GameLoop";
import tzLookup from "tz-lookup";
import { EntityInfo } from "./EntityClickHandler";

export default class HUDView implements Updatable {
  private gameDateEl: HTMLElement | null;

  // World clock elements
  private timeLondonEl: HTMLElement | null;
  private timeNyEl: HTMLElement | null;
  private timeTokyoEl: HTMLElement | null;

  // Entity info panel elements
  private entityInfoPanel: HTMLElement | null;
  private occupantPanel: HTMLElement | null;
  private npcPanel: HTMLElement | null;
  
  // Occupant panel elements
  private occupantIdEl: HTMLElement | null;
  private occupantPositionEl: HTMLElement | null;
  private occupantCommandEl: HTMLElement | null;
  private vacateBodyBtn: HTMLElement | null;
  private commandMenuBtn: HTMLElement | null;
  
  // NPC panel elements
  private npcIdEl: HTMLElement | null;
  private npcPositionEl: HTMLElement | null;
  private npcDistanceEl: HTMLElement | null;
  private possessBtn: HTMLElement | null;

  private mapInstance: any = null; // Will be set by setMapInstance
  private gameState: any = null; // Will be set by setGameState
  
  // Callbacks
  private onVacateBody?: () => void;
  private onPossessBody?: (entityId: number) => void;
  private onCommandMenu?: () => void;

  constructor() {
    this.gameDateEl = document.getElementById('game-date');

    // Query world clock elements
    this.timeLondonEl = document.getElementById('time-london');
    this.timeNyEl = document.getElementById('time-ny');
    this.timeTokyoEl = document.getElementById('time-tokyo');
    
    // Query entity info panel elements
    this.entityInfoPanel = document.getElementById('entity-info-panel');
    this.occupantPanel = document.getElementById('occupant-panel');
    this.npcPanel = document.getElementById('npc-panel');
    
    // Query occupant panel elements
    this.occupantIdEl = document.getElementById('occupant-id');
    this.occupantPositionEl = document.getElementById('occupant-position');
    this.occupantCommandEl = document.getElementById('occupant-command');
    this.vacateBodyBtn = document.getElementById('vacate-body-btn');
    this.commandMenuBtn = document.getElementById('command-menu-btn');
    
    // Query NPC panel elements
    this.npcIdEl = document.getElementById('npc-id');
    this.npcPositionEl = document.getElementById('npc-position');
    this.npcDistanceEl = document.getElementById('npc-distance');
    this.possessBtn = document.getElementById('possess-btn');
    
    // Set up button event listeners
    this.setupEventListeners();
  }
  
  /**
   * Set up event listeners for panel buttons
   */
  private setupEventListeners(): void {
    if (this.vacateBodyBtn) {
      this.vacateBodyBtn.addEventListener('click', () => {
        if (this.onVacateBody) {
          this.onVacateBody();
        }
      });
    }
    
    if (this.possessBtn) {
      this.possessBtn.addEventListener('click', () => {
        if (this.onPossessBody && this.possessBtn) {
          const entityId = parseInt(this.possessBtn.getAttribute('data-entity-id') || '0', 10);
          if (entityId > 0) {
            this.onPossessBody(entityId);
          }
        }
      });
    }
    
    if (this.commandMenuBtn) {
      this.commandMenuBtn.addEventListener('click', () => {
        if (this.onCommandMenu) {
          this.onCommandMenu();
        }
      });
    }
  }
  
  /**
   * Set callbacks for panel actions
   */
  public setCallbacks(callbacks: {
    onVacateBody?: () => void;
    onPossessBody?: (entityId: number) => void;
    onCommandMenu?: () => void;
  }): void {
    this.onVacateBody = callbacks.onVacateBody;
    this.onPossessBody = callbacks.onPossessBody;
    this.onCommandMenu = callbacks.onCommandMenu;
  }

  /**
   * Set map instance for timezone lookup
   */
  setMapInstance(map: any): void {
    this.mapInstance = map;
  }

  /**
   * Set game state reference for time updates
   */
  setGameState(state: any): void {
    this.gameState = state;
  }

  /**
   * Updatable implementation - updates time display every frame for smooth progression
   */
  public update(_deltaMs: number): void {
    if (!this.gameState || !this.mapInstance) return;

    // Get timezone for current map center
    const centre = this.mapInstance.getCenter();
    let zone: string;
    try {
      zone = tzLookup(centre.lat, centre.lng);
    } catch (_) {
      zone = 'UTC';
    }

    // Update time displays with current game time
    this.updateTimeDisplays(this.gameState.gameDate, zone);
  }

  /* ----------------------------------------------------------------
     Game clock display (now called every frame for smooth updates)
     ---------------------------------------------------------------- */
  public updateTimeDisplays(gameDate: Date, localTimeZone: string) {
    // Include seconds in format for smooth progression
    const format = 'dd MMM yyyy HH:mm:ss';

    // Update local time
    if (this.gameDateEl) {
      this.gameDateEl.textContent = formatInTimeZone(
        gameDate,
        localTimeZone,
        format
      );
    }

    // Update world clocks
    if (this.timeLondonEl) {
      this.timeLondonEl.textContent = formatInTimeZone(
        gameDate,
        'Europe/London',
        format
      );
    }
    if (this.timeNyEl) {
      this.timeNyEl.textContent = formatInTimeZone(
        gameDate,
        'America/New_York',
        format
      );
    }
    if (this.timeTokyoEl) {
      this.timeTokyoEl.textContent = formatInTimeZone(
        gameDate,
        'Asia/Tokyo',
        format
      );
    }
  }

  /* ----------------------------------------------------------------
     Entity Info Panel Management
     ---------------------------------------------------------------- */

  /**
   * Show occupant info panel with entity details
   */
  public showOccupantPanel(entityId: number, info: EntityInfo, currentCommand?: string): void {
    if (!this.entityInfoPanel || !this.occupantPanel || !this.npcPanel) return;
    
    // Hide NPC panel
    this.npcPanel.classList.add('hidden');
    
    // Show occupant panel
    this.occupantPanel.classList.remove('hidden');
    this.entityInfoPanel.classList.remove('hidden');
    
    // Update occupant info
    if (this.occupantIdEl) {
      this.occupantIdEl.textContent = entityId.toString();
    }
    
    if (this.occupantPositionEl) {
      this.occupantPositionEl.textContent = `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`;
    }
    
    if (this.occupantCommandEl) {
      this.occupantCommandEl.textContent = currentCommand || 'None';
    }
  }

  /**
   * Show NPC info panel with entity details and distance
   */
  public showNpcPanel(entityId: number, info: EntityInfo, distanceMeters: number, inRange: boolean): void {
    if (!this.entityInfoPanel || !this.occupantPanel || !this.npcPanel) return;
    
    // Hide occupant panel
    this.occupantPanel.classList.add('hidden');
    
    // Show NPC panel
    this.npcPanel.classList.remove('hidden');
    this.entityInfoPanel.classList.remove('hidden');
    
    // Update NPC info
    if (this.npcIdEl) {
      this.npcIdEl.textContent = entityId.toString();
    }
    
    if (this.npcPositionEl) {
      this.npcPositionEl.textContent = `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`;
    }
    
    if (this.npcDistanceEl) {
      this.npcDistanceEl.textContent = `${distanceMeters.toFixed(2)} m`;
    }
    
    // Enable/disable possess button based on range
    if (this.possessBtn) {
      this.possessBtn.disabled = !inRange;
      this.possessBtn.setAttribute('data-entity-id', entityId.toString());
      
      if (inRange) {
        this.possessBtn.title = 'Click to possess this body';
      } else {
        this.possessBtn.title = 'Too far away - move closer to possess';
      }
    }
  }

  /**
   * Hide entity info panel
   */
  public hideEntityPanel(): void {
    if (this.entityInfoPanel) {
      this.entityInfoPanel.classList.add('hidden');
    }
    if (this.occupantPanel) {
      this.occupantPanel.classList.add('hidden');
    }
    if (this.npcPanel) {
      this.npcPanel.classList.add('hidden');
    }
  }

  /**
   * Update occupant command display
   */
  public updateOccupantCommand(entityId: number, command: string): void {
    if (this.occupantCommandEl) {
      this.occupantCommandEl.textContent = command;
    }
  }
}
