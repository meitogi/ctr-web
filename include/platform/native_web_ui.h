#ifndef NATIVE_WEB_UI_H
#define NATIVE_WEB_UI_H

// The browser page's « Unlock everything » box (web/ui/, the home page ; checked by default).
// WEB_UNLOCKED(bit) is the menus' unlock test : the save's bit, as upstream, or open while the box
// is checked and the mode is not Adventure. Characters (game/230/MM_Characters.c), tracks and
// arenas (game/230/MM_TrackSelect.c). It only reads : GAME_PROGRESS.unlocks, which the memory card
// stores, is never written, so the card never gets the opened unlocks.
// g_nativeWebUnlockAll is pulled from the page once per input update (platform/native_input.c) ;
// the page is pulled, it never calls in (ASYNCIFY). Native builds : the upstream test alone.
#if defined(__EMSCRIPTEN__)
extern int g_nativeWebUnlockAll;
#define WEB_UNLOCK_ALL_OPEN   (g_nativeWebUnlockAll && ((GAME_TRACKER->gameMode1 & ADVENTURE_MODE) == 0))
#define WEB_UNLOCKED(bit)     (CHECK_ADV_BIT(GAME_PROGRESS.unlocks, bit) || WEB_UNLOCK_ALL_OPEN)
#else
#define WEB_UNLOCKED(bit) CHECK_ADV_BIT(GAME_PROGRESS.unlocks, bit)
#endif

#endif
