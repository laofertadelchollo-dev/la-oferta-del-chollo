import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /admin/'];
  if (site) lines.push(`Sitemap: ${new URL('/sitemap.xml', site).toString()}`);
  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
};
