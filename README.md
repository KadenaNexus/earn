# Kadena Earn

Kadena Earn connects funded community tasks to KDA rewards. Contributors sign in with Linx or the Ecko app on a phone (WalletConnect) or the Ecko extension on a computer, submit text and evidence links, and follow review and payment status. The owner creates campaigns, funds their escrow, reviews submissions, sends payouts and controls the emergency pause.

Completed work, the all-time leaderboard, payout feed and statistics come from confirmed payments. Screenshot evidence uses links. Wallet access currently supports single-key `k:` accounts on desktop.

The configured production owner is:

```text
k:d70371113e84a5e5216c2a24b7e245049712d2c3f0d93ac77a40caf37f0f8d75
```

## Using the application

### Contributors

1. Open the site in desktop Chrome with Ecko installed and unlocked. Select your account, click **Connect Ecko**, and approve the connection and login challenge. Login verifies a single-use signature without broadcasting a transaction or charging gas.
2. In **Explore tasks**, choose a funded campaign, read its instructions, and click **Start task**. A slot is held for up to 30 minutes, bounded by the campaign deadline.
3. Enter the requested text and HTTP(S) evidence links, then **Submit proof** before the hold expires. The application reserves the reward on chain before adding the submission to the review queue.
4. Follow the submission in **My tasks**. For **Changes requested**, read the review note, edit the proof and resubmit. Its existing reward reservation remains valid after the deadline. Rejection is final.
5. **Paid** means the payout has confirmed on chain. Use its transaction link to inspect the receipt. Completed work becomes public only with contributor consent; fields marked private remain visible to the contributor and owner.

The application never asks for a wallet password, recovery phrase or private key. Disconnect ends the website session.

### Owner

Connect the configured owner account to access **Create** and **Admin**.

1. Create a campaign with instructions, category, reward per contributor, reward slots, deadline and text/link proof fields. Mark sensitive evidence fields **Private**. Each completed task can pay up to 5,000 KDA, with at most six decimal places. The campaign pool is reward per person × reward slots, with no separate pool cap. Campaigns support up to 10,000 reward slots.
2. Select **Create & fund** and review the escrow module, chain, amount and account in Ecko before signing. Campaigns open after confirmation. Saved drafts can also be funded from **Admin → Campaigns**.
3. In the review queue, choose **Approve**, **Reject** or **Request changes**. Rejection and change requests require a note. Approval makes the payout available to send.
4. In **Admin → Payouts**, select **Send**. The operations signer pays the fixed reserved reward from escrow. **Retry** is available only after a conclusive failure, with at most three owner retries. Pending or unknown transactions retain their original request key for reconciliation.
5. To pause or resume, use **Emergency pause** and approve its owner-signed Ecko transaction. New money actions are blocked while either transition is pending. Deadline refunds and rejected-claim releases remain available while paused.

Campaigns end at their deadline. The reconciliation worker returns unused funds to the owner while preserving rewards for submitted work awaiting a decision. Late approval pays the reserved reward; rejection releases it for automatic refund. Keep the worker running and the operations gas account funded. Campaign rewards remain in escrow, separate from operations gas.

### AI reviewer (optional)

Campaigns created with **Let the AI agent review and pay this task** are checked by an AI model (Anthropic Claude). For each submission in review it either approves (and immediately queues the payout from escrow, the same way **Send** does) or requests changes with a note. It never rejects. It hands the submission to the owner's queue when its confidence is below `AI_REVIEW_MIN_CONFIDENCE`, when the proof is identical to another submission, after `AI_REVIEW_MAX_ROUNDS` change requests, or when a limit would be exceeded.

Limits are enforced in code, not by the model: a reward per task of at most `AI_REVIEW_MAX_REWARD_KDA` and a rolling 24-hour total of `AI_REVIEW_DAILY_KDA`. The emergency pause stops it, and **Admin → AI reviewer** has its own on/off switch, which starts off. Every decision, with its confidence and reasons, is stored in `ai_reviews` and shown in Admin; payouts it sends are audited with `agent: true`. Public pages tag these tasks **AI-reviewed** and their payouts **paid by AI agent**.

