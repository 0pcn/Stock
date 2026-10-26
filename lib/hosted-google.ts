import { env } from 'cloudflare:workers';
import { createHostedGoogle } from './hosted-google.mjs';
export const handleHostedGoogle = (request: Request) => createHostedGoogle({ env })(request);
