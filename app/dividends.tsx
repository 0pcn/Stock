'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ChevronDown, ChevronRight, Flower2, LoaderCircle, Search, X } from 'lucide-react';
import { dividendEntries, dividendMonths, dividendStocks, dividendTotal, type DividendEntry } from '../lib/dividend-metrics.mjs';

type Props = { rows: (string | number | null)[][]; hidden: boolean; loading?: boolean; at?: string; exportCSV: () => void };
export default function Dividends({ rows, hidden, loading, at, exportCSV }: Props) {
  const entries = useMemo(() => dividendEntries(rows), [rows]);
  const years = [...new Set(entries.map(entry => entry.year))].sort().reverse();
  const [chosenYear, setChosenYear] = useState('');
  const year = chosenYear === 'all' || years.includes(chosenYear) ? chosenYear : years[0] || 'all';
  const [mode, setMode] = useState<'months' | 'stocks'>('months');
  const [month, setMonth] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const returnView = useRef<{ scroll: number; id: string } | null>(null);
  const scoped = entries.filter(entry => year === 'all' || entry.year === year);
  const months = dividendMonths(scoped);
  const stocks = dividendStocks(scoped);
  const visibleStocks = stocks.filter(stock => `${stock.code} ${stock.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const history = entries.filter(entry => entry.code === code);
  const stock = history[0];
  const stockYears = [...new Set(history.map(entry => entry.year))].sort().reverse();
  const maximumYear = Math.max(1, ...stockYears.map(item => dividendTotal(history.filter(entry => entry.year === item))));
  const maximumMonth = Math.max(1, ...months.map(item => item.amount));
  const monthlyEntries = scoped.filter(entry => month === null || entry.month === month);
  const fmt = (value: number, decimals = 0) => hidden ? '••••' : value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const scopeLabel = year === 'all' ? '歷年' : `${year} 年`;

  useLayoutEffect(() => {
    if (code) { window.scrollTo({ top: 0, behavior: 'auto' }); document.getElementById('dividend-stock-title')?.focus({ preventScroll: true }); }
    else if (returnView.current) {
      const view = returnView.current; returnView.current = null;
      document.getElementById(view.id)?.focus({ preventScroll: true }); window.scrollTo({ top: view.scroll, behavior: 'auto' });
    }
  }, [code]);
  function openStock(entry: { code: string }, id: string) { returnView.current = { scroll: window.scrollY, id }; setCode(entry.code); }
  const empty = (title: string, text: string) => <div className="empty-state">{loading ? <LoaderCircle size={26} className="spin"/> : <Flower2 size={27}/>}<strong>{loading ? '正在整理股利' : title}</strong><p>{text}</p></div>;
  const record = (entry: DividendEntry, clickable = true) => {
    const content = <><span className="holding-identity"><strong>{entry.name}</strong><span>{entry.code}<i/><time dateTime={entry.date}>{entry.date}</time> 除息</span><small>每股 {fmt(entry.perShare, 4)} · 持有 {fmt(entry.shares)} 股</small></span><span className="holding-numbers"><strong>{fmt(entry.amount)}</strong><small>實際領到{clickable && <ChevronRight size={12}/>}</small></span></>;
    return clickable ? <button key={entry.id} id={`dividend-record-${entry.id}`} className="holding-row dividend-record" aria-label={`查看${entry.name} ${entry.code}歷年股利`} onClick={() => openStock(entry, `dividend-record-${entry.id}`)}>{content}</button> : <div key={entry.id} className="holding-row dividend-record">{content}</div>;
  };

  return <div className="dividends-view">
    {code ? <>
      <button className="text-button dividend-back" onClick={() => setCode(null)}><ArrowLeft size={17}/>返回股利總覽</button>
      <div className="dividend-stock-heading"><span className="dividend-icon"><Flower2 size={23}/></span><div><h2 id="dividend-stock-title" tabIndex={-1}>{stock?.name || code}</h2><p>{code} · 歷年股利</p></div></div>
      <section className="dividend-summary" aria-label="單股歷年股利摘要"><span>歷年累計股利</span><strong><small>NT$</small>{fmt(dividendTotal(history))}</strong><p>{stockYears.length} 個年度 · {history.length} 筆配息</p></section>
      <div className="section-heading outside"><h2>每年領到多少</h2><span>新台幣</span></div>
      <p className="dividend-date-note">依除息年度加總，展開查看每筆明細。</p>
      <section className="dividend-year-history" aria-label="單股歷年股利">
        {stockYears.map((item, index) => {
          const records = history.filter(entry => entry.year === item), amount = dividendTotal(records);
          return <details key={`${code}-${item}`} className="dividend-year-card" open={index === 0 ? true : undefined}>
            <summary><span className="dividend-year-label"><strong>{item} 年</strong><small>{records.length} 筆配息</small></span><span className="dividend-year-amount"><strong>{fmt(amount)}</strong><span className="dividend-year-track" aria-hidden="true"><i style={{ width: hidden ? '0%' : `${Math.max(0, amount) / maximumYear * 100}%` }}/></span></span><ChevronDown size={17}/></summary>
            <div className="dividend-year-records">{records.map(entry => record(entry, false))}</div>
          </details>;
        })}
        {!history.length && empty('目前沒有這檔股票的股利', '返回總覽，查看其他股票。')}
      </section>
    </> : <>
      <div className="dividend-toolbar"><label><span className="sr-only">股利年度</span><select aria-label="股利年度" value={year} onChange={event => { setChosenYear(event.target.value); setMonth(null); }}><option value="all">全部年度</option>{years.map(item => <option value={item} key={item}>{item} 年</option>)}</select></label><button className="icon-button" aria-label="匯出股利記錄" onClick={exportCSV}><ArrowDownToLine size={18}/></button></div>
      <section className="dividend-summary" aria-label="股利摘要"><span><Flower2 size={17}/>{scopeLabel}累計股利</span><strong><small>NT$</small>{at ? fmt(dividendTotal(scoped)) : '—'}</strong><p>{stocks.length} 檔股票 · {scoped.length} 筆配息</p></section>
      <div className="segmented-control" aria-label="股利檢視"><button className={mode === 'months' ? 'selected' : ''} aria-pressed={mode === 'months'} onClick={() => setMode('months')}>每月總覽</button><button className={mode === 'stocks' ? 'selected' : ''} aria-pressed={mode === 'stocks'} onClick={() => setMode('stocks')}>依股票看</button></div>
      {mode === 'months' ? <>
        <div className="section-heading outside"><h2>{year === 'all' ? '歷年同月份合計' : '1–12 月股利'}</h2><span>全部股票加總</span></div>
        <p className="dividend-date-note">依除息月份統計，非實際入帳月份。</p>
        <section className="dividend-month-grid" aria-label="每月股利總額">{months.map(item => <button key={item.month} className={`dividend-month${item.count ? ' has-dividends' : ''}${month === item.month ? ' selected' : ''}`} aria-label={`${item.month}月股利`} aria-pressed={month === item.month} disabled={!at} onClick={() => setMonth(month === item.month ? null : item.month)}><span>{item.month} 月<small>{item.count ? `${item.count} 筆` : '—'}</small></span><strong>{at ? fmt(item.amount) : '—'}</strong><i aria-hidden="true"><b style={{ width: hidden ? '0%' : `${Math.max(0, item.amount) / maximumMonth * 100}%` }}/></i></button>)}</section>
        <div className="section-heading outside dividend-record-heading"><h2>{month === null ? `${scopeLabel}配息明細` : `${month} 月配息明細`} <small>{monthlyEntries.length} 筆</small></h2>{month !== null && <button className="text-button" onClick={() => setMonth(null)}>清除月份<X size={13}/></button>}</div>
        {month !== null && <p className="dividend-month-total">{scopeLabel} {month} 月合計 <strong>{fmt(dividendTotal(monthlyEntries))}</strong></p>}
        <section className="stock-list" aria-label="股利配息明細">{monthlyEntries.map(entry => record(entry))}{!monthlyEntries.length && empty(!at ? '股利資料尚未讀取' : month ? `${month} 月沒有股利紀錄` : '目前沒有股利紀錄', '這裡顯示試算表既有紀錄，不預估未來配息。')}</section>
      </> : <>
        <div className="section-heading outside"><h2>{scopeLabel}各股股利</h2><span>點選看歷年</span></div>
        <label className="search-field dividend-stock-search"><Search size={18}/><input aria-label="搜尋股利股票" placeholder="搜尋股票名稱或代號" value={query} onChange={event => setQuery(event.target.value)}/>{query && <button aria-label="清除股利搜尋" onClick={() => setQuery('')}><X size={16}/></button>}</label>
        <section className="stock-list" aria-label="各股股利清單">{visibleStocks.map(item => <button className="holding-row dividend-stock-row" key={item.code} id={`dividend-stock-${item.code}`} aria-label={`查看${item.name} ${item.code}歷年股利`} onClick={() => openStock(item, `dividend-stock-${item.code}`)}><span className="holding-identity"><strong>{item.name}</strong><span>{item.code}<i/>{item.count} 筆配息</span></span><span className="holding-numbers"><strong>{fmt(item.amount)}</strong><small>查看歷年<ChevronRight size={12}/></small></span></button>)}{!visibleStocks.length && empty(at ? '沒有符合條件的股利股票' : '股利資料尚未讀取', query ? '試試其他股票名稱或代號。' : '同步後，就能查看各股的股利紀錄。')}</section>
      </>}
    </>}
    <p className="data-caption dividend-source-note">依試算表「實際領到股利」欄位加總，日期採除息日。<br/>未列出的未來股利不會估算；與庫存表可能有四捨五入差異。{at && <><br/>股利最後讀取 {at}</>}</p>
  </div>;
}
