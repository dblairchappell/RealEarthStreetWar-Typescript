// src/view/HUDView.ts

import { formatInTimeZone } from "../utils/time";
import { Updatable } from "../loop/GameLoop";
import tzLookup from "tz-lookup";
import { EntityInfo, BuildingInfo } from "./EntityClickHandler";
import { Position } from "../ecs/world";
import { calculateDistanceMeters, GameStateConstants } from "@shared/realearthstreetwar";

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
  private buildingPanel: HTMLElement | null;
  
    // Occupant panel elements
    private occupantIdEl: HTMLElement | null;
    private occupantPositionEl: HTMLElement | null;
    private occupantCommandEl: HTMLElement | null;
    private commandMenuBtn: HTMLElement | null;
  
  // NPC panel elements
  private npcIdEl: HTMLElement | null;
  private npcPositionEl: HTMLElement | null;
  private npcDistanceEl: HTMLElement | null;
  private possessBtn: HTMLButtonElement | null;
  
  // Building panel elements
  private buildingIdEl: HTMLElement | null;
  private buildingNameEl: HTMLElement | null;
  private buildingTypeEl: HTMLElement | null;
  private buildingHeightEl: HTMLElement | null;
  private buildingCoordinatesEl: HTMLElement | null;

  private mapInstance: any = null; // Will be set by setMapInstance
  private gameState: any = null; // Will be set by setGameState
  
  // Selected NPC tracking for continuous distance updates
  private selectedNpcClientEid: number | null = null; // Client entity ID of selected NPC
  private selectedNpcServerEid: number | null = null; // Server entity ID (for possess button)
  private getPlayerEntityId: (() => number | null) | null = null; // Callback to get player entity ID
  
  // Selected occupant tracking for continuous position updates
  private selectedOccupantEid: number | null = null; // Client entity ID of selected occupant (player)
  
  // Callbacks
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
    this.buildingPanel = document.getElementById('building-panel');
    
    // Query occupant panel elements
    this.occupantIdEl = document.getElementById('occupant-id');
    this.occupantPositionEl = document.getElementById('occupant-position');
    this.occupantCommandEl = document.getElementById('occupant-command');
    this.commandMenuBtn = document.getElementById('command-menu-btn');
    
    // Query NPC panel elements
    this.npcIdEl = document.getElementById('npc-id');
    this.npcPositionEl = document.getElementById('npc-position');
    this.npcDistanceEl = document.getElementById('npc-distance');
    this.possessBtn = document.getElementById('possess-btn') as HTMLButtonElement | null;
    
    // Query building panel elements
    this.buildingIdEl = document.getElementById('building-id');
    this.buildingNameEl = document.getElementById('building-name');
    this.buildingTypeEl = document.getElementById('building-type');
    this.buildingHeightEl = document.getElementById('building-height');
    this.buildingCoordinatesEl = document.getElementById('building-coordinates');
    
    // Set up button event listeners
    this.setupEventListeners();
  }
  
  /**
   * Set up event listeners for panel buttons
   */
  private setupEventListeners(): void {
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
    onPossessBody?: (entityId: number) => void;
    onCommandMenu?: () => void;
  }): void {
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
   * Set callback to get player entity ID for distance calculations
   */
  setGetPlayerEntityIdCallback(callback: () => number | null): void {
    this.getPlayerEntityId = callback;
  }

  /**
   * Updatable implementation - updates time display every frame for smooth progression
   * Also updates NPC distance if an NPC is selected
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

    // Update NPC distance if an NPC is selected and panel is visible
    if (this.selectedNpcClientEid !== null && this.npcPanel && !this.npcPanel.classList.contains('hidden')) {
      this.updateSelectedNpcDistance();
    }
    
    // Update occupant position if occupant panel is visible
    if (this.selectedOccupantEid !== null && this.occupantPanel && !this.occupantPanel.classList.contains('hidden')) {
      this.updateSelectedOccupantPosition();
    }
  }

  /* ----------------------------------------------------------------
     Game clock display (now called every frame for smooth updates)
     ---------------------------------------------------------------- */
  public updateTimeDisplays(gameDate: Date, localTimeZone: string) {
    // Include seconds in format for smooth progression
    const format = 'dd MMM yyyy HH:mm';

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
    if (!this.entityInfoPanel || !this.occupantPanel || !this.npcPanel || !this.buildingPanel) return;
    
    // Hide other panels
    this.npcPanel.classList.add('hidden');
    this.buildingPanel.classList.add('hidden');
    
    // Show occupant panel
    this.occupantPanel.classList.remove('hidden');
    this.entityInfoPanel.classList.remove('hidden');
    
    // Store selected occupant entity ID for continuous position updates
    this.selectedOccupantEid = info.entityId; // Client entity ID from EntityInfo
    
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
   * Update the position display for the selected occupant
   * Called continuously while occupant panel is visible
   */
  private updateSelectedOccupantPosition(): void {
    if (this.selectedOccupantEid === null || !this.occupantPositionEl) return;

    // Read occupant position from ECS
    const occupantLng = Position.x[this.selectedOccupantEid];
    const occupantLat = Position.y[this.selectedOccupantEid];

    // Check if positions are valid
    if (occupantLng === undefined || occupantLat === undefined) {
      return;
    }

    // Update position display
    this.occupantPositionEl.textContent = `${occupantLat.toFixed(6)}, ${occupantLng.toFixed(6)}`;
  }

  /**
   * Show NPC info panel with entity details and distance
   * @param entityId - Server entity ID (for possess button)
   * @param info - Entity info (contains client entity ID in entityId field)
   * @param distanceMeters - Initial distance
   * @param inRange - Whether NPC is in range
   */
  public showNpcPanel(entityId: number, info: EntityInfo, distanceMeters: number, inRange: boolean): void {
    if (!this.entityInfoPanel || !this.occupantPanel || !this.npcPanel || !this.buildingPanel) return;
    
    // Hide other panels
    this.occupantPanel.classList.add('hidden');
    this.buildingPanel.classList.add('hidden');
    
    // Show NPC panel
    this.npcPanel.classList.remove('hidden');
    this.entityInfoPanel.classList.remove('hidden');
    
    // Store selected NPC info for continuous distance updates
    this.selectedNpcClientEid = info.entityId; // Client entity ID from EntityInfo
    this.selectedNpcServerEid = entityId; // Server entity ID passed as parameter
    
    // Update NPC info
    if (this.npcIdEl) {
      this.npcIdEl.textContent = entityId.toString(); // Show server entity ID
    }
    
    if (this.npcPositionEl) {
      this.npcPositionEl.textContent = `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}`;
    }
    
    // Initial distance update
    this.updateNpcDistanceDisplay(distanceMeters, inRange);
  }

  /**
   * Update the distance display for the selected NPC
   * Called continuously while NPC panel is visible
   */
  private updateSelectedNpcDistance(): void {
    if (this.selectedNpcClientEid === null || !this.getPlayerEntityId) return;

    const playerEid = this.getPlayerEntityId();
    if (playerEid === null) return;

    // Read player position from ECS
    const playerLng = Position.x[playerEid];
    const playerLat = Position.y[playerEid];

    // Read NPC position from ECS
    const npcLng = Position.x[this.selectedNpcClientEid];
    const npcLat = Position.y[this.selectedNpcClientEid];

    // Check if positions are valid
    if (
      playerLng === undefined || playerLat === undefined ||
      npcLng === undefined || npcLat === undefined
    ) {
      return;
    }

    // Calculate distance
    const distanceMeters = calculateDistanceMeters(playerLng, playerLat, npcLng, npcLat);
    const inRange = distanceMeters <= GameStateConstants.POSSESSION_RANGE_METERS;

    // Update display
    this.updateNpcDistanceDisplay(distanceMeters, inRange);
  }

  /**
   * Update NPC distance display and possess button state
   */
  private updateNpcDistanceDisplay(distanceMeters: number, inRange: boolean): void {
    if (this.npcDistanceEl) {
      this.npcDistanceEl.textContent = `${distanceMeters.toFixed(2)} m`;
    }

    // Update position display (in case NPC moved)
    if (this.selectedNpcClientEid !== null && this.npcPositionEl) {
      const npcLng = Position.x[this.selectedNpcClientEid];
      const npcLat = Position.y[this.selectedNpcClientEid];
      if (npcLng !== undefined && npcLat !== undefined) {
        this.npcPositionEl.textContent = `${npcLat.toFixed(6)}, ${npcLng.toFixed(6)}`;
      }
    }

    // Enable/disable possess button based on range
    if (this.possessBtn && this.selectedNpcServerEid !== null) {
      this.possessBtn.disabled = !inRange;
      this.possessBtn.setAttribute('data-entity-id', this.selectedNpcServerEid.toString());
      
      if (inRange) {
        this.possessBtn.title = 'Click to possess this body';
      } else {
        this.possessBtn.title = 'Too far away - move closer to possess';
      }
    }
  }

  /**
   * Show building info panel with building details
   * @param info - Building info with name, type, height, and coordinates
   */
  public showBuildingPanel(info: BuildingInfo): void {
    if (!this.entityInfoPanel || !this.occupantPanel || !this.npcPanel || !this.buildingPanel) return;
    
    // Hide other panels
    this.occupantPanel.classList.add('hidden');
    this.npcPanel.classList.add('hidden');
    
    // Show building panel
    this.buildingPanel.classList.remove('hidden');
    this.entityInfoPanel.classList.remove('hidden');
    
    // Update building info
    if (this.buildingIdEl) {
      this.buildingIdEl.textContent = info.id || 'Unknown';
    }
    
    if (this.buildingNameEl) {
      this.buildingNameEl.textContent = info.name || 'Unknown';
    }
    
    if (this.buildingTypeEl) {
      this.buildingTypeEl.textContent = info.buildingType || 'Unknown';
    }
    
    if (this.buildingHeightEl) {
      if (info.height !== undefined) {
        this.buildingHeightEl.textContent = `${info.height.toFixed(1)} m`;
      } else {
        this.buildingHeightEl.textContent = 'Unknown';
      }
    }
    
    if (this.buildingCoordinatesEl) {
      this.buildingCoordinatesEl.textContent = `${info.centerLat.toFixed(6)}, ${info.centerLng.toFixed(6)}`;
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
    if (this.buildingPanel) {
      this.buildingPanel.classList.add('hidden');
    }
    
    // Clear selected NPC tracking
    this.selectedNpcClientEid = null;
    this.selectedNpcServerEid = null;
    
    // Clear selected occupant tracking
    this.selectedOccupantEid = null;
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
