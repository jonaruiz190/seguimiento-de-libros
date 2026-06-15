# Seguimiento de Libros

Aplicación web multiplataforma para descubrir libros y mantener un seguimiento personal de lectura.

## Arquitectura

- Frontend: HTML5, CSS3 y JavaScript.
- API: Node.js 24 LTS y Express 5.
- Base de datos: PostgreSQL 18.
- Autenticación: sesiones opacas mediante cookies `HttpOnly`.
- Contraseñas: hash `scrypt` con sal única.
- Desarrollo local: Docker Compose.

## Funcionalidades

- Login contra usuarios almacenados en PostgreSQL.
- Registro inicial seguro y altas posteriores mediante invitaciones de un solo uso.
- Panel administrador para emitir o revocar invitaciones, cambiar roles y
  activar o desactivar cuentas.
- Recomendaciones de al menos 20 resultados por categoría, sin duplicados.
- Buscador conectado a Open Library y AniList para libros, manga, manhwa,
  manhua, webtoons y novelas ligeras.
- Seguimiento con estado, puntuación, comentarios y formato.
- Dashboard filtrable con días de lectura, actividad mensual, géneros, autores,
  aplicaciones y mapa de calor por formato.
- Registro de fechas de inicio/finalización y cálculo automático de duración.
- Creación, edición y eliminación de registros.
- Vista detallada de cada libro.
- Reproductor de Spotify en la barra superior y OAuth opcional.
- Enlaces públicos de libro para Kindle, Apple Books y Google Books cuando existen.
- Página actual y proveedor de lectura digital por cada seguimiento.
- Edición de perfil: nombre, nombre de usuario, foto local o mediante URL,
  idioma, preferencias, Spotify y contraseña.
- Recuperación de contraseña mediante enlaces de un solo uso.
- Búsqueda e importación de datos reales desde Open Library.
- Actualización periódica de metadatos con `npm run catalog:refresh`.
- Portadas incluidas como recursos locales para evitar dependencias externas en ejecución.
- Persistencia por usuario en la base de datos.
- Diseño responsive.

## Requisitos

La forma recomendada de ejecutar todo el proyecto requiere:

- Git.
- Docker Desktop con Docker Compose.

Para desarrollar el backend fuera de Docker también se necesita Node.js 24 LTS.

## Inicio rápido con Docker

```bash
git clone https://github.com/jonaruiz190/seguimiento-de-libros.git
cd seguimiento-de-libros
docker compose up --build
```

Abre `http://localhost:3000`.

Para crear datos locales de demostración ejecuta `npm run db:seed`. Esos datos
son exclusivamente para desarrollo y nunca deben importarse a producción.

Detén los contenedores con:

```bash
docker compose down
```

Los datos permanecen en el volumen `postgres_data`. Para eliminar también la base de datos local:

```bash
docker compose down --volumes
```

## Desarrollo sin contenerizar Node.js

Levanta únicamente PostgreSQL:

```bash
docker compose up -d database
```

Crea el archivo de entorno:

```powershell
Copy-Item .env.example .env
```

Instala dependencias, prepara la base de datos e inicia el servidor:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run catalog:refresh
npm run dev
```

## Comandos

```bash
npm run check
npm test
npm audit --omit=dev
npm run db:migrate
npm run db:seed
```

## API

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/invitation?token=...`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `PUT /api/auth/profile`
- `GET /api/books`
- `GET /api/tracking`
- `POST /api/tracking`
- `PUT /api/tracking/:id`
- `DELETE /api/tracking/:id`
- `GET /api/dashboard`
- `GET /api/catalog/search?q=...`
- `GET /api/catalog/recommendations`
- `GET /api/catalog/categories`
- `GET /api/catalog/books/:sourceId`
- `GET /api/catalog/ranking`
- `POST /api/catalog/import`
- `GET /api/integrations/status`
- `GET /api/integrations/spotify/connect`
- `GET /api/integrations/spotify/callback`
- `GET /api/integrations/spotify/playlists`
- `DELETE /api/integrations/spotify`
- `GET /api/admin/overview`
- `POST /api/admin/invitations`
- `DELETE /api/admin/invitations/:id`
- `PATCH /api/admin/users/:id`

## Configuración

Consulta `.env.example`.

- `DATABASE_URL`: conexión PostgreSQL.
- `APP_ORIGIN`: URL pública exacta de la aplicación.
- `APP_ALLOWED_ORIGINS`: orígenes adicionales separados por coma para pruebas
  locales o túneles temporales. No uses comodines.
- `SESSION_DAYS`: duración de las sesiones.
- `TRUST_PROXY`: usa `1` si la plataforma termina HTTPS mediante un proxy.
- `NODE_ENV=production`: activa cookies `Secure` y configuración de producción.
- `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`: credenciales de una app de Spotify.
- `SPOTIFY_REDIRECT_URI`: callback registrado exactamente en Spotify.
- `INTEGRATION_ENCRYPTION_KEY`: secreto largo y aleatorio para cifrar tokens OAuth.
- `TRANSLATION_API_URL`: servicio compatible con LibreTranslate. Docker Compose
  levanta uno automáticamente para el desarrollo local.
- `NYT_BOOKS_API_KEY`: habilita el filtro opcional de best sellers oficiales.
- `GITHUB_SUPPORT_TOKEN`: token de servidor con permiso de escritura de Issues
  únicamente sobre el repositorio de soporte.
