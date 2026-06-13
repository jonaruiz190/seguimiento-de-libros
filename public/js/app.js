const state = {
  user: null,
  books: [],
  tracking: [],
  dashboard: null,
  integrations: null,
  category: "Todos",
  trackingSearch: "",
  statusFilter: "all"
};

const spotifyEmbedUrl = "https://open.spotify.com/embed/playlist/37i9dQZF1DWZwtERXCS82H?utm_source=generator";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();

  try {
    const session = await api("/api/auth/me", { allowUnauthorized: true });
    if (session) await enterApp(session.user);
  } catch (error) {
    $("#login-error").textContent = "No se pudo conectar con el servidor.";
    console.error(error);
  }
}

function bindEvents() {
  $("#login-form").addEventListener("submit", handleLogin);
  $("#register-form").addEventListener("submit", handleRegister);
  $("#open-register-button").addEventListener("click", openRegisterModal);
  $("#logout-button").addEventListener("click", logout);
  $("#profile-button").addEventListener("click", openProfileModal);
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#user-button").addEventListener("click", toggleUserMenu);
  $("#user-avatar-image").addEventListener("error", () => {
    $("#user-avatar-image").classList.add("is-hidden");
    $("#user-avatar-initial").classList.remove("is-hidden");
  });
  $("#hero-catalog-form").addEventListener("submit", searchHeroCatalog);
  $("#tracking-search").addEventListener("input", (event) => {
    state.trackingSearch = event.target.value.trim().toLowerCase();
    renderTracking();
  });
  $("#status-filter").addEventListener("change", (event) => {
    state.statusFilter = event.target.value;
    renderTracking();
  });
  $("#add-book-button").addEventListener("click", () => openTrackingModal());
  $("#catalog-button").addEventListener("click", openCatalogModal);
  $("#catalog-search-form").addEventListener("submit", searchCatalog);
  $("#spotify-button").addEventListener("click", toggleSpotifyPanel);
  $("#close-spotify").addEventListener("click", closeSpotifyPanel);
  $("#spotify-connect").addEventListener("click", connectSpotify);
  $("#tracking-form").addEventListener("submit", saveTracking);
  $("#tracking-status").addEventListener("change", applyDateDefaults);
  $("#refresh-dashboard").addEventListener("click", () => loadDashboard(true));

  $$("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  $("[data-view-link]").addEventListener("click", (event) => {
    event.preventDefault();
    showView("home");
  });

  $$("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", closeBookModal);
  });
  $$("[data-close-tracking]").forEach((element) => {
    element.addEventListener("click", closeTrackingModal);
  });
  $$("[data-close-register]").forEach((element) => {
    element.addEventListener("click", closeRegisterModal);
  });
  $$("[data-close-profile]").forEach((element) => {
    element.addEventListener("click", closeProfileModal);
  });
  $$("[data-close-catalog]").forEach((element) => {
    element.addEventListener("click", closeCatalogModal);
  });
  $$("input[name='preference']").forEach((checkbox) => {
    checkbox.addEventListener("change", enforcePreferenceLimit);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeBookModal();
      closeTrackingModal();
      closeRegisterModal();
      closeProfileModal();
      closeCatalogModal();
      closeSpotifyPanel();
    }
  });
}

async function api(url, options = {}) {
  const { allowUnauthorized = false, ...fetchOptions } = options;
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
      ...fetchOptions.headers
    },
    ...fetchOptions
  });

  if (allowUnauthorized && response.status === 401) return null;
  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "La solicitud no pudo completarse.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function handleRegister(event) {
  event.preventDefault();
  const errorElement = $("#register-error");
  const submitButton = $("#register-form button[type='submit']");
  const preferences = $$("input[name='preference']:checked").map((input) => input.value);
  errorElement.textContent = "";
  submitButton.disabled = true;

  try {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: $("#register-name").value.trim(),
        email: $("#register-email").value.trim(),
        password: $("#register-password").value,
        preferences
      })
    });
    closeRegisterModal();
    await enterApp(result.user);
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
}

