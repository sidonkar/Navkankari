# Navkankari

Navkankari is now a full-stack web app with:

- persistent accounts and guest mode
- live invitations and open-pool matchmaking
- realtime gameplay updates over sockets
- save and restore support
- rankings, leaderboard, wins, losses, and one-live-game enforcement
- Render-ready PostgreSQL persistence
- production build output with minification and JavaScript obfuscation
- a deploy-safe server bundle that is minified by default

## Environment

Use [.env.example](C:\Users\sidon\OneDrive\Documents\Navkankari\.env.example) as the template for your environment values.

Required:

- `DATABASE_URL`: PostgreSQL connection string
- `NAVKANKARI_SECRET`: long random secret used to sign auth tokens

Optional:

- `PORT`: local server port, defaults to `3000`
- `DATABASE_SSL_DISABLE`: set to `1` only if your local Postgres does not use SSL
- `MIGRATE_JSON_ON_BOOT`: set to `1` to import the old `data/store.json` once if the database is empty

## Local development

1. Open a terminal in `C:\Users\sidon\OneDrive\Documents\Navkankari`
2. Install dependencies:

```powershell
npm install
```

3. Make sure Postgres is running and `DATABASE_URL` is set.
4. Start the app in development mode:

```powershell
npm run dev
```

5. Open:

`http://localhost:3000`

6. For multiplayer testing on one machine:

- open two browser windows or an incognito window
- register two different accounts
- invite between them or join the open pool from both

## Production-style local deployment

1. Build the app:

```powershell
npm run build
```

2. Make sure `DATABASE_URL` and `NAVKANKARI_SECRET` are set.
3. Start the built server:

```powershell
npm start
```

4. Open:

`http://localhost:3000`

The build command creates:

- `dist/public/assets/app.js`
- `dist/public/assets/styles.css`
- `dist/server/app.cjs`

## Persistence

- Account data, rankings, invites, queue state, and games are now stored in PostgreSQL
- On first boot, if the database is empty and `MIGRATE_JSON_ON_BOOT=1`, the app imports the old `data/store.json`
- After migration, Postgres becomes the source of truth

## Render deployment

This repo includes [render.yaml](C:\Users\sidon\OneDrive\Documents\Navkankari\render.yaml) for Render Blueprint deployment.

Recommended setup:

1. Push this repo to GitHub.
2. In Render, create a Blueprint deploy from the repo.
3. Let Render create:
   - the web service
   - the managed Postgres database
4. Confirm these env vars exist:
   - `DATABASE_URL`
   - `NAVKANKARI_SECRET`
5. Deploy.

Build/start commands used on Render:

```text
Build: npm install && npm run build
Start: npm start
```

## Notes on obfuscation

- The production build minifies both client and server bundles
- The client bundle is additionally obfuscated aggressively
- The server bundle is left minified by default because aggressive server obfuscation can break runtime behavior and does not materially improve security on a hosted server
- If you still want server obfuscation for distribution experiments, run:

```powershell
$env:OBFUSCATE_SERVER="1"
npm run build
```

- Obfuscation raises the cost of reverse engineering, but it is not a replacement for real security controls

## Main files

- `server/app.js`: Express + Socket.IO backend
- `server/db.js`: PostgreSQL persistence and migration layer
- `src/shared/game-rules.js`: shared Navkankari rules engine
- `src/client/app.js`: client UI and realtime interaction layer
- `src/client/styles.css`: game UI styling
- `scripts/build.mjs`: minification and obfuscation build pipeline
