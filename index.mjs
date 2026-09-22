import fetch from 'node-fetch';

const API_BASE = 'https://www.stonkfun.xyz/api/public/v1';
const POLL_INTERVAL_MS = 30000; // Polls every 30 seconds
const CONCURRENCY_LIMIT = 5;    // Controls batching to respect rate limits

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

async function fetchAllTokens() {
  const data = await apiCall('/tokens?sort=newest');
  if (!data) return [];
  return Array.isArray(data) ? data : (data.tokens || []);
}

async function checkToken(token) {
  const mint = token.mint || token.address;
  if (!mint) return;

  // 1. Holder filter check (Max 2 holders)
  const holderCount = token.holdersCount ?? token.holders ?? token.holderCount;
  if (holderCount === undefined || holderCount > 2) {
    return;
  }

  // 2. Fetch claimable fees
  const feeData = await apiCall(`/tokens/${mint}/fees`);
  if (!feeData || !feeData.claimable) return;

  // 3. Extract claimable amount in USD (or compute from quote value)
  const claimable = feeData.claimable;
  const usdValue = claimable.quote?.amountUsd 
    ?? claimable.usdValue 
    ?? claimable.totalUsd 
    ?? 0;

  if (usdValue > 46) {
    console.log('====================================');
    console.log(`[MATCH FOUND] Token Mint: ${mint}`);
    console.log(`Symbol:           ${token.symbol || 'N/A'}`);
    console.log(`Holders:          ${holderCount}`);
    console.log(`Claimable USD:    $${usdValue.toFixed(2)}`);
    console.log(`Timestamp:        ${new Date().toISOString()}`);
    console.log('====================================');
  }
}

async function runScan() {
  console.log(`\n[${new Date().toISOString()}] Starting scan cycle...`);
  const tokens = await fetchAllTokens();
  console.log(`Fetched ${tokens.length} tokens. Checking criteria...`);

  // Process in concurrency chunks to stay within rate limits
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