function openRegisterModal() {
  $("#register-form").reset();
  $("#register-error").textContent = "";
  $("#register-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
  $("#register-name").focus();
}

function closeRegisterModal() {
  $("#register-modal").classList.add("is-hidden");
  restoreBodyScroll();
}

function enforcePreferenceLimit(event) {
  const selected = $$("input[name='preference']:checked");
  if (selected.length > 5) {
    event.target.checked = false;
    $("#register-error").textContent = "Puedes seleccionar un máximo de 5 preferencias.";
  } else {
    $("#register-error").textContent = "";
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const errorElement = $("#login-error");
  const submitButton = $("#login-form button[type='submit']");
  errorElement.textContent = "";
  submitButton.disabled = true;

  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("#email").value.trim(),
        password: $("#password").value
      })
    });
    await enterApp(result.user);
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
}

async function enterApp(user) {
  state.user = user;
  const [booksResult, trackingResult, integrationsResult] = await Promise.all([
    api("/api/books"),
    api("/api/tracking"),
    api("/api/integrations/status")
  ]);
  state.books = booksResult.books;
  state.tracking = trackingResult.tracking;
  state.integrations = integrationsResult;

  $("#login-screen").classList.add("is-hidden");
  $("#app").classList.remove("is-hidden");
  renderUserIdentity();
  $("#welcome-message").textContent = `${greeting()}, ${user.name.split(" ")[0]}`;
  populateBookSelect();
  renderCategoryFilters();
  renderBooks();
  renderTracking();
  updateStats();
  renderIntegrationStatus();
  showSpotifyCallbackMessage();
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    console.error(error);
  } finally {
    resetToLogin();
  }
}

function resetToLogin() {
  state.user = null;
  state.books = [];
  state.tracking = [];
  state.dashboard = null;
  state.integrations = null;
  $("#app").classList.add("is-hidden");
  $("#login-screen").classList.remove("is-hidden");
  $("#user-dropdown").classList.add("is-hidden");
  stopSpotifyPlayback();
  $("#login-form").reset();
  $("#email").focus();
}

function toggleUserMenu() {
  const menu = $("#user-dropdown");
  const expanded = !menu.classList.contains("is-hidden");
  menu.classList.toggle("is-hidden", expanded);
  $("#user-button").setAttribute("aria-expanded", String(!expanded));
}

function renderUserIdentity() {
  $("#user-name").textContent = state.user.name;
  const image = $("#user-avatar-image");
  const initial = $("#user-avatar-initial");
  initial.textContent = state.user.name.charAt(0).toUpperCase();
  initial.classList.remove("is-hidden");
  image.classList.add("is-hidden");
  image.removeAttribute("src");
  if (state.user.avatarUrl) {
    image.src = safeImageUrl(state.user.avatarUrl);
    image.classList.remove("is-hidden");
    initial.classList.add("is-hidden");
  }
}

function toggleSpotifyPanel() {
  const panel = $("#spotify-panel");
  const opening = panel.classList.contains("is-hidden");
  if (opening) ensureSpotifyPlayback();
  panel.classList.toggle("is-hidden", !opening);
  $("#spotify-button").setAttribute("aria-expanded", String(opening));
}

function closeSpotifyPanel() {
  $("#spotify-panel").classList.add("is-hidden");
  $("#spotify-button").setAttribute("aria-expanded", "false");
}

function ensureSpotifyPlayback() {
  const frame = $("#spotify-frame");
  if (!frame.src) frame.src = spotifyEmbedUrl;
}

function stopSpotifyPlayback() {
  closeSpotifyPanel();
  $("#spotify-frame").src = "";
}

function renderIntegrationStatus() {
  const spotify = state.integrations?.spotify;
  const button = $("#spotify-connect");
  if (spotify?.connected) {
    $("#spotify-status").textContent = "Tu cuenta de Spotify está conectada.";
    button.textContent = "Spotify conectado";
    button.disabled = true;
  } else if (spotify?.configured) {
    $("#spotify-status").textContent =
      "Conecta tu cuenta para habilitar controles personales en una siguiente etapa.";
    button.textContent = "Conectar mi Spotify";
    button.disabled = false;
  } else {
    $("#spotify-status").textContent =
      "El reproductor funciona sin configuración. La conexión personal requiere credenciales de Spotify.";
    button.textContent = "Configurar Spotify";
    button.disabled = false;
  }
}

function connectSpotify() {
  if (!state.integrations?.spotify?.configured) {
    showToast("Faltan las credenciales de Spotify en el servidor.");
    return;
  }
  window.location.assign("/api/integrations/spotify/connect");
}

