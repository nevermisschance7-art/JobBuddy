/** Jobs per page on the board: the user picks one. Safe to import in the browser. */
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const PAGE_SIZE: PageSize = 50;
