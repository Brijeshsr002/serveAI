/**
 * What holds back an automatic refresh: an open dialog, or anything marked with data-live-refresh-pause.
 * A refresh can move a card to another column or drop it from the list, which would throw away what's inside.
 */
export const LIVE_REFRESH_PAUSE = '[data-slot="dialog-content"], [data-live-refresh-pause]';

export const liveRefreshPaused = (doc: Pick<Document, "querySelector">) => doc.querySelector(LIVE_REFRESH_PAUSE) !== null;
