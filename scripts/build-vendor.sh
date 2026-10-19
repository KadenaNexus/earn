#!/usr/bin/env bash
# Rebuilds public/vendor/ (WalletConnect sign client and qrcode) from pinned npm versions, so signing pages never
# loads code from a third-party CDN. Run from the repo root, then commit public/vendor/ and SHA256SUMS together.
set -euo pipefail
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm i --silent --no-audit --no-fund @walletconnect/sign-client@2.20.3 qrcode@1.5.4 esbuild@0.24.0
printf "export * from '@walletconnect/sign-client';\nexport { default } from '@walletconnect/sign-client';\n" > wc.mjs
printf "import QR from 'qrcode';\nexport default QR;\nexport const toDataURL = QR.toDataURL;\n" > qr.mjs
npx esbuild wc.mjs --bundle --format=esm --platform=browser --minify --define:global=globalThis --outfile=walletconnect-sign-client-2.20.3.js --log-level=warning
npx esbuild qr.mjs --bundle --format=esm --platform=browser --minify --outfile=qrcode-1.5.4.js --log-level=warning
cd - >/dev/null
cp "$WORK"/walletconnect-sign-client-2.20.3.js "$WORK"/qrcode-1.5.4.js public/vendor/
(cd public/vendor && sha256sum walletconnect-sign-client-2.20.3.js qrcode-1.5.4.js > SHA256SUMS)
cat public/vendor/SHA256SUMS
