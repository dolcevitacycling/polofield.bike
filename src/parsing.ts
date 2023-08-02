// I didn't intend to write a parser combinator library but here we are.

export interface Stream {
  readonly input: string;
  readonly cursor: number;
}

export interface ParseResult<T> {
  readonly s: Stream;
  readonly result: T;
}

export type Parser<T> = (s: Stream) => ParseResult<T> | undefined;

export type Arr<T> = readonly T[];
export type ResultOfParser<T> = T extends Parser<infer R> ? R : never;
export type AllResults<T> = {
  [P in keyof T]: ResultOfParser<T[P]>;
};

export function stream(input: string): Stream {
  return { input, cursor: 0 };
}

export function streamAtEnd(s: Stream): boolean {
  return s.cursor >= s.input.length;
}

export function mapParser<T, U>(p: Parser<T>, f: (v: T) => U): Parser<U> {
  return (s: Stream) => {
    const r = p(s);
    return r ? { ...r, result: f(r.result) } : undefined;
  };
}

export function parseAll<T extends Arr<Parser<unknown>>>(
  ...args: T
): Parser<AllResults<T>> {
  return (s: Stream) => {
    const result: unknown[] = [];
    for (const p of args) {
      const r = p(s);
      if (!r) {
        return undefined;
      }
      result.push(r.result);
      s = r.s;
    }
    return { s, result: result as AllResults<T> };
  };
}

export function parseFirst<T extends Arr<Parser<unknown>>>(
  ...args: T
): Parser<ResultOfParser<T[number]>> {
  return (s: Stream) => {
    for (const p of args) {
      const r = p(s);
      if (r) {
        return r as ParseResult<ResultOfParser<T[number]>>;
      }
    }
    return undefined;
  };
}

export function ap<T, U>(a: Parser<T>, b: Parser<(t: T) => U>): Parser<U> {
  return (s: Stream) => {
    const r = a(s);
    if (!r) {
      return undefined;
    }
    const r2 = b(r.s);
    if (!r2) {
      return undefined;
    }
    return { s: r2.s, result: r2.result(r.result) };
  };
}

export function apFirst<T, U>(a: Parser<T>, b: Parser<U>): Parser<T> {
  return ap(
    a,
    mapParser(b, (_vb) => (va) => va),
  );
}

export function apSecond<T, U>(a: Parser<T>, b: Parser<U>): Parser<U> {
  return ap(
    a,
    mapParser(b, (vb) => (_va) => vb),
  );
}

export function ensureEndParsed<T>(p: Parser<T>): Parser<T> {
  return (s: Stream) => {
    const r = p(s);
    if (!r || !streamAtEnd(r.s)) {
      return undefined;
    }
    return r;
  };
}

export function parseMany1<T>(p: Parser<T>): Parser<readonly [T, ...T[]]> {
  return (s: Stream) => {
    let r = p(s);
    if (!r) {
      return undefined;
    }
    s = r.s;
    const result: [T, ...T[]] = [r.result];
    while ((r = p(s))) {
      result.push(r.result);
      s = r.s;
    }
    return { s, result };
  };
}

export function parseSepBy1<T>(
  p: Parser<T>,
  sepBy: Parser<unknown>,
): Parser<readonly [T, ...T[]]> {
  const sepP = apSecond(sepBy, p);
  return (s: Stream) => {
    let r = p(s);
    if (!r) {
      return undefined;
    }
    s = r.s;
    const result: [T, ...T[]] = [r.result];
    while ((r = sepP(s))) {
      result.push(r.result);
      s = r.s;
    }
    return { s, result };
  };
}

export function succeed<T>(result: T): Parser<T> {
  return (s: Stream) => ({ s, result });
}

export function optional<T>(p: Parser<T>): Parser<T | undefined> {
  return parseFirst(p, succeed(undefined));
}

export function setCursor(s: Stream, cursor: number): Stream {
  return { ...s, cursor };
}

export function tap<T>(
  p: Parser<T>,
  f: (s: Stream, r: undefined | ParseResult<T>) => void,
): Parser<T> {
  return (s: Stream) => {
    const r = p(s);
    f(s, r);
    return r;
  };
}

export function logFailure<T>(p: Parser<T>, message: string): Parser<T> {
  return tap(p, (s, r) => {
    if (!r) {
      console.log(message, s.input.substring(s.cursor));
    }
    return r;
  });
}
