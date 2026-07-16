import type { MouseEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/primitives/alert-dialog';
import { useTranslation } from '../../i18n';
import type { PendingMemberAction } from './memberPresentation';

interface MemberActionDialogProps {
  action: PendingMemberAction | null;
  confirming: boolean;
  onConfirm: (event: MouseEvent) => void;
  onDismiss: () => void;
}

export function MemberActionDialog({
  action,
  confirming,
  onConfirm,
  onDismiss,
}: MemberActionDialogProps) {
  const { t } = useTranslation();
  const title = action
    ? action.kind === 'remove-member'
      ? t('members.removeConfirm', { name: action.member.name })
      : t('members.revokeConfirm', { email: action.invitation.email })
    : '';
  const description =
    action?.kind === 'remove-member'
      ? t('members.removeConfirmDesc')
      : t('members.revokeConfirmDesc');

  return (
    <AlertDialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open && !confirming) onDismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? t('members.confirming') : t('members.confirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
