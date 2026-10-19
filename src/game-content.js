// Question and riddle banks for Kadena Nexus Games. Server-only: answers never
// reach the browser. Each paid attempt draws a fresh random set.

// Kadena quiz: multiple choice. `a` is the index of the correct option.
export const QUIZ = [
  { q: 'What is the name of Kadena\'s smart contract language?', o: ['Pact', 'Solidity', 'Move', 'Clarity'], a: 0 },
  { q: 'How many chains run in parallel on Kadena mainnet?', o: ['1', '10', '20', '64'], a: 2 },
  { q: 'Which consensus does Kadena use?', o: ['Proof of Stake', 'Proof of Work on braided chains', 'Proof of Authority', 'Delegated Proof of Stake'], a: 1 },
  { q: 'Which hash function do Kadena miners use?', o: ['SHA-256', 'Ethash', 'Blake2s', 'Scrypt'], a: 2 },
  { q: 'What is a k: account?', o: ['An account named after a single public key', 'An exchange account', 'A smart contract', 'A testnet-only account'], a: 0 },
  { q: 'In Pact, what does a capability like coin.TRANSFER do when you sign it?', o: ['Lets the contract do anything with your account', 'Limits your signature to that specific transfer', 'Pays the gas for you', 'Hides the transaction'], a: 1 },
  { q: 'What does a gas station let a Kadena app do?', o: ['Mine blocks', 'Pay transaction fees on behalf of its users', 'Create new KDA', 'Skip signatures'], a: 1 },
  { q: 'What is the maximum supply of KDA?', o: ['21 million', '100 million', '1 billion', 'Unlimited'], a: 2 },
  { q: 'Which of these is not allowed in Pact code?', o: ['Recursion', 'Tables', 'Keysets', 'Modules'], a: 0 },
  { q: 'Roughly how often does each Kadena chain produce a block?', o: ['Every second', 'About every 30 seconds', 'Every 10 minutes', 'Once an hour'], a: 1 },
  { q: 'Moving KDA from chain 0 to chain 1 happens in how many steps?', o: ['One step', 'Two steps: send on the source chain, finish on the target chain', 'Five steps', 'It is not possible'], a: 1 },
  { q: 'Kadena chain IDs run from…', o: ['1 to 20', '0 to 19', 'A to T', '0 to 99'], a: 1 },
  { q: 'A keyset with predicate keys-2 means…', o: ['Exactly two keys exist', 'Any two of its keys must sign', 'The second key always signs', 'Signatures are optional'], a: 1 },
  { q: 'What happens when an enforce check fails inside a Pact transaction?', o: ['Only that line is skipped', 'The whole transaction fails and nothing changes', 'The transaction pays double gas and continues', 'The miner decides'], a: 1 },
  { q: 'In what currency is gas paid on Kadena?', o: ['ETH', 'USDT', 'KDA', 'Any token'], a: 2 },
  { q: 'What does "braided" mean in Kadena\'s Chainweb?', o: ['Each chain\'s blocks reference blocks from its peer chains', 'Chains take turns being online', 'Blocks are compressed', 'Two networks share miners'], a: 0 },
  { q: 'Which standard interface does the KDA coin contract implement?', o: ['ERC-20', 'fungible-v2', 'SPL', 'BEP-2'], a: 1 },
  { q: 'Which post-quantum signature scheme is being added to Kadena for new account types?', o: ['RSA-4096', 'SLH-DSA (SPHINCS+)', 'ECDSA', 'BLS'], a: 1 },
  { q: 'In Pact, where does a contract keep its data?', o: ['In tables defined in the module', 'In the miner\'s wallet', 'In browser cookies', 'Off chain only'], a: 0 },
  { q: 'What does with-capability do in Pact?', o: ['Grants a capability only for the code inside it', 'Deletes a capability', 'Upgrades the contract', 'Sends KDA to the miner'], a: 0 },
  { q: 'Who keeps the Kadena node software going after Kadena LLC closed?', o: ['Nobody', 'Community developers (Kadena Community Edition)', 'A single exchange', 'Ethereum validators'], a: 1 },
  { q: 'What does a Kadena explorer let you check?', o: ['Any confirmed transaction and its result', 'Private keys', 'Your wallet password', 'Future block rewards'], a: 0 },
  { q: 'Mining rewards on Kadena are paid…', o: ['Only on chain 0', 'On every chain, per block', 'Once a day', 'Only to exchanges'], a: 1 },
  { q: 'Why can a Pact contract not be drained by reentrancy like some other chains\' contracts?', o: ['Pact forbids recursion and controls calls with capabilities', 'Kadena has no smart contracts', 'Miners block it by hand', 'Gas is free'], a: 0 },
];

