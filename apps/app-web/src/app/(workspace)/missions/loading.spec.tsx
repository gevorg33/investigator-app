import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MissionsLoading from './loading';

describe('while missions load', () => {
  it('holds the shape of the controls and three cards, hidden from assistive technology', () => {
    const { container } = render(<MissionsLoading />);
    const shapes = container.querySelectorAll('[data-slot=skeleton]');
    // The title, the search, the two controls, and three cards.
    expect(shapes).toHaveLength(7);
    for (const shape of shapes) {
      expect(shape).toHaveAttribute('aria-hidden', 'true');
      // No pulse for a reader who asked for reduced motion.
      expect(shape).toHaveClass('motion-reduce:animate-none');
    }
  });
});
