-- Visual-only car loadout per player (body, paint, rims, tyres, stickers).
-- Validated by the API against the shared cosmetics schema; never affects gameplay.
ALTER TABLE players ADD COLUMN cosmetics jsonb;
