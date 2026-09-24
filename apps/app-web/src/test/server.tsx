import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/**
 * Testing Library renders on the client, where an async server component cannot run. React's
 * server renderer awaits them in production; this does the same for a spec: every async
 * component in the tree is called and awaited, and what it returned takes its place. Client
 * components are left for the render to run, since their hooks need one.
 */
export async function resolveServer(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
    const render = element.type as (props: object) => Promise<ReactNode>;
    return resolveServer(await render(element.props));
  }
  if (element.props.children === undefined) return element;
  return cloneElement(element, undefined, await resolveServer(element.props.children));
}
