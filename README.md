# Sandbox

A physics-first 2D superhero sandbox prototype.

## Current vertical slice

- Tony ragdoll built from multiple rigid bodies and joints
- Mark 50 nanotech suit-up / retract animation
- Per-body-part armor integrity and exposed-body damage
- Repulsors, Unibeam, nano blade, shield, battering ram, cluster cannon and flight boost
- Breakable floor/wall tiles with debris and impact thresholds
- Explosive barrels, crates, concrete blocks and test dummies
- Drag / grab interaction
- Pause, slow motion, reset
- Desktop keyboard + mouse and mobile touch controls
- Nano reserve consumption and regeneration behavior

## Run

This is a static browser game. Serve the repository with any static server.

Example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Controls

- Drag: grab physical objects
- A / D: apply lateral force to Tony
- W: jump / thrust
- F: toggle flight assist
- E: suit up / retract
- Q: cycle Mark 50 weapon mode
- Hold pointer / SPACE: fire current weapon
- 1..7: choose weapon directly
- P: pause
- T: slow motion
- R: reset scene

Mobile controls are shown automatically on touch devices.

## Notes

This is an original fan-made implementation. It does not include ripped game/movie assets. Visuals are procedurally rendered in Canvas and the physics sandbox is independently implemented with Matter.js.
