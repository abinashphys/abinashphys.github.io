// @ts-check
import process from "node:process";
import { defineConfig } from 'astro/config';

// ---------------------------------------------------------------------------
// GitHub Pages settings — see DEPLOY.md.
//
// • User site (repository named  abinashphys.github.io):
//     SITE = 'https://abinashphys.github.io', BASE = '/'
// • Project site (any other repository name, e.g. "website"):
//     SITE = 'https://abinashphys.github.io', BASE = '/website'
// • Custom domain (e.g. a subdomain you own):
//     SITE = 'https://your.domain', BASE = '/'
//
// The GitHub Actions workflow can override both through the environment
// variables SITE_URL and BASE_PATH, so you rarely need to edit this file.
// ---------------------------------------------------------------------------
const SITE = process.env.SITE_URL || 'https://abinashphys.github.io';
const BASE = process.env.BASE_PATH || '/';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
