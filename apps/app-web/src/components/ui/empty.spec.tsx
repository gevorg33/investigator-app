import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './empty';

describe('@shadcn/empty, as adopted', () => {
  it('keeps a heading and a paragraph in the accessibility tree', () => {
    render(
      <Empty className="extra">
        <EmptyHeader>
          <EmptyMedia>icon</EmptyMedia>
          <EmptyTitle>Nothing yet</EmptyTitle>
          <EmptyDescription>It will appear here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>actions</EmptyContent>
      </Empty>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing yet' })).toBeInTheDocument();
    expect(screen.getByText('It will appear here.').tagName).toBe('P');
    expect(screen.getByText('icon')).toHaveAttribute('data-variant', 'default');
    expect(screen.getByText('actions')).toHaveAttribute('data-slot', 'empty-content');
    expect(screen.getByText('Nothing yet').closest('[data-slot="empty"]')).toHaveClass('extra');
  });

  it('draws the icon variant on a token surface', () => {
    render(<EmptyMedia variant="icon">i</EmptyMedia>);
    expect(screen.getByText('i')).toHaveClass('bg-muted', 'text-foreground', 'rounded-lg');
  });
});
