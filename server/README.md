# RealEarthStreetWar Server

Server-side implementation for the RealEarthStreetWar game.

## Setup

1. Install dependencies:
```bash
cd server
npm install
```

## Development

Run the server in development mode (with hot reload):
```bash
npm run dev
```

The server will start on port 8080 by default (or the port specified in the `PORT` environment variable).

## Production

Build the server:
```bash
npm run build
```

Run the compiled server:
```bash
npm start
```

## Architecture

- **GameWorld**: Authoritative game state and ECS world
- **ServerGameLoop**: Fixed-timestep game loop running at 60Hz
- **WebSocketServer**: Handles client connections and message routing
- **PlayerManager**: Manages connected players

## Environment Variables

- `PORT`: Server port (default: 8080)

## WebSocket Protocol

See `src/network/types.ts` for message type definitions.

### Client → Server Messages
- `input`: Player input state
- `spawn_npc`: Request to spawn NPCs
- `place_hq`: Request to place headquarters
- `ping`: Ping for latency measurement

### Server → Client Messages
- `state_snapshot`: Current game state (sent at 20Hz)
- `player_joined`: Notification of player joining
- `player_left`: Notification of player leaving
- `pong`: Response to ping
- `error`: Error message

