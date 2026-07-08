import { Copy, ExternalLink } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { useMembersStore } from '../../stores';
import { emailSchema } from '../../lib/validation';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Select,
  SelectContent,
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
  const { inviteMember } = useMembersStore();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const [sending, setSending] = useState(false);
  const [sentUrl, setSentUrl] = useState<string | null>(null);

  const handleClose = () => {
    setSentUrl(null);
    setEmail('');
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      toast.error(emailResult.error.issues[0].message);
      return;
    }

    setSending(true);
    try {
      const result = await inviteMember(organizationId, emailResult.data, role);
      setSentUrl(result.inviteUrl);
      toast.success(t('members.inviteCreatedToast'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setSending(false);
    }
  };

  const copyToClipboard = async () => {
    if (sentUrl) {
      await navigator.clipboard.writeText(sentUrl);
      toast.success(t('members.linkCopiedToast'));
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
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-email">{t('members.email')}</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder={t('members.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-role">{t('members.role')}</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t('members.admin')}</SelectItem>
                    <SelectItem value="developer">{t('members.developer')}</SelectItem>
                    <SelectItem value="deployer">{t('members.deployer')}</SelectItem>
                    <SelectItem value="viewer">{t('members.viewer')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
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
                <code className="flex-1 truncate text-xs">{sentUrl}</code>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('members.inviteLinkNote')}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={copyToClipboard}>
                <Copy className="size-4" />
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