// One written answer per quiz attempt, judged by the AI agent.
export const WRITTEN = [
  { q: 'In one or two sentences, explain why signing a Pact capability like coin.TRANSFER is safer than signing an open-ended approval.', guide: 'Good answers say the signature is scoped: it only allows that transfer (amount, sender, receiver) and cannot be reused for anything else.' },
  { q: 'Explain in your own words what a gas station lets a Kadena app do, and why that helps new users.', guide: 'Good answers say the app pays transaction fees for users, so a new user without KDA for gas can still use the app.' },
  { q: 'Why does Kadena run many chains in parallel instead of one? Answer in one or two sentences.', guide: 'Good answers mention throughput or scaling: more chains process more transactions while sharing security through the braid.' },
  { q: 'What does an enforce check do in a Pact contract, and why does it matter for payments?', guide: 'Good answers say a failed enforce stops the whole transaction so no money moves unless every rule passes.' },
  { q: 'Explain what a k: account is to a friend who has never used Kadena.', guide: 'Good answers say it is an account whose name comes from one public key, so only the holder of that key can spend from it.' },
  { q: 'Why is it useful that a payout links to a transaction anyone can check on an explorer?', guide: 'Good answers mention transparency and verification: anyone can confirm the payment happened, to whom and how much, without trusting the site.' },
];

// Riddles. `answers` are accepted forms; matching ignores case, articles and plurals.
export const RIDDLES = [
  { q: 'I have keys but open no locks. I have space but no room. You can enter, but you can\'t go inside.', answers: ['keyboard', 'computer keyboard'] },
  { q: 'The more you take, the more you leave behind.', answers: ['footstep', 'footsteps', 'step', 'steps', 'footprint', 'footprints'] },
  { q: 'I have hands but I can\'t clap.', answers: ['clock', 'watch'] },
  { q: 'I have to be broken before you can use me.', answers: ['egg'] },
  { q: 'I\'m tall when I\'m young and short when I\'m old.', answers: ['candle'] },
  { q: 'I go up but never come down.', answers: ['age', 'your age'] },
  { q: 'I have many teeth but I can\'t bite.', answers: ['comb', 'zipper', 'saw'] },
  { q: 'You can catch me but you can\'t throw me.', answers: ['cold', 'a cold'] },
  { q: 'I get wetter the more I dry.', answers: ['towel'] },
  { q: 'I have a neck but no head.', answers: ['bottle', 'shirt'] },
  { q: 'I run but never walk, I have a mouth but never talk, a bed but never sleep.', answers: ['river', 'stream'] },
  { q: 'I have one eye but I can\'t see.', answers: ['needle', 'storm', 'hurricane'] },
  { q: 'Twenty of us run side by side, braided together so none can hide. On Kadena, what are we?', answers: ['chain', 'chains', 'chainweb', 'blockchain', 'blockchains'] },
  { q: 'I open no door, yet I sign everything you send. Lose me and your coins are gone; share me and they are someone else\'s.', answers: ['private key', 'secret key', 'key', 'seed phrase', 'recovery phrase'] },
  { q: 'Miners guess me billions of times a second. When one finds a good one, a block is born.', answers: ['nonce', 'hash'] },
  { q: 'Every transaction burns a little of me to run. On Kadena I\'m paid in KDA.', answers: ['gas', 'gas fee', 'fee', 'fees'] },
  { q: 'I have words but never speak.', answers: ['book'] },
  { q: 'Some months have 31 days, some have 30. How many have 28?', answers: ['all', 'all of them', 'every month', 'all months', '12', 'twelve'] },
  { q: 'I travel around the world while staying in one corner.', answers: ['stamp', 'postage stamp'] },
  { q: 'I have a head and a tail but no body.', answers: ['coin'] },
  { q: 'The more of me there is, the less you see.', answers: ['darkness', 'dark', 'fog'] },
  { q: 'I belong to you, but other people use me more than you do.', answers: ['name', 'your name'] },
  { q: 'I have legs but I don\'t walk.', answers: ['table', 'chair'] },
  { q: 'I am full of holes but I still hold water.', answers: ['sponge'] },
  { q: 'What can fill a room but takes up no space?', answers: ['light', 'air', 'sound'] },
  { q: 'I am a record everyone keeps a copy of, so no one can secretly change me.', answers: ['blockchain', 'ledger', 'chain'] },
];

