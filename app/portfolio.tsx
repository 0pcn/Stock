'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { serverApi, type PortfolioApi, type Connection } from '../lib/portfolio-api';
import { unrealizedPosition } from '../lib/holding-metrics.mjs';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, ChartNoAxesCombined, Check, ChevronRight, Eye, EyeOff, Flower2, Info, Leaf, LoaderCircle, LogOut, Plus, RefreshCw, Search, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Wallet, X } from 'lucide-react';

type Row = (string | number | null)[];
type Source = { rows: Row[]; loading: boolean; error: string; status?: string; at?: string; retryAt?: number };
type Tab = 'holdings' | 'overview' | 'transactions' | 'dividends' | 'settings';
const sourceNames: Record<string, string> = { holdings: '庫存總覽', realized: '已實現損益', transactions: '交易記錄', dividends: '股利記錄', settings: '設定' };
const sheetURL = 'https://docs.google.com/spreadsheets/d/1RH2r6Hx_y6-AuzZ_XXRw5dmVSnUqoUK2IfmtJF15w70/edit';
const navigation = [
  { id: 'holdings', label: '庫存', title: '我的庫存', icon: Wallet },
  { id: 'overview', label: '分析', title: '資產分析', icon: ChartNoAxesCombined },
  { id: 'transactions', label: '交易', title: '交易記錄', icon: ArrowLeftRight },
  { id: 'dividends', label: '股利', title: '股利記錄', icon: Flower2 },
  { id: 'settings', label: '我的', title: '我的帳戶', icon: Settings },
] as const;
const palette = ['#426d58', '#99b38f', '#ccbc8b', '#899fac', '#b49eb2', '#ccd0c1'];
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value: number, decimals = 0) => value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;
const percent = (value: number) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
const normalizeCode = (value: unknown) => ({ '50': '0050', '56': '0056', '713': '00713', '919': '00919', '935': '00935', '9816': '009816' } as Record<string, string>)[String(value)] || String(value ?? '');
const stockName = (value: unknown) => typeof value === 'number' ? normalizeCode(value) : String(value ?? '');
const records = (rows: Row[]) => rows.slice(1).filter(row => row.some(value => value !== null && value !== '') && !String(row[0]).includes('合計'));
function sheetDate(value: unknown, time = false) { return typeof value === 'number' ? new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, time ? 16 : 10).replace('T', ' ') : value ? String(value) : '—'; }
function rowsFrom(result: any): Row[] {
  if (Array.isArray(result?.values)) return result.values;
  if (result?.structuredContent) return rowsFrom(result.structuredContent);
  for (const block of result?.content || []) if (block.type === 'text') { try { const data = JSON.parse(block.text); if (data.values || data.structuredContent) return rowsFrom(data); } catch {} }
  throw new Error('未收到完整的試算表資料，請重新同步。');
}
function GoogleMark() { return <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.23-2.51c-.9.6-2.04.97-3.39.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.51l2.88-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59A5.99 5.99 0 0 1 12 5.96Z"/></svg>; }
function Empty({ loading, title, text }: { loading?: boolean; title: string; text?: string }) { return <div className="empty-state">{loading ? <LoaderCircle className="spin" size={26}/> : <Wallet size={28}/>}<strong>{title}</strong>{text && <p>{text}</p>}</div>; }
function Dialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; element.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { document.body.style.overflow = overflow; previous?.focus(); }; }, []);
  return <div className="sheet-backdrop" onClick={close}><section ref={element} className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') close(); if (event.key !== 'Tab') return; const focusable = Array.from(element.current?.querySelectorAll<HTMLElement>('a[href],button,input,select') || []); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><div className="sheet-handle"/><button className="icon-button sheet-close" aria-label="關閉" onClick={close}><X size={21}/></button>{children}</section></div>;
}

