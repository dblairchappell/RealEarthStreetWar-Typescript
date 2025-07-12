export enum CommandType {
  SpawnNpc = 1,
  DestroyEntity = 2,
  SetVelocity = 3,
}

// Each command occupies four 32-bit slots in the ring buffer.
// Slot 0: cmd type (int)
// Slot 1-3: payload interpreted per command.
export interface Command {
  type: CommandType;
  a?: number;
  b?: number;
  c?: number;
} 