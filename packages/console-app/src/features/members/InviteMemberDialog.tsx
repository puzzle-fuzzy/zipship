import { Copy, ExternalLink } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { useMembersStore } from '../../stores';
import { emailSchema } from '../../lib/validation';
import { Button } from '../../components/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/primitives/input';
import { Field, FieldError, FieldGroup, FieldLabel } from '../../components/primitives/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

interface InviteMemberDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
}

export function InviteMemberDialog({
  open,
  onClose,
  organizationId,
}: InviteMemberDialogProps) {
  const { t } = useTranslation();
  const { inviteMember, fetchInvitations } = useMembersStore();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const [sending, setSending] = useState(false);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [emailError, setEmailError] = useState('');

  const handleClose = () => {
    setSentUrl(null);
    setEmail('');
    setEmailError('');
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setEmailError(t('members.invalidInviteEmail'));
      return;
    }

    setEmailError('');
    setSending(true);
    try {
      const result = await inviteMember(organizationId, emailResult.data, role);
      setSentUrl(result.inviteUrl);
      void fetchInvitations(organizationId);
      toast.success(t('members.inviteCreatedToast'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('members.inviteFailed'));
    } finally {
      setSending(false);
    }
  };

  const copyToClipboard = async () => {
    if (sentUrl) {
      try {
        await navigator.clipboard.writeText(sentUrl);
        toast.success(t('members.linkCopiedToast'));
      } catch {
        toast.error(t('members.copyFailed'));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        {!sentUrl ? (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{t('members.inviteTitle')}</DialogTitle>
              <DialogDescription>{t('members.inviteDesc')}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field data-invalid={Boolean(emailError)}>
                <FieldLabel htmlFor="invite-email">{t('members.email')}</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder={t('members.emailPlaceholder')}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError('');
                  }}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'invite-email-error' : undefined}
                  disabled={sending}
                />
                <FieldError id="invite-email-error">{emailError}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-role">{t('members.role')}</FieldLabel>
                <Select value={role} onValueChange={setRole} disabled={sending}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="admin">{t('members.admin')}</SelectItem>
                      <SelectItem value="developer">{t('members.developer')}</SelectItem>
                      <SelectItem value="deployer">{t('members.deployer')}</SelectItem>
                      <SelectItem value="viewer">{t('members.viewer')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={sending || !email.trim()}>
                {sending ? t('members.sending') : t('members.sendInvite')}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('members.inviteCreatedTitle')}</DialogTitle>
              <DialogDescription>
                {t('members.inviteCreatedDesc', { email })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                <code className="min-w-0 flex-1 truncate text-xs">{sentUrl}</code>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('members.inviteLinkNote')}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={copyToClipboard}>
                <Copy data-icon="inline-start" />
                {t('members.copyLink')}
              </Button>
              <Button onClick={handleClose}>{t('members.done')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
