# Desk

Static iPhone web app for a private paper/live trading desk. Served by GitHub Pages from the
`gh-pages` branch. Desk data on that branch is end-to-end encrypted (AES-GCM); the key never
touches this repo. Nothing here places orders or holds funds.

- `web/` - the app (index.html, app.js, chart.js, app.css, sw.js, manifest.json, icons/)
- `gh-pages` - web/ + encrypted `data/*.bin`, republished about every 10 minutes (single commit)
