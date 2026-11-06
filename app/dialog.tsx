'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export default function Dialog({ title, close, children, fullScreen = false }: { title: string; close: () => void; children: React.ReactNode; fullScreen?: boolean }) {
  const element = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; element.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { document.body.style.overflow = overflow; previous?.focus(); }; }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const node = backdrop.current;
    if (!fullScreen || !viewport || !node) return;
    const resize = () => { node.style.setProperty('--sheet-height', `${viewport.height}px`); node.style.setProperty('--sheet-top', `${viewport.offsetTop}px`); };
    resize(); viewport.addEventListener('resize', resize); viewport.addEventListener('scroll', resize);
    return () => { viewport.removeEventListener('resize', resize); viewport.removeEventListener('scroll', resize); node.style.removeProperty('--sheet-height'); node.style.removeProperty('--sheet-top'); };
  }, [fullScreen]);
  return <div ref={backdrop} className={`sheet-backdrop${fullScreen ? ' full-screen-backdrop' : ''}`} onClick={close}><section ref={element} className={`bottom-sheet${fullScreen ? ' full-screen-sheet' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') close(); if (event.key !== 'Tab') return; const focusable = Array.from(element.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') || []).filter(el => !el.closest('fieldset:disabled') && (!el.closest('details:not([open])') || el.tagName === 'SUMMARY')); const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><div className="sheet-handle"/><button className="icon-button sheet-close" aria-label="關閉" onClick={close}><X size={21}/></button>{children}</section></div>;
}
