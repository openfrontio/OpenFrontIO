export function generateRandomFloat(max = 8, min = 0): number {
  return Math.random() * (max - min) + min;
}

export function generateRandomNumber(max = 8, min = 0): number {
  return Math.floor(generateRandomFloat(max + 1, min));
}

export function generateRandomBoolean(): boolean {
  return Math.random() >= 0.5;
}

export type RandomStringOptions = {
  minLength?: number;
  maxLength?: number;
  includeLowercase?: boolean;
  includeUppercase?: boolean;
  includeNumbers?: boolean;
  includeSpecial?: boolean;
  customCharacters?: string;
  secure?: boolean;
};

export function generateRandomString(
  options: RandomStringOptions | null,
): string {
  const defaultOptions: RandomStringOptions = {
    includeLowercase: true,
    includeNumbers: true,
    includeSpecial: false,
    includeUppercase: true,
    maxLength: 20,
    minLength: 1,
  };

  const config = { ...defaultOptions, ...options };

  let characters: string[] = [];
  if (config.customCharacters) {
    characters = config.customCharacters.split("");
  } else {
    if (config.includeLowercase)
      characters.push(..."abcdefghijklmnopqrstuvwxyz".split(""));
    if (config.includeUppercase)
      characters.push(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    if (config.includeNumbers) characters.push(..."0123456789".split(""));
    if (config.includeSpecial)
      characters.push(..."!@#$%^&*()_+-=[]{}|;:,.<>?".split(""));
  }

  if (characters.length === 0) {
    throw new Error("No character set selected for random string generation");
  }

  const length =
    config.minLength === config.maxLength
      ? config.minLength!
      : generateRandomNumber(config.maxLength, config.minLength);

  let result = "";
  for (let i = 0; i < length; i++) {
    result += pickRandomElement(characters);
  }

  return result;
}

export function pickRandomElement<T>(array: T[]): T {
  if (array.length === 0) {
    throw new Error("Cannot pick random element from empty array");
  }

  return array[generateRandomNumber(array.length - 1)];
}

export function generateCryptoRandomUUID(): string {
  if (crypto !== undefined && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  if (crypto !== undefined && "getRandomValues" in crypto) {
    return (([1e7] as any) + -1e3 + -4e3 + -8e3 + -1e11).replace(
      /[018]/g,
      (c: number): string =>
        (
          c ^
          (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
        ).toString(16),
    );
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c: string): string => {
      const r: number = generateRandomNumber(15);
      const v: number = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  );
}
