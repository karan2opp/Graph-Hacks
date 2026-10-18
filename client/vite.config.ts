import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Public pages, listed in the sitemap. Everything under /app needs a sign-in. */
const PUBLIC_PAGES = ['/', '/privacy', '/terms', '/cookies']

/**
 * Writes robots.txt and sitemap.xml into the build. Both need the site's absolute address, so the
 * sitemap (and robots.txt's pointer to it) is only written when SITE_URL is set.
 */
function crawlerFiles(siteUrl: string | undefined): Plugin {
  const origin = siteUrl?.replace(/\/+$/, '')
  return {
    name: 'crawler-files',
    apply: 'build',
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /', 'Disallow: /app', 'Disallow: /invite/']
      if (origin) robots.push('', `Sitemap: ${origin}/sitemap.xml`)
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') + '\n' })
      if (!origin) return
      const today = new Date().toISOString().slice(0, 10)
      const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${origin}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), crawlerFiles(env.SITE_URL)],
    server: {
      port: Number(process.env.PORT) || 5173,
      proxy: {
        '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
      },
    },
  }
})
