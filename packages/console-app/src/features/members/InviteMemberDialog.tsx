import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { useMembersStore } from '../../stores';
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
  apiBaseUrl: string;
  refreshToken: string;
  organizationId: string;
}

export function InviteMemberDialog({
  open,
  onClose,
  apiBaseUrl,
  refreshToken,
  organizationId,
}: InviteMemberDialogProps) {
  const { t } = useTranslation();
  const { inviteMember } = useMembersStore();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSending(true);
    try {
      await inviteMember(apiBaseUrl, refreshToken, organizationId, email.trim(), role);
      toast.success(t('members.invite'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
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
            <Button variant="outline" type="button" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={sending || !email.trim()}>
              {sending ? t('members.sending') : t('members.sendInvite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
