import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/**
 * Testing Library renders on the client, where an async server component cannot run. React's
 * server renderer awaits them in production; this does the same for a spec: every async
 * component in the tree is called and awaited, and what it returned takes its place. Client
 * components are left for the render to run, since their hooks need one. As on the server, that
 * includes an element handed to a component as any prop, not only as its children.
 */
export async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
    const render = element.type as (props: object) => Promise<ReactNode>;
    return resolveServer(await render(element.props));
  }
  const nodes = Object.entries(element.props).filter(
    ([, value]) => isValidElement(value) || Array.isArray(value),
  );
  if (nodes.length === 0) return element;
  const resolved = await Promise.all(
    nodes.map(async ([key, value]) => [key, await resolveServer(value as ReactNode)] as const),
  );
  return cloneElement(element, Object.fromEntries(resolved));
}
