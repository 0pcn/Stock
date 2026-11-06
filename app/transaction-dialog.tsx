'use client';
import { useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import Dialog from './dialog';
import type { PortfolioApi, TransactionInput } from '../lib/portfolio-api';
import { validateTransaction } from '../lib/transaction-input.mjs';

type Props = { api: PortfolioApi; suggestions: (string | number | null)[][]; connected: boolean; close: () => void; onAuthorized: () => Promise<unknown>; onSaved: (inventoryUpdated: boolean) => Promise<void> };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
export default function TransactionDialog({ api, suggestions, connected, close, onAuthorized, onSaved }: Props) {
  const [form, setForm] = useState({ date: today(), code: '', name: '', market: '上市', action: '買入', shares: '', price: '', fee: '', tax: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<{ id: string; input: TransactionInput } | null>(null);
  const lock = useRef(false);
  const known = new Map(suggestions.filter(row => row[0] && row[1]).map(row => [String(row[0]), row]));
  const change = (key: keyof typeof form, value: string) => {
    setError('');
    setForm(previous => {
      const next = { ...previous, [key]: value };
      if (key === 'code') { const stock = known.get(value.trim().toUpperCase()); next.name = stock ? String(stock[1]) : ''; if (stock) next.market = String(stock[2]); }
      if (key === 'action' && value === '買入') next.tax = '';
      return next;
    });
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !api.addTransaction) return;
    if (!navigator.onLine) { setError('目前離線，請連上網路後再儲存。'); return; }
    let job = pending;
    if (!job) {
      try {
        const input = validateTransaction({ ...form, shares: Number(form.shares), price: Number(form.price), fee: form.fee === '' ? null : Number(form.fee), tax: form.tax === '' ? null : Number(form.tax) });
        job = { id: crypto.randomUUID(), input };
      } catch (error) { setError(error instanceof Error ? error.message : '請檢查交易資料。'); return; }
    }
    lock.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      if (api.login && (api.canRefresh ? !api.canRefresh() : !connected)) {
        const authorization = await api.login(); // Opens synchronously inside this submit gesture.
        if (authorization.status !== 'success') { setError(authorization.message || '授權未完成，資料尚未送出。'); return; }
        await onAuthorized();
      }
      setPending(job);
      sent = true;
      const outcome = await api.addTransaction(job.id, job.input);
      if (outcome.status === 'success') {
        setSaved(true);
        await onSaved(outcome.result.inventoryUpdated);
        if (outcome.result.inventoryUpdated) close();
        else setError(outcome.result.warning);
      } else {
        if (!['execution_unconfirmed', 'conflict'].includes(outcome.status) && !saved) setPending(null);
        setError(outcome.message || '儲存未完成，請確認交易記錄後再試。');
      }
    } catch { if (sent) setPending(job); setError(sent ? '尚未確認儲存結果，請保留視窗並按「確認這筆紀錄」，勿另開一筆新增。' : 'Google 授權暫時無法使用，這次尚未送出交易。'); }
    finally { lock.current = false; setBusy(false); }
  }
  const field = (key: keyof typeof form, label: string, type = 'text', extra: Record<string, any> = {}) => <label className="transaction-field"><span>{label}</span><input name={key} aria-label={label} type={type} value={form[key]} onChange={event => change(key, event.target.value)} {...extra}/></label>;
  const amount = Number(form.shares) * Number(form.price);
  return <Dialog title="新增交易" close={() => { if (!lock.current) close(); }}>
    <h2>新增交易</h2><p className="sheet-intro">儲存到股票試算表，並重新計算庫存。</p>
    <form className="transaction-form" onSubmit={submit}>
      <fieldset disabled={busy || Boolean(pending)}>
        <div className="transaction-fields">
          {field('date', '交易日期', 'date', { required: true, max: today() })}
          <label className="transaction-field"><span>買賣別</span><select aria-label="買賣別" value={form.action} onChange={event => change('action', event.target.value)}><option>買入</option><option>賣出</option></select></label>
          {field('code', '股票代號', 'text', { required: true, maxLength: 16, list: 'transaction-stock-options', autoCapitalize: 'characters', autoComplete: 'off', placeholder: '例如 0050' })}
          {field('name', '股票名稱', 'text', { required: true, maxLength: 60, placeholder: '例如 元大台灣50' })}
          <label className="transaction-field"><span>市場</span><select aria-label="市場" value={form.market} onChange={event => change('market', event.target.value)}><option>上市</option><option>上櫃</option><option>美股</option></select></label>
          {field('shares', '交易股數（股）', 'number', { required: true, min: 1, max: 100000000, step: 1, inputMode: 'numeric' })}
          {field('price', '成交價', 'number', { required: true, min: 0.000001, max: 10000000, step: 'any', inputMode: 'decimal' })}
        </div>
        <datalist id="transaction-stock-options">{[...known].map(([code, stock]) => <option key={code} value={code}>{String(stock[1])}</option>)}</datalist>
        <p className="transaction-help">股數以「股」為單位填寫。成交價使用原試算表的幣別。</p>
        <details className="transaction-options"><summary>費用與備註（可選）</summary><div className="transaction-fields">
          {field('fee', '手續費', 'number', { min: 0, step: 1, placeholder: '留空自動計算', inputMode: 'numeric' })}
          {field('tax', '交易稅', 'number', { min: 0, step: 1, placeholder: form.action === '買入' ? '買入為 0' : '留空自動計算', inputMode: 'numeric' })}
          {field('note', '備註', 'text', { maxLength: 200 })}
        </div><p className="transaction-help">自動費用沿用試算表規則；請以券商對帳單為準，可填入實際費用。</p></details>
      </fieldset>
      <div className="transaction-total"><span>成交金額（未含費用）</span><strong>{Number.isFinite(amount) && amount > 0 ? amount.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}</strong></div>
      {!connected && <p className="transaction-help">儲存時需要 Google 授權，表單內容會保留。</p>}
      {error && <p className="transaction-error" role="alert">{error}</p>}
      <button className="primary-button full-width" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin"/>正在儲存與重算</> : saved ? '重新整理庫存' : pending ? '確認這筆紀錄' : !connected ? '授權並儲存' : '儲存交易'}</button>
      {saved && <button className="secondary-button full-width" type="button" disabled={busy} onClick={close}>完成，稍後更新庫存</button>}
      <p className="transaction-help">{pending && !saved ? '結果未確認前，這筆內容已鎖定；確認時會使用相同紀錄 ID，避免重複新增。' : '新增後可到原試算表更正紀錄。'}</p>
    </form>
  </Dialog>;
}
