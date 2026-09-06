# Highway KP data model

This directory defines the compatibility model used while the existing viewer
is migrated to a network/segment/KP-system architecture.

The browser continues to consume the existing `road.json`, `route.geojson` and
`route-scopes.json` files. `lib/dataCompiler.mjs` reads those files, normalizes
their different position representations and validates cross-file references
before a build is published.

## Normalized position

Every KP position is represented internally as:

```json
{
  "section": "joban",
  "kp": 69.1
}
```

For a single-section route, `section` is `null`. This is the compatibility
form that will later support named KP systems such as north/south KP without
changing the current viewer in one step.

## Migration rule

Source data is migrated incrementally. Until a route has moved to the new
source model, the compiler treats its current files as authoritative and does
not rewrite them.

Management scopes are already migrated. `data/facility-registry.json` assigns
stable IDs to boundary facilities, and `data/scope-definitions.json` refers only
to those IDs. The compiler resolves each registered facility's current name,
section and KP and emits the legacy `route-scopes.json` into `dist/`. Changing
a facility name or KP therefore requires one registry/source edit and does not
break its consumers.

E4 is the first route migrated to split source files under `data-source/e4/`:

- `metadata.json` — identity and data status
- `network.json` — length and endpoints
- `facilities.json` — IC/JCT/SA/PA data
- `structures.json` — bridges and tunnels

The build, local API and R2 workflow compile these files back into the existing
`road.json` contract. Other routes continue to fall back to their current
`data/<route>/road.json` until they are migrated.

To migrate another route without changing runtime behavior:

```powershell
npm run migrate:road-source -- e17
npm run validate:data
npm run build
```

The migration command refuses to overwrite an existing split source. Once a
`data-source/<route>/` directory exists, all four files are mandatory. A
partial migration fails instead of silently falling back to the legacy file.
The legacy `data/<route>/road.json` remains during this transition as a
compatibility reference, while generated builds consume the split source.
The migration also recompiles the new files and requires semantic equality
with the legacy object before reporting success.
