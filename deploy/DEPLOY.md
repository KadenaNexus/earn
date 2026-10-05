# Deploy Kadena Earn with PM2

The release branch is `Kadena-Earn` in `KadenaSaudi/Kadena-NEXUS`. Run Git and server commands manually. Use a separate server checkout for Earn so other applications keep their own files. The frontend is served directly; there is no frontend build step.

Requirements: Node.js 22 or later, PostgreSQL 17, PM2, Nginx and HTTPS. Keep the web process in single-instance fork mode because it includes the reconciliation worker.

## Commit and push

From the local NEXUS checkout, review the changes before committing:

```sh
git branch --show-current                 # Kadena-Earn
git add -A
git diff --cached --stat
git status --short
git commit -m "Add Kadena Earn application"
git push -u origin Kadena-Earn
git rev-parse HEAD
```

Keep the commit ID to compare with the server checkout. Private environments, generated output, dependencies, logs and database backups are ignored.

## Server inspection and checkout

Connect using the existing SSH-agent workflow:

```sh
ssh -A -p 22 mustafa@89.167.14.58
whoami
node --version
command -v node npm pm2
pm2 list
sudo systemctl list-units 'pm2-*' --all
pg_lsclusters
sudo ss -ltnp
sudo nginx -t
```

Use the account that manages the existing PM2 applications. These examples use `mustafa`. The proposed application port is 3035; use another port if it is occupied. Choose the Earn domain and point its DNS to this server. The GitHub-authorized key must be loaded in the Mac's SSH agent, or the server must have its own repository deploy key.

Select an absolute Node executable with version 22 or later. Do not replace the runtime used by other applications:

```sh
export EARN_NODE_BIN="$(command -v node)"
"$EARN_NODE_BIN" --version
export PATH="$(dirname "$EARN_NODE_BIN"):$PATH"
```

If an additional runtime is required, install Node 24 alongside the existing one using [the official downloads](https://nodejs.org/en/download), then set `EARN_NODE_BIN` to its absolute path and prepend its directory to PATH. Keep the existing PM2 installation.

For a new, absent checkout directory:

```sh
bash <<'BASH'
set -euo pipefail
mkdir -p /home/mustafa/apps
git clone --branch Kadena-Earn --single-branch git@github.com:KadenaSaudi/Kadena-NEXUS.git /home/mustafa/apps/kadena-earn
cd /home/mustafa/apps/kadena-earn
git rev-parse HEAD
npm ci --omit=dev
BASH
cd /home/mustafa/apps/kadena-earn
```

Compare its commit with the local one. If Earn is already cloned, inspect its branch, remote and working tree before using the update sequence below.

## PostgreSQL

Reuse an online PostgreSQL 17 cluster if available. If 17 is absent on Ubuntu 24.04, install it using [the official PostgreSQL repository](https://www.postgresql.org/download/linux/ubuntu/):

```sh
sudo apt update
sudo apt install -y postgresql-common ca-certificates
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update
sudo apt install -y postgresql-17 postgresql-client-17
pg_lsclusters
```

Choose the actual online version-17 cluster port. Installing it alongside another cluster may use a port other than 5432. Do not stop or replace existing clusters:

```sh
export EARN_PG_PORT=5432                  # Replace with the actual cluster port.
sudo -u postgres /usr/lib/postgresql/17/bin/psql -X -p "$EARN_PG_PORT" -d postgres -Atc "SHOW server_version; SHOW port; SHOW listen_addresses; SELECT rolname FROM pg_roles WHERE rolname='kadena_earn'; SELECT datname FROM pg_database WHERE datname='kadena_earn';"
```

Keep database access on loopback. If the dedicated role or database already exists, inspect its configuration instead of replacing it. For a fresh database:

```sh
sudo -u postgres /usr/lib/postgresql/17/bin/createuser -p "$EARN_PG_PORT" --login --no-superuser --no-createdb --no-createrole --pwprompt kadena_earn
sudo -u postgres /usr/lib/postgresql/17/bin/createdb -p "$EARN_PG_PORT" --owner=kadena_earn kadena_earn
/usr/lib/postgresql/17/bin/psql -h 127.0.0.1 -p "$EARN_PG_PORT" -U kadena_earn -d kadena_earn -W -c 'SELECT current_user,current_database();'
```

Enter a strong random password privately in the prompts. An alphanumeric password of at least 32 characters avoids URL-encoding issues in `DATABASE_URL`.

## Configuration and operations key

```sh
cd /home/mustafa/apps/kadena-earn
umask 077
test ! -e .env && cp .env.example .env
chmod 600 .env
nano .env
```

Set `PORT` to the free application port, `APP_ORIGIN=https://YOUR_DOMAIN`, and `DATABASE_URL` to the dedicated database on `127.0.0.1` at its actual cluster port, using the password entered above. Keep the configured production owner, mainnet chain 1 and confirmation depth 6. Keep `CONTRACT_REVIEW_CONFIRMED=false` and `ENABLE_CHAIN_WRITES=false` during setup. The per-campaign pool cap defaults to 0.3 KDA.

Generate a fresh production operations key. This command refuses existing/duplicate key assignments, writes the secret only into the protected environment and prints its public gas account:

```sh
"$EARN_NODE_BIN" --input-type=module <<'JS'
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
let text = readFileSync('.env', 'utf8');
for (const key of ['OPS_PUBLIC_KEY', 'OPS_SECRET_KEY', 'OPS_ACCOUNT']) {
  const assignments = [...text.matchAll(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=([^\\r\\n]*)$`, 'gm'))];
  if (assignments.length !== 1 || assignments[0][0] !== `${key}=`) throw new Error(`${key} must occur exactly once as a blank assignment`);
}
const seed = randomBytes(32), pair = nacl.sign.keyPair.fromSeed(seed);
const publicKey = Buffer.from(pair.publicKey).toString('hex');
const values = { OPS_PUBLIC_KEY: publicKey, OPS_SECRET_KEY: seed.toString('hex'), OPS_ACCOUNT: `k:${publicKey}` };
for (const [key, value] of Object.entries(values)) text = text.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${value}`);
const temporaryFile = `.env.new-ops.${process.pid}`;
writeFileSync(temporaryFile, text, { mode: 0o600, flag: 'wx' }); renameSync(temporaryFile, '.env');
console.log(`Production gas account, mainnet chain 1: k:${publicKey}`);
JS
npm run migrate
mkdir -p logs backups
chmod 700 logs backups
```

