import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPasswordResetTokenForTests } from '../src/features/auth/resetToken';
import { ForgotPasswordPage } from '../src/pages/ForgotPasswordPage';
import { LoginPage } from '../src/pages/LoginPage';
import { ResetPasswordPage } from '../src/pages/ResetPasswordPage';
import { useAuthStore } from '../src/stores/authStore';
import { useSettingsStore } from '../src/stores/settingsStore';

function renderPage(page: React.ReactNode) {
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

beforeEach(() => {
  useSettingsStore.setState({ language: 'en' });
  useAuthStore.setState({ status: 'login', user: null });
  resetPasswordResetTokenForTests();
  window.history.replaceState({}, '', '/');
});

describe('authentication pages', () => {
  it('exposes recovery from login and enforces the Rust password floor', async () => {
    const login = vi.fn();
    useAuthStore.setState({ login });
    const user = userEvent.setup();
    renderPage(<LoginPage />);

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Password must be between 12 and 128 characters')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('uses one generic recovery acceptance state for all emails', async () => {
    const requestPasswordReset = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ requestPasswordReset });
    const user = userEvent.setup();
    renderPage(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Email'), 'unknown@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('unknown@example.com'));
    expect(screen.getByText('Check your inbox')).toBeInTheDocument();
    expect(screen.getByText(/If the account can be reset/)).toBeInTheDocument();
  });

  it('submits the in-memory fragment credential and confirms session revocation', async () => {
    const confirmPasswordReset = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ confirmPasswordReset });
    window.history.replaceState({}, '', '/reset-password#token=secret-token');
    const user = userEvent.setup();
    renderPage(<ResetPasswordPage />);

    expect(window.location.hash).toBe('');
    await user.type(screen.getByLabelText('New password'), 'correct horse battery');
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(confirmPasswordReset).toHaveBeenCalledWith('secret-token', 'correct horse battery');
    });
    expect(screen.getByText(/all existing sessions were signed out/i)).toBeInTheDocument();
  });

  it('fails closed when the reset credential is missing', () => {
    renderPage(<ResetPasswordPage />);
    expect(screen.getByText('Reset link unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('accepts a new email fragment in an already-open reset page', async () => {
    renderPage(<ResetPasswordPage />);
    expect(screen.getByText('Reset link unavailable')).toBeInTheDocument();

    window.history.replaceState({}, '', '/reset-password#token=later-token');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(await screen.findByLabelText('New password')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });
});
