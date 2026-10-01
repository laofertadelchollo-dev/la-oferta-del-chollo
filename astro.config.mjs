import { defineConfig } from 'astro/config';

try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

const configuredSiteUrl = process.env.SITE_URL?.trim();
if (configuredSiteUrl) {
  const parsedSiteUrl = new URL(configuredSiteUrl);
  if (parsedSiteUrl.protocol !== 'https:' || parsedSiteUrl.pathname !== '/' || parsedSiteUrl.search || parsedSiteUrl.hash) {
    throw new Error('SITE_URL debe ser un origen HTTPS, por ejemplo https://la-oferta-del-chollo.pages.dev');
  }
}

export default defineConfig({
  site: configuredSiteUrl || undefined,
  output: 'static',
  trailingSlash: 'always',
  vite: {
    define: {
      'import.meta.env.PUBLIC_ANALYTICS_ID': JSON.stringify(process.env.ANALYTICS_ID?.trim() || ''),
      'import.meta.env.PUBLIC_GOOGLE_SITE_VERIFICATION': JSON.stringify(process.env.GOOGLE_SITE_VERIFICATION?.trim() || '')
    }
  },
  devToolbar: {
    enabled: false
  }
});
