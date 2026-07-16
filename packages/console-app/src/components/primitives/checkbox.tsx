import { CheckIcon } from 'lucide-react';
import { useId, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/utils';

type CheckboxProps = Omit<React.ComponentProps<'input'>, 'checked' | 'defaultChecked' | 'onChange' | 'type'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
};

function Checkbox({
  className,
  checked,
  defaultChecked = false,
  disabled,
  id,
  onChange,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
  const isChecked = checked ?? uncontrolledChecked;

  return (
    <span
      data-slot="checkbox"
      data-checked={isChecked ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      className={cn(
        'relative inline-grid size-4 shrink-0 place-items-center rounded-[4px] border border-input text-transparent transition-colors has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground',
        className,
      )}
    >
      <input
        {...props}
        id={id ?? generatedId}
        type="checkbox"
        checked={isChecked}
        disabled={disabled}
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-[4px] disabled:cursor-not-allowed"
        onChange={(event) => {
          if (checked === undefined) {
            setUncontrolledChecked(event.currentTarget.checked);
          }
          onChange?.(event);
          onCheckedChange?.(event.currentTarget.checked);
        }}
      />
      <CheckIcon aria-hidden="true" className="pointer-events-none size-3.5" />
    </span>
  );
}

export { Checkbox };
