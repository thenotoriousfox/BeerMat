#!/usr/bin/env node
// Sets up BeerMat Pro in a Stripe account: the product, its monthly and yearly prices, the customer portal (venues
// update their card, switch between monthly and yearly, or cancel) and the webhook that tells BeerMat Online. Safe to
// run again: what exists is reused. Run it once in test mode and once in live mode.
//   STRIPE_SECRET_KEY=sk_… node online/stripe-setup.mjs https://online.beermatquiz.co.uk https://beermatquiz.co.uk
// It prints the lines for /etc/beermat-online/env. The webhook's signing secret is only shown when the webhook is made;
// to make it again (and see a new secret), add --new-webhook.
const key = process.env.STRIPE_SECRET_KEY;
const [online, site] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!key || !online || !site) throw Error('usage: STRIPE_SECRET_KEY=sk_… node online/stripe-setup.mjs <online url> <site url> [--new-webhook]');
const newWebhook = process.argv.includes('--new-webhook');

async function stripe(method, path, params = {}) {
  const body = new URLSearchParams();
  const add = (prefix, value) => {
    if (Array.isArray(value)) value.forEach((v, i) => add(`${prefix}[${i}]`, v));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) add(`${prefix}[${k}]`, v);
    else body.append(prefix, String(value));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  const get = method === 'GET';
  const response = await fetch(`https://api.stripe.com/v1/${path}${get && body.size ? '?' + body : ''}`, {method, headers: {Authorization: 'Bearer ' + key}, ...(get ? {} : {body})});
  const data = await response.json();
  if (!response.ok) throw Error(`Stripe ${method} ${path}: ${data.error?.message || response.status}`);
  return data;
}

const prices = {monthly: {lookup: 'beermat_pro_monthly', amount: 1999, interval: 'month'}, yearly: {lookup: 'beermat_pro_yearly', amount: 19900, interval: 'year'}};
const found = (await stripe('GET', 'prices', {lookup_keys: Object.values(prices).map(p => p.lookup), expand: ['data.product']})).data;
let product = found[0]?.product;
if (!product) product = await stripe('POST', 'products', {name: 'BeerMat Pro', description: 'Unlimited questions and teams, and your venue on the BeerMat map.', metadata: {beermat: 'pro'}});
const ids = {};
for (const [name, p] of Object.entries(prices)) {
  const existing = found.find(x => x.lookup_key === p.lookup);
  ids[name] = existing ? existing.id : (await stripe('POST', 'prices', {product: product.id, currency: 'gbp', unit_amount: p.amount, recurring: {interval: p.interval}, lookup_key: p.lookup, nickname: `BeerMat Pro ${name}`})).id;
}

// The customer portal: update the card, see invoices, switch between the two prices, cancel at the end of the period.
const portal = {business_profile: {headline: 'BeerMat Pro', privacy_policy_url: `${site}/privacy`, terms_of_service_url: `${site}/terms`},
  default_return_url: site,
  features: {payment_method_update: {enabled: true}, invoice_history: {enabled: true}, customer_update: {enabled: true, allowed_updates: ['email', 'address', 'name']},
    subscription_cancel: {enabled: true, mode: 'at_period_end', cancellation_reason: {enabled: true, options: ['too_expensive', 'unused', 'missing_features', 'switched_service', 'other']}},
    subscription_update: {enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: [{product: product.id, prices: [ids.monthly, ids.yearly]}]}}};
const portals = (await stripe('GET', 'billing_portal/configurations', {is_default: true})).data;
if (portals[0]) await stripe('POST', `billing_portal/configurations/${portals[0].id}`, portal);
else await stripe('POST', 'billing_portal/configurations', portal);

// The webhook: payments, renewals, changes and cancellations.
const url = `${online}/v1/stripe/webhook`, events = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
const hooks = (await stripe('GET', 'webhook_endpoints', {limit: 100})).data.filter(h => h.url === url);
let secret = null;
if (hooks.length && newWebhook) for (const h of hooks) await stripe('DELETE', `webhook_endpoints/${h.id}`);
if (!hooks.length || newWebhook) secret = (await stripe('POST', 'webhook_endpoints', {url, enabled_events: events, description: 'BeerMat Online'})).secret;
else await stripe('POST', `webhook_endpoints/${hooks[0].id}`, {enabled_events: events});

console.log(`Stripe ready (${key.startsWith('sk_live') ? 'LIVE' : 'test'} mode): product ${product.id}`);
console.log('For /etc/beermat-online/env:');
console.log(`STRIPE_PRICE_MONTHLY=${ids.monthly}\nSTRIPE_PRICE_YEARLY=${ids.yearly}`);
console.log(secret ? `STRIPE_WEBHOOK_SECRET=${secret}` : 'STRIPE_WEBHOOK_SECRET: unchanged (the webhook already existed; --new-webhook makes a new one)');
