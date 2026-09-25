import { redirect } from 'next/navigation';

/** The console opens on its one queue; the console's layout decides who may see it (T-070). */
export default function HomePage(): never {
  redirect('/verification');
}
