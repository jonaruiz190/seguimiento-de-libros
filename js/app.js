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
    const booksResponse = await fetch("data/books.json");
    if (!booksResponse.ok) throw new Error("No se pudo cargar el catálogo.");
    state.books = await booksResponse.json();
    populateBookSelect();

    const savedUser = sessionStorage.getItem("bookTrackerUser");
    if (savedUser) {
      enterApp(JSON.parse(savedUser));
    }
  } catch (error) {
    $("#login-error").textContent = "Ejecuta el proyecto desde un servidor local para cargar los datos JSON.";
    console.error(error);
  }
}

function bindEvents() {
  $("#login-form").addEventListener("submit", handleLogin);
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeBookModal();
      closeTrackingModal();
    }
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const email = $("#email").value.trim().toLowerCase();
  const password = $("#password").value;
  const error = $("#login-error");
  error.textContent = "";

  try {
    const response = await fetch("data/users.json");
    if (!response.ok) throw new Error("No se pudo consultar users.json");
    const users = await response.json();
    const user = users.find((item) => item.email.toLowerCase() === email && item.password === password);

    if (!user) {
      error.textContent = "Correo o contraseña incorrectos.";
      return;
    }

    sessionStorage.setItem("bookTrackerUser", JSON.stringify(user));
    enterApp(user);
  } catch (fetchError) {
    error.textContent = "No se pudieron consultar los usuarios. Revisa el servidor local.";
    console.error(fetchError);
  }
}

function enterApp(user) {
  state.user = user;
  state.tracking = loadTracking(user.id);
  $("#login-screen").classList.add("is-hidden");
  $("#app").classList.remove("is-hidden");
  $("#user-name").textContent = user.name;
  $("#user-avatar").textContent = user.name.charAt(0).toUpperCase();
  $("#welcome-message").textContent = `${greeting()}, ${user.name.split(" ")[0]}`;
  renderCategoryFilters();
  renderBooks();
  renderTracking();
  updateStats();
}