// ---------- Added Oct 19, 2026: more quiz questions ----------
QUIZ.push(
  { q: 'In a cross-chain transfer, what does SPV stand for?', o: ['Simple Payment Verification', 'Secure Pact Vault', 'Single Proof Validator', 'Signed Payment Voucher'], a: 0 },
  { q: 'What is the network ID of Kadena mainnet?', o: ['kadena-1', 'mainnet01', 'chainweb-main', 'kda'], a: 1 },
  { q: 'What does a defpact define in Pact?', o: ['A table', 'A multi-step transaction that can continue later, even on another chain', 'A keyset', 'A token price'], a: 1 },
  { q: 'What is a keyset made of?', o: ['A list of public keys and a rule for how many must sign', 'A password and an email', 'One private key', 'A list of chain IDs'], a: 0 },
  { q: 'Which module manages the KDA token itself?', o: ['coin', 'kda', 'token', 'fungible'], a: 0 },
  { q: 'What does a transaction\'s gas limit set?', o: ['The price of KDA', 'The most gas units the transaction may use', 'How many chains it touches', 'The miner\'s reward'], a: 1 },
  { q: 'A transaction runs out of gas. What happens?', o: ['It finishes for free', 'It fails, and the gas it used is still paid', 'The miner pays the rest', 'It is retried on another chain'], a: 1 },
  { q: 'Who can upgrade a Pact module?', o: ['Any miner', 'Whoever satisfies the module\'s governance (a keyset or capability)', 'Nobody, ever', 'The first user of the module'], a: 1 },
  { q: 'Which account prefix is used for a multi-key keyset principal?', o: ['k:', 'w:', 'm:', 'x:'], a: 1 },
  { q: 'What does a transaction\'s TTL mean?', o: ['Total token limit', 'How long the transaction stays valid to be mined', 'The number of signatures', 'The chain it runs on'], a: 1 },
  { q: 'What does enforce-guard do?', o: ['Creates a new key', 'Fails the transaction unless the guard is satisfied, for example the right key signed', 'Pays gas', 'Hides a table'], a: 1 },
  { q: 'Pact is intentionally…', o: ['Turing-incomplete: no unbounded loops or recursion', 'Only for testnets', 'Compiled to Ethereum bytecode', 'Without types'], a: 0 },
  { q: 'How is Pact code stored on chain?', o: ['As human-readable source', 'Encrypted', 'Only as a hash', 'Off chain on a server'], a: 0 },
  { q: 'Which namespace lets anyone deploy community modules on Kadena?', o: ['coin', 'free', 'root', 'admin'], a: 1 },
  { q: 'What is a principal account?', o: ['An account whose name is derived from its guard, such as k: or w:', 'The first account ever made', 'An exchange account', 'An account with more than 1,000 KDA'], a: 0 },
  { q: 'Your KDA is on chain 2. Can you spend it directly on chain 1?', o: ['Yes, chains share one balance', 'No, move it to chain 1 first with a cross-chain transfer', 'Only on weekends', 'Only with a miner\'s help'], a: 1 },
  { q: 'In Pact, what happens if you insert a row whose key already exists?', o: ['It overwrites the row', 'The transaction fails', 'It creates a duplicate', 'It is ignored'], a: 1 },
  { q: 'In Pact, what happens if you update a row that does not exist?', o: ['It creates the row', 'The transaction fails', 'It updates a random row', 'Nothing, silently'], a: 1 },
  { q: 'KDA amounts in Pact are written as which type?', o: ['integer', 'decimal', 'string', 'bool'], a: 1 },
  { q: 'What is Chainweaver?', o: ['A Kadena wallet and developer tool', 'A mining machine', 'An exchange', 'A Kadena chain'], a: 0 },
  { q: 'What is Linx?', o: ['A Kadena mining pool', 'A mobile wallet that supports Kadena', 'A Pact compiler', 'A block explorer'], a: 1 },
  { q: 'What does coin.create-account do?', o: ['Creates a KDA account with a name and guard', 'Mints new KDA', 'Deletes an account', 'Moves KDA across chains'], a: 0 },
  { q: 'What does the read function do in Pact?', o: ['Reads a row from a table by its key', 'Reads a file from disk', 'Reads the user\'s email', 'Reads a private key'], a: 0 },
  { q: 'In Pact, what does a capability\'s managed amount (as in coin.TRANSFER) protect against?', o: ['Spending more than the signer approved', 'Slow blocks', 'Typos in account names', 'High gas prices'], a: 0 },
  { q: 'Each Kadena chain keeps its own…', o: ['Copy of contracts and balances', 'Separate token called KDA2', 'Miner list only', 'Nothing; chains are empty'], a: 0 },
);

