// Share, on the game page (web/index.html loads this module after the page's interface). One
// button over the game (the page's « Share », web/ui/src/ShareButton.svelte) opens a room on the
// relay, streams the game to each guest that reaches this tab directly (WebRTC) and plugs their
// pads in as the next free players ; the guest link goes to the clipboard and is shown. Pressed
// again : stop. Settings › Multiplayer › Share holds the rest : the relay and its key (a private
// relay only), the video bitrate, who is in, the same Share / Stop / link.
//
// Four players at most, the host's own included : a seat held by a device of this machine (a
// second gamepad, the keyboard's second half) is not a guest's, and a fifth player is refused —
// their window says « Too many players » (web/ui/src/lib/strings.js guestFull). The game is not
// changed for it : the seats are the page's (slots.js), and platform/native_input.c only keeps a
// pad plugged later off a guest's seat.
//
// The game calls `Module.ctrShare.present()` after each present and `readPads()` once per input
// update (platform/native_renderer.c, platform/native_input.c) ; both only touch JS state.
// window.__ctrShare.state() / .stats() are for the player suites.
import { formatRoomLink, newRoom } from '../net/link.js';
import { openRoom } from '../net/room.js';
import { DEFAULT_RELAY, DEFAULT_RELAY_KEY, keptRelay, relayWord } from '../net/relay-default.js';
import { createCapture } from './capture.js';
import { BITRATE, createShareHost } from './host.js';
import { nameOf } from './protocol.js';
import { SLOT_COUNT, createSlots } from './slots.js';

const STORE = 'ctr-share.';

const CSS = `
#share label { display: block; margin: 4px 0; }
#share [hidden] { display: none; }
#share input[type=text], #share input[type=password] { width: 100%; box-sizing: border-box; font: inherit; }
#share input[type=range] { width: 100%; }
#share button { font: inherit; cursor: pointer; margin: 4px 4px 0 0; }
#share button:disabled { opacity: .5; cursor: default; }
#share .error { color: #f66; white-space: pre-wrap; }
#share .status { white-space: pre-wrap; margin-top: 6px; }
#share .hint { color: #888; margin-top: 6px; }
#share .word.public { color: #6c6; }
#share .word.yours { color: #fb4; }
`;

