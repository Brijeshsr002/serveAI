/** Where each clip comes from, and on what licence, is in docs/MEDIA.md. */
export const CLIPS = {
  garage: ["paint-booth", "panel-repair", "jet-wash", "car-wash-inside", "open-road"],
  service: ["oil-service", "engine-repair", "parked-car"],
};

/** Plain black, so the footage keeps its colours. For wide banners with their text on the left. On phones the text runs the full width, so the shade never fades out. */
export const SIDE_OVERLAY = "bg-gradient-to-r from-black/55 to-black/25 md:to-transparent md:to-50%";

/** For small cards where the text fills the whole scene. */
export const EVEN_OVERLAY = "bg-black/60";