function showSpotifyCallbackMessage() {
  const url = new URL(window.location.href);
  const result = url.searchParams.get("spotify");
  if (!result) return;
  showToast(result === "connected"
    ? "Spotify quedó conectado correctamente."
    : "No se pudo completar la conexión con Spotify.");
  url.searchParams.delete("spotify");
  window.history.replaceState({}, "", url);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

async function showView(viewName) {
  $$(".view").forEach((view) => view.classList.add("is-hidden"));
  $(`#${viewName}-view`).classList.remove("is-hidden");
  $$("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (viewName === "dashboard") await loadDashboard();
}

function renderCategoryFilters() {
  const preferences = state.user?.preferences || [];
  const allCategories = [...new Set(state.books.flatMap((book) => book.categories))];
  const categories = [
    "Todos",
    ...preferences,
    ...allCategories.filter((category) => !preferences.includes(category))
  ].slice(0, 7);

  $("#category-filters").innerHTML = categories.map((category) => `
    <button class="filter-button ${category === state.category ? "is-active" : ""}"
      type="button" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)}
    </button>
  `).join("");

  $$("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      renderCategoryFilters();
      renderBooks();
    });
  });
}

function renderBooks() {
  const preferences = state.user?.preferences || [];
  const filtered = state.books
    .filter((book) => state.category === "Todos" || book.categories.includes(state.category))
    .sort((a, b) => {
      const aMatch = a.categories.some((category) => preferences.includes(category)) ? 1 : 0;
      const bMatch = b.categories.some((category) => preferences.includes(category)) ? 1 : 0;
      return bMatch - aMatch || b.rating - a.rating;
    });

  $("#recommendations-grid").innerHTML = filtered.map((book) => `
    <article class="book-card" tabindex="0" role="button"
      data-book-id="${escapeHtml(book.id)}"
      aria-label="Ver detalles de ${escapeHtml(book.title)}">
      <div class="book-card__cover-wrap">
        <img class="book-card__cover" src="${safeImageUrl(book.cover)}"
          alt="Portada de ${escapeHtml(book.title)}" loading="lazy">
        ${book.categories.some((category) => preferences.includes(category))
          ? '<span class="book-card__badge">Para ti</span>'
          : ""}
      </div>
      <h3>${escapeHtml(book.title)}</h3>
      <p>${escapeHtml(book.author)}</p>
      <div class="book-card__meta">
        <span class="stars">${ratingStars(book.rating)}</span>
        <span>${escapeHtml(book.year)}</span>
      </div>
    </article>
  `).join("");

  $("#empty-search").classList.toggle("is-hidden", filtered.length > 0);
  attachImageFallbacks($("#recommendations-grid"));
  $$("[data-book-id]").forEach((card) => {
    card.addEventListener("click", () => openBookModal(card.dataset.bookId));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") openBookModal(card.dataset.bookId);
    });
  });
}

