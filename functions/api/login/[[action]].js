import { handleBrowserLogin } from '../../../server/browser-login.mjs';
export const onRequest = ({ request, env }) => handleBrowserLogin(request, env);
