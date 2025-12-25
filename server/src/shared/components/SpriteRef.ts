import { defineComponent, Types } from 'bitecs';

// SpriteRef stores an integer handle that the render layer uses to pick the
// correct sprite / texture atlas region for this entity. 0 is treated as the
// default placeholder (red square).
export const SpriteRef = defineComponent({ id: Types.ui16 });

