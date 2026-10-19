import { sigFromAnswer } from './walletconnect.js';
// A wallet injected into the page as window.kadena: the Ecko browser extension on a
// computer, or Linx's own in-app browser (Explore) on a phone, which offers the same API.
export class EckoWallet {
  constructor(provider = window.kadena) { this.provider=provider; this.kind='injected'; }
  async connect(network) {
    if(!this.provider?.isKadena||!this.provider.request)throw new Error('Install the Ecko desktop browser extension, unlock it, and refresh this page.');
    const connected=await this.provider.request({method:'kda_connect',networkId:network});
    if(connected?.status!=='success')throw new Error(connected?.message||'Wallet connection was declined.');
    // Linx answers kda_connect with the account; Ecko may need kda_checkStatus.
    let account=connected.account;
    if(!/^k:[0-9a-f]{64}$/.test(account?.account||'')){
      const status=await this.provider.request({method:'kda_checkStatus',networkId:network});
      if(status?.status==='success')account=status.account;
    }
    const name=account?.account||'',key=account?.publicKey||name.slice(2);
    if(!/^k:[0-9a-f]{64}$/.test(name)||key!==name.slice(2))throw new Error('Select a single-key k: account in your wallet.');
    return name;
  }
  async sign(command) {
    const body=JSON.parse(command.cmd),pubKey=body.signers[0].pubKey;
    const response=await this.provider.request({method:'kda_requestQuickSign',data:{networkId:body.networkId,commandSigDatas:[{cmd:command.cmd,sigs:body.signers.map(s=>({pubKey:s.pubKey,sig:null}))}]}});
    if(response?.status&&response.status!=='success')throw new Error(response?.error||response?.message||'Wallet signing was declined.');
    const entry=(response?.responses||response?.quickSignData)?.[0];
    // When the wallet echoes the command back, it must be exactly the one we asked it to sign.
    if(entry?.commandSigData?.cmd&&entry.commandSigData.cmd!==command.cmd)throw new Error('The wallet did not sign the expected transaction.');
    if(entry?.outcome?.hash&&entry.outcome.hash!==command.hash)throw new Error('The wallet did not sign the expected transaction.');
    return {...command,sigs:[{sig:sigFromAnswer(response,pubKey)}]};
  }
}