const load = (k) => { try { return localStorage.getItem(STORE + k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(STORE + k, v); } catch { /* private mode */ } };
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wall = () => performance.timeOrigin + performance.now();

const Module = globalThis.Module;
// the page's interface (web/ui) : the player name, the local players, toasts and their words
const ui = globalThis.ctrUI ?? null;
const hostName = () => ui?.settings.get().name ?? '';

/** The seats a device of this machine holds (bit n = player n + 1), as the game reports them. */
function localSeats() {
  let mask = 0;
  const list = ui?.players?.slots ?? [];
  for (let s = 1; s < SLOT_COUNT; s++) if (list[s]?.pad || list[s]?.keyboard || list[s]?.keyboard2) mask |= 1 << s;
  return mask;
}
const slots = createSlots({ busy: localSeats });
let capture = null;
let host = null;
let linkText = '';
let error = '';
// What the relay said, in words (its close codes : web/net/signaling.js)
const NO_ANSWER = 'The relay does not answer.';
const NO_ONE_CAME = 'Share stopped : no one came.';
const RELAY_SAYS = {
  relay: NO_ANSWER,
  'relay-silent': NO_ANSWER,
  'relay-key': 'This relay asks for a key, or refused this one : Settings › Multiplayer › Share.',
  'relay-full': 'The relay is full. Try again later, or set your own relay.',
  'relay-address': 'Too many players from your network are on this relay. Try again later, or set your own relay.',
  'room-alone': NO_ONE_CAME,
  'relay-idle': NO_ONE_CAME,
  'room-life': 'Share stopped : its time on the relay is up. Press Share again.',
};
const RELAY_CLOSED = { 'room-alone': true, 'relay-idle': true, 'room-life': true };
// slot → {buttons, at} : when the game first read a new button word (input-latency probe)
const seen = [null, null, null, null];
let starting = null; // start() on its way

// The game's calls. Until sharing starts, no capture and no guest.
Module.ctrShare = {
  present(displayW, displayH, viewportW, viewportH) {
    capture?.present(displayW, displayH, viewportW, viewportH);
    host?.frame(); // a bot guest's own kart (debug builds : window.__ctr)
  },
  /** Returns the mask of the slots guests hold ; writes their pads at `dst` (slots.js read). */
  readPads(heap, dst) {
    const mask = slots.read(heap, dst);
    for (let s = 1; s < 4; s++) {
      if (!(mask & (1 << s))) { seen[s] = null; continue; }
      const o = dst + (s - 1) * 8;
      const buttons = heap[o + 2] | (heap[o + 3] << 8);
      if (seen[s]?.buttons !== buttons) seen[s] = { buttons, at: wall() };
    }
    return mask;
  },
};

const query = new URLSearchParams(location.search);
document.head.append(el('style', { textContent: CSS }));
const rk = el('input', { type: 'password', id: 'share-rk', value: query.get('rk') || load('rk') || DEFAULT_RELAY_KEY, autocomplete: 'off' });
const relay = el('input', { type: 'text', id: 'share-relay', value: query.get('relay') || keptRelay(load('relay') || '', rk.value) });
// which relay that is, in a word : « public » (the page's own, no key), « yours »
const relayWordOut = el('span', { id: 'share-relay-word' });
const usePublic = el('button', { type: 'button', id: 'share-relay-public', textContent: 'Use the public relay' });
const startButton = el('button', { type: 'button', id: 'share-start', textContent: 'Share' });
const stopButton = el('button', { type: 'button', id: 'share-stop', textContent: 'Stop', disabled: true });
const copyButton = el('button', { type: 'button', id: 'share-copy', textContent: 'Copy guest link', disabled: true });
const bitrate = el('input', { type: 'range', id: 'share-bitrate', min: BITRATE.min, max: BITRATE.max, step: 250_000,
  value: Number(load('bitrate')) || BITRATE.default });
const bitrateLabel = el('span');
const status = el('div', { className: 'status', id: 'share-status' });
const errorLine = el('div', { className: 'error', id: 'share-error' });
const hint = el('div', { className: 'hint', textContent: 'Guests open the link : they see and hear this game and play as the next players, four in all with yours. No disc needed. Direct connections only.' });
const panel = el('div', { id: 'share' },
  el('label', {}, 'Relay ', relayWordOut, relay),
  usePublic,
  el('label', {}, 'Relay key (a private relay only)', rk),
  startButton, stopButton, copyButton,
  el('label', {}, 'Video bitrate ', bitrateLabel, bitrate),
  status, errorLine,
  hint);
// keys typed in the panel are not the game's
panel.addEventListener('keydown', (e) => e.stopPropagation());
panel.addEventListener('keyup', (e) => e.stopPropagation());
// In the page's Settings (web/ui) : Multiplayer › Share ; else floating.
if (!globalThis.ctrUI?.adopt('share', 'Share', panel)) document.body.append(panel);

/** Waits up to `ms` for the game's audio output, so the guests' stream carries sound from the start. */
async function tapAudio(ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (capture.tapAudio()) return true;
  return false;
}

/** Shares this game on `room` (open, role host). */
async function startOn(room) {
  if (!Module.canvas?.captureStream) throw new Error('this browser cannot capture a canvas');
  capture = createCapture(Module.canvas, globalThis.ctrAudio, { onScale: (scale) => host?.setScale(scale) });
  if (!(await tapAudio(3000))) error = 'No game audio yet : guests get video only.';
  room.on('warning', (w) => { error = `${w.code}: ${w.message}`; render(); });
  room.on('close', (info) => {
    if (!host) return; // stopped here : not the relay's doing
    const why = info?.code;
    error = RELAY_CLOSED[why] ? RELAY_SAYS[why] : 'The relay closed the room.';
    if (RELAY_CLOSED[why]) {
      stop();
      ui?.toast('Share stopped', error, '', { ms: 15_000 });
    }
    render();
  });
  host = createShareHost({ room, stream: capture.stream, maxBitrate: Number(bitrate.value), scale: capture.scale, slots, hostName: hostName(),
    game: () => globalThis.__ctr ?? null });
  host.on('change', render);
  // the host is told who comes and goes, Settings open or not
  host.on('join', (g) => ui?.toast(ui.text.joined(nameOf(g.slot, g.name), g.slot + 1)));
  host.on('leave', (g) => ui?.toast(ui.text.left(nameOf(g.slot, g.name), g.slot + 1)));
  render();
  return host;
}

/** Opens a room on the relay of Settings › Multiplayer › Share and shares on it : {ok} or {ok: false, code, message}. */
function start() {
  if (host) return Promise.resolve({ ok: true });
  starting ??= begin().finally(() => { starting = null; render(); });
  render();
  return starting;
}

async function begin() {
  let result = { ok: true };
  error = '';
  save('relay', relay.value.trim());
  save('rk', rk.value.trim());
  try {
    const link = newRoom({ relay: relay.value.trim(), rk: rk.value.trim() });
    // the relay's signaling name, in clear : 'share' — the player's name goes end to end (WELCOME)
    const room = await openRoom({ link, role: 'host', name: 'share' });
    // the guest page, without this page's query : a relay key there only travels after #
    linkText = formatRoomLink(new URL('share/guest.html', location.href).href, link);
    await startOn(room);
    copyLink(ui?.text.shareOnCopied);
  } catch (e) {
    const message = String(e.message ?? e);
    error = RELAY_SAYS[e.code] ?? `${e.code ? `${e.code}: ` : ''}${message}`;
    result = { ok: false, code: e.code ?? '', message };
    capture?.stop();
    capture = null;
    host = null;
    linkText = '';
  }
  render();
  return result;
}

function stop() {
  const mine = host;
  host = null;
  mine?.close();
  capture?.stop();
  capture = null;
  linkText = '';
  render();
}

/**
 * The link to the clipboard. Its result : true copied, false not (a pad press is no gesture for
 * the clipboard : the link stays shown, with its Copy button).
 */
function copyLink(said) {
  const write = linkText && navigator.clipboard?.writeText(linkText);
  if (!write) return Promise.resolve(false);
  return write.then(() => { if (said) ui?.toast(said); return true; }, () => false);
}

function guests() {
  const out = [];
  for (const peerId in host?.guests ?? {}) {
    const g = host.guests[peerId];
    out.push({ peerId, slot: g.slot, name: g.name, path: g.path, state: g.state, error: g.error ?? null });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/** What the page's Share button shows. */
const snapshot = () => ({ sharing: !!host, starting: !!starting, link: linkText, error, guests: guests().length, seats: localSeats() });

// the page's Share button (web/ui/src/ShareButton.svelte) : start, stop, the link, its copy
globalThis.ctrShareApi = { slots, host: () => host, guests, start, stop, link: () => linkText, copy: () => copyLink(ui?.text.shareCopied), state: snapshot };

ui?.settings.subscribe((s) => { if (host && s.name !== host.hostName) host.setHostName(s.name); });

startButton.addEventListener('click', () => start());
usePublic.addEventListener('click', () => {
  relay.value = DEFAULT_RELAY;
  rk.value = DEFAULT_RELAY_KEY;
  save('relay', relay.value);
  save('rk', rk.value);
  render();
});
stopButton.addEventListener('click', stop);
copyButton.addEventListener('click', () => copyLink(ui?.text.shareCopied));
bitrate.addEventListener('input', () => {
  save('bitrate', bitrate.value);
  host?.setBitrate(Number(bitrate.value));
  render();
});

function render() {
  startButton.disabled = !!host || !!starting;
  stopButton.disabled = !host;
  copyButton.disabled = !linkText;
  const word = relayWord(relay.value);
  relayWordOut.className = `word ${word}`;
  relayWordOut.textContent = word;
  usePublic.hidden = word === 'public';
  bitrateLabel.textContent = `${(Number(bitrate.value) / 1e6).toFixed(2)} Mbit/s per guest`;
  const lines = [];
  if (!host) lines.push(starting ? 'Opening the room…' : 'Not sharing.');
  else {
    lines.push(`Sharing${capture?.audio ? ' (video + sound)' : ' (video only)'}, ${capture?.frames ?? 0} frames`);
    if (linkText) lines.push(linkText);
    const list = guests();
    lines.push(list.length ? list.map((g) => `P${g.slot + 1} ${nameOf(g.slot, g.name)} · ${g.path} · ${g.state}`).join('\n') : 'Waiting for guests');
    for (const r of host.refusals.slice(-2)) lines.push(`refused (${r.code}) : ${r.path}`);
  }
  status.textContent = lines.join('\n');
  errorLine.textContent = error;
  ui?.share?.(snapshot());
}
setInterval(() => {
  capture?.tapAudio(); // the game's audio opened late
  render();
}, 1000);
render();

/** One guest's outbound numbers : what the encoder does with the stream. */
async function senderStats(g) {
  const out = { peerId: g.link.peerId, slot: g.slot };
  const stats = await g.link.pc.getStats();
  stats.forEach((r) => {
    if (r.type === 'outbound-rtp' && r.kind === 'video') {
      Object.assign(out, { frameWidth: r.frameWidth, frameHeight: r.frameHeight, framesPerSecond: r.framesPerSecond,
        framesEncoded: r.framesEncoded, encodeMsPerFrame: r.framesEncoded ? (r.totalEncodeTime / r.framesEncoded) * 1000 : null,
        encoder: r.encoderImplementation, videoBytes: r.bytesSent, qualityLimitation: r.qualityLimitationReason, codecId: r.codecId });
    } else if (r.type === 'outbound-rtp' && r.kind === 'audio') {
      out.audioBytes = r.bytesSent;
    } else if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
      out.rttMs = r.currentRoundTripTime != null ? r.currentRoundTripTime * 1000 : null;
    }
  });
  if (out.codecId) out.codec = stats.get(out.codecId)?.mimeType;
  const p = g.senders?.video?.getParameters();
  if (p) out.params = { ...p.encodings[0], degradationPreference: p.degradationPreference };
  return out;
}

window.__ctrShare = {
  state() {
    return {
      sharing: !!host,
      link: linkText,
      maxBitrate: host?.maxBitrate ?? Number(bitrate.value),
      capture: capture && { frames: capture.frames, scale: capture.scale, display: capture.display, audio: capture.audio,
        canvas: [Module.canvas.width, Module.canvas.height] },
      guests: guests(),
      localSeats: localSeats(),
      hostName: host?.hostName ?? null,
      refusals: host?.refusals ?? [],
      pads: seen.map((p, s) => (p ? { slot: s, ...p } : null)),
      error,
    };
  },
  async stats() {
    const out = [];
    for (const peerId in host?.guests ?? {}) if (host.guests[peerId].senders) out.push(await senderStats(host.guests[peerId]));
    return out;
  },
};