// ---------- Added Oct 19, 2026: more riddles ----------
RIDDLES.push(
  { q: 'You can hold me in your right hand but never in your left.', answers: ['left hand', 'your left hand', 'left elbow', 'elbow'] },
  { q: 'The more you take away from me, the bigger I get.', answers: ['hole'] },
  { q: 'I go up and down but never move.', answers: ['stairs', 'staircase', 'stair'] },
  { q: 'I have cities but no houses, forests but no trees, and water but no fish.', answers: ['map'] },
  { q: 'I am always in front of you but can never be seen.', answers: ['future'] },
  { q: 'I can be cracked, made, told and played.', answers: ['joke'] },
  { q: 'I have a thumb and four fingers but I am not alive.', answers: ['glove'] },
  { q: 'I have one head, one foot and four legs.', answers: ['bed'] },
  { q: 'What kind of room has no doors or windows?', answers: ['mushroom'] },
  { q: 'I run all the way around a yard without moving.', answers: ['fence'] },
  { q: 'Say my name and you break me.', answers: ['silence'] },
  { q: 'You can keep me even after you give me to someone.', answers: ['word', 'promise', 'your word'] },
  { q: 'I have thirteen hearts but no other organs.', answers: ['deck of cards', 'deck', 'cards', 'card deck'] },
  { q: 'I am light as a feather, yet the strongest person cannot hold me for long.', answers: ['breath'] },
  { q: 'I have branches but no leaves, no trunk and no fruit.', answers: ['bank'] },
  { q: 'This invention lets you look right through a wall.', answers: ['window'] },
  { q: 'I start with T, end with T, and have T in me.', answers: ['teapot'] },
  { q: 'Twelve or twenty-four words that bring a lost wallet back to life.', answers: ['seed phrase', 'recovery phrase', 'mnemonic', 'seed'] },
  { q: 'I do the work, guess after guess, and add new blocks to the chain.', answers: ['miner', 'mining rig', 'rig', 'asic'] },
  { q: 'I hold the keys to your coins, but never the coins themselves.', answers: ['wallet', 'crypto wallet'] },
  { q: 'Share me freely so people can send you coins.', answers: ['address', 'public key', 'account', 'wallet address'] },
  { q: 'A promise written in code that runs exactly as written.', answers: ['smart contract', 'contract', 'pact'] },
  { q: 'I hold the coins until both sides keep their promise.', answers: ['escrow'] },
  { q: 'I am the number that a block\'s hash must fall below. Miners fight me every block.', answers: ['target', 'difficulty'] },
  { q: 'I was the first block of a chain, with no parent before me.', answers: ['genesis', 'genesis block'] },
);

// ---------- Kadena Word: hidden 5-letter words ----------
export const WORDS = ['block', 'chain', 'miner', 'token', 'nonce', 'proof', 'braid', 'guard', 'asset', 'trade', 'value', 'coins', 'smart', 'vault', 'money', 'nodes', 'peers',
  'apple', 'beach', 'brain', 'bread', 'chair', 'cloud', 'dance', 'dream', 'earth', 'field', 'flame', 'fruit', 'ghost', 'grape', 'green', 'heart', 'horse', 'house', 'juice',
  'knife', 'laugh', 'light', 'lemon', 'magic', 'month', 'mouth', 'music', 'night', 'ocean', 'paint', 'party', 'piano', 'pilot', 'plane', 'plant', 'power', 'queen', 'river',
  'robot', 'round', 'salad', 'sheep', 'shirt', 'smile', 'snake', 'sound', 'space', 'spoon', 'sport', 'storm', 'sugar', 'table', 'tiger', 'toast', 'tower', 'train', 'water',
  'whale', 'world', 'write', 'youth', 'zebra', 'camel', 'candy', 'clock', 'crown', 'desert', 'eagle', 'falcon', 'honey', 'island', 'medal', 'olive', 'pearl', 'sands', 'stars',
].filter(w => /^[a-z]{5}$/.test(w));

