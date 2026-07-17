// Minimal ambient types for react-test-renderer (19.x is already in the tree as
// a transitive dep; @types/react-test-renderer is not installed and we avoid
// adding a devDependency just for two test files). Covers only the surface used
// by lib/__tests__/loginUx.test.tsx.
declare module "react-test-renderer" {
  import type { ReactElement } from "react";

  export interface ReactTestInstance {
    props: Record<string, unknown> & { [key: string]: any };
    parent: ReactTestInstance | null;
    type: unknown;
    findAll(
      predicate: (node: ReactTestInstance) => boolean,
      options?: { deep?: boolean }
    ): ReactTestInstance[];
    find(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance;
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    toJSON(): unknown;
    unmount(): void;
    update(el: ReactElement): void;
  }

  export function create(el: ReactElement, options?: unknown): ReactTestRenderer;
  export function act(cb: () => void | Promise<void>): Promise<void>;

  const TestRenderer: {
    create: typeof create;
    act: typeof act;
    ReactTestInstance: ReactTestInstance;
    ReactTestRenderer: ReactTestRenderer;
  };
  export default TestRenderer;
}
