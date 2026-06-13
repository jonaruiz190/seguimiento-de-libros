const state = {
  user: null,
  books: [],
  tracking: [],
  category: "Todos",
  search: "",
  trackingSearch: "",
  statusFilter: "all"
};

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
  $("#user-button").addEventListener("click", toggleUserMenu);
  $("#book-search").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderBooks();
  });
  $("#tracking-search").addEventListener("input", (event) => {
    state.trackingSearch = event.target.value.trim().toLowerCase();
    renderTracking();
  });
  $("#status-filter").addEventListener("change", (event) => {
    state.statusFilter = event.target.value;
    renderTracking();
  });
  $("#add-book-button").addEventListener("click", () => openTrackingModal());
  $("#tracking-form").addEventListener("submit", saveTracking);

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
  $$("input[name='preference']").forEach((checkbox) => {
    checkbox.addEventListener("change", enforcePreferenceLimit);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeBookModal();
      closeTrackingModal();
      closeRegisterModal();
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
  const [booksResult, trackingResult] = await Promise.all([
    api("/api/books"),
    api("/api/tracking")
  ]);
  state.books = booksResult.books;
  state.tracking = trackingResult.tracking;

  $("#login-screen").classList.add("is-hidden");
  $("#app").classList.remove("is-hidden");
  $("#user-name").textContent = user.name;
  $("#user-avatar").textContent = user.name.charAt(0).toUpperCase();
  $("#welcome-message").textContent = `${greeting()}, ${user.name.split(" ")[0]}`;
  populateBookSelect();
  renderCategoryFilters();
  renderBooks();
  renderTracking();
  updateStats();
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
  $("#app").classList.add("is-hidden");
  $("#login-screen").classList.remove("is-hidden");
  $("#logout-button").classList.add("is-hidden");
  $("#login-form").reset();
  $("#email").focus();
}

function toggleUserMenu() {
  const menu = $("#logout-button");
  const expanded = !menu.classList.contains("is-hidden");
  menu.classList.toggle("is-hidden", expanded);
  $("#user-button").setAttribute("aria-expanded", String(!expanded));
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function showView(viewName) {
  $$(".view").forEach((view) => view.classList.add("is-hidden"));
  $(`#${viewName}-view`).classList.remove("is-hidden");
  $$("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewName);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
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
    .filter((book) => {
      const haystack = `${book.title} ${book.author} ${book.categories.join(" ")}`.toLowerCase();
      return haystack.includes(state.search);
    })
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
        <button class="button button--primary" id="detail-track-button" type="button">
          ${tracked ? "Editar mi seguimiento" : "+ Añadir a mi seguimiento"}
        </button>
      </div>
    </div>
  `;

  $("#detail-track-button").addEventListener("click", () => {
    closeBookModal();
    openTrackingModal(tracked?.id, book.id);
  });
  $("#book-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
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
  $("#tracking-modal-title").textContent = item ? "Editar seguimiento" : "Añadir a mi seguimiento";
  $("#tracking-modal").classList.remove("is-hidden");
  document.body.style.overflow = "hidden";
}

function closeTrackingModal() {
  $("#tracking-modal").classList.add("is-hidden");
  $("#tracking-book").disabled = false;
  restoreBodyScroll();
}

function restoreBodyScroll() {
  if ($("#book-modal").classList.contains("is-hidden")
      && $("#tracking-modal").classList.contains("is-hidden")
      && $("#register-modal").classList.contains("is-hidden")) {
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
    format: $("#tracking-format").value
  };

  try {
    const result = await api(existingId ? `/api/tracking/${existingId}` : "/api/tracking", {
      method: existingId ? "PUT" : "POST",
      body: JSON.stringify(item)
    });
    const index = state.tracking.findIndex((entry) => entry.id === result.tracking.id);
    if (index >= 0) state.tracking[index] = result.tracking;
    else state.tracking.unshift(result.tracking);

    renderTracking();
    updateStats();
    closeTrackingModal();
    showToast(existingId ? "Seguimiento actualizado." : "Libro añadido a tu seguimiento.");
  } catch (error) {
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

function findBook(id) {
  return state.books.find((book) => book.id === id);
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
    const url = new URL(value);
    return url.protocol === "https:" ? escapeHtml(url.href) : "";
  } catch {
    return "";
  }
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}