// ---------- Spot the Pact bug ----------
// Each snippet has exactly one intended bug. `a` is the index of the correct option.
export const PACT_BUGS = [
  { code: `(defun withdraw:string (account:string amount:decimal)
  (enforce (> amount 0.0) "Amount must be positive")
  (with-read balances account { 'balance := bal }
    (enforce (<= amount bal) "Insufficient funds")
    (update balances account { 'balance: (- bal amount) })))`,
    o: ['Anyone can withdraw from any account: the account\'s guard is never checked', 'It allows negative balances', 'update should be insert', 'The amount should be an integer'], a: 0,
    guide: 'Good answers say there is no enforce-guard (or capability) for the account owner, so a stranger can drain anyone\'s balance.' },
  { code: `(defun debit:string (account:string amount:decimal)
  (require-capability (DEBIT account))
  (enforce (> amount 0.0) "Amount must be positive")
  (with-read balances account { 'balance := bal }
    (update balances account { 'balance: (- bal amount) })))`,
    o: ['require-capability should be with-capability', 'It never checks the balance is enough, so balances can go negative', 'The amount check should be >= 0.0', 'with-read cannot read decimals'], a: 1,
    guide: 'Good answers say there is no (enforce (<= amount bal)) check, so an account can spend more than it holds.' },
  { code: `(defun set-fee:string (new-fee:decimal)
  (enforce (>= new-fee 0.0) "Fee cannot be negative")
  (update config "global" { 'fee: new-fee }))`,
    o: ['Fees must be integers', 'The fee check should be > 0.0', 'Anyone can change the fee: there is no admin or governance check', 'update needs a with-read first'], a: 2,
    guide: 'Good answers say the function is not protected by GOVERNANCE or an admin keyset, so any user can set the fee.' },
  { code: `(defcap ADMIN ()
  true)

(defun pause:string ()
  (with-capability (ADMIN)
    (update config "global" { 'paused: true })))`,
    o: ['ADMIN grants itself to anyone because its body is just true', 'with-capability cannot be used in a defun', 'paused should be a string', 'The table name is wrong'], a: 0,
    guide: 'Good answers say the capability must enforce something, such as (enforce-guard (keyset-ref-guard "admin")); returning true lets anyone acquire it.' },
  { code: `(defun pay-claim:string (claim-id:string)
  (with-capability (OPS)
    (with-read claims claim-id { 'recipient := to, 'amount := amt }
      (install-capability (coin.TRANSFER ESCROW to amt))
      (coin.transfer ESCROW to amt))))`,
    o: ['The amount is not rounded', 'The claim is never marked paid, so the same claim can be paid again and again', 'install-capability is not allowed here', 'OPS should be GOVERNANCE'], a: 1,
    guide: 'Good answers say the claim state is never checked or updated (for example to "paid"), so it can be paid repeatedly until the escrow is empty.' },
  { code: `(defun refund:string (id:string)
  (with-read campaigns id { 'deadline := deadline, 'sponsor := sponsor, 'left := left }
    (enforce (< (at 'block-time (chain-data)) deadline) "Too early")
    (update campaigns id { 'left: 0.0 })
    (pay-out sponsor left)))`,
    o: ['The refund is allowed before the deadline: the time check is reversed', 'block-time is not a field of chain-data', 'left should be reset after paying', 'The sponsor cannot receive KDA'], a: 0,
    guide: 'Good answers say the comparison should be (>= now deadline): as written, refunds only work while the campaign is still open, letting the sponsor pull funds early.' },
  { code: `(defun rotate:string (account:string new-guard:guard)
  (enforce-guard new-guard)
  (update accounts account { 'guard: new-guard }))`,
    o: ['guards cannot be stored in tables', 'It checks the new guard instead of the current owner\'s guard, so anyone can take over an account', 'rotate must be a defpact', 'The account name must start with k:'], a: 1,
    guide: 'Good answers say it should enforce the account\'s existing guard (read from the table); checking the caller\'s own new guard lets an attacker set their key on someone else\'s account.' },
];
