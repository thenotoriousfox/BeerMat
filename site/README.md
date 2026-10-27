# beermatquiz.co.uk

The website: what BeerMat is, pricing, downloads, terms and privacy. Astro 5 with Tailwind 4, built to static pages
and served by a Cloudflare Worker (`wrangler.json`), like the HippOS site. BeerMat Online is separate, at
online.beermatquiz.co.uk; `/app`, `/admin`, `/reset` and `/verify` redirect there (`public/_redirects`).

    npm install
    npm run dev       # http://localhost:4321
    npm run deploy    # build and publish (needs CLOUDFLARE_API_TOKEN with Workers access)

The logos and font come from `../brand` at build time. Screenshots in `public/shots` are of a demo quiz. Prices, the
contact address and whether downloads are open are in `src/consts.ts`. The terms and privacy pages are
written for BeerMat as a sole trader with payments by Stripe; worth having reviewed.
