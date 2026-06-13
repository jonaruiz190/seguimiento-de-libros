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
- Registro de cuentas con validación de contraseñas robustas.
- Recomendaciones basadas en categorías preferidas.
- Buscador principal conectado al catálogo real de Open Library.
- Seguimiento con estado, puntuación, comentarios y formato.
- Dashboard con días de lectura, actividad mensual, géneros, autores, formatos y apps.
- Registro de fechas de inicio/finalización y cálculo automático de duración.
- Creación, edición y eliminación de registros.
- Vista detallada de cada libro.
- Reproductor de Spotify en la barra superior y OAuth opcional.
- Enlaces públicos de libro para Kindle, Apple Books y Google Books cuando existen.
- Página actual y proveedor de lectura digital por cada seguimiento.
- Edición de perfil: nombre, foto mediante URL y contraseña.
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

Usuario de demostración:

- Correo: `ana@libros.com`
- Contraseña: `libros123`

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
- `POST /api/catalog/import`
- `GET /api/integrations/status`
- `GET /api/integrations/spotify/connect`
- `GET /api/integrations/spotify/callback`

## Configuración

Consulta `.env.example`.

- `DATABASE_URL`: conexión PostgreSQL.
- `APP_ORIGIN`: URL pública exacta de la aplicación.
- `SESSION_DAYS`: duración de las sesiones.
- `TRUST_PROXY`: usa `1` si la plataforma termina HTTPS mediante un proxy.
- `NODE_ENV=production`: activa cookies `Secure` y configuración de producción.
- `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`: credenciales de una app de Spotify.
- `SPOTIFY_REDIRECT_URI`: callback registrado exactamente en Spotify.
- `INTEGRATION_ENCRYPTION_KEY`: secreto largo y aleatorio para cifrar tokens OAuth.

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

Antes de publicar:

1. Usa una base PostgreSQL administrada con copias de seguridad.
2. Configura `NODE_ENV=production`, `APP_ORIGIN`, `DATABASE_URL` y `TRUST_PROXY=1`.
3. Ejecuta `npm run db:migrate` durante el despliegue.
4. No ejecutes `npm run db:seed`; crea usuarios reales mediante un flujo administrativo.
5. Publica exclusivamente mediante HTTPS.
6. Cambia las credenciales de base de datos incluidas en Docker Compose, que son solo locales.
7. Configura monitoreo, logs, alertas y rotación de secretos.

El usuario de demostración existe únicamente cuando se ejecuta `npm run db:seed`.
