/**
 * CloudFlare Worker - TiTiler CDN Proxy
 * 
 * This worker proxies requests to your TiTiler instance on Google Cloud Run
 * and adds aggressive caching for tile requests to dramatically improve performance.
 * 
 * Expected Performance:
 * - First load: ~500ms (TiTiler processing)
 * - Cached load: ~10-50ms (CloudFlare edge cache)
 * - Cache duration: 30 days for tiles, 1 hour for metadata
 */

const TITILER_ORIGIN = 'https://titiler-1039034665364.europe-west1.run.app';

// CORS headers for browser access
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: CORS_HEADERS,
      });
    }
    
    // Only allow GET and HEAD requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    
    // Build proxied URL to TiTiler
    const titilerUrl = `${TITILER_ORIGIN}${url.pathname}${url.search}`;
    
    // Determine cache duration based on request type
    let cacheDuration = 3600; // Default: 1 hour
    
    // Tile requests (.jpg, .png, .webp) - cache for 30 days
    if (url.pathname.match(/\.(jpg|jpeg|png|webp)$/i)) {
      cacheDuration = 2592000; // 30 days
    }
    
    // Metadata endpoints - cache for 1 hour
    if (url.pathname.match(/\/(info|bounds|statistics|metadata)/)) {
      cacheDuration = 3600; // 1 hour
    }
    
    // Create cache key (includes query params for different tile parameters)
    const cacheKey = new Request(titilerUrl, request);
    const cache = caches.default;
    
    // Check cache first
    let response = await cache.match(cacheKey);
    
    if (!response) {
      // Cache miss - fetch from TiTiler origin
      console.log('Cache MISS:', titilerUrl);
      
      try {
        response = await fetch(titilerUrl, {
          method: request.method,
          headers: {
            'User-Agent': 'CloudFlare-Worker-TiTiler-Proxy/1.0',
          },
        });
        
        // Clone response to add caching headers
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', `public, max-age=${cacheDuration}`);
        headers.set('CDN-Cache-Control', `public, max-age=${cacheDuration}`);
        
        // Add CORS headers
        Object.entries(CORS_HEADERS).forEach(([key, value]) => {
          headers.set(key, value);
        });
        
        // Add custom header to indicate cache status
        headers.set('X-Cache-Status', 'MISS');
        headers.set('X-Cache-Duration', `${cacheDuration}s`);
        
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: headers,
        });
        
        // Store in cache (only for GET requests - HEAD/OPTIONS cannot be cached)
        if (request.method === 'GET') {
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
      } catch (error) {
        // If TiTiler is down, return error
        return new Response(`TiTiler Error: ${error.message}`, {
          status: 502,
          headers: CORS_HEADERS,
        });
      }
    } else {
      // Cache hit
      console.log('Cache HIT:', titilerUrl);
      
      // Add cache hit header
      const headers = new Headers(response.headers);
      headers.set('X-Cache-Status', 'HIT');
      
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
    }
    
    return response;
  },
};