- `GITHUB_SUPPORT_REPO`: repositorio `propietario/nombre` donde se registran los
  reportes. Usa uno privado si pueden incluir información sensible.
- `RESEND_API_KEY` y `EMAIL_FROM`: envío de correos para recuperar contraseñas.
  En desarrollo, si no se configuran, la interfaz muestra el enlace de prueba.

AniList no requiere credenciales y se usa automáticamente para publicaciones
asiáticas. MyAnimeList requiere registrar una aplicación y no se necesita para
este primer bloque porque AniList cubre búsqueda, portada, formato, autor,
popularidad y sinopsis.

Kindle y Apple Books no ofrecen una API pública para leer el progreso personal del
usuario. La aplicación guarda manualmente la página actual y la plataforma usada,
sin solicitar ni almacenar contraseñas de esas plataformas. Google Books sí tiene
OAuth para la biblioteca del usuario, pero no permite acceder a Kindle o Apple Books.

Para mantener actualizados los libros importados, programa diariamente o
semanalmente:

```bash
npm run catalog:refresh
```

## Producción

La configuración inicial recomendada para este proyecto es:

- Aplicación web en Render.
- PostgreSQL en Neon mediante una conexión con SSL.
- HTTPS administrado por Render.
- Cloudflare únicamente cuando exista un dominio propio.
- Monitoreo externo sobre `GET /api/health`.

El archivo `render.yaml` crea el servicio web y solicita los secretos desde el
panel de Render. No guarda credenciales en GitHub.

### Despliegue

1. Crea un proyecto PostgreSQL en Neon y copia su cadena de conexión con
   `sslmode=require`.
2. En Render, crea un Blueprint desde este repositorio.
3. Configura como mínimo:
   - `DATABASE_URL`: cadena de Neon.
   - `DATABASE_SSL=true` y `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.
   - `APP_ORIGIN`: URL HTTPS final de Render, sin barra al final.
   - `APP_ALLOWED_ORIGINS`: la misma URL mientras no exista otro dominio.
   - `ALLOW_REGISTRATION=false`: mantiene el lanzamiento por invitación.
   - `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` y `SPOTIFY_REDIRECT_URI`.
   - `NYT_BOOKS_API_KEY`.
   - `GITHUB_SUPPORT_TOKEN` y `GITHUB_SUPPORT_REPO`.
4. Configura `SPOTIFY_REDIRECT_URI` como
   `https://TU-SERVICIO.onrender.com/api/integrations/spotify/callback` y registra
   exactamente esa URL en Spotify.
5. Agrega `RESEND_API_KEY` y `EMAIL_FROM` antes de habilitar recuperación de
   contraseña para múltiples usuarios.
6. El contenedor ejecuta `npm run db:migrate` al iniciar. Nunca ejecuta
   `npm run db:seed` en producción.
7. Comprueba `/api/health`, registro, login, Spotify, soporte y recuperación de
   contraseña.

Cuando la tabla `users` está vacía, la aplicación permite crear una única cuenta
inicial y le asigna el rol `admin`. Después de ese registro, el alta vuelve a
cerrarse automáticamente y las nuevas cuentas requieren una invitación emitida
desde **Administrar usuarios**. Configura Resend para que la invitación también
verifique el control del buzón; sin Resend, el administrador puede compartir el
enlace manualmente y la cuenta quedará marcada como correo sin verificar.

`TRANSLATION_API_URL` es opcional. LibreTranslate consume más memoria que la
instancia web gratuita, por lo que debe ejecutarse como servicio independiente
o sustituirse por un proveedor externo.

### Limitaciones gratuitas

- Render puede suspender la aplicación tras un periodo sin tráfico, causando un
  arranque lento en la siguiente visita.
- Neon Free es apropiado para pruebas y uso personal, pero no ofrece las mismas
  garantías que un plan de producción pagado.
- No uses el PostgreSQL gratuito temporal de Render como almacenamiento
  permanente.
- Las fotos de perfil se guardan actualmente en PostgreSQL como datos; no
  dependen del sistema de archivos efímero de Render.

Antes de abrir el registro al público configura copias de seguridad externas,
alertas de disponibilidad, política de privacidad, términos de uso y rotación
de secretos.

El usuario de demostración existe únicamente cuando se ejecuta `npm run db:seed`.
- Las recomendaciones cargan hasta 20 títulos por cada género favorito.
- El Top 100 usa popularidad y valoraciones de Open Library; no se presenta como
  una lista oficial de best sellers.
- Los best sellers oficiales por año requieren `NYT_BOOKS_API_KEY`, obtenida en
  el portal para desarrolladores de The New York Times.
- Docker Compose descarga LibreTranslate y traduce títulos y sinopsis al idioma
  del perfil. Los nombres de autores se conservan en su forma oficial o
  romanizada para no alterar nombres propios.
- Las sinopsis se buscan primero en Open Library y luego en Google Books.
- Spotify permite usar la playlist predeterminada o seleccionar playlists de la
  cuenta vinculada sin copiar enlaces.

## Licencia y marca

El código se distribuye bajo la GNU Affero General Public License v3.0. Consulta
`LICENSE`. Las modificaciones utilizadas para prestar un servicio por red deben
ofrecer su código fuente correspondiente bajo los términos de esa licencia.

La licencia no concede derechos sobre el nombre, logotipos o identidad de
**Seguimiento de Libros**. Consulta `TRADEMARKS.md`.

Los reportes de vulnerabilidades deben seguir `SECURITY.md`. Las contribuciones
deben seguir `CONTRIBUTING.md`.
