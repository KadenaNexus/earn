import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir=new URL('../tmp/pact-tests/',import.meta.url);await mkdir(dir,{recursive:true});
// Use the production source, with the same escrow-account substitution as deployment.
const contract=(await readFile(new URL('../contracts/escrow.pact',import.meta.url),'utf8')).replaceAll('__ESCROW_ACCOUNT__','kadena-earn-escrow');
await writeFile(new URL('../contracts/test/compiled-escrow.pact',import.meta.url),contract);
const repl=(await readFile(new URL('../contracts/test/escrow.repl',import.meta.url),'utf8')).replace('../escrow.pact','compiled-escrow.pact').replaceAll('__ESCROW_ACCOUNT__','kadena-earn-escrow');
await writeFile(new URL('../contracts/test/compiled.repl',import.meta.url),repl);
const result=spawnSync(process.env.PACT_BIN||fileURLToPath(new URL('../.local/pact',import.meta.url)),['compiled.repl'],{cwd:new URL('../contracts/test/',import.meta.url),encoding:'utf8'});
await writeFile(new URL('results.log',dir),(result.stdout||'')+(result.stderr||''));
console.log(result.stdout||'',result.error?.message||result.stderr||'');
if(result.error||result.status!==0||/FAILURE|Load failed|Error:/i.test(result.stdout+result.stderr))process.exitCode=1;
