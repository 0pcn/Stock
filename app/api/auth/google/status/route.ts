import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '@/app/chatgpt-auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await getChatGPTUser();
  return Response.json({ mode: 'hosted', configured: true, connected: Boolean(user), signInPath: chatGPTSignInPath('/'), signOutPath: chatGPTSignOutPath('/') }, { headers: { 'Cache-Control': 'private, no-store' } });
}
