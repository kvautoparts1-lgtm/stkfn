import fetch from 'node-fetch';

const API_BASE = 'https://www.stonkfun.xyz/api/public/v1';
const POLL_INTERVAL_MS = 30000; // Polls every 30 seconds
const CONCURRENCY_LIMIT = 5;    // Max safe batch size to respect StonkFun rate limits (300 req/min)

// Filter Criteria
const MIN_CLAIMABLE_USD = 46;
const MAX_HOLDERS = 2;
const MIN_AGE_SECONDS = 300;    // Minimum age: 5 minutes
const MIN_VOLUME_USD = 4000;    // Minimum volume: $4,000

async function apiCall(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || json;
  } catch (err) {
    console.error(`[ERR] Failed fetching ${endpoint}:`, err.message);
    return null;
  }
}

/**
 * Fetches all active tokens across all pages instead of stopping at page 1
 */
async function fetchAllTokens() {
  let allTokens = [];
  let page = 1;
  const limit = 50;

  while (true) {
    const data = await apiCall(`/tokens?sort=newest&page=${page}&limit=${limit}`);
    const tokens = Array.isArray(data) ? data : (data?.tokens || []);

    if (!tokens || tokens.length === 0) {
      break;
    }

    allTokens.push(...tokens);

    // If the page returned fewer items than requested, we reached the end
    if (tokens.length < limit) {
      break;
    }

    page++;
  }

  return allTokens;
}

async function checkToken(token) {
  const mint = token.mint || token.address;
  if (!mint) return;

  // 1. Holder Filter (Max 2 holders)
  const holderCount = token.holdersCount ?? token.holders ?? token.holderCount;
  if (holderCount === undefined || holderCount > MAX_HOLDERS) {
    return;
  }

  // 2. Minimum Age Filter (Min 300 seconds)
  const createdAtMs = token.createdAt 
    ? new Date(token.createdAt).getTime() 
    : (token.created_at ? new Date(token.created_at).getTime() : (token.timestamp ? token.timestamp * 1000 : null));

  if (createdAtMs) {
    const ageInSeconds = (Date.now() - createdAtMs) / 1000;
    if (ageInSeconds < MIN_AGE_SECONDS) {
      return; // Token is too young
    }
  }

  // 3. Minimum Volume Filter (Min $4,000 USD)
  const volumeUsd = token.volume24h 
    ?? token.volumeUsd 
    ?? token.volume 
    ?? token.stats?.volumeUsd 
    ?? 0;

  if (volumeUsd < MIN_VOLUME_USD) {
    return; // Volume below threshold
  }

  // 4. Fetch Claimable Creator Fees
  const feeData = await apiCall(`/tokens/${mint}/fees`);
  if (!feeData || !feeData.claimable) return;

  // 5. Extract Claimable USD Amount
  const claimable = feeData.claimable;
  const usdValue = claimable.quote?.amountUsd 
    ?? claimable.usdValue 
    ?? claimable.totalUsd 
    ?? 0;

  if (usdValue > MIN_CLAIMABLE_USD) {
    console.log('====================================');
    console.log(`[MATCH FOUND] Token Mint: ${mint}`);
    console.log(`Symbol:           ${token.symbol || 'N/A'}`);
    console.log(`Holders:          ${holderCount}`);
    console.log(`Volume USD:       $${volumeUsd.toFixed(2)}`);
    console.log(`Claimable USD:    $${usdValue.toFixed(2)}`);
    console.log(`Timestamp:        ${new Date().toISOString()}`);
    console.log('====================================');
  }
}

async function runScan() {
  console.log(`\n[${new Date().toISOString()}] Starting scan cycle...`);
  const tokens = await fetchAllTokens();
  console.log(`Fetched total ${tokens.length} tokens across all pages. Applying filters...`);

  // Process fee checks in concurrency chunks to stay within rate limits
  for (let i = 0; i < tokens.length; i += CONCURRENCY_LIMIT) {
    const chunk = tokens.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(chunk.map(token => checkToken(token)));
  }
  
  console.log(`Scan completed. Next scan in ${POLL_INTERVAL_MS / 1000}s.`);
}

function start() {
  runScan();
  setInterval(runScan, POLL_INTERVAL_MS);
}

start();