function logout() {
  sessionStorage.removeItem("bookTrackerUser");
  state.user = null;
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
  const categories = ["Todos", ...preferences, ...allCategories.filter((category) => !preferences.includes(category))].slice(0, 7);

  $("#category-filters").innerHTML = categories.map((category) => `
    <button class="filter-button ${category === state.category ? "is-active" : ""}" type="button" data-category="${category}">
      ${category}
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
    <article class="book-card" tabindex="0" role="button" data-book-id="${book.id}" aria-label="Ver detalles de ${book.title}">
      <div class="book-card__cover-wrap">
        <img class="book-card__cover" src="${book.cover}" alt="Portada de ${book.title}" loading="lazy">
        ${book.categories.some((category) => preferences.includes(category)) ? '<span class="book-card__badge">Para ti</span>' : ""}
      </div>
      <h3>${book.title}</h3>
      <p>${book.author}</p>
      <div class="book-card__meta">
        <span class="stars">${ratingStars(book.rating)}</span>
        <span>${book.year}</span>
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
        <img src="${book.cover}" alt="Portada de ${book.title}">
      </div>
      <div class="book-detail__info">
        <p class="eyebrow">${book.categories[0]}</p>
        <h2 id="modal-title">${book.title}</h2>
        <p class="book-detail__author">de ${book.author}</p>
        <div class="book-detail__facts">
          <span>Publicado<strong>${book.year}</strong></span>
          <span>Páginas<strong>${book.pages}</strong></span>
          <span>Valoración<strong><span class="stars">${ratingStars(book.rating)}</span> ${book.rating}</strong></span>
        </div>
        <p class="book-detail__synopsis">${book.synopsis}</p>
        <div class="tags">${book.categories.map((category) => `<span class="tag">${category}</span>`).join("")}</div>
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
    <option value="${book.id}">${book.title} — ${book.author}</option>
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
  if ($("#book-modal").classList.contains("is-hidden") && $("#tracking-modal").classList.contains("is-hidden")) {
    document.body.style.overflow = "";
  }
}

function saveTracking(event) {
  event.preventDefault();
  const existingId = $("#tracking-id").value;
  const bookId = $("#tracking-book").value;
  const existingForBook = state.tracking.find((item) => item.bookId === bookId && item.id !== existingId);
  if (existingForBook) {
    showToast("Este libro ya está en tu seguimiento.");
    return;
  }

  const item = {
    id: existingId || `tracking-${Date.now()}`,
    bookId,
    status: $("#tracking-status").value,
    rating: Number($("#tracking-rating").value),
    comment: $("#tracking-comment").value.trim(),
    format: $("#tracking-format").value
  };

  const index = state.tracking.findIndex((entry) => entry.id === item.id);
  if (index >= 0) state.tracking[index] = item;
  else state.tracking.push(item);

  persistTracking();
  renderTracking();
  updateStats();
  closeTrackingModal();
  showToast(existingId ? "Seguimiento actualizado." : "Libro añadido a tu seguimiento.");
}

function renderTracking() {
  const filtered = state.tracking.filter((item) => {
    const book = findBook(item.bookId);
    const matchesSearch = `${book?.title} ${book?.author}`.toLowerCase().includes(state.trackingSearch);
    const matchesStatus = state.statusFilter === "all" || item.status === state.statusFilter;
    return matchesSearch && matchesStatus;
  });

  $("#tracking-table-body").innerHTML = filtered.map((item) => {
    const book = findBook(item.bookId);
    return `
      <tr>
        <td>
          <div class="table-book">
            <img src="${book.cover}" alt="">
            <div><strong>${book.title}</strong><span>${book.author}</span></div>
          </div>
        </td>
        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
        <td><span class="stars">${item.rating ? ratingStars(item.rating) : "Sin puntuar"}</span></td>
        <td class="comment-cell">${item.comment || "Sin comentarios"}</td>
        <td>${item.format}</td>
        <td class="row-actions">
          <button class="icon-button" type="button" data-view-book="${book.id}" aria-label="Ver detalles">Ver</button>
          <button class="icon-button" type="button" data-edit="${item.id}" aria-label="Editar">Editar</button>
          <button class="icon-button" type="button" data-delete="${item.id}" aria-label="Eliminar">×</button>
        </td>
      </tr>
    `;
  }).join("");

  $("#empty-tracking").classList.toggle("is-hidden", filtered.length > 0);
  $$("[data-view-book]").forEach((button) => button.addEventListener("click", () => openBookModal(button.dataset.viewBook)));
  $$("[data-edit]").forEach((button) => button.addEventListener("click", () => openTrackingModal(button.dataset.edit)));
  $$("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteTracking(button.dataset.delete)));
}

function deleteTracking(id) {
  const item = state.tracking.find((entry) => entry.id === id);
  const book = findBook(item?.bookId);
  if (!item || !window.confirm(`¿Eliminar "${book.title}" de tu seguimiento?`)) return;
  state.tracking = state.tracking.filter((entry) => entry.id !== id);
  persistTracking();
  renderTracking();
  updateStats();
  showToast("Libro eliminado del seguimiento.");
}

function updateStats() {
  $("#stat-reading").textContent = state.tracking.filter((item) => item.status === "Leyendo").length;
  $("#stat-read").textContent = state.tracking.filter((item) => item.status === "Leído").length;
  $("#stat-next").textContent = state.tracking.filter((item) => item.status === "Próximo a leer").length;
}

function loadTracking(userId) {
  const key = `bookTracker:${userId}`;
  const saved = localStorage.getItem(key);
  if (saved) return JSON.parse(saved);
  const initial = state.user?.tracking || [];
  localStorage.setItem(key, JSON.stringify(initial));
  return initial;
}

function persistTracking() {
  localStorage.setItem(`bookTracker:${state.user.id}`, JSON.stringify(state.tracking));
}

function findBook(id) {
  return state.books.find((book) => book.id === id);
}

function ratingStars(rating) {
  const rounded = Math.round(rating);
  return `${"★".repeat(rounded)}${"☆".repeat(Math.max(0, 5 - rounded))}`;
}

function statusClass(status) {
  if (status === "Próximo a leer") return "status-pill--next";
  if (status === "Leído") return "status-pill--read";
  return "";
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}
