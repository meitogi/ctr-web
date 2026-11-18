// The page's shared UI state (Svelte 5 runes). One object, read and written by the components and
// by main.js's boot / drop flow.

export const ui = $state({
  // 'checking' (looking for a stored disc) · 'boot' (drop screen) · 'ready' (a stored disc, waiting
  // for the player's press) · 'preparing' (copy into OPFS) · 'starting' (game script injected) · 'running'
  phase: 'checking',
  status: '',
  error: '',
  // the copy into OPFS : { title, detail, written, total, kind, serial }
  progress: null,
  // whole-window drag overlay
  dragging: false,
  // the replace-disc / forget-disc confirmation : { text, action, run }
  confirm: null,
  settingsOpen: false,
  // the touch layout's editor (TouchEditor.svelte) over the game
  touchEditor: false,
  tab: 'players',
  // the Multiplayer tab's panel (an adopted id : 'share')
  multi: null,
  // Share's guest page : { slot, host, list: [{ slot, name }] } from the host's messages
  room: null,
  // Share on this page (web/share/panel.js) : { sharing, starting, link, error, guests, seats } ;
  // shareCard : the link's card under the Share button is shown
  share: null,
  shareCard: false,
  // Share's guest page : the connection as web/share/guest-page.js reports it (guest.js)
  guest: null,
  // panels other modules hand over (web/share/panel.js) : { id, title, el }
  adopted: [],
  // { id, title, detail, family, leaving }
  toasts: [],
  // connected pads by Gamepad.index : { index, id, family, name }
  pads: [],
  // the game's four player slots (lib/players.js describe()) : { pad, keyboard, keyboard2, pressed }
  players: [],
  // the stored disc : { serial, size } or null
  disc: null,
  // the Controls tab is waiting for a key / button : { device: 'keyboard'|'gamepad', button }
  listening: null,
  notice: '',
  volumeOpen: false,
  // debug builds (src/dev/) : this window's « Bot » switch (lib/autopilot.js drives it), the second
  // window's progress line ({ mode, text, error })
  bot: false,
  second: null,
  // a phone's Home Screen (lib/install.js) : { ios, touch, standalone, canPrompt, persisted, kept }
  install: null,
})
