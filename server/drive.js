// Quiz files from a Google Drive share link. No sign-in: the file must be shared as "Anyone with the link". The laptop
// downloads it (a browser page can't, Drive sends no CORS headers) and only ever asks Google's own download address.
import {QuizError} from './model.js';

const MAX_BYTES = 50 * 1024 * 1024;
const PRIVATE = 'That file isn’t shared publicly. In Drive, set General access to “Anyone with the link”, then try again.';

// The file id from the links Drive hands out: /file/d/<id>/view, open?id=<id>, uc?id=<id>, and the download address.
export function driveFileId(link) {
  let url; try {url = new URL(String(link).trim());} catch {return null;}
  if (url.protocol !== 'https:' || !['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'].includes(url.hostname)) return null;
  const id = /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
  return id && /^[a-zA-Z0-9_-]{10,200}$/.test(id) ? id : null;
}

export async function fetchDriveQuiz(link, fetchImpl = globalThis.fetch) {
  const id = driveFileId(link);
  if (!id) throw new QuizError('That is not a Google Drive file link. In Drive, use Share → Copy link on the quiz file.');
  // confirm=t skips Drive's "can't scan this file for viruses" page, which large files get.
  let response;
  try {response = await fetchImpl(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, {signal: AbortSignal.timeout(60000)});}
  catch {throw new QuizError('Google Drive could not be reached. Is this laptop online?', 502);}
  if (response.status === 404) throw new QuizError('Google Drive has no file at that link.', 404);
  if (response.status === 401 || response.status === 403) throw new QuizError(PRIVATE, 403);
  if (!response.ok) throw new QuizError(`Google Drive said ${response.status}. Check the file is shared as “Anyone with the link”.`, 502);
  // A file that isn't shared publicly comes back as Google's sign-in page.
  if (/text\/html/i.test(response.headers.get('content-type') || '')) throw new QuizError(PRIVATE, 403);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new QuizError('Quiz files must be under 50 MB', 413);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new QuizError('Quiz files must be under 50 MB', 413);
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new QuizError('That file is not a quiz JSON file');}
}
