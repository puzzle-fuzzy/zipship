import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import { useAuthStore } from '../../stores';
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
import { Label } from '../../components/primitives/label';

interface ProfileEditDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ProfileEditDialog({ open, onClose }: ProfileEditDialogProps) {
  const { t } = useTranslation();
  const { user, updateProfile } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateProfile(name.trim());
      toast.success('Profile updated');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>Update your display name</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Email</Label>
              <Input value={user?.email ?? ''} disabled className="text-muted-foreground" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? 'Saving...' : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
