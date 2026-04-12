// TODO: Restrict origin when landing site (franchisefantasy.co) starts calling edge functions directly
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function corsResponse(): Response {
  return new Response('ok', { headers: CORS_HEADERS });
}
