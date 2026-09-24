import { catalogs } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { legalDocument } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { LegalDocuments } from './legal-documents';

describe('documents to accept', () => {
  it('shows each one in full before anything is accepted, with one required checkbox', () => {
    renderIntl(
      <form>
        <LegalDocuments
          documents={[
            legalDocument(),
            legalDocument({ id: 'doc-terms-2-en', title: 'Terms of service', version: 2 }),
          ]}
          intro="Read before you continue:"
          accept="I accept"
        />
      </form>,
    );
    const group = screen.getByRole('group', { name: 'Read before you continue:' });
    const privacy = within(group).getByText('Privacy policy').closest('details')!;
    expect(privacy).toHaveTextContent('Version 3, in force from Sep 1, 2026');
    expect(privacy).toHaveTextContent('What we collect.');
    expect(within(group).getByRole('checkbox', { name: 'I accept' })).toBeRequired();
    // The exact versions shown are what the form posts back.
    const form = group.closest('form')!;
    expect(new FormData(form).getAll('acceptedDocumentIds')).toEqual([
      'doc-privacy-3-en',
      'doc-terms-2-en',
    ]);
  });

  it('says which language a document is shown in when it has no translation yet', () => {
    renderIntl(<LegalDocuments documents={[legalDocument()]} intro="i" accept="a" />, 'hy');
    expect(
      screen.getByText(catalogs.hy.auth.sign_up.shown_in.replace('{language}', 'English')),
    ).toBeInTheDocument();
  });

  it('says nothing of the language when it is the reader’s, or not one the app names', () => {
    renderIntl(
      <LegalDocuments
        documents={[legalDocument({ locale: 'hy' }), legalDocument({ id: 'x', locale: 'de' })]}
        intro="i"
        accept="a"
      />,
      'hy',
    );
    expect(screen.queryByText(/English|Deutsch/)).toBeNull();
  });

  it('is nothing at all when nothing is required', () => {
    const { container } = renderIntl(<LegalDocuments documents={[]} intro="i" accept="a" />);
    expect(container).toBeEmptyDOMElement();
  });
});
