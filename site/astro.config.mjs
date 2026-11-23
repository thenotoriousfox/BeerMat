// @ts-check
// beermatquiz.co.uk, built to static pages and served by a Cloudflare Worker (wrangler.json). BeerMat Online itself
// runs at online.beermatquiz.co.uk; /app and /admin redirect there (public/_redirects).
import {defineConfig} from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	site: 'https://beermatquiz.co.uk',
	integrations: [sitemap()],
	vite: {plugins: [tailwindcss()]},
});
