import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * Render helpers for component tests.
 *
 * Most pages/features read route params (`useParams`), navigate (`useNavigate`),
 * or consume an outlet context, so they need a router ancestor. `renderWithRouter`
 * wraps the tree in a `MemoryRouter` with controllable initial entries.
 */

interface RouterRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
}

export function renderWithRouter(
  ui: ReactElement,
  { initialEntries = ['/'], ...options }: RouterRenderOptions = {},
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
  return render(ui, { wrapper, ...options });
}
