export class EckoWallet {
  constructor(provider = window.kadena) { this.provider=provider; }
  async connect(network) {
    if(!this.provider?.isKadena||!this.provider.request)throw new Error('Install the Ecko desktop browser extension, unlock it, and refresh this page.');
    const connected=await this.provider.request({method:'kda_connect',networkId:network});
    if(connected?.status!=='success')throw new Error(connected?.message||'Wallet connection was declined.');
    const status=await this.provider.request({method:'kda_checkStatus',networkId:network});
    const account=status?.account;
    if(status?.status!=='success'||!/^k:[0-9a-f]{64}$/.test(account?.account||'')||account.publicKey!==account.account.slice(2))throw new Error('Select a single-key k: account in Ecko.');
    return account.account;
  }
  async sign(command) {
    const body=JSON.parse(command.cmd);
    const response=await this.provider.request({method:'kda_requestQuickSign',data:{networkId:body.networkId,commandSigDatas:[{cmd:command.cmd,sigs:body.signers.map(s=>({pubKey:s.pubKey,sig:null}))}]}});
    if(response?.status!=='success')throw new Error(response?.error||'Wallet signing was declined.');
    const entry=(response.responses||response.quickSignData)?.[0];
    if(entry?.outcome?.result!=='success'||entry.outcome.hash!==command.hash||entry.commandSigData?.cmd!==command.cmd)throw new Error('The wallet did not sign the expected transaction.');
    const sigs=entry.commandSigData.sigs;
    if(sigs.length!==1||sigs[0].pubKey!==body.signers[0].pubKey||!/^[0-9a-f]{128}$/.test(sigs[0].sig||''))throw new Error('Invalid signature returned by the wallet.');
    return {...command,sigs:[{sig:sigs[0].sig}]};
  }
}
