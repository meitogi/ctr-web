// What the player suites cover, for web/test/player/select.mjs : which scenarios a change runs.
//
// Each suite tags its scenarios (`export const tags = { 'SCENARIO': ['race', …] }`) with the areas
// it covers ; PATHS below says which areas a file of the repository touches. A change runs the
// scenarios tagged with one of the areas its files touch ; a file no rule claims runs the smoke.
//
// The areas :
//   boot    the game's start : the disc, the retail intro, the first menu
//   menu    the game's menus (main menu, character and track selects)
//   race    a race running : driving, laps, the end of a race
//   render  the picture : the renderer, the split screen
//   unlock  the home page's « Unlock everything » box and what the menus open with it
//   card    the memory card : what the game saves and reads back
//   input   keyboards, pads, mappings, the players' seats
//   audio   the sound
//   page    the page around the game : boot screen, Settings, toasts, the Share button
//   share   Share : the room, the guests, the relay
//   harness the tests' own tools (the fast start, the snapshots, ctr.mjs)

/** The suites a level can run, in the order they run. */
export const SUITES = ['fast', 'menu', 'time-trial', 'bare', 'couch', 'split', 'ux', 'share', 'audio']

/** The tag level : one scenario per area, ~5 min. */
export const SMOKE = [
	['menu', 'BOOT-MENU'],
	['time-trial', 'TT-LAP'],
	['bare', 'BARE-PAGE'],
	['bare', 'UNLOCK-ON'],
	['bare', 'SHARE-BUTTON'],
]

/** Words only : a change of these runs no test at all. */
export const WORDS = /(^|\/)[^/]*\.md$|^docs\/|^LICENSE$|^metadata\//

// [pattern, areas] : the first pattern a path matches decides ; [] = no player suite (node --test,
// the site's guard, or nothing to run). The suites' own files are not here : a change to one runs the
// scenarios it changed (select.mjs).
export const PATHS = [
	// words only (and no `node --test` either)
	[WORDS, []],
	// the tests' tools
	[/^web\/test\/player\/(ctr|coverage|select)\.mjs$|^web\/test\/player\/serve\.py$|^web\/ui\/src\/dev\/|^platform\/web_debug_bridge\.c$/, ['harness']],
	[/^web\/test\/player\/audio-meter\.mjs$/, ['audio']],
	[/^web\/test\//, []],
	[/^web\/(ui|net|share)\/test\//, []],
	// the game
	[/^game\/230\/MM_(Characters|TrackSelect)\.c$|^include\/platform\/native_web_ui\.h$/, ['unlock', 'menu']],
	[/^game\/230\//, ['menu', 'boot']],
	[/^game\/PushBuffer\.c$/, ['render', 'race']],
	[/^game\/|^include\/|^externals\//, ['boot', 'menu', 'race', 'render']],
	[/^main\.c$|^platform\/native_(platform|memory|checkpoint|state|savestate|replay_scheduler|perf|log|assets|libapi|libetc|inline_c|gte|libgte)/, ['boot', 'menu', 'race']],
	[/^platform\/(native_(gpu|renderer|libgpu|glad)|gte_)/, ['render', 'race']],
	[/^platform\/native_(audio|libspu|str)/, ['audio']],
	[/^platform\/native_memcard/, ['card']],
	[/^platform\/native_(input|libpad)/, ['input']],
	[/^platform\/native_(cd|disc_image)/, ['boot', 'race']],
	// the page
	[/^web\/audio\//, ['audio']],
	[/^web\/(share|net)\/|^relay\//, ['share']],
	[/^web\/ui\/src\/lib\/(keys|binding|mappings|pads|pad-events|input-hook|players|guest-input|autopilot)\.js$|^web\/ui\/src\/(Controls|Players|WhoPlays)\.svelte$/, ['input', 'page']],
	[/^web\/ui\/src\/ShareButton\.svelte$/, ['share', 'page']],
	[/^web\/ui\//, ['page']],
	[/^web\/(index\.html|disc\.js)$/, ['page', 'boot']],
	[/^web\/(emscripten\.cmake|build-web\.sh|build-progress\.sh)$|^CMakeLists\.txt$|^CMakePresets\.json$/, ['boot', 'race']],
	// the site and the repository's own tooling : guard.sh's test, no player suite
	[/^web\/pages\/|^\.github\/|^\.gitignore$|^web\/(dev\.sh|serve\.sh|dev-ports\.tsv)$|^render\.yaml$/, []],
	[/^(build|package-linux|match)\.sh$|^build-msvc\.bat$|^build\.bat$|^tools\/|^tests\//, []],
]

/** The areas a path touches : an array (maybe empty), or null when no rule claims it. */
export function areasOf(path) {
	for (const [re, areas] of PATHS) if (re.test(path)) return areas
	return null
}
