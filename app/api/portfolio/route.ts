import { connectorsForRequest } from '@/lib/connectors';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
export const dynamic = 'force-dynamic';
import { PORTFOLIO_SOURCES as sources, SPREADSHEET_ID } from '@/lib/portfolio-sources.mjs';
export async function POST(request: Request) {
 const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
 if(request.headers.get('origin')!==new URL(request.url).origin) return response({status:'invalid_request',message:'無效的請求來源'},403);
 const user=await getChatGPTUser();
 if(!user) return response({status:'reauthentication_required',message:'請先登入以讀取你的試算表',signInPath:chatGPTSignInPath('/')},401);
 let key:string; try {const body:any=await request.json();key=body.source;}catch{return response({status:'invalid_request',message:'請求格式不正確'},400)}
 if(!Object.hasOwn(sources,key))return response({status:'invalid_request',message:'找不到資料分頁'},400);
 const [sheet,range]=sources[key as keyof typeof sources];
 const outcome=await connectorsForRequest().invoke('connector_5f3c8c41a1e54ad7a76272c89e2554fa','get_spreadsheet_range',{
  spreadsheet_id:SPREADSHEET_ID,sheet_name:sheet,range,value_render_option:'UNFORMATTED_VALUE'
 });
 return response({...outcome,...(outcome.status==='reauthentication_required'?{signInPath:chatGPTSignInPath('/')}:{})});
}
