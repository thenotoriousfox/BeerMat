// The quiz Wi-Fi's sign-in sheet (the window a phone opens itself when the Wi-Fi has no internet): only how to stay on
// the Wi-Fi. Teams join in the phone's own browser, which keeps their team when the sheet closes.
import {setLanguage, t} from '/i18n.js';

const $ = id => document.getElementById(id);
fetch('/api/leaderboard').then(r => r.json()).then(s => {
  setLanguage(s.settings?.language);
  $('title').textContent = s.settings?.title || 'BeerMat';
  $('heading').textContent = t('You’re on the quiz Wi-Fi');
  $('stay').textContent = t('If your phone warns about “no internet”, choose “Use network as is” or “Stay connected”.');
  $('next').textContent = t('Then close this and scan the code on the TV, or open {url} in your browser.', {url: (s.settings?.joinUrl || 'http://10.42.0.1').replace(/^https?:\/\//, '')});
}).catch(() => {});
