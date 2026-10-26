import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title:'藏股 Stockfolio｜我的股票庫存',description:'看見每一筆投資的累積。個人台股庫存、損益與股利管理。',
 manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'藏股',statusBarStyle:'default'},
 icons:{icon:'/icon.svg',apple:'/icons/apple-touch-icon.png'}
};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#1b352e',viewportFit:'cover'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-Hant"><body>{children}</body></html>}
