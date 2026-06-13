import { randomBytes } from "node:crypto";
import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { encryptSecret, hashOauthState } from "../integration-security.js";

const SPOTIFY_AUTHORIZE = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";

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
    const connection = await pool.query(
      "SELECT 1 FROM spotify_connections WHERE user_id = $1",
      [request.user.id]
    );
    response.json({
      spotify: {
        configured: spotifyConfigured(config),
        connected: connection.rowCount === 1
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
    url.searchParams.set("scope", "user-read-playback-state user-modify-playback-state");
    response.redirect(url);
  }));

  router.delete("/spotify", asyncHandler(async (request, response) => {
    await pool.query("DELETE FROM spotify_connections WHERE user_id = $1", [request.user.id]);
    response.status(204).end();
  }));

  return router;
}
