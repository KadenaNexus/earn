# Deploying nodes.kadena.ws

The site is one static file, `client/index.html`. Deploying means copying it over `index.html` in the web root. Nothing else on the server changes: no nginx edit or reload, no new jobs, and the data files are left alone.

## Where things are

| | |
|---|---|
| Server | `89.167.14.58` (Ubuntu 24.04, nginx 1.24). Log in as `mustafa`; `sudo` asks for your password. |
| nginx site file | `/etc/nginx/sites-enabled/nodes.kadena.ws`. This is a regular file, not a link to `sites-available`, so edits to `sites-available` have no effect. |
| Web root | `/home/zero/monitor/dist`, owned by `zero:zero`. `location /` already has `try_files $uri $uri/ /index.html` and `Cache-Control: no-store`, so visitors get the new page on their next load. |
| Old React site | Until this redesign, the web root held a build of `KDA-Monitor-dashboard` at commit `b365753` (Apr 26). It was built in `/home/zero/monitor-new`, a git checkout, and copied in on Apr 28. `/home/zero/monitor` itself is not a git checkout; it holds the data scripts and an older copy of the React source (`b7aea41`). |
| Data files | `/home/zero/monitor/dist/data/{ttfc,activechains,tx24h,avgblocktime}`, refreshed about once a minute. User `deploy` runs kdatracker, which writes them to `/tmp`, and `zero`'s `./sync-data-continuously.sh` loop copies them into `dist/data`. |

Three things to avoid on this server:

- **Never remove, move or rename `dist` or `dist/data`, even for a moment.** If `dist/data` disappears, the copy in `update-data.sh` fails, and the sync loop stops for good (both scripts use `set -e`). The numbers then freeze with no visible sign.
- **Don't run `npm run build` in `/home/zero/monitor` or `/home/zero/monitor-new`.** Both hold the old React source. Vite empties `dist`, including `data/`, and writes an old page back.
- **Don't reboot without restarting the data jobs.** kdatracker runs in a `screen` session that `deploy` started by hand. The `kdatracker.service` unit is enabled but has been failing and restarting every 5 seconds since about March. `zero`'s sync loop runs in an ordinary shell. Neither comes back on its own after a reboot, so block time, first confirmation and 24h transactions would stop updating until both are restarted.

## 0. Check the server first (read-only)

```bash
ssh mustafa@89.167.14.58
grep -E 'server_name|root' /etc/nginx/sites-enabled/nodes.kadena.ws   # root /home/zero/monitor/dist
pgrep -u zero -af sync-data-continuously                                # the /data copy loop: must be running
pgrep -u deploy -af kdatracker                                          # writes /tmp/*
date -u; stat -c '%y %n' /home/zero/monitor/dist/data/*                 # each file less than ~2 minutes old
```

If the sync loop isn't running, fix that before deploying (this deploy doesn't cause it): restart `./sync-data-continuously.sh` as `zero` from `/home/zero/monitor`, inside tmux or screen.

## 1. Upload (on your laptop, from the repo root)

```bash
shasum -a 256 client/index.html                                               # note the hash
grep -c '<title>Kadena Network Monitor | Kadena Nexus</title>' client/index.html   # must print 1
ssh mustafa@89.167.14.58 'mkdir -p ~/nodes-explorer'
scp client/index.html mustafa@89.167.14.58:nodes-explorer/index.html
```

## 2. Back up and swap (on the server)

```bash
sha256sum ~/nodes-explorer/index.html            # must match the laptop hash

BK=/home/zero/monitor/dist.bak-$(date -u +%Y%m%dT%H%M%SZ)
sudo test -e "$BK" && echo "STOP: $BK already exists" || { sudo cp -a /home/zero/monitor/dist "$BK" && echo "$BK" > ~/nodes-explorer/LAST_BACKUP; }
cat ~/nodes-explorer/LAST_BACKUP                 # the backup (about 0.5 MB, outside the web root)

sudo install -o zero -g zero -m 644 ~/nodes-explorer/index.html /home/zero/monitor/dist/index.html.new
sudo mv -f /home/zero/monitor/dist/index.html.new /home/zero/monitor/dist/index.html
sha256sum /home/zero/monitor/dist/index.html     # same hash again
```

The final `mv` replaces the file in one step, so no visitor ever gets a half-written page.

## 3. Check

From your laptop:

```bash
curl -s https://nodes.kadena.ws/ | shasum -a 256          # same hash: the new page is being served
for f in ttfc activechains tx24h avgblocktime; do printf '%-13s ' $f; curl -s https://nodes.kadena.ws/data/$f | head -1; done   # numbers, never HTML
curl -sI https://nodes.kadena.ws/data/ttfc | grep -i last-modified   # repeat after ~90 s: it should have moved on
```

On the server, run `pgrep -u zero -af sync-data-continuously` again; the loop should still be running.

Then open https://nodes.kadena.ws in a private window:

- The header pill says **Live** within about 10 seconds.
- All six numbers fill in: throughput, block time, first confirmation, active chains, 24h transactions, hashrate. If block time, first confirmation or 24h transactions stay as dashes, the page can't read `/data/*`.
- "What's in the latest transactions" lists contract functions.
- The node map shows pins, and "All N crawled nodes" opens the table.

## Roll back

Only `index.html` changed, so putting the old one back restores the old site. These commands also bring back `assets/` if it has been cleaned up since:

```bash
BK=$(cat ~/nodes-explorer/LAST_BACKUP)       # if this file is gone: ls -1d /home/zero/monitor/dist.bak-*
if sudo test -f "$BK/index.html"; then
  sudo test -d /home/zero/monitor/dist/assets || sudo cp -a "$BK/assets" /home/zero/monitor/dist/assets
  sudo install -o zero -g zero -m 644 "$BK/index.html" /home/zero/monitor/dist/index.html.new
  sudo mv -f /home/zero/monitor/dist/index.html.new /home/zero/monitor/dist/index.html
  echo "restored from $BK"
else
  echo "STOP: no backup at '$BK'"
fi
```

## Clean up later

Once the new page has been running without problems for a few days, remove the old bundle:

```bash
sudo rm -rf /home/zero/monitor/dist/assets
```

Keep `favicon.png`, `opengraph.jpg` and `data/`. Keep the backup for at least two weeks after this.