Securely back up `.env` outside Git. Database dumps do not contain the operations key. The owner key belongs only in Ecko.

## PM2 and HTTPS

After verifying that neither Earn process name is already in use:

```sh
pm2 start ecosystem.config.cjs --only "kadena-earn,kadena-earn-backup"
pm2 save
curl --fail --silent --show-error http://127.0.0.1:3035/healthz
pm2 logs kadena-earn --lines 40 --nostream
pm2 logs kadena-earn-backup --lines 40 --nostream
```

Adjust the health URL if using another port. Expect `{"ok":true}`, both processes online, Earn listening on `127.0.0.1`, and a verified dump/checksum in `backups/`. If this PM2 account has no startup service, run `pm2 startup`, execute its generated command, then `pm2 save`. Preserve the other managed applications.

Set the chosen domain and port after DNS is ready:

```sh
export EARN_DOMAIN=earn.example.com        # Replace with the chosen domain.
export EARN_PORT=3035
bash <<'BASH'
set -euo pipefail
[[ "$EARN_DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$ ]]
[[ "$EARN_PORT" =~ ^[0-9]+$ ]] && (( EARN_PORT > 1024 && EARN_PORT < 65536 ))
test ! -e "/etc/nginx/sites-available/$EARN_DOMAIN"
test ! -L "/etc/nginx/sites-available/$EARN_DOMAIN"
test ! -e "/etc/nginx/sites-enabled/$EARN_DOMAIN"
test ! -L "/etc/nginx/sites-enabled/$EARN_DOMAIN"
sed -e "s/__EARN_DOMAIN__/$EARN_DOMAIN/g" -e "s/__EARN_PORT__/$EARN_PORT/g" deploy/nginx.conf.example | sudo tee "/etc/nginx/sites-available/$EARN_DOMAIN" >/dev/null
sudo ln -s "/etc/nginx/sites-available/$EARN_DOMAIN" "/etc/nginx/sites-enabled/$EARN_DOMAIN"
sudo nginx -t
sudo systemctl reload nginx
BASH
```

