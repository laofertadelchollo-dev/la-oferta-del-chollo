import type { APIRoute } from 'astro';
import { offers } from '../data/offers';
import { guides } from '../data/guides';
import { CATEGORIES, isOfferActive } from '../lib/site';

const staticPaths = [
  '/',
  '/ofertas/',
  ...CATEGORIES.map(({ slug }) => `/${slug}/`),
  '/guias/',
  '/sobre-nosotros/',
  '/contacto/',
  '/privacidad/',
  '/aviso-legal/',
  '/afiliados/',
  ...guides.map(({ slug }) => `/guia/${slug}/`),
  ...offers.filter(isOfferActive).map(({ slug }) => `/oferta/${slug}/`)
];

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin;
  const locations = origin
    ? staticPaths.map((path) => `  <url><loc>${new URL(path, `${origin}/`).toString()}</loc></url>`).join('\n')
    : '  <!-- Configura SITE_URL con el dominio canónico antes de publicar. -->';
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations}\n</urlset>\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
};
