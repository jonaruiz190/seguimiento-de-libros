# Seguimiento de Libros

Aplicación web multiplataforma para descubrir libros y llevar un registro personal de lectura.

## Funcionalidades

- Inicio de sesión de prueba consultando usuarios desde `data/users.json`.
- Recomendaciones ordenadas según las categorías favoritas del usuario.
- Búsqueda y filtros por categoría.
- Tabla de seguimiento con estado, puntuación, comentarios y formato.
- Creación, edición y eliminación de registros de lectura.
- Vista detallada con portada, autor, sinopsis, datos y categorías.
- Persistencia local por usuario mediante `localStorage`.
- Diseño responsive para escritorio, tablet y móvil.

## Tecnologías

- HTML5
- CSS3
- JavaScript
- JSON

## Ejecutar el proyecto

Los navegadores bloquean la lectura de JSON mediante `fetch` cuando se abre el archivo directamente. Inicia un servidor local desde la raíz del proyecto:

```bash
python -m http.server 8000
```

Después abre `http://localhost:8000`.

## Usuario de prueba

- Correo: `ana@libros.com`
- Contraseña: `libros123`

> Este login es únicamente una simulación para desarrollo. Las contraseñas en texto plano no deben usarse en producción.
