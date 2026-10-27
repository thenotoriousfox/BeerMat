// Buying BeerMat Pro: the website's checkout, Stripe's webhook setting the venue up, approval for the map, renewals,
// the billing portal and cancelling. Against a real BeerMat Online and a stand-in for Stripe's API, with webhooks
// signed the way Stripe signs them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createService} from '../online/service.js';

const DAY = 86400000;

async function setup({withStripe = true} = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'online-payments-')), sent = [], calls = [];
  let time = Date.now();
  const subscriptions = new Map();
  // Stripe's API, as far as BeerMat Online uses it.
  const fake = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const params = Object.fromEntries(new URLSearchParams(raw)), route = req.url.split('?')[0];
    calls.push({method: req.method, route, params, auth: req.headers.authorization});
    const reply = (status, data) => {res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(data));};
    if (route === '/v1/checkout/sessions') return reply(200, {id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1'});
    if (route.startsWith('/v1/subscriptions/')) return subscriptions.has(route.slice(18)) ? reply(200, subscriptions.get(route.slice(18))) : reply(404, {error: {message: 'No such subscription'}});
    if (route === '/v1/billing_portal/sessions') return reply(200, {url: 'https://billing.stripe.test/session'});
    reply(404, {error: {message: 'Unknown'}});
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const fetchImpl = (url, options) => url.startsWith('https://api.postcodes.io/postcodes/')
    ? Promise.resolve(new Response(JSON.stringify(url.endsWith('DE12RR') ? {status: 200, result: {postcode: 'DE1 2RR', latitude: 52.9168, longitude: -1.4646, admin_district: 'Derby'}} : {status: 404}), {status: url.endsWith('DE12RR') ? 200 : 404}))
    : fetch(url, options);
  const stripe = withStripe ? {secretKey: 'sk_test_x', webhookSecret: 'whsec_test', prices: {monthly: 'price_m', yearly: 'price_y'}, siteUrl: 'https://site.test', apiBase: `http://127.0.0.1:${fake.address().port}`} : null;
  const service = createService({database: path.join(dir, 'online.sqlite'), now: () => time, publicUrl: 'https://online.test', mail: async m => {sent.push(m);}, adminEmail: 'hello@beermat.test', stripe, fetchImpl});
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const api = async (method, route, body, token) => {
    const response = await fetch(base + route, {method, headers: {'Content-Type': 'application/json', ...(token && {Authorization: 'Bearer ' + token})}, ...(body && {body: JSON.stringify(body)})});
    return {status: response.status, ...await response.json().catch(() => ({}))};
  };
  // A webhook, signed like Stripe: HMAC-SHA256 of "<time>.<body>".
  let n = 0;
  const webhook = async (type, object, {secret = 'whsec_test', id = `evt_${++n}`} = {}) => {
    const body = JSON.stringify({id, type, data: {object}}), t = Math.floor(time / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const response = await fetch(base + '/v1/stripe/webhook', {method: 'POST', headers: {'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}`}, body});
    return response.status;
  };
  const sub = (id, status, periodEnd) => {const s = {id, status, items: {data: [{current_period_end: Math.floor(periodEnd / 1000)}]}}; subscriptions.set(id, s); return s;};
  return {service, api, webhook, sub, sent, calls, tick: ms => {time += ms;}, now: () => time,
    done: async () => {await service.close(); fake.close(); rmSync(dir, {recursive: true, force: true});}};
}

const form = {venue: 'The Victoria Inn', address: '12 Midland Place', postcode: 'de1 2rr', name: 'Vic', email: 'Vic@Example.com', interval: 'monthly'};

test('without Stripe set up, checkout says so', async () => {
  const {api, done} = await setup({withStripe: false});
  try {assert.equal((await api('POST', '/v1/checkout', form)).status, 503);} finally {await done();}
});

test('checkout: the pub’s details are checked, then Stripe’s payment page', async () => {
  const {api, calls, done} = await setup();
  try {
    assert.equal((await api('POST', '/v1/checkout', {...form, postcode: 'ZZ9 9ZZ'})).status, 400, 'an unknown postcode');
    assert.equal((await api('POST', '/v1/checkout', {...form, interval: 'weekly'})).status, 400);
    assert.equal((await api('POST', '/v1/checkout', {...form, email: 'nope'})).status, 400);
    const {url} = await api('POST', '/v1/checkout', form);
    assert.equal(url, 'https://checkout.stripe.test/cs_test_1');
    const {params, auth} = calls.find(c => c.route === '/v1/checkout/sessions');
    assert.equal(auth, 'Bearer sk_test_x');
    assert.deepEqual([params.mode, params['line_items[0][price]'], params.customer_email, params.success_url, params.cancel_url], ['subscription', 'price_m', 'vic@example.com', 'https://site.test/pro/thanks', 'https://site.test/pro']);
    assert.deepEqual([params['metadata[venue]'], params['metadata[postcode]'], params['metadata[town]'], params['metadata[lat]']], ['The Victoria Inn', 'DE1 2RR', 'Derby', '52.9168']);
    assert.equal((await api('POST', '/v1/checkout', {...form, interval: 'yearly'})).status, 200);
    assert.equal(calls.filter(c => c.route === '/v1/checkout/sessions').at(-1).params['line_items[0][price]'], 'price_y');
  } finally {await done();}
});

test('paid: the venue and its operator are set up, approved for the map by an admin, renewed, and dropped when cancelled', async () => {
  const {service, api, webhook, sub, sent, tick, now, done} = await setup();
  try {
    const session = {mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', customer_details: {email: 'Vic@Example.com'},
      metadata: {venue: 'The Victoria Inn', contact: 'Vic', address: '12 Midland Place', postcode: 'DE1 2RR', town: 'Derby', lat: '52.9168', lon: '-1.4646'}};
    sub('sub_1', 'active', now() + 30 * DAY);
    assert.equal(await webhook('checkout.session.completed', session, {secret: 'whsec_wrong'}), 400, 'not signed by Stripe');
    assert.equal(await webhook('checkout.session.completed', session, {id: 'evt_paid'}), 200);
    assert.equal(await webhook('checkout.session.completed', session, {id: 'evt_paid'}), 200, 'the same event again changes nothing');
    assert.equal(await webhook('checkout.session.completed', session), 200, 'nor does the same session in another event');
    const venues = service.db.prepare('SELECT * FROM venues').all();
    assert.equal(venues.length, 1);
    const v = venues[0];
    assert.deepEqual([v.id, v.name, v.town, v.postcode, v.lat, v.plan, v.approved, v.stripe_customer], ['the-victoria-inn-derby', 'The Victoria Inn', 'Derby', 'DE1 2RR', 52.9168, 'pro', 0, 'cus_1']);
    assert.ok(Math.abs(v.plan_until - (now() + 32 * DAY)) < 2000, 'paid to the end of the period, plus two days for the renewal');

    // Emails: the operator sets a password from the link; BeerMat is told there's a venue to approve.
    const welcome = sent.find(m => m.to === 'vic@example.com'), notice = sent.find(m => m.to === 'hello@beermat.test');
    assert.match(welcome.subject, /Welcome to BeerMat Pro, The Victoria Inn/); assert.match(welcome.text, /https:\/\/online\.test\/reset\?token=/);
    assert.match(notice.subject, /approve: The Victoria Inn, Derby/);
    const setupToken = /token=([\w-]+)/.exec(welcome.text)[1];
    tick(3 * DAY);
    assert.equal((await api('POST', '/v1/password-reset/confirm', {token: setupToken, password: 'pub quiz every monday'})).reset, true, 'the setup link lasts a week');
    const vic = (await api('POST', '/v1/sessions', {email: 'vic@example.com', password: 'pub quiz every monday'})).token;

    // Not on the map until approved; the operator sees it, its plan and its billing.
    assert.deepEqual((await api('GET', '/v1/venues')).venues, []);
    const mine = (await api('GET', '/v1/me/venues', undefined, vic)).venues[0];
    assert.deepEqual([mine.plan, mine.approved, mine.billing], ['pro', false, true]);
    assert.equal((await api('POST', '/v1/venues/the-victoria-inn-derby/billing', {}, vic)).url, 'https://billing.stripe.test/session');
    const admin = (await api('POST', '/v1/accounts', {email: 'admin@example.com', password: 'correct horse battery', displayName: 'Admin'})).token;
    service.db.prepare("UPDATE accounts SET admin=1 WHERE email='admin@example.com'").run();
    assert.equal((await api('POST', '/v1/venues/the-victoria-inn-derby/approve', {}, vic)).status, 403);
    assert.equal((await api('GET', '/v1/admin/overview', undefined, admin)).awaitingApproval, 1);
    await api('POST', '/v1/venues/the-victoria-inn-derby/approve', {}, admin);
    assert.deepEqual((await api('GET', '/v1/venues')).venues.map(x => x.name), ['The Victoria Inn'], 'on the map');

    // Renewed: paid on another month. Cancelled: off Pro and off the map.
    tick(30 * DAY);
    assert.equal(await webhook('customer.subscription.updated', sub('sub_1', 'active', now() + 30 * DAY)), 200);
    assert.ok(service.db.prepare('SELECT plan_until FROM venues').get().plan_until > now() + 31 * DAY);
    assert.equal(await webhook('customer.subscription.deleted', sub('sub_1', 'canceled', now())), 200);
    tick(1000);
    assert.deepEqual((await api('GET', '/v1/venues')).venues, [], 'a cancelled venue leaves the map');
    const again = (await api('POST', '/v1/sessions', {email: 'vic@example.com', password: 'pub quiz every monday'})).token;
    assert.equal((await api('GET', '/v1/me/venues', undefined, again)).venues[0].plan, 'free', 'its operator still sees it, on Free');
  } finally {await done();}
});

test('someone who already has a BeerMat account buys: the venue is theirs, and they keep their password', async () => {
  const {service, api, webhook, sub, sent, now, done} = await setup();
  try {
    await api('POST', '/v1/accounts', {email: 'lou@example.com', password: 'correct horse battery', displayName: 'Lou'});
    sent.length = 0;
    sub('sub_2', 'active', now() + 365 * DAY);
    await webhook('checkout.session.completed', {mode: 'subscription', subscription: 'sub_2', customer: 'cus_2', customer_details: {email: 'lou@example.com'}, metadata: {venue: 'The Crown', town: 'Bath', postcode: 'BA1 1AA'}});
    const owner = service.db.prepare('SELECT a.email FROM venues v JOIN accounts a ON a.id=v.owner').get();
    assert.equal(owner.email, 'lou@example.com');
    const welcome = sent.find(m => m.to === 'lou@example.com');
    assert.match(welcome.text, /usual password/); assert.doesNotMatch(welcome.text, /reset\?token=/);
    assert.equal((await api('POST', '/v1/sessions', {email: 'lou@example.com', password: 'correct horse battery'})).status, 200);
  } finally {await done();}
});
