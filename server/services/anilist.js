import { cached } from "../cache.js";

const ANILIST_API = "https://graphql.anilist.co";

const SEARCH_QUERY = `
  query ($search: String, $page: Int, $perPage: Int, $country: CountryCode) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: MANGA, countryOfOrigin: $country, sort: [POPULARITY_DESC]) {
        id
        title { romaji english native }
        description(asHtml: false)
        format
        countryOfOrigin
        status
        chapters
        volumes
        averageScore
        popularity
        coverImage { extraLarge large }
        genres
        startDate { year }
        staff(perPage: 4, sort: RELEVANCE) {
          edges { role node { name { full native } } }
        }
        siteUrl
      }
    }
  }
`;

export async function searchAniList({
  query = "",
  category = "",
  language = "es",
  limit = 20
}) {
  const country = countryForCategory(category);
  const cacheKey = `anilist:${query}:${category}:${language}:${limit}`;
  return cached(cacheKey, 30 * 60_000, async () => {
    const response = await fetch(ANILIST_API, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: {
          search: query || undefined,
          page: 1,
          perPage: Math.min(limit, 50),
          country
        }
      })
    });
    if (!response.ok) {
      const error = new Error("AniList no está disponible temporalmente.");
      error.status = 502;
      throw error;
    }
    const payload = await response.json();
    return (payload.data?.Page?.media || []).map((media) =>
      normalizeAniListMedia(media, language)
    );
  });
}

export async function getAniListBook(sourceId, language = "es") {
  const directQuery = `
    query ($id: Int) {
      Media(id: $id, type: MANGA) {
        id title { romaji english native } description(asHtml: false)
        format countryOfOrigin status chapters volumes averageScore popularity
        coverImage { extraLarge large } genres startDate { year }
        staff(perPage: 4, sort: RELEVANCE) {
          edges { role node { name { full native } } }
        }
        siteUrl
      }
    }
  `;
  const response = await fetch(ANILIST_API, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: directQuery, variables: { id: Number(sourceId) } })
  });
  if (!response.ok) {
    const error = new Error("No se pudo cargar la publicación desde AniList.");
    error.status = 502;
    throw error;
  }
  const payload = await response.json();
  if (!payload.data?.Media) {
    const error = new Error("Publicación no encontrada en AniList.");
    error.status = 404;
    throw error;
  }
  return normalizeAniListMedia(payload.data.Media, language);
}

function normalizeAniListMedia(media, language) {
  const authorEdge = media.staff?.edges?.find((edge) =>
    /story|original creator|manga/i.test(edge.role || "")
  ) || media.staff?.edges?.[0];
  return {
    source: "anilist",
    sourceId: String(media.id),
    title: preferredTitle(media.title, language),
    originalTitle: media.title?.native || null,
    author: authorEdge?.node?.name?.full || authorEdge?.node?.name?.native || "Autor desconocido",
    year: media.startDate?.year || new Date().getFullYear(),
    pages: media.chapters || media.volumes || 1,
    rating: Number(media.averageScore || 0) / 20,
    ratingsCount: Number(media.popularity || 0),
    readersCount: Number(media.popularity || 0),
    cover: media.coverImage?.extraLarge || media.coverImage?.large || "/covers/fallback.svg",
    categories: [...new Set([formatLabel(media), ...(media.genres || [])])].slice(0, 8),
    synopsis: stripHtml(media.description) || "Sinopsis no disponible.",
    language: media.countryOfOrigin || null,
    previewUrl: media.siteUrl || null,
    externalUrl: media.siteUrl || null,
    format: formatLabel(media)
  };
}

function preferredTitle(title, language) {
  if (language === "en") return title?.english || title?.romaji || title?.native;
  return title?.english || title?.romaji || title?.native || "Sin título";
}

function formatLabel(media) {
  if (media.format === "NOVEL") return "Novela ligera";
  if (media.countryOfOrigin === "KR") return "Manhwa";
  if (media.countryOfOrigin === "CN" || media.countryOfOrigin === "TW") return "Manhua";
  return "Manga";
}

function countryForCategory(category) {
  if (category === "Manhwa" || category === "Webtoon") return "KR";
  if (category === "Manhua") return "CN";
  if (category === "Manga" || category === "Novela ligera") return "JP";
  return undefined;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .trim()
    .slice(0, 5000);
}
