const { LavalinkManager } = require('lavalink-client');

const NODE_ID = 'oxy-lavalink';
let manager = null;
let boundDiscordClient = null;

function node() {
  return manager?.nodeManager?.nodes?.get?.(NODE_ID) || null;
}

function getPlayer(guildId) {
  return manager?.getPlayer?.(String(guildId)) || null;
}

function trackTitle(track) {
  return track?.info?.title || track?.title || 'Unknown track';
}

function trackAuthor(track) {
  return track?.info?.author || track?.author || 'Unknown artist';
}

function trackDuration(track) {
  return Number(track?.info?.length || track?.duration || 0);
}

function state(guildId) {
  const player = getPlayer(guildId);
  if (!player) return null;
  return {
    player,
    current: player.queue?.current || null,
    tracks: Array.isArray(player.queue?.tracks) ? player.queue.tracks : [],
    previous: Array.isArray(player.queue?.previous) ? player.queue.previous : [],
    playing: Boolean(player.playing),
    paused: Boolean(player.paused),
    volume: Number(player.volume ?? player.lavalinkVolume ?? 100),
    repeatMode: player.repeatMode || 'off',
    position: Number(player.position || player.lastPosition || 0),
    node: player.node?.id || NODE_ID,
    voiceChannelId: player.voiceChannelId || null,
    textChannelId: player.textChannelId || null
  };
}

async function init(discordClient) {
  if (manager) return manager;
  boundDiscordClient = discordClient;

  manager = new LavalinkManager({
    nodes: [{
      id: NODE_ID,
      host: process.env.LAVALINK_HOST || 'lavalink',
      port: Number(process.env.LAVALINK_PORT || 2333),
      authorization: process.env.LAVALINK_PASSWORD || 'oxy-lavalink-local',
      secure: String(process.env.LAVALINK_SECURE || 'false') === 'true',
      retryAmount: 10,
      retryDelay: 5000
    }],
    sendToShard: (guildId, payload) => {
      const guild = discordClient.guilds.cache.get(String(guildId));
      if (guild?.shard) guild.shard.send(payload);
    },
    autoSkip: true,
    client: {
      id: discordClient.user.id,
      username: discordClient.user.username
    },
    playerOptions: {
      defaultSearchPlatform: 'ytsearch',
      applyVolumeAsFilter: false,
      onDisconnect: {
        autoReconnect: true,
        destroyPlayer: false
      },
      onEmptyQueue: {
        destroyAfterMs: 30_000
      },
      useUnresolvedData: true
    },
    advancedOptions: {
      debugOptions: {
        noAudio: false,
        playerDestroy: { dontThrowError: true, debugLog: false }
      }
    }
  });

  discordClient.on('raw', packet => {
    try {
      manager.sendRawData(packet);
    } catch (error) {
      console.error('[Music] Voice forwarding error:', error.message);
    }
  });

  manager.nodeManager.on('connect', node => {
    console.log(`[Music] Lavalink connected: ${node.id}`);
  });
  manager.nodeManager.on('disconnect', (node, reason) => {
    console.warn(`[Music] Lavalink disconnected: ${node.id} ${reason || ''}`);
  });
  manager.nodeManager.on('reconnecting', node => {
    console.warn(`[Music] Lavalink reconnecting: ${node.id}`);
  });
  manager.nodeManager.on('error', (node, error) => {
    console.error(`[Music] Lavalink error: ${node.id}: ${error?.stack || error}`);
  });

  manager.on('trackStart', (player, track) => {
    console.log(`[Music] Playing in ${player.guildId}: ${trackTitle(track)} — ${trackAuthor(track)}`);
  });
  manager.on('trackEnd', (player, track) => {
    console.log(`[Music] Track ended in ${player.guildId}: ${trackTitle(track)}`);
  });
  manager.on('trackStuck', (player, track, payload) => {
    console.error(`[Music] Track stuck in ${player.guildId}: ${trackTitle(track)}`, payload);
  });
  manager.on('trackError', (player, track, payload) => {
    console.error(`[Music] Track error in ${player.guildId}: ${trackTitle(track)}`, payload);
  });
  manager.on('queueEnd', player => {
    console.log(`[Music] Queue ended in ${player.guildId}`);
  });

  await manager.init({ ...discordClient.user });
  return manager;
}

async function requirePlayer(interaction) {
  const p = getPlayer(interaction.guildId);
  if (!p) throw new Error('Nothing is currently playing.');
  return p;
}

