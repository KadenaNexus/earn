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
