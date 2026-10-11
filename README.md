# Oxy Controller v0.4.13

Oxy Controller is a Discord management bot built around Oxford Response communities.

## Included systems

Moderation, staff management, shift tracking, tickets, applications, suggestions, giveaways, reaction roles, AutoMod, music, Roblox linking, Oxford Response controls, server templates and website integration.

## Configuration

Use `/settings` as the main server configuration area. Existing server settings are preserved when new options are added.

## Upgrade notes

Keep your existing server data and deployment configuration when replacing the application files with a newer release.


## Oxy Controller v5.0

Version 5.0 introduces the hosted template platform foundation. Template records now support creator slugs, public/private state, private template limits, hosted template paths, and persistent version changelogs. Existing template records are migrated into version history on startup. The web dashboard remains outside the v5 scope and is reserved for the full launch.

## v5 Template Layout Downloads

Public hosted templates expose a download endpoint at:
`/v1/website/template/{creator}/{id}/download`

The endpoint returns a plain text server layout containing roles, channels, categories, channel types, topics and supported settings.

Private templates are owner-only. `/templates download <id>` verifies ownership, generates the same versioned `.txt` layout and DMs the file to the template owner instead of exposing it publicly.


## Per-server dashboard

The dashboard at `/dashboard/` includes server-specific overview, Oxford Response live status/player views, moderation history, AutoMod configuration, and server settings. Discord OAuth permissions are checked on every per-server endpoint. See `dashboard/README.md`.


## Music playback

Music search is configured for Lavalink's native SoundCloud source. Enter a song/artist search or a public SoundCloud track/playlist URL in `/music`. This configuration does not require YouTube OAuth, Spotify credentials, or LavaSrc. Lavalink must be able to reach SoundCloud from the VPS. Playback availability can still vary by track, region, or SoundCloud restrictions.
