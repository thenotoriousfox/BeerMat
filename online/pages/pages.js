// The pages emailed links open (online/service.js): confirming an email address, and choosing a new password.
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token');
// The token is in the address only until it is read, so it isn't left in the browser's history.
if (token) history.replaceState(null, '', location.pathname);
const say = (text, error = false) => {$('status').textContent = text; $('status').classList.toggle('error', error);};
async function post(route, body) {
  const response = await fetch(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'Something went wrong. Try again later.');
  return data;
}

if (document.body.dataset.page === 'verify') {
  if (!token) say('This link is incomplete. Open it straight from the email.', true);
  else post('/v1/verify', {token}).then(() => say('Thanks: your email address is confirmed. You can close this page.'), e => say(e.message, true));
}

if (document.body.dataset.page === 'reset') {
  const form = token ? $('choose') : $('ask');
  form.hidden = false;
  form.onsubmit = async e => {
    e.preventDefault();
    const button = form.querySelector('button'); button.disabled = true;
    try {
      if (!token) {await post('/v1/password-reset', {email: $('email').value}); form.hidden = true; say('If that address has a BeerMat account, a link is on its way. It works for an hour.');}
      else {
        if ($('password').value !== $('again').value) throw Error('The two passwords don’t match');
        await post('/v1/password-reset/confirm', {token, password: $('password').value});
        form.hidden = true; say('Your password is changed. Sign in with it in the BeerMat app or on the quiz desk.');
      }
    } catch (error) {say(error.message, true);} finally {button.disabled = false;}
  };
}