Use the existing Certbot installation, or follow [the official Nginx setup](https://certbot.eff.org/instructions?ws=nginx&os=ubuntufocal) if absent:

```sh
sudo certbot --nginx -d "$EARN_DOMAIN" --redirect
sudo nginx -t
curl --fail --silent --show-error "https://$EARN_DOMAIN/healthz"
sudo certbot renew --dry-run
```

Save only public release choices for future SSH sessions:

```sh
bash <<'BASH'
set -euo pipefail
umask 077
printf 'export EARN_NODE_BIN=%q\nexport EARN_DOMAIN=%q\nexport EARN_PORT=%q\nexport EARN_PG_PORT=%q\n' "$EARN_NODE_BIN" "$EARN_DOMAIN" "$EARN_PORT" "$EARN_PG_PORT" > .env.release
BASH
```

Install Earn-specific log rotation:

```sh
bash <<'BASH'
set -euo pipefail
test ! -e /etc/logrotate.d/kadena-earn
test ! -L /etc/logrotate.d/kadena-earn
sed -e 's|__EARN_DIRECTORY__|/home/mustafa/apps/kadena-earn|g' -e 's/__EARN_USER__/mustafa/g' -e "s/__EARN_GROUP__/$(id -gn)/g" deploy/logrotate.conf.example | sudo tee /etc/logrotate.d/kadena-earn >/dev/null
sudo logrotate --debug /etc/logrotate.d/kadena-earn
BASH
```

## Production contract activation

The production owner must sign a separate escrow installation. An existing deployment under another owner cannot be transferred by editing application configuration. Obtain acceptance of the contract review, set `CONTRACT_REVIEW_CONFIRMED=true`, and keep writes disabled while preparing:

```sh
npm run prepare:contract
```

The ignored `output/contract/` directory contains the unsigned command, QuickSign request metadata, source hashes, gas ceiling and exact Pact source. Preparation neither signs nor broadcasts. The owner reviews and QuickSigns the exact command in desktop Ecko; namespace installation requires an unscoped owner signature. Commands expire after 600 seconds, so regenerate unsigned preparation if needed. Preserve every signed/broadcast command and its request key.

Broadcast the owner-signed command through the configured Chainweb node and verify native confirmation depth 6, module source/hash, owner/operations guards and sponsor. Fund/create the new operations `k:` gas account on mainnet chain 1. Set `PACT_MODULE` to the confirmed namespace/module and enable writes only after installation and gas funding confirm:

```sh
nano .env
pm2 restart ecosystem.config.cjs --only kadena-earn --update-env
pm2 save
```

Verify desktop Ecko login, owner navigation, a small funded campaign, submission/review, confirmed payout, deadline refund and pause/resume. Automatic refunds require the worker and funded gas account.

## Backups and updates

The backup process makes a custom-format PostgreSQL dump immediately and every 24 hours. It validates the archive, generates SHA-256, uses restrictive permissions and retains 14 days. Failed runs retry after 60 seconds. Verify an initial dump and another after 24 hours. Arrange an off-server copy when required.

From a fresh SSH session, load public release choices, then inspect an actual backup:

```sh
cd /home/mustafa/apps/kadena-earn
source .env.release
export PATH="$(dirname "$EARN_NODE_BIN"):$PATH"
cd backups
sha256sum --check ACTUAL_FILENAME.dump.sha256
/usr/lib/postgresql/17/bin/pg_restore --list ACTUAL_FILENAME.dump >/dev/null
```

Test restoring into a new database, never over the live database with its worker running:

```sh
sudo -u postgres /usr/lib/postgresql/17/bin/createdb -p "$EARN_PG_PORT" --owner=kadena_earn kadena_earn_restore_check
/usr/lib/postgresql/17/bin/pg_restore -h 127.0.0.1 -p "$EARN_PG_PORT" -U kadena_earn -W -d kadena_earn_restore_check --no-owner --no-acl /home/mustafa/apps/kadena-earn/backups/ACTUAL_FILENAME.dump
/usr/lib/postgresql/17/bin/psql -h 127.0.0.1 -p "$EARN_PG_PORT" -U kadena_earn -W -d kadena_earn_restore_check -c 'SELECT name FROM schema_migrations ORDER BY name;'
```

For later releases, push the branch manually from the Mac, then run on the server:

```sh
bash <<'BASH'
set -euo pipefail
cd /home/mustafa/apps/kadena-earn
source .env.release
export PATH="$(dirname "$EARN_NODE_BIN"):$PATH"
test -x "$EARN_NODE_BIN"
test "$(git branch --show-current)" = Kadena-Earn
test -z "$(git status --porcelain)"
pm2 stop kadena-earn-backup
trap 'EARN_EXIT=$?; if [ "$EARN_EXIT" -ne 0 ]; then pm2 restart kadena-earn-backup || true; fi; exit "$EARN_EXIT"' EXIT
"$EARN_NODE_BIN" --env-file=.env --input-type=module -e 'import { backupEnvironment, runBackup } from "./scripts/backup-loop.js"; await runBackup(backupEnvironment());'
pm2 stop kadena-earn
git fetch origin
git pull --ff-only origin Kadena-Earn
git log --oneline -1
npm ci --omit=dev
npm run migrate
pm2 restart ecosystem.config.cjs --only "kadena-earn,kadena-earn-backup" --update-env
pm2 save
curl --fail --silent --show-error "https://$EARN_DOMAIN/healthz"
pm2 logs kadena-earn --lines 40 --nostream
pm2 logs kadena-earn-backup --lines 40 --nostream
BASH
```

A failed pull/install/migration leaves the web process stopped for inspection; the failure trap attempts to restore backup scheduling. A failed check after successful restart leaves the web process running. Do not run destructive test schemas against production, automatically undo migrations, or change blockchain records during recovery.

## Transaction reconciliation

Inspect owner-only jobs, audit records, campaign balances and payout receipts. Retry only conclusively failed payouts through the UI. For an unknown result, inspect the original request key and on-chain claim/payment record; do not create a replacement payment. Operations gas shortages delay reservations, payouts and refunds without moving reward pools out of escrow.
