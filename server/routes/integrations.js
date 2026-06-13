import { randomBytes } from "node:crypto";
import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { spotifySearchSchema, validate } from "../validation.js";
import {
  decryptSecret,
  encryptSecret,
  hashOauthState
} from "../integration-security.js";

const SPOTIFY_AUTHORIZE = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";

function spotifyConfigured(config) {
  return Boolean(
    config.spotifyClientId &&
    config.spotifyClientSecret &&
    config.integrationEncryptionKey
  );
}

export function createIntegrationsRouter({ pool, config }) {
  const router = Router();

  router.get("/spotify/callback", asyncHandler(async (request, response) => {
    if (!spotifyConfigured(config)) return response.redirect("/?spotify=not-configured");
    const stateHash = hashOauthState(String(request.query.state || ""));
    const stateResult = await pool.query(
      `DELETE FROM oauth_states
       WHERE state_hash = $1 AND provider = 'spotify' AND expires_at > NOW()
       RETURNING user_id`,
      [stateHash]
    );
    if (stateResult.rowCount !== 1 || !request.query.code) {
      return response.redirect("/?spotify=invalid-state");
    }

    const credentials = Buffer
      .from(`${config.spotifyClientId}:${config.spotifyClientSecret}`)
      .toString("base64");
    const tokenResponse = await fetch(SPOTIFY_TOKEN, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(request.query.code),
        redirect_uri: config.spotifyRedirectUri
      })
    });
    if (!tokenResponse.ok) return response.redirect("/?spotify=token-error");
    const tokens = await tokenResponse.json();
    await pool.query(
      `INSERT INTO spotify_connections
        (user_id, access_token_encrypted, refresh_token_encrypted, expires_at, scope)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'), $5)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = COALESCE(
           EXCLUDED.refresh_token_encrypted,
           spotify_connections.refresh_token_encrypted
         ),
         expires_at = EXCLUDED.expires_at, scope = EXCLUDED.scope, updated_at = NOW()`,
      [
        stateResult.rows[0].user_id,
        encryptSecret(tokens.access_token, config.integrationEncryptionKey),
        tokens.refresh_token
          ? encryptSecret(tokens.refresh_token, config.integrationEncryptionKey)
          : null,
        tokens.expires_in,
        tokens.scope || ""
      ]
    );
    return response.redirect(`${config.appOrigin}/?spotify=connected`);
  }));

  router.use(requireAuth(pool));

  router.get("/status", asyncHandler(async (request, response) => {
    const [connection, profile] = await Promise.all([
      pool.query(
        "SELECT 1 FROM spotify_connections WHERE user_id = $1",
        [request.user.id]
      ),
      pool.query(
        "SELECT spotify_playlist_url FROM users WHERE id = $1",
        [request.user.id]
      )
    ]);
    response.json({
      spotify: {
        configured: spotifyConfigured(config),
        connected: connection.rowCount === 1,
        playlistUrl: profile.rows[0]?.spotify_playlist_url || null
      },
      readingProviders: {
        progressSyncAvailable: false,
        message: "Kindle y Apple Books no ofrecen una API pública de progreso personal."
      }
    });
  }));

  router.get("/spotify/connect", asyncHandler(async (request, response) => {
    if (!spotifyConfigured(config)) {
      return response.status(503).json({
        error: "Spotify OAuth aún no está configurado en el servidor."
      });
    }
    const state = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO oauth_states (state_hash, user_id, provider, expires_at)
       VALUES ($1, $2, 'spotify', NOW() + INTERVAL '10 minutes')`,
      [hashOauthState(state), request.user.id]
    );
    const url = new URL(SPOTIFY_AUTHORIZE);
    url.searchParams.set("client_id", config.spotifyClientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", config.spotifyRedirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set(
      "scope",
      "playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state"
    );
    response.redirect(url);
  }));

  router.get("/spotify/playlists", asyncHandler(async (request, response) => {
    const accessToken = await getSpotifyAccessToken(pool, config, request.user.id);
    if (!accessToken) {
      return response.status(409).json({ error: "Conecta tu cuenta de Spotify primero." });
    }
    const spotifyResponse = await fetch(`${SPOTIFY_API}/me/playlists?limit=50`, {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!spotifyResponse.ok) {
      return response.status(502).json({
        error: "Spotify no pudo devolver tus playlists en este momento."
      });
    }
    const payload = await spotifyResponse.json();
    response.json({
      playlists: (payload.items || []).map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        owner: playlist.owner?.display_name || "",
        image: playlist.images?.[0]?.url || null,
        url: playlist.external_urls?.spotify || null
      }))
    });
  }));

  router.get("/spotify/search", asyncHandler(async (request, response) => {
    const input = validate(spotifySearchSchema, request.query);
    const accessToken = await getSpotifyAccessToken(pool, config, request.user.id);
    if (!accessToken) {
      return response.status(409).json({ error: "Conecta tu cuenta de Spotify primero." });
    }
    const url = new URL(`${SPOTIFY_API}/search`);
    url.searchParams.set("q", input.q);
    url.searchParams.set("type", input.type);
    url.searchParams.set("limit", "10");
    const spotifyResponse = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!spotifyResponse.ok) {
      return response.status(502).json({ error: "Spotify no pudo completar la búsqueda." });
    }
    const payload = await spotifyResponse.json();
    const items = input.type === "track"
      ? payload.tracks?.items || []
      : payload.playlists?.items || [];
    response.json({
      items: items.filter(Boolean).map((item) => ({
        id: item.id,
        type: input.type,
        name: item.name,
        subtitle: input.type === "track"
          ? (item.artists || []).map((artist) => artist.name).join(", ")
          : item.owner?.display_name || "",
        image: input.type === "track"
          ? item.album?.images?.[0]?.url || null
          : item.images?.[0]?.url || null,
        url: item.external_urls?.spotify || null
      }))
    });
  }));

  router.delete("/spotify", asyncHandler(async (request, response) => {
    await pool.query("DELETE FROM spotify_connections WHERE user_id = $1", [request.user.id]);
    response.status(204).end();
  }));

  return router;
}

async function getSpotifyAccessToken(pool, config, userId) {
  const result = await pool.query(
    `SELECT access_token_encrypted, refresh_token_encrypted, expires_at
     FROM spotify_connections WHERE user_id = $1`,
    [userId]
  );
  if (!result.rowCount) return null;
  const connection = result.rows[0];
  if (new Date(connection.expires_at).getTime() > Date.now() + 30_000) {
    return decryptSecret(connection.access_token_encrypted, config.integrationEncryptionKey);
  }
  if (!connection.refresh_token_encrypted) return null;
  const credentials = Buffer
    .from(`${config.spotifyClientId}:${config.spotifyClientSecret}`)
    .toString("base64");
  const tokenResponse = await fetch(SPOTIFY_TOKEN, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptSecret(
        connection.refresh_token_encrypted,
        config.integrationEncryptionKey
      )
    })
  });
  if (!tokenResponse.ok) return null;
  const tokens = await tokenResponse.json();
  await pool.query(
    `UPDATE spotify_connections
     SET access_token_encrypted = $1,
         expires_at = NOW() + ($2 * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE user_id = $3`,
    [
      encryptSecret(tokens.access_token, config.integrationEncryptionKey),
      tokens.expires_in,
      userId
    ]
  );
  return tokens.access_token;
}
