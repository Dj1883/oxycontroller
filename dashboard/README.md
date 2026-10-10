# Oxy Controller Per-Server Dashboard

Sign in with Discord at `/dashboard/` and choose a server where your account has Manage Server, Administrator, or ownership permissions.

## Server pages

- **Overview:** per-server Oxford Response configuration status, active Oxy-tracked staff shifts, AutoMod state, and recent moderation cases.
- **Oxford Response:** live server status and current players using the server's saved Oxford Response key.
- **Moderation:** recent moderation cases recorded by Oxy for the selected server.
- **AutoMod:** per-server toggles for detection modules, protection settings, thresholds, and escalation.
- **Settings:** save or remove the Oxford Response server key and configure the Oxy admin role.
- **Developer:** owner-only bot-wide summary.

## Security notes

Every per-server API endpoint validates the selected guild against the signed-in user's Discord OAuth guild list and their Discord permissions. Oxford Response keys are never returned to the browser and are stored using Oxy's existing encrypted secret storage. The dashboard never executes Oxford Response commands directly.

## Configuration

Configure Discord OAuth using `DASHBOARD_CLIENT_ID`, `DASHBOARD_CLIENT_SECRET`, and `DASHBOARD_REDIRECT_URI`. Ensure `ENCRYPTION_KEY` is set and kept stable before saving Oxford Response keys. See `.env.example` and the root README for deployment details.