Submissions are untrusted text. The model is told to treat them as data and to pass anything that tries to instruct it to the owner, but the limits above are what protect the escrow. The agent cannot open links, so it suits tasks that can be judged from the text. To enable: set `ANTHROPIC_API_KEY` (and optionally the other `AI_REVIEW_*` values from `.env.example`), run migrations, restart, then turn it on in Admin.

### Kadena Nexus Games

`/games.html` hosts eight games: Sliding Tiles, Kadena Quiz, Logic Grid (6×6), Riddles, Kadena Word (5 letters, 6 tries), Memory Match (8 pairs), Minesweeper (8×8, 10 mines) and Spot the Pact Bug. Word, Memory and Minesweeper are played move by move against the server (`POST /api/games/sessions/:id/move`), which keeps the hidden word, card layout and mines; Minesweeper places its mines after the first click so it is always safe. A game round is an ordinary funded campaign with a game kind, opened by the owner from the owner card on the Games page (prize per win, number of prizes, hours open). Players need a connected wallet. Setting `GAMES_REQUIRE_EMAIL=true` also requires a confirmed email (one inbox per wallet; Gmail dots and +tags are normalized, temporary-inbox domains are refused); it is off by default because the AI games budget already caps daily payouts.

1. **Play** holds a reward slot like **Start task** and gives the player a puzzle generated on the server. Quiz and riddle answers never reach the browser.
2. **Finish** is checked on the server with server-measured time. A miss uses one of `GAMES_ATTEMPTS_PER_ROUND` tries (each with a fresh puzzle). A win writes the proof itself (a public result line and a private play record) and reserves the prize in escrow, exactly like a task submission.
3. The AI agent reviews how the round was played (approve or hand to the owner; it never asks for changes on a game and never rejects). Wins with bot-like signals (faster than a person, machine-like move timing, a grid pasted rather than typed) go to the owner without asking the model.
4. Limits in code: one win per wallet per round, `GAMES_WINS_PER_WALLET_PER_DAY` wins per game per 24 h, and the agent's own games budget (`GAMES_MAX_REWARD_KDA` per win, `GAMES_DAILY_KDA` per 24 h), separate from the task limits. Over-limit wins wait in the owner's review queue.

The generic task endpoints refuse game rounds, so game proof can only come from a finished, server-checked round. The email requirement needs `RESEND_API_KEY` and `EMAIL_FROM`.

### Submission status

| Status | Meaning |
| --- | --- |
| Started | Submit proof before the slot hold expires. |
| Confirming reservation | Proof is saved; the escrow reservation is pending. |
| In review | The owner can review the proof. |
| Changes requested | Read the note, edit proof and resubmit. |
| Approved | The owner can send the payout. |
| Paid | Payment has confirmed; its receipt is available. |
| Rejected | The reward reservation is released. |
| Reservation failed | Start again while the campaign is open. |
| Payout failed | The owner can inspect the failure and, when eligible, retry. |
| Pending / Sending | Wait for the existing transaction's result. |

An empty Explore page means no funded campaign is available. Missing owner navigation means the connected account is not the configured owner. For wallet connection errors, unlock Ecko, select the intended account and refresh. Follow the reconciliation procedure in the deployment guide for unresolved transactions.

## Architecture and safeguards

- `public/`: frontend, API client, Ecko adapter and transaction receipts.
- `src/`: Express API, PostgreSQL persistence, authentication and reconciliation worker.
- `migrations/`: database schema.
- `contracts/`: Pact escrow source and contract tests.
- `scripts/`: migrations, contract preparation, local-chain testing and backups.

The escrow enforces funded slot limits, fixed recipients and one payment per submission. The owner controls funding, pause and module governance. The operations key can reserve and pay claims, release rejected claims and refund unused rewards to the fixed sponsor. Protect this key: the contract trusts its claim decisions; application review approval is enforced by the server.

Signed commands and request keys are persisted before broadcast. Workers poll existing transactions before sending, so a restart after node acceptance does not create a replacement payment. Unknown results require reconciliation; the worker never silently substitutes a new transaction. Refunds require the running worker and sufficient gas because Pact contracts do not run on a schedule themselves.

