# LA OFERTA DEL CHOLLO

Portal editorial estático de ofertas y guías para el mercado español. Está construido con Astro y no necesita base de datos ni servidor de aplicación.

## Requisitos y comandos

Usa Node.js 22 (el proyecto fija la versión principal en `.node-version`).

```powershell
npm ci
npm run dev
npm test
npm run build
npm run check:production
npm run preview
```

La web local se sirve normalmente en `http://localhost:4321/`. Si ese puerto está ocupado, Astro muestra el puerto alternativo en la consola.

## Marca y configuración

El nombre, la descripción editorial, los avisos de afiliación y los placeholders legales están centralizados en `src/lib/site.ts`. Cambia `SITE.name` para renombrar el sitio; ajusta también el SVG de `public/favicon.svg` y el banner de portada si cambias la identidad gráfica.

Copia `.env.example` como `.env` para desarrollo local y completa solo los valores que ya tengas. No subas `.env`: Git lo ignora. No introduzcas contraseñas, tokens ni claves en el frontend.

| Variable | Uso |
| --- | --- |
| `SITE_URL` | Origen canónico HTTPS. En el entorno de desarrollo usa el valor real de Cloudflare indicado en `.env`; en GitHub y Cloudflare configúralo como variable de build. |
| `GOOGLE_SITE_VERIFICATION` | Valor de verificación que entrega Search Console; se añade como metaetiqueta solo si se proporciona. |
| `ANALYTICS_ID` | ID de medición opcional. La etiqueta de analítica no se carga hasta que la persona visitante acepta el aviso. |
| `AMAZON_AFFILIATE_ID`, `ALIEXPRESS_AFFILIATE_ID`, `AWIN_ID` | Referencias documentales; no generan enlaces ni se usan en el sitio estático. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Reservadas para una futura integración privada. No las usa esta versión ni deben ponerse en archivos públicos. |

No hay IDs de analítica, de afiliación o de Search Console preconfigurados. Los enlaces publicados se introducen en cada oferta y deben ser reales.

## Añadir y publicar ofertas

La fuente editorial es `src/data/offers.json`. Los registros incluyen identificador, título, slug, tienda, categoría, imagen opcional, precio, cupón y condiciones, descripción, URL de origen, URL afiliada opcional, fechas, última comprobación, etiquetas y estado:

- `draft`: nunca se muestra en páginas públicas.
- `verified` y `published`: pueden mostrarse si `verified` es `true`, no están caducadas, no son DEMO y tienen una URL HTTP(S) válida.
- `verified`: puede mostrarse como enlace directo no monetizado cuando `affiliateUrl` está vacío.
- `published`: estado para una publicación monetizada; requiere una URL afiliada real además de la URL de origen.
- `expired`: no aparece como oferta activa.
- `lastVerifiedAt`: fecha/hora de la última comprobación editorial.
- `previousPriceVerified`: debe ser `true` antes de mostrar el precio anterior o calcular el descuento. El porcentaje se calcula desde los dos precios; no se confía en un porcentaje introducido manualmente.
- `affiliateUrl`: puede quedar vacío. Si se proporciona, debe ser un enlace real; la web lo marca como afiliado y añade `sponsored`/`nofollow`.

Las diez ofertas existentes son datos ficticios de prueba (`demo: true`). Solo se incluyen al ejecutar en desarrollo y llevan una etiqueta DEMO; el build de producción no genera sus fichas, no los lista ni distribuye sus datos al panel administrativo. Sus imágenes son ilustraciones genéricas ubicadas en `public/images/placeholders/`, no fotografías ni representaciones de productos concretos.

Para una oferta real, usa una imagen propia o autorizada y guárdala bajo `public/images/products/` (este directorio se puede crear cuando se añadan las primeras imágenes). `sourceUrl` conserva la página original del producto; `affiliateUrl` contiene exclusivamente el enlace de afiliación real facilitado por el programa. Nunca se deriva una URL afiliada a partir de un ID.

### Panel local

Abre `/admin/` mientras ejecutas `npm run dev`. Permite crear, editar, duplicar y eliminar registros, fijar estado, verificar precios, generar slugs, preparar texto de Telegram e importar/exportar JSON. Los cambios se guardan en `localStorage` de ese navegador; **no modifican automáticamente el sitio ni se sincronizan con otros dispositivos**. Exporta `offers.json`, revísalo y sustituye manualmente `src/data/offers.json` antes de volver a compilar.

