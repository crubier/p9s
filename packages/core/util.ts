export type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[] ? RecursivePartial<U>[] : T[P] extends object ? RecursivePartial<T[P]> : T[P];
};

export type DeepMergeable = { [key: string]: any } | any[] | null | undefined;

export const deepMerge = <T extends DeepMergeable, U extends DeepMergeable>(obj1: T, obj2: U): T & U => {
  if (obj1 === null || obj1 === undefined) {
    return obj2 as T & U;
  }
  if (obj2 === null || obj2 === undefined) {
    return obj1 as T & U;
  }

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    return [...obj1, ...obj2] as unknown as T & U;
  }

  if (typeof obj1 === 'object' && typeof obj2 === 'object') {
    const result: { [key: string]: any } = { ...obj1 };
    for (const [key, value] of Object.entries(obj2)) {
      if (key in result && typeof result[key] === 'object' && value !== null) {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
    return result as T & U;
  }

  return obj2 as T & U;
}

type NestedObject<T> = {
  [key: string]: T | NestedObject<T>;
};

export type ReplaceNestedTypes<X, Y, T extends NestedObject<X>> = {
  [K in keyof T]: T[K] extends X ? Y : T[K] extends NestedObject<X> ? ReplaceNestedTypes<X, Y, T[K]> : T[K]
};

export const replaceNestedStrings = <X extends string, Y, T extends NestedObject<X>>(obj: T, replace: ((x: X) => Y)): ReplaceNestedTypes<X, Y, T> => {
  const entries = Object.entries(obj).map(([key, value]) => {
    if (typeof value === 'object') {
      return [key, replaceNestedStrings(value, replace)] as const;
    }
    return [key, replace(value)] as const;
  });
  return Object.fromEntries(entries) as ReplaceNestedTypes<X, Y, T>;
}

export const capitalizeFirstLetter = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
