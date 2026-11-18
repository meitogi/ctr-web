// The game's language and the disc it is read from (platform/web_disc_view.c reads
// globalThis.__ctrLang when the disc opens : a change applies at the next start).
//
// Every disc gives the six languages' text (the US disc carries them too) ; the voices are the
// disc's : English on the US disc, the six on the PAL one. So English is read from the US disc
// when it is kept (the complete US game), another language from the PAL disc when it is kept.
// `auto` : the browser's language with a PAL disc kept, else English (a US disc alone plays as
// it always did).

export const GAME_LANGUAGES = ['en', 'fr', 'de', 'it', 'es', 'nl']

/** The first of the browser's languages the game has, else English. */
export function browserLanguage(languages) {
  for (const tag of languages ?? []) {
    const code = String(tag).toLowerCase().split('-')[0]
    if (GAME_LANGUAGES.includes(code)) return code
  }
  return 'en'
}

/**
 * @param {string} setting - 'auto' or one of GAME_LANGUAGES
 * @param {{us?: unknown, pal?: unknown}} kept - the discs kept, by region
 * @param {readonly string[]} languages - navigator.languages
 * @returns {{language: string, region: 'us'|'pal'}}
 */
export function chooseGame(setting, kept, languages) {
  const language = GAME_LANGUAGES.includes(setting) ? setting : kept.pal ? browserLanguage(languages) : 'en'
  const prefer = language === 'en' ? ['us', 'pal'] : ['pal', 'us']
  return { language, region: prefer.find((r) => kept[r]) ?? prefer[0] }
}
