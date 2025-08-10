export const skinTypes = [
  "", // default
  "\u{1f3fb}", // skin type 1-2
  "\u{1f3fc}", // skin type 3
  "\u{1f3fd}", // skin type 4
  "\u{1f3fe}", // skin type 5
  "\u{1f3ff}", // skin type 6
];
export const cyclist = "\u{1f6b4}";
export const genders = [
  "", // person
  "\u{200d}\u{2642}\u{FE0F}", // man
  "\u{200d}\u{2640}\u{FE0F}", // woman
];

export function randomPersonType() {
  return `${selectRandom(skinTypes)}${selectRandom(genders)}`;
}

export function selectRandom(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomShrug() {
  return `🤷🏼${randomPersonType()}`;
}

export const NO_BIKES = "🚳";
export const WARNING = "⚠️";
export const BOUQUET = "💐";

export function randomCyclist() {
  return `${cyclist}${randomPersonType()}`;
}

export const SUNRISE = "🌅";
export const SUNSET = "🌉";
