import fetch from 'node-fetch';

const API_BASE = 'https://www.stonkfun.xyz/api/public/v1';
const POLL_INTERVAL_MS = 60000; // Rescan every 1 minute (60,000 ms)
const CONCURRENCY_LIMIT = 5;    // Max safe batch size for rate limits (300 req/min)

// Filter Criteria
const MIN_CLAIMABLE_USD = 46;
const MAX_HOLDERS = 2;
const MIN_AGE_SECONDS = 300;    // Minimum age: 300 seconds (5 minutes)
const MIN_VOLUME_USD = 4000;    // Minimum volume: $4,000 USD

// Track tokens we have already scanned to avoid redundant deep fee checks
const processedTokens = new Set();

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
 * Fetches all platform tokens across all pages
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

  // 1. Minimum Age Check (Must be >= 300 seconds old)
  const createdAtMs = token.createdAt 
    ? new Date(token.createdAt).getTime() 
    : (token.created_at ? new Date(token.created_at).getTime() : (token.timestamp ? token.timestamp * 1000 : null));

  if (createdAtMs) {
    const ageInSeconds = (Date.now() - createdAtMs) / 1000;
    
    // Skip if token is younger than 300 seconds
    if (ageInSeconds < MIN_AGE_SECONDS) {
      return;
    }
  }

  // 2. Holder Filter (Max 2 holders)
  const holderCount = token.holdersCount ?? token.holders ?? token.holderCount;
  if (holderCount === undefined || holderCount > MAX_HOLDERS) {
    return;
  }

  // 3. Minimum Volume Filter (Min $4,000 USD)
  const volumeUsd = token.volume24h 
    ?? token.volumeUsd 
    ?? token.volume 
    ?? token.stats?.volumeUsd 
    ?? 0;

  if (volumeUsd < MIN_VOLUME_USD) {
    return;
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

    // Mark as processed after reporting a match
    processedTokens.add(mint);
  }
}

async function runScan() {
  console.log(`\n[${new Date().toISOString()}] Running 60s scan cycle...`);
  const tokens = await fetchAllTokens();
  
  // Filter for tokens that are >= 300s old and not previously reported
  const readyTokens = tokens.filter(token => {
    const mint = token.mint || token.address;
    if (processedTokens.has(mint)) return false;

    const createdAtMs = token.createdAt 
      ? new Date(token.createdAt).getTime() 
      : (token.created_at ? new Date(token.created_at).getTime() : (token.timestamp ? token.timestamp * 1000 : null));

    if (!createdAtMs) return true; // Include if timestamp missing
    const ageInSeconds = (Date.now() - createdAtMs) / 1000;
    return ageInSeconds >= MIN_AGE_SECONDS;
  });

  console.log(`Fetched total ${tokens.length} tokens. ${readyTokens.length} tokens are >= 300s old and ready for scan.`);

  // Process fee checks in concurrency chunks
  for (let i = 0; i < readyTokens.length; i += CONCURRENCY_LIMIT) {
    const chunk = readyTokens.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(chunk.map(token => checkToken(token)));
  }
  
  console.log(`Cycle finished. Rescanning in 60s...`);
}

function start() {
  runScan();
  setInterval(runScan, POLL_INTERVAL_MS);
}

start();
