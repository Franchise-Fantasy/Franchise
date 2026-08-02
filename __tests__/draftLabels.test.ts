import { initialDraftLabel } from '@/utils/draft/draftLabels';

describe('initialDraftLabel', () => {
  it('names the dynasty initial draft a startup draft', () => {
    expect(initialDraftLabel('dynasty')).toBe('Startup Draft');
  });

  it('names the redraft/keeper initial draft a season draft', () => {
    expect(initialDraftLabel('redraft')).toBe('Season Draft');
    expect(initialDraftLabel('keeper')).toBe('Season Draft');
  });

  // The create-league wizard holds display-cased league types ('Dynasty') while
  // every DB read gives lowercase ('dynasty'). Both call this, so dropping the
  // case fold would silently relabel the wizard's dynasty startup draft.
  it('accepts the wizard display casing', () => {
    expect(initialDraftLabel('Dynasty')).toBe('Startup Draft');
    expect(initialDraftLabel('Redraft')).toBe('Season Draft');
    expect(initialDraftLabel('Keeper')).toBe('Season Draft');
  });

  it('defaults to dynasty when the type is missing', () => {
    expect(initialDraftLabel(null)).toBe('Startup Draft');
    expect(initialDraftLabel(undefined)).toBe('Startup Draft');
  });
});