function openBookModal(bookId) {
  const book = findBook(bookId);
  if (!book) return;
  const tracked = state.tracking.find((item) => item.bookId === book.id);
  const readingLinks = getReadingLinks(book, tracked);

  $("#book-detail").innerHTML = `
    <div class="book-detail">
      <div class="book-detail__visual">
        <img src="${safeImageUrl(book.cover)}" alt="Portada de ${escapeHtml(book.title)}">
      </div>
      <div class="book-detail__info">
        <p class="eyebrow">${escapeHtml(book.categories[0] || "Libro")}</p>
        <h2 id="modal-title">${escapeHtml(book.title)}</h2>
        <p class="book-detail__author">de ${escapeHtml(book.author)}</p>
        <div class="book-detail__facts">
          <span>Publicado<strong>${escapeHtml(book.year)}</strong></span>
          <span>Páginas<strong>${escapeHtml(book.pages)}</strong></span>
          <span>Valoración<strong><span class="stars">${ratingStars(book.rating)}</span>
            ${escapeHtml(book.rating)}</strong></span>
        </div>
        <p class="book-detail__synopsis">${escapeHtml(book.synopsis)}</p>
        <div class="tags">${book.categories
          .map((category) => `<span class="tag">${escapeHtml(category)}</span>`)
          .join("")}</div>
        ${tracked?.currentPage
          ? `<p class="reading-progress">Vas por la página <strong>${tracked.currentPage}</strong>
              de ${escapeHtml(book.pages)}.</p>`
          : ""}
        ${readingLinks.length ? `
          <div class="reading-links">
            ${readingLinks.map((link, index) => `
              <a class="button ${index === 0 ? "button--primary" : "button--secondary"}"
                href="${safeExternalUrl(link.url)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(`Abrir en ${link.label}`)}
              </a>
            `).join("")}
          </div>
        ` : ""}
        <button class="button button--primary" id="detail-track-button" type="button">
          ${tracked ? "Editar mi seguimiento" : "+ Añadir a mi seguimiento"}
        </button>
      </div>
    </div>
  `;

  attachImageFallbacks($("#book-detail"));
  $("#detail-track-button").addEventListener("click", () => {
    closeBookModal();
    openTrackingModal(tracked?.id, book.id);
  });
  $("#book-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
}

function getReadingLinks(book, tracked) {
  const links = [];
  if (book.appleBooksUrl) links.push({ label: "Apple Books", url: book.appleBooksUrl });
  if (book.kindleUrl) links.push({ label: "Kindle", url: book.kindleUrl });
  if (book.previewUrl) links.push({ label: "Google Books", url: book.previewUrl });
  return links.filter((link, index, all) =>
    safeExternalUrl(link.url) &&
    all.findIndex((candidate) => candidate.url === link.url) === index
  );
}

function closeBookModal() {
  $("#book-modal").classList.add("is-hidden");
  restoreBodyScroll();
}

function populateBookSelect() {
  $("#tracking-book").innerHTML = state.books.map((book) => `
    <option value="${escapeHtml(book.id)}">${escapeHtml(book.title)} — ${escapeHtml(book.author)}</option>
  `).join("");
}

function openTrackingModal(trackingId = null, preferredBookId = null) {
  const item = state.tracking.find((entry) => entry.id === trackingId);
  $("#tracking-form").reset();
  $("#tracking-id").value = item?.id || "";
  $("#tracking-book").value = item?.bookId || preferredBookId || state.books[0]?.id || "";
  $("#tracking-book").disabled = Boolean(item);
  $("#tracking-status").value = item?.status || "Leyendo";
  $("#tracking-format").value = item?.format || "Físico";
  $("#tracking-rating").value = String(item?.rating || 0);
  $("#tracking-comment").value = item?.comment || "";
  $("#tracking-started-at").value = dateInputValue(item?.startedAt);
  $("#tracking-finished-at").value = dateInputValue(item?.finishedAt);
  $("#tracking-provider").value = item?.readingProvider || "";
  $("#tracking-current-page").value = item?.currentPage || "";
  $("#tracking-modal-title").textContent = item ? "Editar seguimiento" : "Añadir a mi seguimiento";
  if (!item) applyDateDefaults();
  $("#tracking-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
}

function closeTrackingModal() {
  $("#tracking-modal").classList.add("is-hidden");
  $("#tracking-book").disabled = false;
  restoreBodyScroll();
}

async function searchHeroCatalog(event) {
  event.preventDefault();
  const query = $("#hero-catalog-search").value.trim();
  if (!query) return;
  openCatalogModal(query);
  await runCatalogSearch(query);
  $("#hero-catalog-search").value = "";
}

function restoreBodyScroll() {
  if ($("#book-modal").classList.contains("is-hidden")
      && $("#tracking-modal").classList.contains("is-hidden")
      && $("#register-modal").classList.contains("is-hidden")
      && $("#profile-modal").classList.contains("is-hidden")
      && $("#catalog-modal").classList.contains("is-hidden")) {
    document.body.style.overflow = "";
  }
}

async function saveTracking(event) {
  event.preventDefault();
  const existingId = $("#tracking-id").value;
  const item = {
    bookId: $("#tracking-book").value,
    status: $("#tracking-status").value,
    rating: Number($("#tracking-rating").value),
    comment: $("#tracking-comment").value.trim(),
    format: $("#tracking-format").value,
    startedAt: $("#tracking-started-at").value || null,
    finishedAt: $("#tracking-finished-at").value || null,
    readingProvider: $("#tracking-provider").value || null,
    currentPage: Number($("#tracking-current-page").value) || null
  };

  try {
    const result = await api(existingId ? `/api/tracking/${existingId}` : "/api/tracking", {
      method: existingId ? "PUT" : "POST",
      body: JSON.stringify(item)
    });
    const index = state.tracking.findIndex((entry) => entry.id === result.tracking.id);
    if (index >= 0) state.tracking[index] = result.tracking;
    else state.tracking.unshift(result.tracking);
    state.dashboard = null;

    renderTracking();
    updateStats();
    closeTrackingModal();
    showToast(existingId ? "Seguimiento actualizado." : "Libro añadido a tu seguimiento.");
  } catch (error) {
    showToast(error.message);
  }
}

function openCatalogModal(initialQuery = "") {
  $("#catalog-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
  if (initialQuery) $("#catalog-search").value = initialQuery;
  $("#catalog-search").focus();
}

function closeCatalogModal() {
  $("#catalog-modal").classList.add("is-hidden");
  restoreBodyScroll();
}

function openProfileModal() {
  $("#user-dropdown").classList.add("is-hidden");
  $("#profile-form").reset();
  $("#profile-name").value = state.user.name;
  $("#profile-avatar").value = state.user.avatarUrl || "";
  $("#profile-error").textContent = "";
  $("#profile-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
  $("#profile-name").focus();
}

function closeProfileModal() {
  $("#profile-modal").classList.add("is-hidden");
  restoreBodyScroll();
}

async function saveProfile(event) {
  event.preventDefault();
  const errorElement = $("#profile-error");
  const submitButton = $("#profile-form button[type='submit']");
  errorElement.textContent = "";
  submitButton.disabled = true;

  try {
    const result = await api("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: $("#profile-name").value.trim(),
        avatarUrl: $("#profile-avatar").value.trim() || null,
        currentPassword: $("#profile-current-password").value,
        newPassword: $("#profile-new-password").value
      })
    });
    state.user = result.user;
    renderUserIdentity();
    $("#welcome-message").textContent = `${greeting()}, ${state.user.name.split(" ")[0]}`;
    closeProfileModal();
    showToast("Perfil actualizado.");
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
}

async function searchCatalog(event) {
  event.preventDefault();
  const query = $("#catalog-search").value.trim();
  await runCatalogSearch(query);
}

async function runCatalogSearch(query) {
  const message = $("#catalog-message");
  const submit = $("#catalog-search-form button[type='submit']");
  message.textContent = "Buscando en Open Library...";
  submit.disabled = true;
  $("#catalog-results").innerHTML = "";

  try {
    const result = await api(`/api/catalog/search?q=${encodeURIComponent(query)}`);
    renderCatalogResults(result.books);
    message.textContent = result.books.length
      ? `${result.books.length} resultados encontrados.`
      : "No se encontraron libros con esa búsqueda.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function renderCatalogResults(books) {
  $("#catalog-results").innerHTML = books.map((book) => `
    <article class="catalog-book">
      <img src="${safeImageUrl(book.cover)}" alt="Portada de ${escapeHtml(book.title)}" loading="lazy">
      <div>
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(book.author)}</p>
        <small>${escapeHtml(book.year)} · ${escapeHtml(book.pages)} páginas
          ${book.isbn13 ? ` · ISBN ${escapeHtml(book.isbn13)}` : ""}</small>
      </div>
      <button class="button button--secondary" type="button"
        data-import-book="${escapeHtml(book.sourceId)}">Agregar</button>
    </article>
  `).join("");
  attachImageFallbacks($("#catalog-results"));
  $$("[data-import-book]").forEach((button) => {
    button.addEventListener("click", () => importCatalogBook(button));
  });
}

async function importCatalogBook(button) {
  button.disabled = true;
  button.textContent = "Agregando...";
  try {
    const result = await api("/api/catalog/import", {
      method: "POST",
      body: JSON.stringify({ sourceId: button.dataset.importBook })
    });
    const booksResult = await api("/api/books");
    state.books = booksResult.books;
    populateBookSelect();
    renderCategoryFilters();
    renderBooks();
    button.textContent = "Agregado";
    showToast("Libro agregado con datos del catálogo real.");
    const imported = findBook(result.id);
    if (imported) {
      closeCatalogModal();
      $("#catalog-search").value = "";
      $("#catalog-results").innerHTML = "";
      openBookModal(imported.id);
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = "Agregar";
    showToast(error.message);
  }
}

function renderTracking() {
  const filtered = state.tracking.filter((item) => {
    const book = findBook(item.bookId);
    const matchesSearch = `${book?.title} ${book?.author}`.toLowerCase()
      .includes(state.trackingSearch);
    const matchesStatus = state.statusFilter === "all" || item.status === state.statusFilter;
    return matchesSearch && matchesStatus;
  });

  $("#tracking-table-body").innerHTML = filtered.map((item) => {
    const book = findBook(item.bookId);
    if (!book) return "";
    return `
      <tr>
        <td>
          <div class="table-book">
            <img src="${safeImageUrl(book.cover)}" alt="">
            <div><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author)}</span></div>
          </div>
        </td>
        <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
        <td><span class="stars">${item.rating ? ratingStars(item.rating) : "Sin puntuar"}</span></td>
        <td class="comment-cell">${escapeHtml(item.comment || "Sin comentarios")}</td>
        <td>${escapeHtml(item.format)}</td>
        <td class="row-actions">
          <button class="icon-button" type="button" data-view-book="${escapeHtml(book.id)}">Ver</button>
          <button class="icon-button" type="button" data-edit="${escapeHtml(item.id)}">Editar</button>
          <button class="icon-button" type="button" data-delete="${escapeHtml(item.id)}"
            aria-label="Eliminar">×</button>
        </td>
      </tr>
    `;
  }).join("");

  $("#empty-tracking").classList.toggle("is-hidden", filtered.length > 0);
  attachImageFallbacks($("#tracking-table-body"));
  $$("[data-view-book]").forEach((button) => {
    button.addEventListener("click", () => openBookModal(button.dataset.viewBook));
  });
  $$("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => openTrackingModal(button.dataset.edit));
  });
  $$("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteTracking(button.dataset.delete));
  });
}

async function deleteTracking(id) {
  const item = state.tracking.find((entry) => entry.id === id);
  const book = findBook(item?.bookId);
  if (!item || !window.confirm(`¿Eliminar "${book.title}" de tu seguimiento?`)) return;

  try {
    await api(`/api/tracking/${id}`, { method: "DELETE" });
    state.tracking = state.tracking.filter((entry) => entry.id !== id);
    state.dashboard = null;
    renderTracking();
    updateStats();
    showToast("Libro eliminado del seguimiento.");
  } catch (error) {
    showToast(error.message);
  }
}

function updateStats() {
  $("#stat-reading").textContent = state.tracking.filter((item) => item.status === "Leyendo").length;
  $("#stat-read").textContent = state.tracking.filter((item) => item.status === "Leído").length;
  $("#stat-next").textContent = state.tracking
    .filter((item) => item.status === "Próximo a leer").length;
}

function applyDateDefaults() {
  const status = $("#tracking-status").value;
  const startedAt = $("#tracking-started-at");
  const finishedAt = $("#tracking-finished-at");
  const today = localDateString();

  if ((status === "Leyendo" || status === "Leído") && !startedAt.value) {
    startedAt.value = today;
  }
  if (status === "Leído" && !finishedAt.value) {
    finishedAt.value = today;
  }
  if (status !== "Leído") finishedAt.value = "";
}

async function loadDashboard(force = false) {
  const loading = $("#dashboard-loading");
  const content = $("#dashboard-content");
  if (state.dashboard && !force) {
    renderDashboard();
    return;
  }

  loading.textContent = "Calculando tus estadísticas...";
  loading.classList.remove("is-hidden");
  content.classList.add("is-hidden");

  try {
    state.dashboard = await api("/api/dashboard");
    renderDashboard();
  } catch (error) {
    loading.textContent = error.message;
  }
}

function renderDashboard() {
  const dashboard = state.dashboard;
  if (!dashboard) return;
  const summary = dashboard.summary;

  $("#metric-read-books").textContent = summary.readBooks;
  $("#metric-reading-books").textContent = `${summary.readingBooks} leyendo actualmente`;
  $("#metric-total-days").textContent = `${numberFormatter.format(summary.totalDays)} días`;
  $("#metric-average-days").textContent = summary.averageDays === null
    ? "—"
    : `${formatDecimal(summary.averageDays)} días`;
  $("#metric-pages").textContent = numberFormatter.format(summary.pagesRead);
  $("#metric-rating").textContent = summary.averageRating === null
    ? "Sin puntuaciones"
    : `Puntuación media: ${formatDecimal(summary.averageRating)} / 5`;
  $("#metric-genre").textContent = summary.topGenre || "Sin datos";
  $("#metric-author").textContent = summary.topAuthor || "Sin datos";

  renderMonthlyChart(dashboard.monthly);
  renderRankingChart("#genre-chart", dashboard.genres);
  renderRankingChart("#author-chart", dashboard.authors);
  renderRankingChart("#format-chart", dashboard.formats);
  renderRankingChart("#provider-chart", dashboard.providers);
  renderDashboardBooks(dashboard.books);

  $("#dashboard-loading").classList.add("is-hidden");
  $("#dashboard-content").classList.remove("is-hidden");
}

function renderMonthlyChart(monthly) {
  const max = Math.max(1, ...monthly.map((item) => item.books));
  $("#monthly-chart").innerHTML = monthly.map((item) => {
    const height = item.books === 0 ? 2 : Math.max(12, (item.books / max) * 92);
    return `
      <div class="month-column" title="${item.books} libros · ${item.days} días">
        <div class="month-column__track">
          <div class="month-column__bar" style="height: ${height}%">
            ${item.books ? `<span>${item.books}</span>` : ""}
          </div>
        </div>
        <span>${escapeHtml(item.label)}</span>
      </div>
    `;
  }).join("");
}

function renderRankingChart(selector, rows) {
  const container = $(selector);
  if (!rows.length) {
    container.innerHTML = '<p class="dashboard-empty">Finaliza libros para ver esta estadística.</p>';
    return;
  }

  const max = Math.max(...rows.map((row) => row.value), 1);
  container.innerHTML = rows.map((row) => `
    <div class="ranking-row">
      <span class="ranking-row__label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
      <div class="ranking-row__track">
        <div class="ranking-row__bar" style="width: ${(row.value / max) * 100}%"></div>
      </div>
      <strong>${row.value}</strong>
    </div>
  `).join("");
}

function renderDashboardBooks(books) {
  const container = $("#dashboard-books");
  if (!books.length) {
    container.innerHTML = `
      <p class="dashboard-empty">
        Cuando marques un libro como leído, su duración y tiempo aparecerán aquí.
      </p>
    `;
    return;
  }

  container.innerHTML = `
    <div class="dashboard-book-row dashboard-book-row--header">
      <span>Libro</span><span>Inicio</span><span>Final</span><span>Duración</span><span>App</span>
    </div>
    ${books.map((book) => `
      <div class="dashboard-book-row">
        <div class="dashboard-book-title">
          <img src="${safeImageUrl(book.cover)}" alt="">
          <div>
            <strong>${escapeHtml(book.title)}</strong>
            <span>${escapeHtml(book.author)}</span>
          </div>
        </div>
        <span>${formatDate(book.startedAt)}</span>
        <span>${formatDate(book.finishedAt)}</span>
        <span>${book.durationDays === null ? "Sin fechas" : `${book.durationDays} días`}</span>
        <span>${escapeHtml(book.readingProvider || book.format)}</span>
      </div>
    `).join("")}
  `;
  attachImageFallbacks(container);
}

function findBook(id) {
  return state.books.find((book) => book.id === id);
}

const numberFormatter = new Intl.NumberFormat("es");
const dateFormatter = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC"
});

function formatDecimal(value) {
  return Number(value).toLocaleString("es", { maximumFractionDigits: 1 });
}

function formatDate(value) {
  if (!value) return "Sin registrar";
  return dateFormatter.format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`));
}

function dateInputValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

function localDateString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function ratingStars(rating) {
  const rounded = Math.round(Number(rating));
  return `${"★".repeat(rounded)}${"☆".repeat(Math.max(0, 5 - rounded))}`;
}

function statusClass(status) {
  if (status === "Próximo a leer") return "status-pill--next";
  if (status === "Leído") return "status-pill--read";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeImageUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    const allowed = url.origin === window.location.origin || url.protocol === "https:";
    return allowed ? escapeHtml(url.href) : "";
  } catch {
    return "";
  }
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? escapeHtml(url.href) : "";
  } catch {
    return "";
  }
}

function attachImageFallbacks(scope) {
  $$("img", scope).forEach((image) => {
    image.addEventListener("error", () => {
      image.src = "/covers/fallback.svg";
    }, { once: true });
  });
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}