Las ofertas DEMO están protegidas contra edición directa y al duplicarlas se crea un borrador limpio, sin URL ni precios de ejemplo. El administrador muestra un mensaje informativo en producción y no incluye la lógica ni los datos de gestión.

## Telegram

El panel crea un borrador con los datos de la oferta y permite copiarlo. No envía mensajes ni utiliza el bot token. Si falta un enlace real, el borrador lo indica; nunca inventa una URL.

## SEO y Google Search Console

Las páginas tienen títulos y descripciones propios, metadatos Open Graph/Twitter, canonical condicionado a `SITE_URL`, favicon, datos estructurados de artículos/ofertas con información disponible, y endpoints generados para `robots.txt` y `sitemap.xml`. No hay un dominio ficticio de reserva.

Para conectar Search Console:

1. Publica primero bajo un dominio HTTPS que controles.
2. Añade la propiedad de dominio o prefijo de URL en Search Console y completa la verificación que Google te indique.
3. Configura `SITE_URL` con el origen canónico exacto y, si eliges la verificación por metaetiqueta, copia el valor recibido a `GOOGLE_SITE_VERIFICATION`.
4. Vuelve a compilar y desplegar; envía `https://tu-dominio-real/sitemap.xml` desde Search Console.

No se han inventado verificaciones ni se ha registrado una propiedad.

## Cloudflare Pages

La configuración de Wrangler está en `wrangler.toml`; el directorio de salida estático es `dist/`.

El proyecto Pages existente es `la-oferta-del-chollo` y Cloudflare confirma el dominio `https://la-oferta-del-chollo.pages.dev`. La URL queda configurada localmente en `.env` (ignorado por Git); `.env.example` se conserva vacío para no propagar un dominio de despliegue como dato privado del entorno.

Al conectar el repositorio en Cloudflare Pages, usa:

- Framework: Astro (o configuración personalizada).
- Build command: `npm run build`.
- Build output directory: `dist`.
- Node.js: 22 (`.node-version`; configura `NODE_VERSION=22` en las variables de build si el entorno no lo detecta).
- Project name: `la-oferta-del-chollo`.
- Variable de build `SITE_URL`: configura `https://la-oferta-del-chollo.pages.dev` en **Workers & Pages → tu proyecto → Settings → Variables and Secrets → Build variables**. No añadas rutas, parámetros ni barra final.

Cloudflare instala las dependencias desde `package-lock.json`. El proyecto Pages tiene el dominio asignado y este build estático verificado se ha desplegado directamente con Wrangler. Aún no está conectado a un proveedor Git. Conecta GitHub y configura build `npm run build` y salida `dist`; tras añadir un dominio propio, actualiza `SITE_URL` al host canónico elegido y vuelve a desplegar. Las rutas ya son limpias y usan barra final, por ejemplo `https://la-oferta-del-chollo.pages.dev/ofertas/` (sin `.html`); canonical no incluye los parámetros de búsqueda.

## GitHub Actions

`.github/workflows/ci.yml` ejecuta pruebas, build, verificación de contenido de producción y auditoría de dependencias en cada push y pull request. No necesita secretos ni publica cambios.

## Diseño y arquitectura

- Páginas Astro: `src/pages/`.
- Componentes: `src/components/`.
- Datos editoriales: `src/data/`.
- Lógica de ofertas y configuración: `src/lib/site.ts`.
- Estilos responsive: `src/styles/global.css`.
- Recursos estáticos: `public/`.

Los filtros de ofertas funcionan en el navegador por búsqueda, categoría, tienda, precio, descuento verificado y orden, también en el despliegue estático. Los componentes y páginas se generan desde el catálogo; las ofertas expiradas, borradores y registros DEMO no se publican.

## Antes del lanzamiento

- Sustituye los ejemplos por ofertas reales que hayas comprobado y enlaces que tengas permiso para utilizar.
- Completa `[NOMBRE]`, `[EMAIL]` y `[DOMICILIO]` en la configuración, y revisa los textos legales con los datos y prácticas reales del responsable.
- Indica en la página de afiliación únicamente programas con los que exista una relación vigente.
- Configura el dominio, `SITE_URL`, Search Console y, si procede, analítica con consentimiento.
- Ejecuta `npm test`, `npm run build` y `npm run check:production` antes de publicar.
