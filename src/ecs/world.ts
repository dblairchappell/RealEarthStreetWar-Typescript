import { addComponent, addEntity, createWorld, defineComponent, Types } from 'bitecs';
import { SpriteRef } from './components/SpriteRef';

export const Position = defineComponent({ x: Types.f64, y: Types.f64 }); // x = lng, y = lat
export const Rotation = defineComponent({ angle: Types.f32 });           // degrees
export const Velocity = defineComponent({ x: Types.f64, y: Types.f64 }); // units/second in degrees
export const PlayerTag = defineComponent();

export const world = createWorld();

export function createPlayerEntity(lng: number, lat: number, rotationDeg: number): number {
  const eid = addEntity(world);
  addComponent(world, Position, eid);
  addComponent(world, Rotation, eid);
  addComponent(world, Velocity, eid);
  addComponent(world, PlayerTag, eid);
  addComponent(world, SpriteRef, eid);

  Position.x[eid] = lng;
  Position.y[eid] = lat;
  Rotation.angle[eid] = rotationDeg;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  SpriteRef.id[eid] = 0; // default sprite (player handled separately later)
  return eid;
} 