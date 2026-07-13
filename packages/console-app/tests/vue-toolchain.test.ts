import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import VueProbe from './fixtures/VueProbe.vue';

describe('Vue test toolchain', () => {
  it('renders a Vue component in jsdom', () => {
    render(VueProbe);
    expect(screen.getByRole('main')).toHaveTextContent('Vue console ready');
  });
});