Authentication uses expiring single-use challenges. Sessions use HTTP-only cookies, secure production cookies, CSRF protection, rate limits and origin checks. Owner authorization is checked on every request. User text is escaped, links allow only HTTP(S), private proof fields stay out of public results, and financial and review transitions are audited.

## Local development and tests

Requires Node.js 22 or later and PostgreSQL 17. Pact 5.4 is required for contract tests. Docker is optional and used only to run the local Chainweb devnet.

```sh
npm ci
cp .env.example .env
```

Create a local database and update `.env`: set `NODE_ENV=development`, `PORT=3000`, a local `DATABASE_URL`, `APP_ORIGIN=http://localhost:3000`, `KADENA_NETWORK_ID=development`, `KADENA_NODE_URL=http://127.0.0.1:8080`, and `ENABLE_CHAIN_WRITES=false`. Keep private configuration and keys out of version control.

```sh
npm run migrate
npm start
```

Run API and worker tests against a separate disposable PostgreSQL database. Tests recreate their dedicated schemas, so never point `TEST_DATABASE_URL` at production.

```sh
TEST_DATABASE_URL='postgres://kadena_earn@127.0.0.1:5432/kadena_earn_test' npm test
PACT_BIN=/path/to/pact npm run test:pact
```

The automated suites cover authentication, authorization, slot concurrency, review, privacy, payment recovery, pause transitions, backup scheduling and contract invariants.

To exercise mined local transactions, start the devnet:

```sh
docker compose -p kadena-earn-local -f compose.devnet.yaml up -d
```

Set `.env` to `KADENA_NETWORK_ID=development`, `KADENA_NODE_URL=http://127.0.0.1:8080` and `CONFIRMATION_DEPTH=1`, with a separate local database, then run `npm run test:chain`. This test refuses non-local nodes and other networks. It uses generated development accounts and a fresh namespace, recreates its `ke_chain_pilot` schema, and checks funding, reserved payouts after the deadline, pause, unused refunds and duplicate-payment rejection. The devnet certificate and miner key are public development fixtures.

## Deployment

Follow [deploy/DEPLOY.md](deploy/DEPLOY.md) for the branch push, server checkout, PostgreSQL, PM2, Nginx, HTTPS, daily backups and transaction reconciliation. PM2 runs one web process with the reconciliation worker and one backup process; keep the web process in single-instance fork mode.

Production chain writes are disabled by default. The operator enables owner setup using `npm run setup:contract -- REVIEWED_SHA256`. This creates a fresh operations key if the key assignments are blank, pins the reviewed escrow source and keeps campaign writes disabled. The configured owner opens `/setup.html`, signs in with desktop Ecko, reviews the complete contract and approves installation (gas capped at 0.01 KDA). After six-block confirmation, the owner approves a separate 0.05 KDA operations gas transfer (gas capped at 0.0015 KDA). Campaign rewards are funded separately.

The operator runs `npm run activate:contract` after both transactions confirm. It checks native confirmations, deployed module hash, owner/operations guards, sponsor and remaining operations gas before configuring the installed module and enabling campaign writes. Restart only the Earn web process afterward. Changing the owner setting does not transfer an existing contract's governance.

`npm run prepare:contract` prepares the unsigned installation and exact source; it does not sign or broadcast. Never commit `.env`, operations keys, private signing material or database backups.

## Wallets

Sign-in and owner signatures work with Linx or the Ecko app over WalletConnect (`public/walletconnect.js`, the same code and pinned 2.20.3 build as Kadena Garden), or the Ecko browser extension (`public/wallet.js`). `public/wallets.js` asks which to use when the extension is present and goes straight to the phone wallet when it is not. The WalletConnect and QR libraries are served from `public/vendor`, rebuilt reproducibly with `scripts/build-vendor.sh` (checksums in `SHA256SUMS`, checked by the tests). The page's Content-Security-Policy allows the WalletConnect relay and nothing else outside the site.