export default function Portfolio({ api = serverApi, baseUrl = '/' }: { api?: PortfolioApi; baseUrl?: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [tab, setTab] = useState<Tab>('holdings');
  const [data, setData] = useState<Record<string, Source>>({});
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('全部');
  const [sort, setSort] = useState('value');
  const [includeDiv, setIncludeDiv] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [analysisTab, setAnalysisTab] = useState('allocation');
  const [year, setYear] = useState('全部年度');
  const [detail, setDetail] = useState<Row | null>(null);
  const [install, setInstall] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [syncPhase, setSyncPhase] = useState<'prices' | 'data' | null>(null);
  const [syncError, setSyncError] = useState('');
  const syncLock = useRef(false);
  const generation = useRef(0);
  const updatesPrices = Boolean(connection?.priceRefreshConfigured);

  async function checkSession() {
    const version = generation.current;
    setChecking(true); setAuthError('');
    try {
      const result = await api.status();
      if (!['local', 'hosted', 'pages'].includes(result.mode) || typeof result.connected !== 'boolean') throw new Error();
      if (version === generation.current) setConnection(result);
    } catch { if (version === generation.current) setAuthError('目前無法確認登入狀態，請確認網路後再試一次。'); }
    finally { if (version === generation.current) setChecking(false); }
  }
  function clearSession(signInPath?: string) {
    generation.current++; setData({}); setDetail(null); setInstall(false); setTab('holdings'); setQuery(''); setMarket('全部');
    setConnection(previous => previous ? { ...previous, connected: false, ...(signInPath ? { signInPath } : {}) } : null);
    setChecking(false); setSyncError(''); setSyncPhase(null);
  }
  async function readSource(key: string) {
    const version = generation.current;
    setData(previous => ({ ...previous, [key]: { ...previous[key], rows: previous[key]?.rows || [], loading: true, error: '' } }));
    try {
      const result: any = await api.read(key);
      if (version !== generation.current) return false;
      if (result.status === 'reauthentication_required') { setAuthNotice('登入狀態已過期，請重新登入以查看庫存。'); clearSession(result.signInPath); return false; }
      if (result.status !== 'success') {
        setData(previous => ({ ...previous, [key]: { ...previous[key], loading: false, error: result.message || '同步未完成，請稍後重試。', status: result.status, retryAt: result.retryAfterMs ? Date.now() + result.retryAfterMs : undefined } })); return false;
      }
      const rows = rowsFrom(result.result);
      setData(previous => ({ ...previous, [key]: { rows, loading: false, error: '', at: new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }) } }));
      if (key === 'settings') { const setting = rows.find(row => row[0] === '含股利模式'); if (setting) setIncludeDiv(setting[1] === '是'); }
      return true;
    } catch {
      if (version === generation.current) setData(previous => ({ ...previous, [key]: { ...previous[key], rows: previous[key]?.rows || [], loading: false, error: navigator.onLine ? '暫時無法同步，請再試一次。' : '目前離線，恢復網路後即可查看最新資料。' } }));
      return false;
    }
  }
  async function refresh() {
    if (!connection?.connected || syncLock.current || Object.values(data).some(source => source.loading)) return;
    syncLock.current = true; setSyncPhase(updatesPrices ? 'prices' : 'data'); setSyncError('');
    const version = generation.current;
    try {
      if (!updatesPrices) {
        const reads = await Promise.all(Object.keys(sourceNames).map(key => readSource(key)));
        if (version !== generation.current) return;
        if (reads.every(Boolean)) setToast('已重新讀取試算表資料');
        return;
      }
      const outcome: any = await api.refresh(crypto.randomUUID());
      if (version !== generation.current) return;
      if (outcome.status === 'reauthentication_required') {
        setAuthNotice(outcome.message || '更新現價需要重新登入。完成授權後，請再次按同步。');
        clearSession(outcome.signInPath); return;
      }
      if (outcome.status !== 'success') { setSyncError(outcome.message || '尚未確認現價更新結果，請先查看試算表。'); return; }
      setSyncPhase('data');
      const reads = await Promise.all(Object.keys(sourceNames).map(key => readSource(key)));
      if (version !== generation.current) return;
      const result = outcome.result;
      if (result.failed.length) setSyncError(`已更新 ${result.updated} 檔；${result.failed.join('、')} 抓價失敗，保留上次現價。`);
      if (!reads.every(Boolean)) setSyncError(previous => (previous ? previous + ' ' : '') + '股價更新已完成，但部分畫面資料讀取失敗，請使用資料旁的重試按鈕。');
      setToast(result.failed.length ? `現價更新完成：成功 ${result.updated} 檔、失敗 ${result.failed.length} 檔` : `已更新 ${result.updated} 檔現價與損益`);
    } catch { if (version === generation.current) setSyncError('連線中斷，尚未確認現價是否更新完成。請先查看試算表，再決定是否重試。'); }
    finally { syncLock.current = false; setSyncPhase(null); }
  }
  async function signIn() {
    if (!api.login || signingIn) return;
    setSigningIn(true); setAuthNotice('');
    try {
      const result = await api.login();
      if (result.status === 'success') await checkSession();
      else setAuthNotice(result.message || 'Google 登入尚未完成。');
    } catch { setAuthNotice('Google 登入暫時無法使用，請稍後重試。'); }
    finally { setSigningIn(false); }
  }
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const result: any = await api.logout();
      if (result.status !== 'success') throw new Error();
      clearSession(); setAuthNotice('你已安全登出。');
    } catch { setToast('登出未完成，請稍後再試。'); }
    finally { setSigningOut(false); }
  }
  useEffect(() => {
    const notices: Record<string, string> = { denied: 'Google 授權已取消，你可以隨時重新登入。', expired: '登入驗證已過期，請重新登入。', configuration: '連線設定尚未完成，請確認 Google OAuth 設定。', scope: '請允許股票工具所需的三個 Google 權限，再重新登入。', failed: 'Google 登入未完成，請確認 OAuth 設定後再試一次。' };
    const result = new URLSearchParams(window.location.search).get('google_auth');
    if (result) { setAuthNotice(notices[result] || ''); window.history.replaceState({}, '', window.location.pathname); }
    void api.initialize?.().catch(() => setAuthNotice('無法載入 Google 登入，請確認網路後再試一次。'));
    const unsubscribe = api.subscribe?.(() => { setAuthNotice('Google 授權已到期，請重新登入。'); clearSession(); });
    void checkSession();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register(baseUrl + 'sw.js', { scope: baseUrl }).catch(() => {});
    const prompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', prompt);
    return () => { unsubscribe?.(); window.removeEventListener('beforeinstallprompt', prompt); generation.current++; };
  }, []);
  useEffect(() => { if (connection?.connected) Object.keys(sourceNames).forEach(key => void readSource(key)); }, [connection?.connected]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);

  const holds = useMemo(() => records(data.holdings?.rows || []).filter(row => number(row[3]) > 0), [data.holdings?.rows]);
  const trades = useMemo(() => records(data.transactions?.rows || []).sort((a, b) => number(b[0]) - number(a[0])), [data.transactions?.rows]);
  const dividends = useMemo(() => records(data.dividends?.rows || []).filter(row => typeof row[2] === 'number').sort((a, b) => number(b[2]) - number(a[2])), [data.dividends?.rows]);
  const realized = records(data.realized?.rows || []);
  const total = (index: number) => holds.reduce((sum, row) => sum + number(row[index]), 0);
  const value = total(7), cost = total(6), unrealized = total(9), dividend = total(11);
  const loaded = Boolean(data.holdings?.at), busy = syncPhase !== null || Object.values(data).some(source => source.loading);
  const fmt = (value: number, decimals = 0) => hidden ? '••••' : money(value, decimals);
  const sgn = (value: number) => hidden ? '••••' : signed(value);
  const rate = (value: number) => hidden ? '••%' : percent(value);
  const tone = (value: number) => value >= 0 ? 'gain' : 'loss';
  const visible = holds.filter(row => (market === '全部' || (market === 'ETF' ? normalizeCode(row[0]).startsWith('00') : row[2] === market)) && `${normalizeCode(row[0])} ${row[1]}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'value' ? number(b[7]) - number(a[7]) : sort === 'return' ? unrealizedPosition(b).returnRate - unrealizedPosition(a).returnRate : normalizeCode(a[0]).localeCompare(normalizeCode(b[0])));
  const filteredTrades = trades.filter(row => `${normalizeCode(row[1])} ${row[2]}`.includes(query) && (market === '全部' || row[4] === market));
  const years = Array.from(new Set(dividends.map(row => sheetDate(row[2]).slice(0, 4)))).sort().reverse();
  const filteredDividends = dividends.filter(row => (year === '全部年度' || sheetDate(row[2]).startsWith(year)) && `${normalizeCode(row[0])} ${stockName(row[1])}`.includes(query));
  const allocation = [...holds].sort((a, b) => number(b[7]) - number(a[7]));
  const pie = allocation.length > 5 ? [...allocation.slice(0, 5).map(row => ({ name: stockName(row[1]), value: number(row[7]) })), { name: '其他持股', value: allocation.slice(5).reduce((sum, row) => sum + number(row[7]), 0) }] : allocation.map(row => ({ name: stockName(row[1]), value: number(row[7]) }));
  const dividendsTotal = filteredDividends.reduce((sum, row) => sum + number(row[5]), 0);
  function changeTab(next: Tab) { setTab(next); setQuery(''); setMarket('全部'); window.scrollTo({ top: 0, behavior: 'auto' }); }
  function exportCSV(source: string) {
    const rows = data[source]?.rows || [];
    if (!rows.length) { setToast('資料讀取完成後就能匯出。'); return; }
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `藏股-${sourceNames[source]}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); setToast('已匯出 CSV。');
  }
  function errorPanel(key: string) {
    const source = data[key]; if (!source?.error) return null;
    return <div className="inline-error" role="alert"><Info size={17}/><div><strong>{source.rows.length ? '更新未完成，顯示上次資料' : `${sourceNames[key]}暫時無法讀取`}</strong><p>{source.error}</p></div><button aria-label={`重新讀取${sourceNames[key]}`} className="icon-button" disabled={source.loading} onClick={() => { if (source.retryAt && Date.now() < source.retryAt) setToast('請稍候再試。'); else void readSource(key); }}><RefreshCw size={17}/></button></div>;
  }
  function search(label: string) { return <label className="search-field"><Search size={18}/><input aria-label={label} placeholder="搜尋股票名稱或代號" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="清除搜尋" onClick={() => setQuery('')}><X size={16}/></button>}</label>; }
  const includeToggle = <label className="switch-label"><span>含股利</span><input type="checkbox" aria-label="含股利" checked={includeDiv} onChange={event => setIncludeDiv(event.target.checked)}/><span className="switch"/></label>;
  const installSheet = install && <Dialog title="加入主畫面" close={() => setInstall(false)}><div className="sheet-icon"><Smartphone size={26}/></div><h2>把藏股，放進口袋。</h2><p className="sheet-intro">下次輕點主畫面圖示，就能打開你的庫存。</p>{installPrompt && <button className="primary-button full-width" onClick={async () => { await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }}>安裝藏股<ArrowDownToLine size={18}/></button>}<div className="help-step"><strong>iPhone / iPad</strong><p>使用 Safari 開啟網站，點「分享」→「加入主畫面」→「新增」。若出現「以網頁 App 開啟」，請開啟。</p></div><div className="help-step"><strong>Android / 電腦</strong><p>在 Chrome 或 Edge 的選單中選擇「安裝應用程式」或「加入主畫面」。</p></div><p className="fine-print">查看股票資料需要網路連線；首次從主畫面開啟可能需要重新登入。</p></Dialog>;

  if (checking || !connection?.connected) return <main className="login-screen">
    <header className="login-brand"><img src={baseUrl + 'icon.svg'} alt=""/><span>藏股<small>STOCKFOLIO</small></span></header>
    <div className="login-content"><div className="login-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-leaf"><Leaf size={27}/></div><div className="art-card art-card-back"/><div className="art-card"><span className="art-card-heading"><Wallet size={19}/>MY PORTFOLIO<ShieldCheck size={16}/></span><div className="art-bars"><i/><i/><i/><i/><i/></div><div className="art-card-footer"><span/><span/></div></div><span className="art-check"><Check size={20}/></span></div>
      <p className="eyebrow">YOUR INVESTMENT, AT A GLANCE</p><h1>你的庫存，<br/>一眼就懂。</h1><p className="login-description">把持股、損益與股利放在一起，<br/>每一份累積，都清楚可見。</p>
      {checking ? <div className="login-loading" role="status"><LoaderCircle className="spin" size={20}/>正在確認登入狀態</div> : <div className="login-actions">
        {authError ? <><p className="login-message" role="alert">{authError}</p><button className="primary-button full-width" onClick={() => void checkSession()}><RefreshCw size={18}/>重新連線</button></> : connection?.configured ? (api.login ? <button className="google-signin full-width" onClick={() => void signIn()} disabled={signingIn}><GoogleMark/><span>{signingIn ? '正在登入 Google' : '使用 Google 帳號登入'}</span><ArrowUpRight size={17}/></button> : <a className="google-signin" href={connection.signInPath || '/api/auth/google/start'} target="_top"><GoogleMark/><span>使用 Google 帳號登入</span><ArrowUpRight size={17}/></a>) : <div className="login-message" role="alert"><Info size={19}/><p>連線設定尚未完成。<br/>{connection?.configurationError || '請確認 Google OAuth 設定後再試一次。'}</p><button className="text-button" onClick={() => void checkSession()}>重新檢查<RefreshCw size={14}/></button></div>}
        {authNotice && <p className="auth-notice" role="status">{authNotice}</p>}<p className="login-caption">使用有這份試算表權限的帳號；更新現價需要編輯權限</p><a className="text-button" href={baseUrl + (connection?.mode === 'pages' ? 'privacy.html' : 'privacy')}>隱私權說明</a>
      </div>}
    </div><footer className="login-footer"><ShieldCheck size={15}/><span>Google 授權・固定試算表</span><button onClick={() => setInstall(true)} aria-label="查看加入主畫面說明"><Smartphone size={17}/></button></footer>{installSheet}
  </main>;

  return <div className="app-shell"><header className="app-header"><div><span className="app-wordmark">藏股 <span>STOCKFOLIO</span></span><h1>{navigation.find(item => item.id === tab)?.title}</h1></div><div className="header-actions"><button className="icon-button" aria-label={hidden ? '顯示金額' : '隱藏金額'} onClick={() => setHidden(!hidden)}>{hidden ? <EyeOff size={20}/> : <Eye size={20}/>}</button><button className="icon-button sync-button" aria-label={updatesPrices ? '更新現價並同步' : '同步資料'} onClick={refresh} disabled={busy}><RefreshCw size={19} className={busy ? 'spin' : ''}/></button></div></header>
    <main className="app-content">
      {syncError && <div className="inline-error" role="alert"><Info size={17}/><div><strong>同步結果</strong><p>{syncError}</p></div><button className="icon-button" aria-label="關閉同步訊息" onClick={() => setSyncError('')}><X size={16}/></button></div>}
      {tab === 'holdings' && <>
        <section className="portfolio-hero" aria-label="庫存摘要"><div className="hero-caption"><span>未實現損益</span><span className="currency-label">TWD</span></div><div className={`hero-amount hero-unrealized ${tone(unrealized)}`}><small>NT$</small>{loaded ? sgn(unrealized) : '—'}{loaded && cost > 0 && <span className="hero-return">{rate(unrealized / cost)}</span>}</div><div className="hero-metrics"><div><span>持股總市值</span><strong>{loaded ? fmt(value) : '—'}</strong></div><button className="hero-analysis" onClick={() => changeTab('overview')} aria-label="查看資產分析"><ChartNoAxesCombined size={19}/><ChevronRight size={15}/></button></div><div className="hero-update"><span className={`status-dot ${data.holdings?.error ? 'warning' : ''}`}/>{syncPhase === 'prices' ? '正在執行現價更新' : syncPhase === 'data' ? (updatesPrices ? '正在讀取更新後的庫存' : '正在讀取試算表資料') : busy ? '正在同步資料' : data.holdings?.at ? `讀取於 ${data.holdings.at}` : '正在讀取庫存'}<span>{loaded ? `${holds.length} 檔持股` : '—'}</span></div></section>
        {errorPanel('holdings')}{search('搜尋庫存')}
        <div className="stock-filters"><div className="chips" aria-label="市場篩選">{['全部', '上市', '上櫃', 'ETF'].map(item => <button key={item} className={market === item ? 'selected' : ''} aria-pressed={market === item} onClick={() => setMarket(item)}>{item}</button>)}</div><label className="sort-control"><SlidersHorizontal size={17}/><span className="sr-only">庫存排序</span><select aria-label="庫存排序" value={sort} onChange={event => setSort(event.target.value)}><option value="value">市值</option><option value="return">未實現報酬率</option><option value="code">代號</option></select></label></div>
        <div className="list-heading"><span>{query || market !== '全部' ? `符合條件 ${visible.length} 檔` : '全部持股'}<small>點選查看明細</small></span><span className="holdings-metric-label">未實現損益 / 報酬率</span></div>
        <section className="stock-list" aria-label="我的持股清單">{visible.map((row, index) => <button className="holding-row" key={normalizeCode(row[0])} aria-label={`查看${stockName(row[1])} ${normalizeCode(row[0])}持股明細`} onClick={() => setDetail(row)}><span className="stock-symbol" style={{ background: palette[index % 5] + '18', color: palette[index % 5] }}>{normalizeCode(row[0]).startsWith('00') ? 'ETF' : stockName(row[1]).slice(0, 1)}</span><span className="holding-identity"><strong>{stockName(row[1])}</strong><span>{normalizeCode(row[0])}<i/> {fmt(number(row[3]))} 股</span><small>現價 {fmt(number(row[5]), 2)}</small></span><span className="holding-numbers"><strong>{fmt(number(row[7]))}</strong><span className={tone(unrealizedPosition(row).profitLoss)}>{sgn(unrealizedPosition(row).profitLoss)}</span><small className={tone(unrealizedPosition(row).returnRate)}>{rate(unrealizedPosition(row).returnRate)}<ChevronRight size={12}/></small></span></button>)}{!visible.length && <Empty loading={!loaded && !data.holdings?.error} title={!loaded ? data.holdings?.error ? '資料還沒準備好' : '正在整理你的庫存' : query || market !== '全部' ? '沒有符合條件的持股' : '目前沒有持股'} text={query ? '試試其他股票名稱或代號。' : '同步後就能在這裡查看持股。'}/>}</section>
        <p className="data-caption">金額為新台幣・首頁僅顯示未實現損益，累計損益請點選明細</p>
      </>}
      {tab === 'overview' && <>
        <div className="segmented-control"><button className={analysisTab === 'allocation' ? 'selected' : ''} onClick={() => setAnalysisTab('allocation')}>資產配置</button><button className={analysisTab === 'realized' ? 'selected' : ''} onClick={() => setAnalysisTab('realized')}>已實現損益</button></div>
        {analysisTab === 'allocation' ? <>{errorPanel('holdings')}<div className="metric-grid"><div><span>持有成本</span><strong>{loaded ? fmt(cost) : '—'}</strong></div><div><span>未實現損益</span><strong className={tone(unrealized)}>{loaded ? sgn(unrealized) : '—'}</strong></div><div><span>持股累計股利</span><strong>{loaded ? fmt(dividend) : '—'}</strong></div><div><span>含股利報酬率</span><strong className={tone(total(12))}>{loaded && cost ? rate(total(12) / cost) : '—'}</strong></div></div>
        <section className="content-card allocation-card"><div className="section-heading"><h2>每一份持有的比例</h2><span>依市值</span></div><div className="donut"><svg viewBox="0 0 220 220" role="img" aria-label="持股市值配置圖"><circle cx="110" cy="110" r="82" fill="none" stroke="#edf0e8" strokeWidth="22"/>{pie.map((item, index) => { const offset = pie.slice(0, index).reduce((sum, prior) => sum + (value ? prior.value / value * 515.22 : 0), 0); const length = value ? item.value / value * 515.22 : 0; return <circle key={item.name} cx="110" cy="110" r="82" fill="none" stroke={palette[index]} strokeWidth="22" strokeDasharray={`${Math.max(0, length - 3)} ${515.22 - Math.max(0, length - 3)}`} strokeDashoffset={-offset} transform="rotate(-90 110 110)"><title>{item.name}：{value ? (item.value / value * 100).toFixed(1) : 0}%</title></circle>; })}</svg><div><span>持股檔數</span><strong>{loaded ? holds.length : '—'}</strong><small>股票 / ETF</small></div></div><div className="allocation-legend">{pie.map((item, index) => <div key={item.name}><i style={{ background: palette[index] }}/><span>{item.name}</span><strong>{hidden ? '••%' : value ? (item.value / value * 100).toFixed(1) + '%' : '—'}</strong></div>)}</div></section>
        <section className="content-card"><div className="section-heading"><h2>持股表現</h2>{includeToggle}</div>{[...holds].sort((a, b) => number(b[includeDiv ? 14 : 13]) - number(a[includeDiv ? 14 : 13])).slice(0, 5).map((row, index) => <button className="performance-row" key={normalizeCode(row[0])} onClick={() => setDetail(row)}><span className="rank-number">0{index + 1}</span><span>{stockName(row[1])}<small>{normalizeCode(row[0])}</small></span><strong className={tone(number(row[includeDiv ? 14 : 13]))}>{rate(number(row[includeDiv ? 14 : 13]))}</strong><ChevronRight size={15}/></button>)}</section></> : <>{errorPanel('realized')}{errorPanel('holdings')}<section className="soft-summary"><span>全部股票已實現價差</span><strong className={tone(total(8) + realized.reduce((sum, row) => sum + number(row[3]), 0))}>{sgn(total(8) + realized.reduce((sum, row) => sum + number(row[3]), 0))}</strong><p>包含目前持股與已出清股票</p></section><div className="section-heading outside"><h2>已出清股票</h2><button className="text-button" onClick={() => exportCSV('realized')}><ArrowDownToLine size={15}/>匯出</button></div><section className="record-list">{realized.map(row => <article className="record-card" key={normalizeCode(row[0])}><div className="record-top"><div><h3>{stockName(row[1])}</h3><p>{normalizeCode(row[0])} · {row[2]}</p></div><div className="record-number"><strong className={tone(number(row[5]))}>{sgn(number(row[5]))}</strong><small>含股利總損益</small></div></div><div className="record-meta"><span>價差 {sgn(number(row[3]))}</span><span>股利 {fmt(number(row[4]))}</span></div></article>)}{!realized.length && <Empty loading={data.realized?.loading} title="目前沒有已出清股票"/>}</section></>}
      </>}
      {tab === 'transactions' && <>{errorPanel('transactions')}<div className="section-toolbar"><p>每一次買賣，都有跡可循。</p><a className="compact-action" href={sheetURL + '#gid=419336587'} target="_blank" rel="noreferrer"><Plus size={16}/>記錄交易<ArrowUpRight size={13}/></a></div>{search('搜尋交易')}<div className="stock-filters"><div className="chips">{['全部', '買入', '賣出'].map(item => <button key={item} className={market === item ? 'selected' : ''} onClick={() => setMarket(item)}>{item}</button>)}</div><button className="icon-button" aria-label="匯出交易記錄" onClick={() => exportCSV('transactions')}><ArrowDownToLine size={18}/></button></div><section className="record-list" aria-label="交易清單">{filteredTrades.map((row, index) => <article className="record-card" key={index}>{(index === 0 || sheetDate(filteredTrades[index - 1][0]) !== sheetDate(row[0])) && <time className="record-date">{sheetDate(row[0])}</time>}<div className="record-top"><span className={`trade-type ${row[4] === '買入' ? 'buy' : 'sell'}`}>{row[4] === '買入' ? '買' : '賣'}</span><div><h3>{stockName(row[2])}</h3><p>{normalizeCode(row[1])} · {fmt(number(row[5]))} 股</p></div><div className="record-number"><strong>{fmt(number(row[9]))}</strong><small>{row[4] === '買入' ? '實際成本' : '實際收入'}</small></div></div><div className="record-meta"><span>成交價 {fmt(number(row[6]), 2)}</span><span>手續費 {fmt(number(row[7]))} · 稅 {fmt(number(row[8]))}</span></div>{row[10] && <p className="record-note">{row[10]}</p>}</article>)}{!filteredTrades.length && <Empty loading={data.transactions?.loading} title="沒有符合條件的交易"/>}</section><p className="data-caption">共 {filteredTrades.length} 筆・記錄交易會開啟原始試算表</p></>}
      {tab === 'dividends' && <>{errorPanel('dividends')}<section className="dividend-summary"><span><Flower2 size={17}/>{year === '全部年度' ? '歷年累計股利' : year + ' 年股利'}</span><strong><small>NT$</small>{fmt(dividendsTotal)}</strong><p>{filteredDividends.length} 筆配息 · {new Set(filteredDividends.map(row => normalizeCode(row[0]))).size} 檔股票</p></section><section className="content-card year-chart" aria-label="歷年股利圖">{[...years].reverse().map(item => { const amount = dividends.filter(row => sheetDate(row[2]).startsWith(item)).reduce((sum, row) => sum + number(row[5]), 0); const max = Math.max(1, ...years.map(year => dividends.filter(row => sheetDate(row[2]).startsWith(year)).reduce((sum, row) => sum + number(row[5]), 0))); return <button key={item} className={year === item ? 'selected' : ''} onClick={() => setYear(year === item ? '全部年度' : item)}><span>{fmt(amount)}</span><i style={{ height: Math.max(5, amount / max * 78) + 'px' }}/><strong>{item}</strong></button>; })}</section><div className="dividend-filters"><select aria-label="股利年度" value={year} onChange={event => setYear(event.target.value)}><option>全部年度</option>{years.map(item => <option key={item}>{item}</option>)}</select><button className="icon-button" aria-label="匯出股利記錄" onClick={() => exportCSV('dividends')}><ArrowDownToLine size={18}/></button></div>{search('搜尋股利')}<section className="record-list dividends-list" aria-label="股利清單">{filteredDividends.map((row, index) => <article className="record-card" key={index}><div className="record-top"><span className="dividend-icon"><Flower2 size={20}/></span><div><h3>{stockName(row[1])}</h3><p>{normalizeCode(row[0])} · {sheetDate(row[2])} 除息</p></div><div className="record-number"><strong>{fmt(number(row[5]))}</strong><small>實際領到股利</small></div></div><div className="record-meta"><span>每股 {fmt(number(row[3]), 4)}</span><span>當日持有 {fmt(number(row[4]))} 股</span></div></article>)}{!filteredDividends.length && <Empty loading={data.dividends?.loading} title="沒有符合條件的股利"/>}</section><p className="data-caption">依實際領到股利欄位加總，與庫存表可能有四捨五入差異。</p></>}
      {tab === 'settings' && <><section className="account-card"><span className="account-avatar"><Leaf size={25}/></span><div><h2>我的投資帳戶</h2><p><span className="status-dot"/>Google 已安全連接</p></div><ShieldCheck size={23}/></section><h2 className="group-title">顯示偏好</h2><section className="settings-group"><div className="settings-row"><span className="settings-icon"><ChartNoAxesCombined size={19}/></span><div><strong>分析報酬率包含股利</strong><p>套用於分析頁，首頁固定顯示未實現損益</p></div>{includeToggle}</div><div className="settings-row"><span className="settings-icon"><EyeOff size={19}/></span><div><strong>隱藏財務數字</strong><p>隱藏金額、報酬率與持有股數</p></div><label className="switch-label"><input type="checkbox" aria-label="隱藏財務數字" checked={hidden} onChange={event => setHidden(event.target.checked)}/><span className="switch"/></label></div></section><h2 className="group-title">資料與連線</h2><section className="settings-group"><a className="settings-row" href={sheetURL} target="_blank" rel="noreferrer"><span className="settings-icon"><Wallet size={19}/></span><div><strong>股票V2 試算表</strong><p>查看或編輯原始資料</p></div><ArrowUpRight size={18}/></a><button className="settings-row" onClick={refresh} disabled={busy}><span className="settings-icon"><RefreshCw size={19} className={busy ? 'spin' : ''}/></span><div><strong>{updatesPrices ? '更新現價並同步' : '同步試算表資料'}</strong><p>{data.holdings?.at ? `最近讀取 ${data.holdings.at}` : updatesPrices ? '先更新現價，再讀取最新庫存' : '讀取庫存、交易與股利'}</p></div><ChevronRight size={18}/></button>{api.login ? <button className="settings-row" onClick={() => void signIn()} disabled={signingIn}><span className="settings-icon"><GoogleMark/></span><div><strong>重新連接 Google</strong><p>切換帳號或更新授權</p></div><ArrowUpRight size={18}/></button> : <a className="settings-row" href={connection.signInPath || '/api/auth/google/start'} target="_top"><span className="settings-icon"><GoogleMark/></span><div><strong>重新連接 Google</strong><p>切換帳號或更新授權</p></div><ArrowUpRight size={18}/></a>}</section>{Object.keys(sourceNames).map(key => <div key={key}>{errorPanel(key)}</div>)}<h2 className="group-title">匯出資料</h2><section className="settings-group">{['holdings', 'transactions', 'dividends', 'realized'].map(source => <button className="settings-row" key={source} onClick={() => exportCSV(source)}><span className="settings-icon"><ArrowDownToLine size={18}/></span><div><strong>{sourceNames[source]}</strong></div><span className="row-suffix">CSV<ChevronRight size={16}/></span></button>)}</section><h2 className="group-title">讓藏股更順手</h2><section className="settings-group"><button className="settings-row" onClick={() => setInstall(true)}><span className="settings-icon"><Smartphone size={20}/></span><div><strong>加入主畫面</strong><p>輕點圖示，直接查看庫存</p></div><ChevronRight size={18}/></button></section><p className="privacy-caption"><ShieldCheck size={16}/>股票資料不寫入離線快取。{connection.mode === 'pages' ? 'Google 授權只保留在目前分頁，重新整理後需再次登入。' : connection.mode === 'local' ? '授權資訊僅保存在本機伺服器。' : '授權資訊加密保存在伺服器。'}</p>{<button className="signout-button" onClick={() => void signOut()} disabled={signingOut}><LogOut size={18}/>{signingOut ? '正在登出' : '登出帳戶'}</button>}<p className="app-signature">藏股 STOCKFOLIO<Leaf size={12}/></p></>}
    </main>
    <nav className="bottom-navigation" aria-label="底部分頁導覽">{navigation.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)}><span><item.icon size={22} strokeWidth={tab === item.id ? 2.2 : 1.7}/></span><span>{item.label}</span></button>)}</nav>
    {detail && <Dialog title={`${stockName(detail[1])}持股明細`} close={() => setDetail(null)}><div className="detail-heading"><span className="stock-symbol">{normalizeCode(detail[0]).startsWith('00') ? 'ETF' : stockName(detail[1]).slice(0, 1)}</span><div><h2>{stockName(detail[1])}</h2><p>{normalizeCode(detail[0])} · {detail[2]} · {fmt(number(detail[3]))} 股</p></div></div><div className="detail-value"><span>持有市值</span><strong>NT$ {fmt(number(detail[7]))}</strong><span className="detail-pnl-label">累計價差損益</span><p className={tone(number(detail[10]))}>{sgn(number(detail[10]))}<span>{rate(number(detail[13]))}</span></p></div><div className="detail-grid">{[['平均成本', 4], ['現價', 5], ['持有成本', 6], ['已實現損益', 8], ['未實現損益', 9], ['累計股利', 11]].map(([label, index]) => <div key={label}><span>{label}</span><strong>{fmt(number(detail[Number(index)]), Number(index) < 6 ? 2 : 0)}</strong></div>)}</div><div className="detail-source"><Info size={15}/><p>試算表更新：{sheetDate(detail[16], true)}<br/>累計價差損益＝已實現＋未實現，股利另列。<br/>損益沿用試算表結果，可能包含預估費用。</p></div><a className="secondary-button full-width" href={sheetURL + '#gid=985999386'} target="_blank" rel="noreferrer">查看原始試算表<ArrowUpRight size={16}/></a></Dialog>}
    {installSheet}{toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
  </div>;
}
