// Wallet choice for Kadena Earn: Linx or the Ecko app on a phone (WalletConnect),
// or the Ecko browser extension on a computer. Both share connect(network) and sign(command).
import { EckoWallet } from './wallet.js';
import { PhoneWallet } from './walletconnect.js';

const KEY = 'ke-wallet';
export const hasEcko = () => !!window.kadena?.isKadena;
const remember = kind => { try { localStorage.setItem(KEY, kind); } catch { /* private mode */ } };
const remembered = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

/** The wallet the user signed in with last, for later signatures (owner funding, pause). */
export function restoreWallet() {
  if (remembered() === 'phone' || (!hasEcko() && PhoneWallet.hasSession())) return new PhoneWallet();
  return new EckoWallet();
}
export function forgetWallet() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Asks which wallet to use. Phones without the Ecko extension go straight to Linx. */
export function chooseWallet() {
  if (!hasEcko()) { remember('phone'); return Promise.resolve(new PhoneWallet()); }
  return new Promise((resolve, reject) => {
    const box = document.createElement('div');
    box.className = 'wc-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'wPickTitle');
    box.innerHTML = `<div class="wc-panel">
      <div class="wc-head"><h2 id="wPickTitle">Connect a wallet</h2><button type="button" class="wc-x" aria-label="Close">✕</button></div>
      <button type="button" class="wallet-choice" data-kind="phone"><b>Linx or Ecko app</b><span>Phone wallet, by WalletConnect</span></button>
      <button type="button" class="wallet-choice" data-kind="ecko"><b>Ecko extension</b><span>In this browser</span></button>
      <p class="wc-note">Signing in sends no transaction and costs no gas. Use a single-key k: account.</p></div>`;
    document.body.append(box);
    const done = fn => { box.remove(); fn(); };
    box.querySelector('.wc-x').onclick = () => done(() => reject(new Error('No wallet chosen.')));
    box.querySelectorAll('.wallet-choice').forEach(b => b.onclick = () => done(() => { remember(b.dataset.kind); resolve(b.dataset.kind === 'phone' ? new PhoneWallet() : new EckoWallet()); }));
    box.querySelector('.wallet-choice').focus();
  });
}
