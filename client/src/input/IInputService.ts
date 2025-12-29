import { InputState, InputCallbacks } from '@shared/realearthstreetwar';

export interface IInputService {
  /**
   * Register an additional observer for input events. The same function
   * references should be supplied to `removeCallbacks` when you no longer
   * need them.
   */
  addCallbacks(callbacks: InputCallbacks): void;

  /**
   * Remove a previously-added observer. Safe to call even if the callbacks
   * were not registered.
   */
  removeCallbacks(callbacks: InputCallbacks): void;

  /**
   * Convenience helper that clears existing observers and adds the supplied
   * one.  Useful when you only need a single listener (legacy API).
   */
  setCallbacks(callbacks: InputCallbacks): void;

  /** Snapshot of current input state */
  getInputState(): InputState;

  /** Clean up any global listeners */
  destroy(): void;
} 