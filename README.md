# Knight Bot — Pair Code + Bot Engine (Render-ready source)

This combined project contains the original Knightbot-MD command engine and the Pair Code website/API.

## Render deployment
1. Push this project root to a GitHub repository.
2. In Render, create a **Web Service** from that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Health check path: `/health`
6. Attach a persistent disk mounted at `/opt/render/project/src/sessions`.
7. Set `OWNER_NUMBER` to your WhatsApp owner number in international digits only if your commands require it.

The service URL will look like `https://your-service-name.onrender.com`. Open it to use the Pair Code page. The frontend calls `/pair?number=...` on the same service, so there is no separate URL to paste into the page.

## How pairing works
- Enter the WhatsApp number with country code, digits only.
- `/pair` starts an isolated child process for that number using the original bot engine.
- The child engine requests the WhatsApp pairing code and returns only the code to the website.
- Authentication is stored under `sessions/<number>/`.
- No `creds.json`, Session ID, or auth file is sent in a WhatsApp chat.
- The same child process continues running the actual Knightbot-MD commands after pairing.
- Previously registered bot workers are restored from `sessions/hosted-bots.json` when the web service restarts.

## Multi-bot notes
Each number gets its own Baileys session directory and its own Node worker process. The default worker cap is 10; configure `MAX_BOTS` only after sizing the Render instance. This is a practical multi-session host layout, but the original bot's JSON command settings and lightweight message store are still shared in the project data directory. It is not a hardened SaaS tenant boundary. Do not expose this publicly as a paid multi-tenant service without adding per-user data isolation, authentication, rate limits, and resource quotas.

## Hosting limitations
- Render free web services sleep after inactivity and have ephemeral filesystem storage. They are not suitable for reliable 24/7 WhatsApp sessions.
- Use a paid Render instance with a persistent disk for persistent sessions and always-on operation.
- Multiple WhatsApp workers consume RAM/CPU per connected number. Increase instance size as the number of bots grows.
- WhatsApp may disconnect or revoke linked sessions; reconnect behavior depends on Baileys/WhatsApp state.

## Local run
- Node.js 20+
- `npm install`
- `npm start`
- Open `http://localhost:10000`

## Existing bot-only run
`npm run start:engine` starts one bot using `./session` (or `BOT_SESSION_DIR` if set).
