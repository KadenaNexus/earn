# Kadena Network Monitor

Live Kadena mainnet dashboard at https://nodes.kadena.ws: blocks arriving on all 20 chains, throughput, block time, first-confirmation time, active chains, 24-hour transactions, hashrate, what the latest transactions call, and where the nodes run.

The front end is one static file, [`client/index.html`](client/index.html), with its CSS and JavaScript inline. There is no build step and there are no npm dependencies. Deploying means copying that file to the web root; see [DEPLOY.md](DEPLOY.md).

## Where the numbers come from

The browser fetches everything directly, and polling pauses while the tab is hidden.

| On the page | Source | Refresh |
|---|---|---|
| Live chain strip, throughput (TPS), block height, active chains | `blocksFromDepth` on `https://graphql.chaddex.com/graphql/v0` | 10 s |
| What's in the latest transactions | `transactions` (latest 500) on the same endpoint | 60 s |
| Hashrate | `networkInfo` on the same endpoint | 2 min |
| Node map, node counts and the node table | `https://nodes.denascan.com/api/nodes` | 5 min |
| Block time, first confirmation (TTFC), 24h transactions and the per-chain split | `/data/*` files served by this site | 30 s |

Leaflet loads from cdnjs (pinned with Subresource Integrity), fonts from Google Fonts, and map tiles from OpenStreetMap.

The status pill reads **Live** while the newest indexed block is less than 90 seconds old, and **Delayed** when it is older, for example when the indexer stalls. It takes the current time from this site's `Date` response header, so a visitor whose device clock is wrong still sees correct ages. A chain counts as active if it produced a block in the last 3 minutes.

## Data files

The backend writes these files to `/tmp`, and `update-data.sh` copies them into `data/` in the web root (and into `client/public/data` for local work). The formats are unchanged from the previous version of the site.

| File | Contents |
|---|---|
| `ttfc` | line 1: median time to first confirmation in ms; line 2: 90th percentile in ms |
| `activechains` | line 1: percentage of chains active; line 2: space-separated active chain ids. The page now works out active chains from live blocks, so this file is no longer shown. |
| `tx24h` | line 1: total transactions in the last 24 hours; then one `<chain id> <count>` line per chain |
| `avgblocktime` | average block time in seconds |

`sync-data-continuously.sh` runs `update-data.sh` once a second.

## Run it locally

```bash
mkdir -p dist/data
cp client/index.html dist/
cp client/public/data/* dist/data/
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. The sample files in `client/public/data` stand in for the backend. If the backend files exist in `/tmp`, run `./sync-data-continuously.sh` in another terminal to keep `dist/data` current.

## Licence

MIT