async function ensurePlayer(interaction) {
  const voice = interaction.member?.voice?.channel;
  if (!voice) throw new Error('Join a voice channel first.');
  if (!manager) await init(interaction.client);

  const n = node();
  if (!n) throw new Error('Lavalink node is not available.');
  if (!n.connected) throw new Error('Lavalink is still connecting. Try again in a few seconds.');

  let player = getPlayer(interaction.guildId);
  if (!player) {
    player = manager.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voice.id,
      textChannelId: interaction.channelId,
      node: n,
      selfDeaf: true,
      volume: Number(process.env.MUSIC_DEFAULT_VOLUME || 75)
    });
  } else if (player.voiceChannelId && player.voiceChannelId !== voice.id) {
    throw new Error(`I am already connected to <#${player.voiceChannelId}>.`);
  }

  if (!player.connected) await player.connect();
  return player;
}

async function play(interaction, query) {
  const player = await ensurePlayer(interaction);
  const input = String(query || '').trim();
  if (!input) throw new Error('Enter a song, artist, or URL.');

  const n = node();
  if (!n?.connected) throw new Error('Lavalink is not connected.');
  const isSpotifyUrl = /^https?:\/\/(?:open\.)?spotify\.com\//i.test(input);
  const searchQuery = isSpotifyUrl || /^https?:\/\//i.test(input) ? input : `ytsearch:${input}`;
  const result = await n.search({ query: searchQuery }, interaction.user, true);
  if (!result?.tracks?.length && !result?.playlist?.tracks?.length) throw new Error('No playable track found.');

  const tracks = result.playlist?.tracks?.length ? result.playlist.tracks : result.tracks.slice(0, 1);
  const maxQueue = Math.max(1, Number(process.env.MUSIC_MAX_QUEUE || 100));
  const available = Math.max(0, maxQueue - player.queue.tracks.length);
  if (!available) throw new Error(`The queue is full (${maxQueue} tracks).`);

  player.queue.add(tracks.slice(0, Math.max(1, available)));
  if (!player.playing && !player.paused) await player.play();

  const added = Math.min(tracks.length, Math.max(1, available));
  return {
    track: tracks[0],
    tracks,
    added,
    playlist: result.playlist ? {
      name: result.playlist.name || result.playlist.title || null,
      author: result.playlist.author || null,
      total: result.playlist.tracks?.length || tracks.length
    } : null
  };
}

async function join(interaction) {
  await ensurePlayer(interaction);
}

async function leave(interaction) {
  const p = getPlayer(interaction.guildId);
  if (!p) return false;
  await p.destroy();
  return true;
}

async function pause(interaction) { await (await requirePlayer(interaction)).pause(); }
async function resume(interaction) { await (await requirePlayer(interaction)).resume(); }
async function skip(interaction) { await (await requirePlayer(interaction)).skip(0, false); }
async function stop(interaction) { await (await requirePlayer(interaction)).stopPlaying(true, false); }
async function setVolume(interaction, level) { await (await requirePlayer(interaction)).setVolume(Number(level), true); }
async function seek(interaction, ms) { await (await requirePlayer(interaction)).seek(Number(ms)); }
async function setLoop(interaction, mode) { await (await requirePlayer(interaction)).setRepeatMode(mode); }
async function shuffle(interaction) { await (await requirePlayer(interaction)).queue.shuffle(); }
async function clearQueue(interaction) {
  const player = await requirePlayer(interaction);
  const count = Array.isArray(player.queue?.tracks) ? player.queue.tracks.length : 0;
  if (count) await player.queue.splice(0, count);
}
async function removeAt(interaction, position) { return (await requirePlayer(interaction)).queue.remove(Number(position) - 1); }
async function previous(interaction) {
  const player = await requirePlayer(interaction);
  const previousTrack = await player.queue.shiftPrevious();
  if (!previousTrack) throw new Error('There is no previous track.');
  await player.play({ clientTrack: previousTrack });
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function snapshot(guildId) {
  const s = state(guildId);
  if (!s) return null;
  return {
    playing: s.playing,
    paused: s.paused,
    volume: s.volume,
    repeatMode: s.repeatMode,
    position: s.position,
    current: s.current ? {
      title: trackTitle(s.current),
      author: trackAuthor(s.current),
      duration: trackDuration(s.current),
      durationText: formatDuration(trackDuration(s.current)),
      uri: s.current?.info?.uri || null
    } : null,
    queue: s.tracks.map((track, index) => ({
      position: index + 1,
      title: trackTitle(track),
      author: trackAuthor(track),
      duration: trackDuration(track)
    })),
    previous: s.previous.map(track => ({ title: trackTitle(track), author: trackAuthor(track) })),
    voiceChannelId: s.voiceChannelId,
    textChannelId: s.textChannelId,
    node: s.node
  };
}

module.exports = {
  init,
  getPlayer,
  state,
  snapshot,
  play,
  join,
  leave,
  pause,
  resume,
  skip,
  stop,
  setVolume,
  seek,
  setLoop,
  shuffle,
  clearQueue,
  removeAt,
  previous,
  formatDuration
};
